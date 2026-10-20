"""Precompute the Week 4 philosopher community-detection explorer data.

The browser consumes the partition and link-community JSON files and never
runs community detection. The source data have one record per directed link,
with a numeric weight. Duplicate source--target records are summed before
analysis (the current frozen snapshot has 11,135 unique directed pairs).
"""

from __future__ import annotations

from collections import Counter, defaultdict
import json
import itertools
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
OVERLAP_OUTPUT_PATH = DATA_DIR / "week4_link_communities.json"
ARISTOTLE_OUTPUT_PATH = DATA_DIR / "week4_aristotle_case.json"
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


def _partition_density(edge_count, node_count):
    """Ahn et al.'s density for one edge-community (zero for a single edge)."""
    if node_count <= 2:
        return 0.0
    possible = (node_count - 2) * (node_count - 1) / 2
    return max(0.0, (edge_count - (node_count - 1)) / possible)


def run_link_communities(graph, isolates):
    """Run the Ahn--Bagrow--Lehmann edge-based link-community method.

    The published method is defined for undirected, unweighted topology. We
    therefore collapse reciprocal directed pairs into one simple undirected
    edge and use binary inclusive-neighbourhood Jaccard similarity for the
    dendrogram. Original directed weighted records remain in the exported
    display data and inherit their undirected pair's edge community.
    """
    undirected = nx.Graph()
    undirected.add_nodes_from(node_id for node_id in graph if node_id not in isolates)
    for source, target, attributes in graph.edges(data=True):
        weight = float(attributes["weight"])
        if undirected.has_edge(source, target):
            undirected[source][target]["weight"] += weight
        else:
            undirected.add_edge(source, target, weight=weight)

    undirected_edges = list(undirected.edges())
    edge_index = {
        frozenset((source, target)): index
        for index, (source, target) in enumerate(undirected_edges)
    }
    inclusive = {
        node_id: set(undirected.neighbors(node_id)) | {node_id}
        for node_id in undirected
    }
    incident = defaultdict(list)
    for index, (source, target) in enumerate(undirected_edges):
        incident[source].append(index)
        incident[target].append(index)

    # A link-community dendrogram connects line-graph edges by Jaccard score.
    similarities = defaultdict(list)
    for shared_node, incident_edges in incident.items():
        for first, second in itertools.combinations(incident_edges, 2):
            first_edge = undirected_edges[first]
            second_edge = undirected_edges[second]
            first_other = first_edge[1] if first_edge[0] == shared_node else first_edge[0]
            second_other = second_edge[1] if second_edge[0] == shared_node else second_edge[0]
            left = inclusive[first_other]
            right = inclusive[second_other]
            union_size = len(left | right)
            similarity = len(left & right) / union_size if union_size else 0.0
            similarities[similarity].append((first, second))

    parent = list(range(len(undirected_edges)))
    edge_counts = [1] * len(undirected_edges)
    component_nodes = [{source, target} for source, target in undirected_edges]
    total_score = 0.0

    def find(index):
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    def component_score(root):
        return edge_counts[root] * _partition_density(
            edge_counts[root], len(component_nodes[root])
        )

    best_density = -1.0
    best_partition = None
    # Descending values correspond to progressively less strict similarity
    # thresholds. Evaluating once per score keeps equal-similarity merges tied.
    for similarity in sorted(similarities, reverse=True):
        for first, second in similarities[similarity]:
            first_root = find(first)
            second_root = find(second)
            if first_root == second_root:
                continue
            total_score -= component_score(first_root) + component_score(second_root)
            if edge_counts[first_root] < edge_counts[second_root]:
                first_root, second_root = second_root, first_root
            parent[second_root] = first_root
            edge_counts[first_root] += edge_counts[second_root]
            component_nodes[first_root].update(component_nodes[second_root])
            total_score += component_score(first_root)
        density = total_score / len(undirected_edges)
        if density > best_density + 1e-12:
            best_density = density
            best_partition = [find(index) for index in range(len(undirected_edges))]

    if best_partition is None:
        best_partition = list(range(len(undirected_edges)))
        best_density = 0.0
    groups_by_root = defaultdict(list)
    for edge_index_value, root in enumerate(best_partition):
        groups_by_root[root].append(edge_index_value)
    edge_groups = sorted(
        groups_by_root.values(),
        key=lambda group: (-len(group), min(group)),
    )
    edge_community = {
        edge_id: community_id
        for community_id, group in enumerate(edge_groups, start=1)
        for edge_id in group
    }
    community_nodes = {
        community_id: sorted(
            set(itertools.chain.from_iterable(
                (undirected_edges[edge_id] for edge_id in group)
            ))
        )
        for community_id, group in enumerate(edge_groups, start=1)
    }
    memberships = defaultdict(set)
    for community_id, node_ids in community_nodes.items():
        for node_id in node_ids:
            memberships[node_id].add(community_id)

    pair_to_community = {
        frozenset((source, target)): edge_community[index]
        for index, (source, target) in enumerate(undirected_edges)
    }
    return {
        "edge_count": len(undirected_edges),
        "community_count": len(edge_groups),
        "partition_density": best_density,
        "edge_community": pair_to_community,
        "community_nodes": community_nodes,
        "memberships": {node_id: sorted(values) for node_id, values in memberships.items()},
    }


