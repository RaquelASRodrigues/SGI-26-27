"""Degree-preserving directed null benchmark for Week 4 Louvain modularity."""

from __future__ import annotations

import json
import random
from pathlib import Path

import networkx as nx
import numpy as np

from week4_analysis import DATA_DIR, load_graph


OUTPUT_PATH = DATA_DIR / "week4_modularity_null.json"
SEED = 260927
RANDOMIZATIONS = 100
SWAPS_PER_ARC = 10


def modularity(graph: nx.DiGraph, seed: int) -> tuple[float, int]:
    groups = nx.community.louvain_communities(graph, weight="weight", seed=seed)
    return nx.community.modularity(graph, groups, weight="weight"), len(groups)


def main() -> None:
    _, _, observed_graph, _, _ = load_graph()
    edge_count = observed_graph.number_of_edges()
    observed_score, observed_communities = modularity(observed_graph, SEED)
    original_weights = [
        float(attributes["weight"])
        for _, _, attributes in observed_graph.edges(data=True)
    ]
    scores = []
    community_counts = []
    rng = random.Random(SEED)

    for index in range(RANDOMIZATIONS):
        randomized = observed_graph.copy()
        nx.directed_edge_swap(
            randomized,
            nswap=SWAPS_PER_ARC * edge_count,
            max_tries=100 * SWAPS_PER_ARC * edge_count,
            seed=SEED + index + 1,
        )
        randomized_edges = list(randomized.edges())
        shuffled_weights = original_weights.copy()
        rng.shuffle(shuffled_weights)
        nx.set_edge_attributes(
            randomized,
            {
                edge: {"weight": weight}
                for edge, weight in zip(randomized_edges, shuffled_weights)
            },
        )
        if set(randomized) != set(observed_graph):
            raise ValueError("A randomized graph changed the node set.")
        if randomized.number_of_edges() != edge_count:
            raise ValueError("A randomized graph changed the directed arc count.")
        if any(
            randomized.in_degree(node) != observed_graph.in_degree(node)
            or randomized.out_degree(node) != observed_graph.out_degree(node)
            for node in observed_graph
        ):
            raise ValueError("A randomized graph did not preserve directed degrees.")
        if not np.isclose(randomized.size(weight="weight"), sum(original_weights)):
            raise ValueError("A randomized graph changed total edge weight.")
        score, count = modularity(randomized, SEED)
        scores.append(score)
        community_counts.append(count)
        print(f"randomization {index + 1:03d}/{RANDOMIZATIONS}: Q={score:.6f}", flush=True)

    mean = float(np.mean(scores))
    standard_deviation = float(np.std(scores, ddof=1))
    exceedances = sum(score >= observed_score for score in scores)
    empirical_p = (exceedances + 1) / (RANDOMIZATIONS + 1)
    bins = min(20, max(8, int(round(RANDOMIZATIONS ** 0.5))))
    counts, edges = np.histogram(scores, bins=bins)
    payload = {
        "meta": {
            "method": "Directed degree-preserving edge-rewiring null with shuffled weights",
            "null_model": (
                "Each replicate starts from the directed philosopher graph and performs "
                f"{SWAPS_PER_ARC} directed double-edge swaps per original arc. NetworkX "
                "directed_edge_swap preserves every node's in-degree and out-degree, the "
                "node set, and directed arc count while rewiring endpoints. The observed "
                "multiset of aggregated edge weights is then shuffled over the rewired arcs. "
                "Thus the null preserves the global edge-weight distribution and total "
                "weight, but not node strengths or the association between particular weights "
                "and endpoints."
            ),
            "score": (
                "For the observed graph and every null replicate, run NetworkX Louvain on "
                "the directed weighted graph with weight='weight', default resolution and "
                f"threshold, and the same fixed seed {SEED}; calculate directed modularity "
                "for that run's partition."
            ),
            "seed": SEED,
            "randomizations": RANDOMIZATIONS,
            "swaps_per_arc": SWAPS_PER_ARC,
            "interpretation": (
                "The empirical p-value is (1 + null scores at least as large as observed) / "
                "(B + 1). It tests the observed weighted modularity against this degree- and "
                "weight-distribution-preserving null; it does not identify philosophical "
                "schools or establish that a partition is objectively correct."
            ),
        },
        "stats": {
            "nodes": observed_graph.number_of_nodes(),
            "directed_arcs": edge_count,
            "total_weight": float(sum(original_weights)),
            "observed_modularity": observed_score,
            "observed_communities": observed_communities,
            "random_mean": mean,
            "random_sd": standard_deviation,
            "random_min": min(scores),
            "random_max": max(scores),
            "exceedances": exceedances,
            "empirical_p": empirical_p,
            "scores": scores,
            "community_counts": community_counts,
            "histogram": [
                {
                    "lower": float(edges[index]),
                    "upper": float(edges[index + 1]),
                    "count": int(counts[index]),
                }
                for index in range(len(counts))
            ],
        },
    }
    OUTPUT_PATH.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(
        f"Observed Q={observed_score:.6f}; null mean={mean:.6f}, "
        f"SD={standard_deviation:.6f}; p={empirical_p:.6f} "
        f"({exceedances}/{RANDOMIZATIONS} exceedances)"
    )
    print(f"Wrote {OUTPUT_PATH.relative_to(DATA_DIR.parent)}")


if __name__ == "__main__":
    main()
