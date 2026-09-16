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
    names = nodes.set_index("node_id")["name"].to_dict()
    graph = nx.Graph()
    graph.add_nodes_from(nodes["node_id"])
    graph.add_edges_from(edges.itertuples(index=False, name=None))
    return graph, names


def centralities(graph):
    return {
        "Degree": dict(graph.degree()),
        "Closeness": nx.closeness_centrality(graph),
        "Betweenness": nx.betweenness_centrality(graph, normalized=True),
        "PageRank": nx.pagerank(graph, alpha=0.85),
    }


def main():
    graph, names = load_graph()
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
    output = {
        "metadata": {
            "source": "02805 Week 1 shared Marvel Wikipedia network",
            "nodes": graph.number_of_nodes(),
            "edges": graph.number_of_edges(),
            "null_model": "80 Erdős–Rényi graphs with the same node and edge counts",
            "null_runs": NULL_RUNS,
        },
        "rows": rows,
        "top": top,
        "lowest": lowest,
    }
    with OUTPUT_PATH.open("w", encoding="utf-8") as file:
        json.dump(output, file, ensure_ascii=False, separators=(",", ":"))


if __name__ == "__main__":
    main()
