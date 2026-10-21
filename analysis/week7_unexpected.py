"""Build the Week 7 unexpected-pairs analysis and browser data.

Run from the repository root: python analysis/week7_unexpected.py
The directed degree-preserving null uses 100 independent graphs, each with
five accepted target-swaps per observed edge (seed 721026).
"""
from __future__ import annotations

import csv
import json
import random
import urllib.parse
from pathlib import Path

import networkx as nx
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
PAGES = DATA / "marvel_pages"
SEED = 721026
NULL_NETWORKS = 100
SWAPS_PER_EDGE = 5
TOP_COHORT_FRACTION = 0.01


def read_nodes():
    with (DATA / "week1_nodes.tsv").open(encoding="utf-8-sig", newline="") as file:
        rows = csv.DictReader((line for line in file if not line.startswith("#")), delimiter="\t")
        return list(rows)


def read_edges():
    with (DATA / "week1_edges.tsv").open(encoding="utf-8-sig", newline="") as file:
        return [tuple(row[:2]) for row in csv.reader(
            (line for line in file if line.strip() and not line.startswith("#")), delimiter="\t"
        )]


def distance_maps(graph, directed):
    view = graph if directed else graph.to_undirected()
    return {source: lengths for source, lengths in nx.all_pairs_shortest_path_length(view)}


def pair_distance(maps, a, b, directed):
    if not directed:
        return maps[a].get(b)
    forward = maps[a].get(b)
    reverse = maps[b].get(a)
    if forward is None:
        return reverse
    if reverse is None:
        return forward
    return min(forward, reverse)


def cohort_stats(maps, cohort, directed):
    distances = [pair_distance(maps, a, b, directed) for a, b in cohort]
    reachable = [distance for distance in distances if distance is not None]
    return {
        "mean_reachable_distance": float(np.mean(reachable)) if reachable else None,
        "reachable_pairs": len(reachable),
        "unreachable_pairs": len(distances) - len(reachable),
        "unreachable_fraction": (len(distances) - len(reachable)) / len(distances) if distances else 0,
    }


def rewire_directed(graph, rng, swaps_per_edge):
    """Swap edge targets; preserve source out-degrees and target in-degrees."""
    edges = list(graph.edges())
    edge_set = set(edges)
    target_swaps = swaps_per_edge * len(edges)
    accepted = attempts = 0
    max_attempts = target_swaps * 100
    while accepted < target_swaps and attempts < max_attempts:
        attempts += 1
        i, j = rng.sample(range(len(edges)), 2)
        u, v = edges[i]
        x, y = edges[j]
        if u == x or v == y or u == y or x == v:
            continue
        new_first, new_second = (u, y), (x, v)
        if new_first in edge_set or new_second in edge_set:
            continue
        edge_set.remove((u, v))
        edge_set.remove((x, y))
        edge_set.add(new_first)
        edge_set.add(new_second)
        edges[i], edges[j] = new_first, new_second
        accepted += 1
    if accepted != target_swaps:
        raise RuntimeError(f"Accepted {accepted}/{target_swaps} edge swaps after {attempts} attempts.")
    randomized = nx.DiGraph()
    randomized.add_nodes_from(graph.nodes())
    randomized.add_edges_from(edges)
    if randomized.number_of_edges() != graph.number_of_edges():
        raise AssertionError("A rewired graph changed its number of edges.")
    if dict(randomized.in_degree()) != dict(graph.in_degree()):
        raise AssertionError("A rewired graph changed node in-degrees.")
    if dict(randomized.out_degree()) != dict(graph.out_degree()):
        raise AssertionError("A rewired graph changed node out-degrees.")
    return randomized, accepted, attempts


def empirical_upper_p(observed, null_values):
    if observed is None:
        return None
    values = [value for value in null_values if value is not None]
    return (1 + sum(value >= observed for value in values)) / (1 + len(values))


def holm_adjust(p_values):
    valid = [(key, value) for key, value in p_values.items() if value is not None]
    ordered = sorted(valid, key=lambda item: item[1])
    adjusted = {}
    running = 0.0
    count = len(ordered)
    for rank, (key, value) in enumerate(ordered):
        running = max(running, min(1.0, (count - rank) * value))
        adjusted[key] = running
    return adjusted