def build_aristotle_case_payload(graph, nodes, link_payload):
    """Precompute k-clique node communities on a binary undirected projection."""
    try:
        aristotle_id = nodes.loc[nodes["name"] == "Aristotle", "node_id"].iloc[0]
    except IndexError as error:
        raise ValueError("The philosopher dataset must contain Aristotle.") from error
    node_ids = list(nodes["node_id"])
    node_index = {node_id: index for index, node_id in enumerate(node_ids)}
    aristotle_index = node_index[aristotle_id]

    clique_graph = nx.Graph()
    clique_graph.add_nodes_from(node_ids)
    clique_graph.add_edges_from(graph.edges())
    results = {}
    for k in (3, 4, 5):
        groups = [set(group) for group in nx.community.k_clique_communities(clique_graph, k)]
        groups.sort(key=lambda group: (-len(group), min(group), tuple(sorted(group))))
        memberships = defaultdict(list)
        communities = []
        for community_id, group in enumerate(groups, start=1):
            members = sorted(node_index[node_id] for node_id in group)
            communities.append({"id": community_id, "size": len(members), "members": members})
            for index in members:
                memberships[index].append(community_id)
        results[str(k)] = {
            "communities": communities,
            "memberships": {
                str(index): community_ids for index, community_ids in memberships.items()
            },
            "stats": {
                "communities": len(communities),
                "assigned_nodes": len(memberships),
                "membership_total": sum(map(len, memberships.values())),
                "multiple_membership_nodes": sum(
                    len(community_ids) > 1 for community_ids in memberships.values()
                ),
                "aristotle_memberships": memberships.get(aristotle_index, []),
            },
        }

    return {
        "meta": {
            "method": "NetworkX k-clique percolation",
            "preprocessing": (
                "A simple undirected graph: reciprocal directed arcs collapse to one "
                "connection, and edge weights are ignored. A connection exists if at "
                "least one directed article link exists in either direction."
            ),
            "interpretation": (
                "Communities are unions of adjacent k-cliques, not edge assignments "
                "or verified philosophical traditions."
            ),
        },
        "aristotle_index": aristotle_index,
        "supported_k": [3, 4, 5],
        "source_stats": link_payload["stats"],
        "results": results,
    }


