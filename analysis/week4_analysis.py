"""Precompute the Week 4 philosopher community-detection explorer data.

The browser consumes ``data/week4_communities.json`` and never re-runs either
community-detection algorithm. The source data have one record per directed
link, with a numeric weight. Duplicate source--target records are summed before
analysis (the current frozen snapshot already has 11,135 unique pairs).
"""

from __future__ import annotations

from collections import defaultdict
import json
from pathlib import Path

from infomap import Infomap
import networkx as nx
import pandas as pd
from sklearn.metrics import normalized_mutual_info_score


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = PROJECT_ROOT / "data"
NODES_PATH = DATA_DIR / "week4_philosophers_nodes.tsv"
EDGES_PATH = DATA_DIR / "week4_philosophers_edges.tsv"
OUTPUT_PATH = DATA_DIR / "week4_communities.json"
LOUVAIN_SEEDS = range(20)
INFOMAP_SEEDS = range(1, 21)
LAYOUT_SEED = 260927


def load_graph():
    """Read the supplied graph, aggregate duplicate directed pairs, keep isolates."""
    nodes = pd.read_csv(NODES_PATH, sep="\t", comment="#", dtype={"node_id": str})
    edges = pd.read_csv(
        EDGES_PATH,
        sep="\t",
        comment="#",
        dtype={"source": str, "target": str, "weight": float},
    )
    edge_rows_before_aggregation = len(edges)
    edges = (
        edges.groupby(["source", "target"], as_index=False, sort=False)["weight"]
        .sum()
    )
    node_ids = set(nodes["node_id"])
    edge_ids = set(edges["source"]) | set(edges["target"])
    if edge_ids - node_ids:
        raise ValueError("Every edge endpoint must appear in the node file.")

    graph = nx.DiGraph()
    graph.add_edges_from(
        (row.source, row.target, {"weight": float(row.weight)})
        for row in edges.itertuples(index=False)
    )
    attributes = nodes.set_index("node_id").to_dict("index")
    graph.add_nodes_from((node_id, values) for node_id, values in attributes.items())
    isolates = {node_id for node_id in graph if graph.degree(node_id) == 0}
    return nodes, edges, graph, isolates, edge_rows_before_aggregation


def canonical_groups(groups):
    """Give communities stable, presentation-friendly labels by size then node id."""
    return sorted((set(group) for group in groups), key=lambda group: (-len(group), min(group)))


def partition_from_groups(groups):
    return {
        node_id: community_id
        for community_id, group in enumerate(canonical_groups(groups), start=1)
        for node_id in group
    }


def run_louvain(graph):
    """Run NetworkX's directed, weighted Louvain implementation over fixed seeds."""
    runs = []
    for seed in LOUVAIN_SEEDS:
        groups = nx.community.louvain_communities(graph, weight="weight", seed=seed)
        modularity = nx.community.modularity(graph, groups, weight="weight")
        runs.append(
            {
                "seed": seed,
                "modularity": modularity,
                "groups": groups,
                "community_count": len(groups),
            }
        )
    best = max(runs, key=lambda run: run["modularity"])
    groups = canonical_groups(best["groups"])
    return {
        "groups": groups,
        "partition": partition_from_groups(groups),
        "seed": best["seed"],
        "modularity": best["modularity"],
        "runs": [
            {
                "seed": run["seed"],
                "modularity": run["modularity"],
                "community_count": run["community_count"],
            }
            for run in runs
        ],
    }


def infomap_partition(graph, seed):
    """Keep edge direction and multiplicity/weight when sending data to Infomap."""
    node_to_int = {node_id: index for index, node_id in enumerate(graph.nodes())}
    int_to_node = {index: node_id for node_id, index in node_to_int.items()}
    infomap = Infomap(directed=True, seed=seed)
    for source, target, attributes in graph.edges(data=True):
        infomap.add_link(
            node_to_int[source], node_to_int[target], float(attributes["weight"])
        )
    infomap.run()
    partition = {
        int_to_node[node.node_id]: node.module_id
        for node in infomap.tree
        if node.is_leaf
    }
    return partition, infomap.codelength


def run_infomap(graph):
    """Select the lowest-codelength directed, weighted Infomap solution."""
    runs = []
    for seed in INFOMAP_SEEDS:
        partition, codelength = infomap_partition(graph, seed)
        runs.append(
            {
                "seed": seed,
                "partition": partition,
                "codelength": codelength,
                "community_count": len(set(partition.values())),
            }
        )
    best = min(runs, key=lambda run: run["codelength"])
    groups_by_original_id = defaultdict(set)
    for node_id, community_id in best["partition"].items():
        groups_by_original_id[community_id].add(node_id)
    groups = canonical_groups(groups_by_original_id.values())
    return {
        "groups": groups,
        "partition": partition_from_groups(groups),
        "seed": best["seed"],
        "codelength": best["codelength"],
        "runs": [
            {
                "seed": run["seed"],
                "codelength": run["codelength"],
                "community_count": run["community_count"],
            }
            for run in runs
        ],
    }


