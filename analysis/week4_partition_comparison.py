"""Precompute weighted/unweighted Louvain and Infomap partitions for Week 4."""

from __future__ import annotations

import json
from pathlib import Path

from infomap import Infomap
import networkx as nx
from sklearn.metrics import normalized_mutual_info_score

from week4_analysis import DATA_DIR, load_graph


PROJECT_ROOT = Path(__file__).resolve().parents[1]
LAYOUT_PATH = DATA_DIR / "week4_communities.json"
OUTPUT_PATH = DATA_DIR / "week4_partition_comparison.json"
LOUVAIN_SEEDS = range(20)
INFOMAP_SEEDS = range(1, 21)


def canonical_groups(groups: list[set[str]]) -> list[set[str]]:
    return sorted((set(group) for group in groups), key=lambda group: (-len(group), min(group)))


def louvain_result(graph: nx.DiGraph) -> dict:
    candidates = []
    for seed in LOUVAIN_SEEDS:
        groups = nx.community.louvain_communities(graph, weight="weight", seed=seed)
        quality = nx.community.modularity(graph, groups, weight="weight")
        candidates.append((quality, seed, groups))
    quality, seed, groups = max(candidates, key=lambda item: (item[0], -item[1]))
    return {"groups": canonical_groups(groups), "seed": seed, "quality": quality}


def infomap_result(graph: nx.DiGraph) -> dict:
    node_ids = list(graph.nodes())
    node_to_index = {node_id: index for index, node_id in enumerate(node_ids)}
    candidates = []
    for seed in INFOMAP_SEEDS:
        infomap = Infomap(directed=True, seed=seed, silent=True)
        for index in range(len(node_ids)):
            infomap.add_node(index)
        for source, target, attributes in graph.edges(data=True):
            infomap.add_link(
                node_to_index[source],
                node_to_index[target],
                float(attributes["weight"]),
            )
        infomap.run()
        groups_by_module: dict[int, set[str]] = {}
        for node in infomap.tree:
            if node.is_leaf:
                groups_by_module.setdefault(node.module_id, set()).add(
                    node_ids[node.node_id]
                )
        groups = canonical_groups(list(groups_by_module.values()))
        candidates.append((infomap.codelength, seed, groups))
    quality, seed, groups = min(candidates, key=lambda item: (item[0], item[1]))
    return {"groups": groups, "seed": seed, "quality": quality}


def partition_payload(result: dict, node_ids: list[str]) -> dict:
    groups = result["groups"]
    assignments_by_id = {
        node_id: community_id
        for community_id, group in enumerate(groups, start=1)
        for node_id in group
    }
    return {
        "assignments": [assignments_by_id[node_id] for node_id in node_ids],
        "communities": [
            {"id": community_id, "size": len(group)}
            for community_id, group in enumerate(groups, start=1)
        ],
        "community_count": len(groups),
        "seed": result["seed"],
        "quality": result["quality"],
    }


def membership_signatures(assignments: list[int]) -> list[frozenset[int]]:
    members_by_community: dict[int, set[int]] = {}
    for index, community_id in enumerate(assignments):
        members_by_community.setdefault(community_id, set()).add(index)
    return [
        frozenset(members_by_community[community_id] - {index})
        for index, community_id in enumerate(assignments)
    ]


def size_distribution(partition: dict) -> dict[str, int]:
    distribution: dict[str, int] = {}
    for community in partition["communities"]:
        size = str(community["size"])
        distribution[size] = distribution.get(size, 0) + 1
    return dict(sorted(distribution.items(), key=lambda item: int(item[0])))


