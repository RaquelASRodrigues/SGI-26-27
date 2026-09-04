import json
from io import StringIO
from pathlib import Path

import networkx as nx
import pandas as pd


DATA_DIR = Path(__file__).parent / "data"
NODES_PATH = DATA_DIR / "week1_nodes.tsv"
EDGES_PATH = DATA_DIR / "week1_edges.tsv"
OUTPUT_PATH = DATA_DIR / "graph.json"


def non_comment_lines(path):
    with path.open("r", encoding="utf-8-sig") as file:
        return [line for line in file if line.strip() and not line.lstrip().startswith("#")]


def read_edges(path):
    lines = non_comment_lines(path)
    if not lines:
        return pd.DataFrame(columns=["source", "target"])

    first_fields = lines[0].rstrip("\r\n").split("\t")
    has_header = len(first_fields) >= 2 and {
        first_fields[0].strip().lower(),
        first_fields[1].strip().lower(),
    } == {"source", "target"}

    return pd.read_csv(
        StringIO("".join(lines)),
        sep="\t",
        quoting=3,
        header=0 if has_header else None,
        names=None if has_header else ["source", "target"],
    )[["source", "target"]]


def main():
    nodes = pd.read_csv(NODES_PATH, sep="\t", comment="#", quoting=3)
    edges = read_edges(EDGES_PATH)

    graph = nx.DiGraph()
    graph.add_nodes_from(nodes["node_id"])
    graph.add_edges_from(edges.itertuples(index=False, name=None))

    degrees = dict(graph.degree())
    top5 = {
        node_id
        for node_id, _ in sorted(degrees.items(), key=lambda item: (-item[1], str(item[0])))[:5]
    }
    names = nodes.set_index("node_id")["name"].to_dict()

    output = {
        "nodes": [
            {
                "id": node_id,
                "name": names.get(node_id, node_id),
                "in_degree": graph.in_degree(node_id),
                "out_degree": graph.out_degree(node_id),
                "is_top5": node_id in top5,
            }
            for node_id in graph.nodes
        ],
        "edges": [
            {"source": source, "target": target}
            for source, target in graph.edges
        ],
    }
    with OUTPUT_PATH.open("w", encoding="utf-8") as file:
        json.dump(output, file, ensure_ascii=False, separators=(",", ":"))


if __name__ == "__main__":
    main()