def main():
    nodes, edges, graph, isolates, input_edge_rows = load_graph()
    louvain = run_louvain(graph)
    infomap = run_infomap(graph)
    overlap = run_link_communities(graph, isolates)

    assigned_by_infomap = set(infomap["partition"])
    if set(graph) - assigned_by_infomap != isolates:
        raise ValueError("Infomap's unassigned nodes must be exactly the isolates.")
    common_nodes = sorted(set(louvain["partition"]) & assigned_by_infomap)
    nmi = normalized_mutual_info_score(
        [louvain["partition"][node_id] for node_id in common_nodes],
        [infomap["partition"][node_id] for node_id in common_nodes],
    )
    positions = make_layout(graph, edges, isolates)
    node_ids_by_index = list(nodes["node_id"])
    node_index = {node_id: index for index, node_id in enumerate(node_ids_by_index)}
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
    node_records_by_id = {record["id"]: record for record in node_records}
    overlap_memberships = overlap["memberships"]
    overlap_communities = [
        {
            "id": community_id,
            "edge_count": sum(
                1 for value in overlap["edge_community"].values() if value == community_id
            ),
            "node_count": len(node_ids),
            "members": [node_index[node_id] for node_id in node_ids],
        }
        for community_id, node_ids in sorted(overlap["community_nodes"].items())
    ]
    overlap_payload = {
        "meta": {
            "title": "Week 4 · Overlapping philosopher communities",
            "method": "Ahn–Bagrow–Lehmann link communities",
            "method_note": "This edge-based method clusters links by inclusive-neighbourhood Jaccard similarity and selects the dendrogram cut with maximum partition density. It returns edge communities; node memberships are derived from the edge communities incident to each node.",
            "preprocessing": "The directed graph was projected to an undirected graph by collapsing reciprocal arcs and summing their weights. Link similarity uses binary inclusive neighbourhoods, so weights do not affect clustering; original directed weighted arcs remain in the display.",
            "interpretation_note": "Community IDs are algorithmic groups, not named philosophical schools. A philosopher with several incident edge communities receives several memberships; isolated nodes receive none.",
        },
        "stats": {
            "nodes": graph.number_of_nodes(),
            "connected_nodes": graph.number_of_nodes() - len(isolates),
            "isolated_nodes": len(isolates),
            "directed_edges": graph.number_of_edges(),
            "undirected_edges": overlap["edge_count"],
            "communities": overlap["community_count"],
            "partition_density": overlap["partition_density"],
            "multiple_membership_nodes": sum(
                len(overlap_memberships.get(node_id, [])) > 1 for node_id in graph
            ),
            "assigned_nodes": sum(bool(overlap_memberships.get(node_id)) for node_id in graph),
            "membership_total": sum(len(values) for values in overlap_memberships.values()),
            "membership_histogram": dict(
                sorted(
                    Counter(
                        len(overlap_memberships.get(node_id, [])) for node_id in graph
                    ).items()
                )
            ),
        },
        "communities": overlap_communities,
        "nodes": [
            {
                "id": node_id,
                "name": node_records_by_id[node_id]["name"],
                "url": node_records_by_id[node_id]["url"],
                "era": node_records_by_id[node_id]["era"],
                "x": node_records_by_id[node_id]["x"],
                "y": node_records_by_id[node_id]["y"],
                "isolated": node_id in isolates,
                "memberships": overlap_memberships.get(node_id, []),
                "membership_count": len(overlap_memberships.get(node_id, [])),
            }
            for node_id in nodes["node_id"]
        ],
        "edges": [
            {
                "source": edge["source"],
                "target": edge["target"],
                "weight": edge["weight"],
                "community": overlap["edge_community"][
                    frozenset((node_ids_by_index[edge["source"]], node_ids_by_index[edge["target"]]))
                ],
            }
            for edge in payload["edges"]
        ],
    }
    OVERLAP_OUTPUT_PATH.write_text(
        json.dumps(overlap_payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    case_payload = build_aristotle_case_payload(graph, nodes, overlap_payload)
    ARISTOTLE_OUTPUT_PATH.write_text(
        json.dumps(case_payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
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
    print(
        f"Link communities: {overlap['community_count']} edge communities, "
        f"partition density {overlap['partition_density']:.6f}, "
        f"{overlap_payload['stats']['multiple_membership_nodes']} multiple-membership nodes"
    )
    for k, result in case_payload["results"].items():
        print(
            f"k-clique k={k}: {result['stats']['communities']} communities, "
            f"{len(result['stats']['aristotle_memberships'])} Aristotle memberships"
        )


if __name__ == "__main__":
    main()
