"""Build the Week 2 model-comparison data used by the static site.

The source network is directed, so the script keeps that version for the
in-/out-degree story and makes a simple undirected projection for the classic
ER, Watts--Strogatz, Barabasi--Albert, and shuffle comparisons.
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import networkx as nx
import numpy as np
import pandas as pd


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = PROJECT_ROOT / "data"
NODES_PATH = DATA_DIR / "week1_nodes.tsv"
OUTPUT_PATH = DATA_DIR / "week2_models.json"

sys.path.insert(0, str(PROJECT_ROOT))
from build_graph_data import read_edges  # noqa: E402


SEED = 260927
ER_RUNS = 120
BA_RUNS = 120
NULL_RUNS = 160
WS_RUNS = 28
WS_Q_VALUES = [0, 0.001, 0.003, 0.01, 0.03, 0.05, 0.1, 0.2, 0.5, 1]


def load_graphs():
    """Return the directed source graph, undirected simple projection, and names."""
    nodes = pd.read_csv(NODES_PATH, sep="\t", comment="#", quoting=3)
    edges = read_edges(DATA_DIR / "week1_edges.tsv")
    names = nodes.set_index("node_id")["name"].to_dict()

    directed = nx.DiGraph()
    directed.add_nodes_from(nodes["node_id"])
    directed.add_edges_from(edges.itertuples(index=False, name=None))

    undirected = nx.Graph()
    undirected.add_nodes_from(nodes["node_id"])
    undirected.add_edges_from(edges.itertuples(index=False, name=None))
    return directed, undirected, names


def safe_assortativity(graph):
    value = nx.degree_assortativity_coefficient(graph)
    return None if not np.isfinite(value) else float(value)


def metrics(graph):
    """Metrics are calculated on all nodes except distance, which uses the GCC."""
    components = sorted(nx.connected_components(graph), key=len, reverse=True)
    giant = graph.subgraph(components[0]).copy()
    degrees = dict(graph.degree())
    triangles = sum(nx.triangles(graph).values()) // 3
    return {
        "nodes": graph.number_of_nodes(),
        "edges": graph.number_of_edges(),
        "mean_degree": float(np.mean(list(degrees.values()))),
        "clustering": float(nx.average_clustering(graph)),
        "transitivity": float(nx.transitivity(graph)),
        "path_length": float(nx.average_shortest_path_length(giant)),
        "giant_share": giant.number_of_nodes() / graph.number_of_nodes(),
        "isolates": len(list(nx.isolates(graph))),
        "max_degree": max(degrees.values()),
        "triangles": triangles,
        "assortativity": safe_assortativity(graph),
    }


def summary(samples):
    """Mean and standard deviation for a list of metrics dictionaries."""
    result = {}
    for key in samples[0]:
        values = [sample[key] for sample in samples if sample[key] is not None]
        if not values:
            result[key] = {"mean": None, "sd": None}
        else:
            result[key] = {
                "mean": float(np.mean(values)),
                "sd": float(np.std(values, ddof=1)) if len(values) > 1 else 0.0,
            }
    return result


def metric_summary(values):
    values = [value for value in values if value is not None]
    if not values:
        return {"mean": None, "sd": None, "low": None, "high": None}
    return {
        "mean": float(np.mean(values)),
        "sd": float(np.std(values, ddof=1)) if len(values) > 1 else 0.0,
        "low": float(np.quantile(values, 0.1)),
        "high": float(np.quantile(values, 0.9)),
    }


def top_hub_share(graph):
    degrees = list(dict(graph.degree()).values())
    total_degree = sum(degrees)
    return float(max(degrees) / total_degree) if total_degree else 0.0


def null_clustering_summary(samples, observed):
    values = [value for value in samples if value is not None]
    mean = float(np.mean(values)) if values else None
    sd = float(np.std(values, ddof=1)) if len(values) > 1 else 0.0 if values else None
    z_score = None if sd in (None, 0.0) else float((observed - mean) / sd)
    empirical_p = (
        float((sum(value >= observed for value in values) + 1) / (len(values) + 1))
        if values
        else None
    )
    return {
        "mean": mean,
        "sd": sd,
        "z_score": z_score,
        "empirical_p": empirical_p,
        "runs": len(values),
    }


def ccdf(values):
    values = np.asarray([value for value in values if value > 0], dtype=int)
    if not len(values):
        return []
    return [
        {"k": int(k), "p": float(np.mean(values >= k))}
        for k in range(1, int(values.max()) + 1)
    ]


def poisson_ccdf(mean_degree, maximum):
    """A numerically stable enough Poisson survival curve for this small range."""
    probability = math.exp(-mean_degree)
    cumulative = probability
    points = []
    for k in range(1, maximum + 1):
        points.append({"k": k, "p": max(0.0, 1 - cumulative)})
        probability *= mean_degree / k
        cumulative += probability
    return points


def band_ccdf(graphs, maximum):
    rows = []
    for graph in graphs:
        values = np.asarray(list(dict(graph.degree()).values()), dtype=int)
        rows.append([float(np.mean(values >= k)) for k in range(1, maximum + 1)])
    matrix = np.asarray(rows)
    return [
        {
            "k": k,
            "mean": float(matrix[:, k - 1].mean()),
            "low": float(np.quantile(matrix[:, k - 1], 0.1)),
            "high": float(np.quantile(matrix[:, k - 1], 0.9)),
        }
        for k in range(1, maximum + 1)
    ]


def null_samples(real_graph, make_graph, runs, seed_offset):
    values = []
    all_metrics = []
    for index in range(runs):
        graph = make_graph(SEED + seed_offset + index)
        value = metrics(graph)
        values.append(value["clustering"])
        all_metrics.append(value)
    return values, all_metrics


def make_degree_preserving_graph(real_graph, seed):
    shuffled = real_graph.copy()
    edge_count = shuffled.number_of_edges()
    nx.double_edge_swap(
        shuffled,
        nswap=10 * edge_count,
        max_tries=120 * edge_count,
        seed=seed,
    )
    return shuffled


def build_friendship_data(graph, names):
    degrees = dict(graph.degree())
    entries = []
    for node_id in graph.nodes:
        neighbours = sorted(graph.neighbors(node_id), key=lambda node: (-degrees[node], names[node]))
        neighbour_degrees = [degrees[node] for node in neighbours]
        entries.append(
            {
                "id": node_id,
                "name": names[node_id],
                "degree": degrees[node_id],
                "average_neighbor_degree": float(np.mean(neighbour_degrees)) if neighbour_degrees else None,
                "top_neighbors": [
                    {"name": names[node], "degree": degrees[node]} for node in neighbours[:8]
                ],
            }
        )

    non_isolates = [node for node in graph.nodes if degrees[node] > 0]
    fraction_outpopularized = float(
        np.mean(
            [
                np.mean([degrees[neighbor] >= degrees[node] for neighbor in graph.neighbors(node)])
                for node in non_isolates
            ]
        )
    )
    mean_degree = float(np.mean(list(degrees.values())))
    endpoint_mean = float(sum(degree * degree for degree in degrees.values()) / sum(degrees.values()))
    return {
        "global": {
            "mean_degree": mean_degree,
            "mean_friend_degree": endpoint_mean,
            "fraction_friend_at_least_as_popular": fraction_outpopularized,
        },
        "characters": sorted(entries, key=lambda item: item["name"]),
    }


def main():
    directed, real_graph, names = load_graphs()
    n = real_graph.number_of_nodes()
    m = real_graph.number_of_edges()
    mean_degree = 2 * m / n
    ws_k = 10  # NetworkX requires an even value; this is closest to the observed mean degree.
    ba_m = 5  # Mean degree is approximately 2m; 5 is the nearest standard BA setting.

    real_metrics = metrics(real_graph)
    real_metrics["top_hub_share"] = top_hub_share(real_graph)

    er_graphs = [nx.gnm_random_graph(n, m, seed=SEED + index) for index in range(ER_RUNS)]
    ba_graphs = [nx.barabasi_albert_graph(n, ba_m, seed=SEED + 10_000 + index) for index in range(BA_RUNS)]
    er_metrics = [metrics(graph) for graph in er_graphs]
    ba_metrics = [metrics(graph) for graph in ba_graphs]
    for metric_set, graphs in ((er_metrics, er_graphs), (ba_metrics, ba_graphs)):
        for metric, graph in zip(metric_set, graphs):
            metric["top_hub_share"] = top_hub_share(graph)

    ws_rows = []
    for q_index, q in enumerate(WS_Q_VALUES):
        model_graphs = [
            nx.watts_strogatz_graph(n, ws_k, q, seed=SEED + 20_000 + q_index * 1_000 + index)
            for index in range(WS_RUNS)
        ]
        model_metrics = [metrics(graph) for graph in model_graphs]
        for metric, graph in zip(model_metrics, model_graphs):
            metric["top_hub_share"] = top_hub_share(graph)
        model_summary = summary(model_metrics)
        ws_rows.append(
            {
                "q": q,
                "clustering": model_summary["clustering"],
                "path_length": model_summary["path_length"],
                "samples": [
                    {
                        "clustering": sample["clustering"],
                        "path_length": sample["path_length"],
                    }
                    for sample in model_metrics
                ],
            }
        )

    best_ws = min(ws_rows, key=lambda row: abs(row["clustering"]["mean"] - real_metrics["clustering"]))
    best_ws_metrics = next(
        row for row in ws_rows if row["q"] == best_ws["q"]
    )
    # Make a metric-shaped summary for the interactive scoreboard.
    best_ws_graphs = [
        nx.watts_strogatz_graph(n, ws_k, best_ws["q"], seed=SEED + 30_000 + index)
        for index in range(WS_RUNS)
    ]
    best_ws_metric_samples = [metrics(graph) for graph in best_ws_graphs]
    for metric, graph in zip(best_ws_metric_samples, best_ws_graphs):
        metric["top_hub_share"] = top_hub_share(graph)
    best_ws_summary = summary(best_ws_metric_samples)

    er_clustering, _ = null_samples(
        real_graph,
        lambda seed: nx.gnm_random_graph(n, m, seed=seed),
        NULL_RUNS,
        40_000,
    )
    swapped_clustering, _ = null_samples(
        real_graph,
        lambda seed: make_degree_preserving_graph(real_graph, seed),
        NULL_RUNS,
        50_000,
    )

    in_degrees = [degree for _, degree in directed.in_degree()]
    out_degrees = [degree for _, degree in directed.out_degree()]
    undirected_degrees = list(dict(real_graph.degree()).values())
    maximum_degree = max(max(in_degrees), max(out_degrees), max(undirected_degrees))
    ws_baseline = next(row for row in ws_rows if row["q"] == 0)
    ws_normalized = []
    baseline_samples = ws_baseline["samples"]
    for row in ws_rows:
        clustering_ratios = [
            sample["clustering"] / baseline["clustering"]
            if baseline["clustering"]
            else None
            for sample, baseline in zip(row["samples"], baseline_samples)
        ]
        path_ratios = [
            sample["path_length"] / baseline["path_length"]
            if baseline["path_length"]
            else None
            for sample, baseline in zip(row["samples"], baseline_samples)
        ]
        ws_normalized.append(
            {
                "q": row["q"],
                "clustering_ratio": metric_summary(clustering_ratios),
                "path_ratio": metric_summary(path_ratios),
            }
        )
    er_null_summary = null_clustering_summary(er_clustering, real_metrics["clustering"])
    degree_preserving_summary = null_clustering_summary(swapped_clustering, real_metrics["clustering"])
    model_summaries = {
        "er": summary(er_metrics),
        "ws": best_ws_summary,
        "ba": summary(ba_metrics),
    }
    model_closeness = {
        "clustering": min(
            (
                (model, abs(metrics_summary["clustering"]["mean"] - real_metrics["clustering"]))
                for model, metrics_summary in model_summaries.items()
            ),
            key=lambda item: item[1],
        )[0],
        "maximum_degree": min(
            (
                (model, abs(metrics_summary["max_degree"]["mean"] - real_metrics["max_degree"]))
                for model, metrics_summary in model_summaries.items()
            ),
            key=lambda item: item[1],
        )[0],
        "path_length": min(
            (
                (model, abs(metrics_summary["path_length"]["mean"] - real_metrics["path_length"]))
                for model, metrics_summary in model_summaries.items()
            ),
            key=lambda item: item[1],
        )[0],
    }
    interpretation = {
        "best_model_by_metric": model_closeness,
        "marvel_clustering_exceeds_degree_preserving": bool(
            real_metrics["clustering"] > degree_preserving_summary["mean"]
        ),
        "text": (
            f"The {model_closeness['clustering'].upper()} model is closest to Marvel's observed clustering, "
            f"the {model_closeness['maximum_degree'].upper()} model is closest for maximum degree, and the "
            f"{model_closeness['path_length'].upper()} model is closest for path length. Marvel clustering "
            f"{'exceeds' if real_metrics['clustering'] > degree_preserving_summary['mean'] else 'does not exceed'} "
            "the degree-preserving null expectation."
        ),
    }

    output = {
        "metadata": {
            "source": "02805 Week 1 shared Marvel Wikipedia network",
            "directed_nodes": directed.number_of_nodes(),
            "directed_edges": directed.number_of_edges(),
            "undirected_nodes": n,
            "undirected_edges": m,
            "undirected_mean_degree": mean_degree,
            "notes": {
                "distance": "Average shortest path length is calculated on the giant component.",
                "models": "ER, Watts–Strogatz, and BA are undirected models, so they use the simple undirected projection of the directed Wikipedia links.",
                "ws": f"Watts–Strogatz uses k={ws_k}, the nearest allowed ring degree to the observed mean degree.",
                "ba": f"Standard BA uses m={ba_m}, the nearest allowed integer attachment setting to the observed mean degree.",
            },
        },
        "degree_ccdf": {
            "in": {
                "real": ccdf(in_degrees),
                "poisson": poisson_ccdf(float(np.mean(in_degrees)), maximum_degree),
                "isolates": int(np.sum(np.asarray(in_degrees) == 0)),
            },
            "out": {
                "real": ccdf(out_degrees),
                "poisson": poisson_ccdf(float(np.mean(out_degrees)), maximum_degree),
                "isolates": int(np.sum(np.asarray(out_degrees) == 0)),
            },
            "undirected": {
                "real": ccdf(undirected_degrees),
                "poisson": poisson_ccdf(mean_degree, maximum_degree),
                "er_band": band_ccdf(er_graphs, maximum_degree),
                "ba_band": band_ccdf(ba_graphs, maximum_degree),
                "isolates": int(np.sum(np.asarray(undirected_degrees) == 0)),
            },
        },
        "scoreboard": {
            "real": real_metrics,
            "er": summary(er_metrics),
            "ws": {"q": best_ws_metrics["q"], "metrics": best_ws_summary},
            "ba": summary(ba_metrics),
        },
        "watts_strogatz": {
            "k": ws_k,
            "runs_per_q": WS_RUNS,
            "baseline_q": 0,
            "rows": ws_rows,
            "normalized": ws_normalized,
        },
        "null_models": {
            "real_clustering": real_metrics["clustering"],
            "runs": NULL_RUNS,
            "er": {
                "samples": er_clustering,
                "summary": er_null_summary,
            },
            "degree_preserving": {
                "samples": swapped_clustering,
                "summary": degree_preserving_summary,
            },
        },
        "interpretation": interpretation,
        "friendship": build_friendship_data(real_graph, names),
    }

    with OUTPUT_PATH.open("w", encoding="utf-8") as file:
        json.dump(output, file, ensure_ascii=False, separators=(",", ":"))

    print(f"Undirected projection: {n} nodes, {m} edges, mean degree {mean_degree:.2f}")
    print(f"Real clustering: {real_metrics['clustering']:.3f}")
    print(f"Best WS q: {best_ws['q']}")
    print(f"Wrote {OUTPUT_PATH.relative_to(PROJECT_ROOT)}")


if __name__ == "__main__":
    main()
