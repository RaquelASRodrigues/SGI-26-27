"""Build the Week 3 centrality surprise data for the static site."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import networkx as nx
import numpy as np
import pandas as pd

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = PROJECT_ROOT / "data"
OUTPUT_PATH = DATA_DIR / "week3_centrality.json"
NODES_PATH = DATA_DIR / "week1_nodes.tsv"

sys.path.insert(0, str(PROJECT_ROOT))
from build_graph_data import read_edges  # noqa: E402

SEED = 260927
NULL_RUNS = 80


def load_graph():
    nodes = pd.read_csv(NODES_PATH, sep="\t", comment="#", quoting=3)
    edges = read_edges(DATA_DIR / "week1_edges.tsv")
    info = nodes.set_index("node_id")[["name", "description"]].to_dict("index")
    graph = nx.Graph()
    graph.add_nodes_from(nodes["node_id"])
    graph.add_edges_from(edges.itertuples(index=False, name=None))
    directed = nx.DiGraph()
    directed.add_nodes_from(nodes["node_id"])
    directed.add_edges_from(edges.itertuples(index=False, name=None))
    return graph, directed, info


def centralities(graph):
    return {
        "Degree": dict(graph.degree()),
        "Closeness": nx.closeness_centrality(graph),
        "Betweenness": nx.betweenness_centrality(graph, normalized=True),
        "PageRank": nx.pagerank(graph, alpha=0.85),
    }


def fragmentation_rows(graph, names, betweenness):
    original_size = graph.number_of_nodes()
    original_giant_size = len(max(nx.connected_components(graph), key=len))
    rows = []
    for node_id in graph.nodes:
        reduced = graph.copy()
        reduced.remove_node(node_id)
        giant_after = len(max(nx.connected_components(reduced), key=len)) if reduced else 0
        rows.append({
            "id": node_id,
            "character": names[node_id],
            "betweenness": float(betweenness[node_id]),
            "giant_before": original_giant_size,
            "giant_after": giant_after,
            "reduction": float(1 - giant_after / original_size),
        })
    betweenness_rank = {
        row["id"]: index
        for index, row in enumerate(
            sorted(rows, key=lambda row: (-row["betweenness"], row["character"])),
            start=1,
        )
    }
    fragmentation_rank = {
        row["id"]: index
        for index, row in enumerate(
            sorted(rows, key=lambda row: (-row["reduction"], row["character"])),
            start=1,
        )
    }
    for row in rows:
        row["betweenness_rank"] = betweenness_rank[row["id"]]
        row["fragmentation_rank"] = fragmentation_rank[row["id"]]
    return rows, original_size, original_giant_size


def direction_rows(graph, directed, info):
    node_count = directed.number_of_nodes()
    in_degree = dict(directed.in_degree())
    out_degree = dict(directed.out_degree())

    def rank_map(values):
        ordered = sorted(values, key=lambda node: (-values[node], info[node]["name"]))
        return {node: rank for rank, node in enumerate(ordered, start=1)}

    in_rank = rank_map(in_degree)
    out_rank = rank_map(out_degree)

    def percentile(rank):
        return 100.0 * (node_count - rank) / max(1, node_count - 1)

    rows = []
    for node_id in directed.nodes:
        in_percentile = percentile(in_rank[node_id])
        out_percentile = percentile(out_rank[node_id])
        description = info[node_id]["description"]
        tags = []
        for label, words in {
            "team/group": ("team", "group", "organization", "organisation"),
            "location": ("location", "city", "country", "planet"),
            "villain": ("villain", "supervillain", "enemy"),
            "protagonist/hero": ("superhero", "hero", "protagonist"),
            "supporting character": ("character", "fictional character"),
        }.items():
            if any(word in description.lower() for word in words):
                tags.append(label)
        rows.append({
            "id": node_id,
            "character": info[node_id]["name"],
            "description": description,
            "in_degree": int(in_degree[node_id]),
            "out_degree": int(out_degree[node_id]),
            "in_rank": in_rank[node_id],
            "out_rank": out_rank[node_id],
            "in_percentile": in_percentile,
            "out_percentile": out_percentile,
            "direction_difference": out_percentile - in_percentile,
            "tags": tags,
        })

    outgoing = sorted(rows, key=lambda row: (-row["direction_difference"], row["character"]))[:5]
    incoming = sorted(rows, key=lambda row: (row["direction_difference"], row["character"]))[:5]
    top_tags = {}
    for row in outgoing + incoming:
        for tag in row["tags"]:
            top_tags[tag] = top_tags.get(tag, 0) + 1
    common_tag = max(top_tags.items(), key=lambda item: item[1]) if top_tags else None
    return {
        "rows": rows,
        "links_out_more": outgoing,
        "linked_to_more": incoming,
        "common_tag": {"label": common_tag[0], "count": common_tag[1]} if common_tag else None,
    }


def path_network(graph, directed, info, real):
    degree_rows = direction_rows(graph, directed, info)["rows"]
    degree_by_id = {row["id"]: row for row in degree_rows}
    centrality_by_id = {}
    for metric, values in real.items():
        for node_id, value in values.items():
            centrality_by_id.setdefault(node_id, {})[metric] = float(value)
    return {
        "nodes": [
            {
                "id": node_id,
                "character": info[node_id]["name"],
                "description": info[node_id]["description"],
                "in_degree": degree_by_id[node_id]["in_degree"],
                "out_degree": degree_by_id[node_id]["out_degree"],
                "centrality": centrality_by_id[node_id],
            }
            for node_id in graph.nodes
        ],
        "edges": [
            {"source": source, "target": target}
            for source, target in graph.edges
        ],
    }


def main():
    graph, directed, info = load_graph()
    names = {node_id: value["name"] for node_id, value in info.items()}
    real = centralities(graph)
    null_samples = {metric: [] for metric in real}

    for index in range(NULL_RUNS):
        null_graph = nx.gnm_random_graph(
            graph.number_of_nodes(),
            graph.number_of_edges(),
            seed=SEED + index,
        )
        null_graph = nx.relabel_nodes(
            null_graph,
            dict(zip(null_graph.nodes, graph.nodes)),
        )
        sampled = centralities(null_graph)
        for metric in null_samples:
            null_samples[metric].append(sampled[metric])

    rows = []
    for node_id, name in names.items():
        for metric in real:
            values = np.array([sample[node_id] for sample in null_samples[metric]])
            mean = float(values.mean())
            sd = float(values.std(ddof=1))
            real_value = float(real[metric][node_id])
            z_score = None if sd == 0 else float((real_value - mean) / sd)
            rows.append({
                "id": node_id,
                "character": name,
                "centrality": metric,
                "real": real_value,
                "null_mean": mean,
                "null_sd": sd,
                "z": z_score,
            })

    ranked = [row for row in rows if row["z"] is not None]
    top = sorted(ranked, key=lambda row: (-row["z"], row["character"], row["centrality"]))[:3]
    lowest = sorted(ranked, key=lambda row: (row["z"], row["character"], row["centrality"]))[:3]
    previous_top3_betweenness = sorted(
        (row for row in ranked if row["centrality"] == "Betweenness"),
        key=lambda row: (-row["z"], row["character"]),
    )[:3]
    betweenness = real["Betweenness"]
    fragmentation, original_size, original_giant_size = fragmentation_rows(graph, names, betweenness)
    direction = direction_rows(graph, directed, info)
    network_paths = path_network(graph, directed, info, real)
    top_betweenness_ids = {
        row["id"] for row in previous_top3_betweenness
    }
    top_fragmentation = sorted(
        fragmentation,
        key=lambda row: (-row["reduction"], row["character"]),
    )[:5]
    x_values = np.array([row["betweenness"] for row in fragmentation])
    y_values = np.array([row["reduction"] for row in fragmentation])
    correlation = float(np.corrcoef(x_values, y_values)[0, 1])
    output = {
        "metadata": {
            "source": "02805 Week 1 shared Marvel Wikipedia network",
            "nodes": graph.number_of_nodes(),
            "edges": graph.number_of_edges(),
            "null_model": "80 Erdős–Rényi graphs with the same node and edge counts",
            "null_runs": NULL_RUNS,
            "original_network_size": original_size,
            "original_giant_component_size": original_giant_size,
        },
        "rows": rows,
        "top": top,
        "lowest": lowest,
        "fragmentation": {
            "rows": fragmentation,
            "top5": top_fragmentation,
            "top3_betweenness_ids": sorted(top_betweenness_ids),
            "correlation": correlation,
        },
        "direction": direction,
        "path_network": network_paths,
    }
    with OUTPUT_PATH.open("w", encoding="utf-8") as file:
        json.dump(output, file, ensure_ascii=False, separators=(",", ":"))


if __name__ == "__main__":
    main()