def main() -> None:
    nodes, directed_edges, weighted_graph, isolates, _ = load_graph()
    node_ids = list(nodes["node_id"])
    unweighted_graph = nx.DiGraph()
    unweighted_graph.add_nodes_from(node_ids)
    unweighted_graph.add_edges_from(
        (source, target, {"weight": 1.0})
        for source, target in weighted_graph.edges()
    )

    results = {}
    for algorithm, runner in (
        ("louvain", louvain_result),
        ("infomap", infomap_result),
    ):
        results[algorithm] = {}
        for representation, graph in (
            ("unweighted", unweighted_graph),
            ("weighted", weighted_graph),
        ):
            result = runner(graph)
            results[algorithm][representation] = partition_payload(result, node_ids)
            if algorithm == "infomap":
                groups = result["groups"]
                if any(
                    not any(group == {node_id} for group in groups)
                    for node_id in isolates
                ):
                    raise ValueError(
                        "Infomap must retain each explicit isolate as a singleton module."
                    )

    comparisons = {}
    for algorithm, partitions in results.items():
        unweighted = partitions["unweighted"]["assignments"]
        weighted = partitions["weighted"]["assignments"]
        unweighted_signatures = membership_signatures(unweighted)
        weighted_signatures = membership_signatures(weighted)
        changed_indices = [
            index for index, (left, right) in enumerate(
                zip(unweighted_signatures, weighted_signatures)
            )
            if left != right
        ]
        comparisons[algorithm] = {
            "nmi": normalized_mutual_info_score(unweighted, weighted),
            "changed_count": len(changed_indices),
            "changed_fraction": len(changed_indices) / len(node_ids),
            "changed_indices": changed_indices,
            "comparable_nodes": len(node_ids),
        }

    layout = json.loads(LAYOUT_PATH.read_text(encoding="utf-8"))
    layout_by_id = {node["id"]: node for node in layout["nodes"]}
    if set(layout_by_id) != set(node_ids):
        raise ValueError("The saved layout must contain exactly the philosopher node set.")
    if set(weighted_graph) != set(unweighted_graph) or set(weighted_graph) != set(node_ids):
        raise ValueError("All four partitions must use the same complete node set.")
    if set(weighted_graph.edges()) != set(unweighted_graph.edges()):
        raise ValueError("Weighted and unweighted graphs must contain identical directed arcs.")
    if any(
        unweighted_graph[source][target]["weight"] != 1.0
        for source, target in unweighted_graph.edges()
    ):
        raise ValueError("Every distinct unweighted directed arc must have weight one.")

    nodes_by_id = nodes.set_index("node_id")
    node_index = {node_id: index for index, node_id in enumerate(node_ids)}
    payload = {
        "meta": {
            "source": layout["meta"]["source"],
            "weight_definition": layout["meta"]["weight_definition"],
            "preprocessing": (
                "Duplicate directed source-target rows are summed before analysis. "
                "The unweighted representation assigns weight 1 to every distinct directed arc; "
                "the weighted representation uses the aggregated source-data weight. Both use "
                "all philosopher nodes, including isolates. Louvain runs on the directed graph "
                "with NetworkX directed modularity; Infomap is directed and receives each arc's "
                "weight. For each Infomap run, all nodes are explicitly added before links so "
                "isolates receive singleton modules rather than being omitted."
            ),
            "settings": (
                "Louvain uses NetworkX louvain_communities with weight='weight', default "
                "resolution and threshold, and seeds 0–19; the highest-modularity run is kept "
                "for each representation. Infomap 2.15.1 uses directed=True with default flow "
                "settings and seeds 1–20; the lowest-codelength run is kept. Weighted and "
                "unweighted runs use identical settings within each algorithm."
            ),
            "comparison": (
                "NMI is calculated on all 1,444 philosophers for each same-algorithm pair. "
                "Changed-node counts compare each philosopher's set of co-members, not numeric "
                "community IDs; arbitrary IDs are not aligned or treated as identities. "
                "Community size distributions include singleton communities."
            ),
            "interpretation": (
                "Each edge weight counts links from one source Wikipedia article to another "
                "target article in the source dataset. It is not a measure of philosophical "
                "agreement, relationship strength, or historical importance."
            ),
        },
        "stats": {
            "nodes": len(node_ids),
            "directed_arcs": weighted_graph.number_of_edges(),
            "directed_total_weight": float(weighted_graph.size(weight="weight")),
            "isolates": len(isolates),
            "representations": {
                algorithm: {
                    representation: {
                        **{
                            key: value
                            for key, value in partition.items()
                            if key != "assignments"
                        },
                        "size_distribution": size_distribution(partition),
                    }
                    for representation, partition in partitions.items()
                }
                for algorithm, partitions in results.items()
            },
            "comparisons": comparisons,
        },
        "nodes": [
            {
                "id": node_id,
                "name": str(nodes_by_id.loc[node_id, "name"]),
                "url": str(nodes_by_id.loc[node_id, "url"]),
                "x": layout_by_id[node_id]["x"],
                "y": layout_by_id[node_id]["y"],
                "isolated": node_id in isolates,
            }
            for node_id in node_ids
        ],
        "edges": [
            {
                "source": node_index[row.source],
                "target": node_index[row.target],
                "weight": float(row.weight),
            }
            for row in directed_edges.itertuples(index=False)
        ],
        "partitions": results,
    }
    OUTPUT_PATH.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    for algorithm, comparison in comparisons.items():
        weighted = results[algorithm]["weighted"]
        unweighted = results[algorithm]["unweighted"]
        print(
            f"{algorithm}: NMI {comparison['nmi']:.6f}; "
            f"{comparison['changed_count']}/{comparison['comparable_nodes']} "
            f"changed memberships; communities "
            f"{unweighted['community_count']} unweighted / "
            f"{weighted['community_count']} weighted"
        )
    print(
        f"Wrote {OUTPUT_PATH.relative_to(PROJECT_ROOT)} with {len(node_ids)} nodes, "
        f"{weighted_graph.number_of_edges()} directed arcs, "
        f"{len(isolates)} isolates."
    )


if __name__ == "__main__":
    main()