def context(text, term, radius=100):
    import re

    match = re.search(r"(?<!\w)" + re.escape(term) + r"(?!\w)", text, re.IGNORECASE)
    if not match:
        return ""
    start = max(0, match.start() - radius)
    end = min(len(text), match.end() + radius)
    excerpt = " ".join(text[start:end].split())
    return ("…" if start else "") + excerpt + ("…" if end < len(text) else "")


def main():
    node_rows = read_nodes()
    by_id = {row["node_id"]: row for row in node_rows}
    node_ids = sorted(by_id)
    pages = {}
    for path in PAGES.glob("*.txt"):
        node_id = urllib.parse.unquote(path.stem)
        if node_id in by_id:
            pages[node_id] = " ".join(path.read_text(encoding="utf-8", errors="replace").split())
    missing = set(node_ids) - pages.keys()
    if missing:
        raise ValueError(f"Missing page text for {len(missing)} nodes: {sorted(missing)[:5]}")

    documents = [pages[node_id] for node_id in node_ids]
    vectorizer = TfidfVectorizer(stop_words="english", sublinear_tf=True, norm="l2")
    tfidf = vectorizer.fit_transform(documents).tocsr()
    matrix = np.load(DATA / "week7_embeddings.npz", allow_pickle=False)
    cached_ids = matrix["node_ids"].tolist()
    if cached_ids != node_ids:
        raise ValueError("Cached neural embedding node IDs do not match the Week 1 node order.")
    embeddings = matrix["embeddings"]
    if embeddings.shape[0] != len(node_ids):
        raise ValueError("Cached neural embedding count does not match the Week 1 nodes.")

    original = json.loads((DATA / "week7_text_network.json").read_text(encoding="utf-8"))
    tfidf_scores = np.asarray(original["similarities"], dtype=np.float64)
    lsa_scores = np.asarray(original["lsa_similarities"], dtype=np.float64)
    minilm_scores = np.asarray(
        original.get("minilm_similarities", original["embedding_similarities"]),
        dtype=np.float64,
    )
    methods = ["tfidf", "lsa", "minilm"]
    similarity_scores = {
        "tfidf": tfidf_scores,
        "lsa": lsa_scores,
        "minilm": minilm_scores,
    }
    mxbai_metadata = original["meta"].get("mxbai", {"available": False})
    if mxbai_metadata.get("available"):
        if "mxbai_similarities" not in original:
            raise ValueError("mxbai is marked available but its validated score matrix is missing.")
        if (
            mxbai_metadata.get("model", mxbai_metadata.get("model_id")) != "mixedbread-ai/mxbai-embed-large-v1"
            or mxbai_metadata.get("model_revision") != "b33106f585b9ce46904ad7443a3b52b7a63e231c"
        ):
            raise ValueError("mxbai metadata does not identify the required pinned model revision.")
        mxbai_scores = np.asarray(original["mxbai_similarities"], dtype=np.float64)
        if mxbai_scores.shape != (len(node_ids), len(node_ids)) or not np.isfinite(mxbai_scores).all():
            raise ValueError("mxbai similarity matrix has invalid shape or values.")
        if not np.allclose(mxbai_scores, mxbai_scores.T, atol=1e-6):
            raise ValueError("mxbai similarity matrix is not symmetric.")
        if not np.allclose(np.diag(mxbai_scores), 1, atol=1e-6):
            raise ValueError("mxbai similarity matrix diagonal must be 1.")
        similarity_scores["mxbai"] = mxbai_scores
        methods.append("mxbai")
    tfidf_recomputed = (tfidf @ tfidf.T).toarray()
    np.fill_diagonal(tfidf_recomputed, 1)
    minilm_recomputed = embeddings @ embeddings.T
    np.fill_diagonal(minilm_recomputed, 1)
    if not np.allclose(tfidf_recomputed, tfidf_scores, atol=1.1e-6):
        raise ValueError("Stored TF-IDF similarities do not match the source pages and preprocessing.")
    if not np.allclose(minilm_recomputed, minilm_scores, atol=1.1e-6):
        raise ValueError("Stored MiniLM similarities do not match the cached node-ordered embeddings.")
    lsa_cache = np.load(DATA / "week7_lsa_vectors.npz", allow_pickle=False)
    if lsa_cache["node_ids"].tolist() != node_ids:
        raise ValueError("Cached LSA node IDs do not match the Week 1 node order.")
    lsa_vectors = lsa_cache["vectors"]
    lsa_recomputed = lsa_vectors @ lsa_vectors.T
    np.fill_diagonal(lsa_recomputed, 1)
    if lsa_vectors.shape[0] != len(node_ids) or not np.allclose(
        lsa_recomputed, lsa_scores, atol=1.1e-6
    ):
        raise ValueError("Stored LSA similarities do not match the cached node-ordered vectors.")

    edges = read_edges()
    if len(set(edges)) != len(edges):
        raise ValueError("The Week 1 edge file contains duplicate directed links.")
    if any(source == target for source, target in edges):
        raise ValueError("The Week 1 edge file contains self-loops.")
    id_to_index = {node_id: i for i, node_id in enumerate(node_ids)}
    graph = nx.DiGraph()
    graph.add_nodes_from(node_ids)
    graph.add_edges_from(edges)
    observed_in = dict(graph.in_degree())
    observed_out = dict(graph.out_degree())
    directed_maps = distance_maps(graph, directed=True)
    undirected_maps = distance_maps(graph, directed=False)
    observed_directed_unreachable = sum(
        len(node_ids) - len(lengths) for lengths in directed_maps.values()
    )
    observed_undirected_unreachable = sum(
        len(node_ids) - len(lengths) for lengths in undirected_maps.values()
    ) // 2

    pair_rows = []
    for i, a in enumerate(node_ids):
        for j in range(i + 1, len(node_ids)):
            b = node_ids[j]
            pair_rows.append({
                "a": i,
                "b": j,
                **{method: float(scores[i, j]) for method, scores in similarity_scores.items()},
                "a_to_b": directed_maps[a].get(b),
                "b_to_a": directed_maps[b].get(a),
                "undirected": undirected_maps[a].get(b),
                "direct_a_to_b": graph.has_edge(a, b),
                "direct_b_to_a": graph.has_edge(b, a),
            })
    pair_count = len(pair_rows)
    isolated_indices = {
        index for index, node_id in enumerate(node_ids)
        if observed_in[node_id] == 0 and observed_out[node_id] == 0
    }
    pair_populations = {
        "all": pair_rows,
        "non_isolated": [
            row for row in pair_rows
            if row["a"] not in isolated_indices and row["b"] not in isolated_indices
        ],
    }
    cohorts = {}
    observed_stats = {}
    null_values = {}
    cohort_sizes = {}
    for population, eligible_rows in pair_populations.items():
        cohort_size = max(1, int(np.ceil(len(eligible_rows) * TOP_COHORT_FRACTION)))
        cohort_sizes[population] = cohort_size
        cohorts[population] = {}
        observed_stats[population] = {}
        null_values[population] = {}
        for method in methods:
            ordered = sorted(eligible_rows, key=lambda row: (-row[method], row["a"], row["b"]))
            cohort = [(node_ids[row["a"]], node_ids[row["b"]]) for row in ordered[:cohort_size]]
            cohorts[population][method] = cohort
            observed_stats[population][method] = {
                "directed": cohort_stats(directed_maps, cohort, directed=True),
                "undirected": cohort_stats(undirected_maps, cohort, directed=False),
            }
            null_values[population][method] = {"directed": [], "undirected": []}

    pairwise_null = {
        mode: {
            "count": np.zeros(pair_count, dtype=np.int32),
            "mean": np.zeros(pair_count, dtype=np.float64),
            "m2": np.zeros(pair_count, dtype=np.float64),
        }
        for mode in ("directed", "undirected")
    }
    pair_id_indices = [(node_ids[row["a"]], node_ids[row["b"]]) for row in pair_rows]

    randomizer = random.Random(SEED)
    swaps_per_graph = SWAPS_PER_EDGE * len(edges)
    weak_components = []
    strong_components = []
    global_directed_unreachable = []
    global_undirected_unreachable = []
    swap_attempts = []
    accepted_swaps = []
    for run in range(NULL_NETWORKS):
        randomized, accepted, attempts = rewire_directed(graph, randomizer, SWAPS_PER_EDGE)
        accepted_swaps.append(accepted)
        swap_attempts.append(attempts)
        weak_components.append(nx.number_weakly_connected_components(randomized))
        strong_components.append(nx.number_strongly_connected_components(randomized))
        directed_null_maps = distance_maps(randomized, directed=True)
        undirected_null_maps = distance_maps(randomized, directed=False)
        global_directed_unreachable.append(sum(
            len(node_ids) - len(lengths) for lengths in directed_null_maps.values()
        ))
        global_undirected_unreachable.append(sum(
            len(node_ids) - len(lengths) for lengths in undirected_null_maps.values()
        ) // 2)
        for mode, maps, is_directed in (
            ("directed", directed_null_maps, True),
            ("undirected", undirected_null_maps, False),
        ):
            distribution = pairwise_null[mode]
            distances = np.full(pair_count, np.nan, dtype=np.float64)
            for index, (a, b) in enumerate(pair_id_indices):
                distance = pair_distance(maps, a, b, directed=is_directed)
                if distance is not None:
                    distances[index] = distance
            valid = np.isfinite(distances)
            prior_count = distribution["count"][valid]
            updated_count = prior_count + 1
            delta = distances[valid] - distribution["mean"][valid]
            distribution["mean"][valid] += delta / updated_count
            distribution["m2"][valid] += delta * (
                distances[valid] - distribution["mean"][valid]
            )
            distribution["count"][valid] = updated_count
        for population in pair_populations:
            for method in methods:
                for mode, maps, is_directed in (
                    ("directed", directed_null_maps, True),
                    ("undirected", undirected_null_maps, False),
                ):
                    stats = cohort_stats(
                        maps, cohorts[population][method], directed=is_directed
                    )
                    null_values[population][method][mode].append(stats)
        if run == 0 or run + 1 == NULL_NETWORKS or (run + 1) % 10 == 0:
            print(f"Validated degree-preserving null network {run + 1}/{NULL_NETWORKS}.")

    p_values = {}
    null_results_by_population = {}
    for population in pair_populations:
        null_results_by_population[population] = {}
        for method in methods:
            null_results_by_population[population][method] = {}
            for mode in ("directed", "undirected"):
                key = f"{population}_{method}_{mode}"
                observed = observed_stats[population][method][mode]
                sample = null_values[population][method][mode]
                mean_values = [
                    row["mean_reachable_distance"] for row in sample
                    if row["mean_reachable_distance"] is not None
                ]
                unreachable_values = [row["unreachable_fraction"] for row in sample]
                observed_mean = observed["mean_reachable_distance"]
                null_mean = float(np.mean(mean_values)) if mean_values else None
                null_sd = float(np.std(mean_values, ddof=1)) if len(mean_values) > 1 else None
                p_value = empirical_upper_p(
                    observed_mean, [row["mean_reachable_distance"] for row in sample]
                )
                p_values[f"{key}_distance"] = p_value
                unreachable_p = empirical_upper_p(
                    observed["unreachable_fraction"], unreachable_values
                )
                p_values[f"{key}_unreachable"] = unreachable_p
                null_results_by_population[population][method][mode] = {
                    "observed": observed,
                    "cohort_size": cohort_sizes[population],
                    "eligible_pair_count": len(pair_populations[population]),
                    "null_mean_reachable_distance": null_mean,
                    "null_sd_reachable_distance": null_sd,
                    "null_95_percentile_reachable_distance": (
                        [float(value) for value in np.quantile(mean_values, [0.025, 0.975])]
                        if mean_values else None
                    ),
                    "observed_minus_null_mean": (
                        observed_mean - null_mean
                        if observed_mean is not None and null_mean is not None else None
                    ),
                    "standardized_shift": (
                        (observed_mean - null_mean) / null_sd
                        if observed_mean is not None and null_mean is not None and null_sd else None
                    ),
                    "upper_tail_p": p_value,
                    "observed_unreachable_fraction": observed["unreachable_fraction"],
                    "null_mean_unreachable_fraction": (
                        float(np.mean(unreachable_values)) if unreachable_values else None
                    ),
                    "unreachable_fraction_upper_tail_p": unreachable_p,
                    "null_weak_components_mean": float(np.mean(weak_components)),
                    "null_weak_components_range": [int(min(weak_components)), int(max(weak_components))],
                    "unreachable_pair_count_range": [
                        int(min(row["unreachable_pairs"] for row in sample)),
                        int(max(row["unreachable_pairs"] for row in sample)),
                    ],
                    "valid_reachable_distance_runs": len(mean_values),
                }
    adjusted = holm_adjust(p_values)
    for population in null_results_by_population:
        for method in null_results_by_population[population]:
            for mode, result in null_results_by_population[population][method].items():
                key = f"{population}_{method}_{mode}"
                result["holm_adjusted_upper_tail_p"] = adjusted.get(f"{key}_distance")
                result["holm_adjusted_unreachable_upper_tail_p"] = adjusted.get(f"{key}_unreachable")

    for mode, distribution in pairwise_null.items():
        counts = distribution["count"]
        variances = np.full(pair_count, np.nan, dtype=np.float64)
        valid = counts > 1
        variances[valid] = distribution["m2"][valid] / (counts[valid] - 1)
        standard_deviations = np.sqrt(np.maximum(variances, 0))
        for index, row in enumerate(pair_rows):
            row[f"{mode}_null_mean_distance"] = (
                float(distribution["mean"][index]) if counts[index] else None
            )
            row[f"{mode}_null_sd_distance"] = (
                float(standard_deviations[index]) if valid[index] else None
            )
            row[f"{mode}_null_valid_runs"] = int(counts[index])
            row[f"{mode}_null_unreachable_runs"] = int(NULL_NETWORKS - counts[index])

    names = [by_id[node_id]["name"] for node_id in node_ids]
    sparse_rows = []
    for i in range(len(node_ids)):
        start, end = tfidf.indptr[i], tfidf.indptr[i + 1]
        sparse_rows.append({
            "indices": tfidf.indices[start:end].tolist(),
            "weights": np.round(tfidf.data[start:end], 8).tolist(),
        })
    vocabulary = vectorizer.get_feature_names_out().tolist()
    payload = {
        "meta": {
            "node_count": len(node_ids),
            "edge_count": len(edges),
            "eligible_unordered_pairs": pair_count,
            "isolated_node_count": len(isolated_indices),
            "non_isolated_unordered_pairs": len(pair_populations["non_isolated"]),
            "isolate_definition": "A node is isolated when its observed directed in-degree and out-degree are both zero; this is also degree zero in the undirected projection.",
            "methods": methods,
            "similarity_thresholds": original["meta"]["similarity_thresholds"],
            "lsa": original["meta"]["lsa"],
            "minilm": original["meta"]["embedding"],
            "mxbai": mxbai_metadata,
            "tfidf": "English stop words removed; sublinear term frequency; unigram TF-IDF; L2-normalized rows. Contributions are exact sparse-vector dot-product terms.",
            "embedding": original["meta"]["embedding"],
            "path_definitions": {
                "directed": "For each unordered pair, retain both A-to-B and B-to-A shortest path lengths separately. Pair ranking uses the shorter reachable direction; unreachable in both directions is a separate category.",
                "undirected": "Shortest paths in the undirected projection; this is proximity, not necessarily a valid directed hyperlink sequence.",
                "unreachable": "JSON null; no finite distance is substituted.",
            },
            "null_model": {
                "algorithm": "Directed target swaps: choose edges (u,v) and (x,y), replace with (u,y) and (x,v), rejecting self-loops and already-existing edges. This preserves each source out-degree and target in-degree.",
                "constraints": "Same 303 nodes; simple directed graph; no self-loops or parallel edges; exact in-/out-degree preservation checked after every accepted randomized graph.",
                "networks": NULL_NETWORKS,
                "accepted_swaps_per_network": swaps_per_graph,
                "seed": SEED,
                "attempts_range": [int(min(swap_attempts)), int(max(swap_attempts))],
                "cohort": f"Fixed top {TOP_COHORT_FRACTION:.0%} of eligible distinct unordered pairs by within-method cosine, calculated separately for all nodes and for pairs containing no observed isolates, under {', '.join(methods)}.",
                "statistic": "For each eligible pair, the path-distance component is the minimum finite shortest-path distance across either direction (directed mode) or the undirected-projection distance. For each fixed text-defined cohort, the aggregate statistic is the mean finite pair distance; pairs unreachable in both directions are omitted from that mean and reported as an unreachable fraction.",
                "pairwise_z_score": "Descriptive marginal z-score for each observed reachable pair: (observed pair distance - mean finite distance for that same pair across randomized networks) / sample standard deviation of those finite distances. Unreachable null realizations are excluded and their count retained; this is conditional on a finite null path. Observed-unreachable pairs and zero-variance or undersampled distributions have no z-score. Pairwise z-scores are not individual significance tests and are not multiplicity-adjusted.",
                "limitations": f"Aggregate inference is for prespecified top-similarity cohorts, not individual pairs. {2 * len(methods) * 2 * len(pair_populations)} aggregate upper-tail tests (distance and unreachable fraction x {len(methods)} methods x two path modes x two isolate populations) use Holm adjustment. Null networks do not preserve components or path lengths.",
                "pairwise_null_valid_runs_min": int(min(
                    pairwise_null["directed"]["count"].min(),
                    pairwise_null["undirected"]["count"].min(),
                )),
                "weak_components_observed": nx.number_weakly_connected_components(graph),
                "weak_components_null_mean": float(np.mean(weak_components)),
                "weak_components_null_range": [int(min(weak_components)), int(max(weak_components))],
                "strong_components_observed": nx.number_strongly_connected_components(graph),
                "strong_components_null_mean": float(np.mean(strong_components)),
                "strong_components_null_range": [int(min(strong_components)), int(max(strong_components))],
                "directed_unreachable_ordered_pairs_observed": observed_directed_unreachable,
                "undirected_unreachable_unordered_pairs_observed": observed_undirected_unreachable,
                "directed_unreachable_ordered_pairs_null_mean": float(np.mean(global_directed_unreachable)),
                "directed_unreachable_ordered_pairs_null_range": [
                    int(min(global_directed_unreachable)), int(max(global_directed_unreachable))
                ],
                "undirected_unreachable_unordered_pairs_null_mean": float(np.mean(global_undirected_unreachable)),
                "undirected_unreachable_unordered_pairs_null_range": [
                    int(min(global_undirected_unreachable)), int(max(global_undirected_unreachable))
                ],
                "null_results": null_results_by_population["all"],
                "null_results_by_population": null_results_by_population,
            },
        },
        "nodes": [
            {
                "id": node_id,
                "name": by_id[node_id]["name"],
                "in_degree": observed_in[node_id],
                "out_degree": observed_out[node_id],
                "url": by_id[node_id].get("url", ""),
                "text": pages[node_id],
            }
            for node_id in node_ids
        ],
        "edges": [{"source": source, "target": target} for source, target in edges],
        "pairs": pair_rows,
        "tfidf_terms": vocabulary,
        "tfidf_sparse_rows": sparse_rows,
    }
    output = DATA / "week7_unexpected_pairs.json"
    output.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {output.relative_to(ROOT)} ({output.stat().st_size:,} bytes; {pair_count:,} pairs).")
    print(json.dumps(null_results_by_population, indent=2))
    for method in methods:
        ordered = sorted(pair_rows, key=lambda row: (-row[method], row["a"], row["b"]))
        print(method, "top 1% sample:", [
            (names[row["a"]], names[row["b"]], round(row[method], 3), row["a_to_b"], row["b_to_a"])
            for row in ordered[:5]
        ])


if __name__ == "__main__":
    main()
