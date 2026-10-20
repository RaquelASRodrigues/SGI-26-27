"""Precompute directed disparity-filter scores for the Week 4 philosopher graph."""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = PROJECT_ROOT / "data"
NODES_PATH = DATA_DIR / "week4_philosophers_nodes.tsv"
EDGES_PATH = DATA_DIR / "week4_philosophers_edges.tsv"
LAYOUT_PATH = DATA_DIR / "week4_communities.json"
OUTPUT_PATH = DATA_DIR / "week4_backbone.json"


def disparity_significance(weight: float, strength: float, degree: int) -> float:
    """Return the disparity-filter tail probability for one endpoint's edge."""
    if degree <= 1 or strength <= 0:
        return 1.0
    normalized_weight = min(1.0, max(0.0, weight / strength))
    return (1.0 - normalized_weight) ** (degree - 1)


def main() -> None:
    nodes = pd.read_csv(NODES_PATH, sep="\t", comment="#", dtype={"node_id": str})
    edges = pd.read_csv(
        EDGES_PATH,
        sep="\t",
        comment="#",
        dtype={"source": str, "target": str, "weight": float},
    )
    edges = edges.groupby(["source", "target"], as_index=False, sort=False)["weight"].sum()
    node_ids = set(nodes["node_id"])
    if not (set(edges["source"]) | set(edges["target"])).issubset(node_ids):
        raise ValueError("Every edge endpoint must appear in the philosopher node file.")

    out_degree = edges.groupby("source")["target"].count().to_dict()
    in_degree = edges.groupby("target")["source"].count().to_dict()
    out_strength = edges.groupby("source")["weight"].sum().to_dict()
    in_strength = edges.groupby("target")["weight"].sum().to_dict()

    scored_edges = []
    for row in edges.itertuples(index=False):
        alpha_source = disparity_significance(
            float(row.weight), float(out_strength[row.source]), int(out_degree[row.source])
        )
        alpha_target = disparity_significance(
            float(row.weight), float(in_strength[row.target]), int(in_degree[row.target])
        )
        scored_edges.append(
            {
                "source": row.source,
                "target": row.target,
                "weight": float(row.weight),
                "alpha_source": alpha_source,
                "alpha_target": alpha_target,
                "alpha": min(alpha_source, alpha_target),
            }
        )

    layout = json.loads(LAYOUT_PATH.read_text(encoding="utf-8"))
    layout_by_id = {node["id"]: node for node in layout["nodes"]}
    if set(layout_by_id) != node_ids:
        raise ValueError("The frozen network layout must match the current node dataset.")
    payload = {
        "meta": {
            "title": "Week 4 · Directed disparity-filter backbone",
            "method": "Serrano–Boguñá–Vespignani disparity filter",
            "parameter": (
                "alpha is the endpoint significance threshold. Retain a directed "
                "arc when its outgoing-source or incoming-target disparity tail "
                "probability is less than or equal to alpha."
            ),
            "null_model": (
                "At each node, normalized incident edge weights are compared with "
                "a uniform random allocation of that node's strength among its "
                "distinct incoming or outgoing neighbors."
            ),
            "directionality": (
                "Direction is preserved: outgoing and incoming strengths and "
                "degrees are tested separately. The OR rule retains an arc if it "
                "is significant at either endpoint."
            ),
            "interpretation": (
                "Excluded links fail this filter at the selected alpha; this does "
                "not establish that they are historically unimportant."
            ),
            "weight_definition": layout["meta"]["weight_definition"],
            "source": layout["meta"]["source"],
        },
        "stats": {
            "nodes": len(nodes),
            "directed_edges": len(scored_edges),
            "total_directed_weight": float(edges["weight"].sum()),
        },
        "nodes": [
            {
                "id": row.node_id,
                "name": row.name,
                "url": row.url,
                "isolated": bool(layout_by_id[row.node_id]["isolated"]),
                "x": layout_by_id[row.node_id]["x"],
                "y": layout_by_id[row.node_id]["y"],
            }
            for row in nodes.itertuples(index=False)
        ],
        "edges": scored_edges,
    }
    OUTPUT_PATH.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    print(
        f"Wrote {OUTPUT_PATH.relative_to(PROJECT_ROOT)}: "
        f"{payload['stats']['nodes']} nodes, {payload['stats']['directed_edges']} "
        f"weighted directed arcs"
    )
    for alpha in (0.01, 0.05, 0.1, 0.2, 0.5):
        retained = sum(edge["alpha"] <= alpha for edge in scored_edges)
        print(f"alpha={alpha:.2f}: {retained} / {len(scored_edges)} directed arcs retained")


if __name__ == "__main__":
    main()