def make_layout(graph, edges, isolates):
    """Generate a deterministic topology-oriented layout for the canvas.

    Reciprocal directed links are summed only for the visual spring layout. This
    has no effect on either exported partition. Isolates are positioned in a
    dedicated right-hand tray so that they are visibly retained.
    """
    connected = [node_id for node_id in graph if node_id not in isolates]
    layout_graph = nx.Graph()
    layout_graph.add_nodes_from(connected)
    for row in edges.itertuples(index=False):
        if layout_graph.has_edge(row.source, row.target):
            layout_graph[row.source][row.target]["weight"] += float(row.weight)
        else:
            layout_graph.add_edge(row.source, row.target, weight=float(row.weight))
    raw_positions = nx.spring_layout(
        layout_graph,
        seed=LAYOUT_SEED,
        iterations=120,
        k=0.105,
        weight="weight",
        scale=1,
    )
    positions = {
        node_id: {
            "x": round(0.04 + (coordinate[0] + 1) * 0.38, 6),
            "y": round(0.06 + (coordinate[1] + 1) * 0.44, 6),
        }
        for node_id, coordinate in raw_positions.items()
    }
    # Eight columns by nine rows in the visibly separate isolate tray.
    for index, node_id in enumerate(sorted(isolates)):
        positions[node_id] = {
            "x": round(0.84 + (index % 8) * 0.019, 6),
            "y": round(0.11 + (index // 8) * 0.095, 6),
        }
    return positions


def community_rows(groups, isolates):
    return [
        {
            "id": index,
            "size": len(group),
            "substantive": len(group) > 1 and not group.issubset(isolates),
        }
        for index, group in enumerate(groups, start=1)
        if not group.issubset(isolates)
    ]


def method_payload(result, isolates, quality_name):
    all_sizes = [len(group) for group in result["groups"]]
    substantive_sizes = [
        len(group)
        for group in result["groups"]
        if len(group) > 1 and not group.issubset(isolates)
    ]
    payload = {
        "seed": result["seed"],
        "community_count": len(result["groups"]),
        "assigned_node_count": sum(all_sizes),
        "communities": community_rows(result["groups"], isolates),
        "substantive_community_count": len(substantive_sizes),
        "substantive_sizes": substantive_sizes,
        "runs": result["runs"],
    }
    payload[quality_name] = result[quality_name]
    return payload


def main():
    nodes, edges, graph, isolates, input_edge_rows = load_graph()
    louvain = run_louvain(graph)
    infomap = run_infomap(graph)

    assigned_by_infomap = set(infomap["partition"])
    if set(graph) - assigned_by_infomap != isolates:
        raise ValueError("Infomap's unassigned nodes must be exactly the isolates.")
    common_nodes = sorted(set(louvain["partition"]) & assigned_by_infomap)
    nmi = normalized_mutual_info_score(
        [louvain["partition"][node_id] for node_id in common_nodes],
        [infomap["partition"][node_id] for node_id in common_nodes],
    )
    positions = make_layout(graph, edges, isolates)
    node_index = {node_id: index for index, node_id in enumerate(nodes["node_id"])}
    node_records = []
    for row in nodes.itertuples(index=False):
        node_id = row.node_id
        node_records.append(
            {
                "id": node_id,
                "name": row.name,
                "url": row.url,
                "era": None if pd.isna(row.era) else row.era,
                "isolated": node_id in isolates,
                "louvain": louvain["partition"][node_id],
                "infomap": infomap["partition"].get(node_id),
                **positions[node_id],
            }
        )

    payload = {
        "meta": {
            "title": "Week 4 · Philosophers: Louvain and Infomap",
            "source": "Frozen 2026-09-15 Wikipedia philosopher-list snapshot",
            "weight_definition": "Each directed edge weight is the count of links from source article to target article; duplicate directed pairs are summed.",
            "louvain_graph": "Directed, weighted graph. NetworkX applies its directed modularity formulation, so no undirected conversion was used for the Louvain partition.",
            "infomap_graph": "Directed, weighted graph passed directly to Infomap.",
            "layout_note": "The fixed canvas layout uses a weighted undirected projection only for visual placement; it does not affect either partition.",
        },
        "stats": {
            "nodes": graph.number_of_nodes(),
            "directed_edges_input": input_edge_rows,
            "directed_edges_aggregated": graph.number_of_edges(),
            "total_directed_weight": graph.size(weight="weight"),
            "isolated_nodes": len(isolates),
            "connected_nodes": graph.number_of_nodes() - len(isolates),
        },
        "methods": {
            "louvain": method_payload(louvain, isolates, "modularity"),
            "infomap": method_payload(infomap, isolates, "codelength"),
        },
        "comparison": {"nmi": nmi, "shared_nodes": len(common_nodes)},
        "nodes": node_records,
        "edges": [
            {"source": node_index[row.source], "target": node_index[row.target], "weight": row.weight}
            for row in edges.itertuples(index=False)
        ],
    }
    OUTPUT_PATH.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    print(f"Wrote {OUTPUT_PATH.relative_to(PROJECT_ROOT)}")
    print(
        f"Louvain: seed {louvain['seed']}, modularity {louvain['modularity']:.6f}, "
        f"{len(louvain['groups'])} communities"
    )
    print(
        f"Infomap: seed {infomap['seed']}, codelength {infomap['codelength']:.6f}, "
        f"{len(infomap['groups'])} communities"
    )
    print(f"NMI on {len(common_nodes)} shared connected nodes: {nmi:.6f}")


if __name__ == "__main__":
    main()
