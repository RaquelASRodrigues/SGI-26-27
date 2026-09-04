import json
import sys
from pathlib import Path

import matplotlib.pyplot as plt
import networkx as nx
import pandas as pd

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from build_graph_data import read_edges  # noqa: E402


DATA_DIR = PROJECT_ROOT / "data"
ASSET_DIR = PROJECT_ROOT / "assets" / "week1"
ANALYSIS_DIR = PROJECT_ROOT / "analysis"
NODES_PATH = DATA_DIR / "week1_nodes.tsv"
GRAPH_JSON_PATH = DATA_DIR / "graph.json"

BACKGROUND = "#0a090d"
PAPER = "#f2eaf5"
LILAC = "#bd7dff"
PURPLE = "#7d2ed8"
MAGENTA = "#e84e83"


def load_graph():
    nodes = pd.read_csv(NODES_PATH, sep="\t", comment="#", quoting=3)
    edges = read_edges(DATA_DIR / "week1_edges.tsv")

    graph = nx.DiGraph()
    graph.add_nodes_from(nodes["node_id"])
    graph.add_edges_from(edges.itertuples(index=False, name=None))
    names = nodes.set_index("node_id")["name"].to_dict()
    return graph, names


def style_axes(ax):
    ax.set_facecolor(BACKGROUND)
    ax.tick_params(colors=PAPER, labelsize=9)
    for spine in ax.spines.values():
        spine.set_color("#493052")
    ax.xaxis.label.set_color(PAPER)
    ax.yaxis.label.set_color(PAPER)
    ax.title.set_color(PAPER)
    ax.grid(color=PURPLE, alpha=0.22, linewidth=0.6)


def save_degree_distributions(graph):
    degrees = pd.Series(dict(graph.degree()), dtype="int64")
    counts = degrees.value_counts().sort_index()

    fig, ax = plt.subplots(figsize=(10, 6), facecolor=BACKGROUND)
    ax.hist(degrees, bins=range(0, int(degrees.max()) + 2), color=LILAC, edgecolor=BACKGROUND, linewidth=0.7)
    ax.set_title("WEEK 01 · TOTAL DEGREE DISTRIBUTION", loc="left", fontweight="bold", pad=16)
    ax.set_xlabel("Total degree (in + out)")
    ax.set_ylabel("Number of nodes")
    style_axes(ax)
    fig.tight_layout()
    fig.savefig(ASSET_DIR / "degree_dist_linear.png", dpi=180, facecolor=BACKGROUND)
    plt.close(fig)

    positive = counts[counts.index > 0]
    fig, ax = plt.subplots(figsize=(10, 6), facecolor=BACKGROUND)
    ax.scatter(positive.index, positive / len(degrees), color=MAGENTA, s=28, alpha=0.9)
    ax.set_xscale("log")
    ax.set_yscale("log")
    ax.set_title("WEEK 01 · DEGREE DISTRIBUTION / LOG–LOG", loc="left", fontweight="bold", pad=16)
    ax.set_xlabel("Total degree, k (log scale)")
    ax.set_ylabel("P(k) (log scale)")
    style_axes(ax)
    fig.tight_layout()
    fig.savefig(ASSET_DIR / "degree_dist_loglog.png", dpi=180, facecolor=BACKGROUND)
    plt.close(fig)


def save_degree_comparison(graph, names, top5):
    rows = [
        {
            "node_id": node_id,
            "name": names.get(node_id, node_id),
            "in_degree": graph.in_degree(node_id),
            "out_degree": graph.out_degree(node_id),
            "is_top5": node_id in top5,
        }
        for node_id in graph.nodes
    ]
    degree_frame = pd.DataFrame(rows)
    degree_frame.sort_values(["in_degree", "name"], ascending=[False, True]).head(10).to_csv(
        ANALYSIS_DIR / "top_in_degree.csv", index=False
    )
    degree_frame.sort_values(["out_degree", "name"], ascending=[False, True]).head(10).to_csv(
        ANALYSIS_DIR / "top_out_degree.csv", index=False
    )

    fig, ax = plt.subplots(figsize=(9, 7), facecolor=BACKGROUND)
    regular = degree_frame[~degree_frame["is_top5"]]
    hubs = degree_frame[degree_frame["is_top5"]]
    ax.scatter(regular["in_degree"], regular["out_degree"], color=LILAC, s=24, alpha=0.65, label="Other nodes")
    ax.scatter(hubs["in_degree"], hubs["out_degree"], color=MAGENTA, s=52, edgecolors=PAPER, linewidths=.5, label="Top 5 total-degree hubs")
    for _, row in hubs.iterrows():
        ax.annotate(row["name"], (row["in_degree"], row["out_degree"]), xytext=(6, 5), textcoords="offset points", color=PAPER, fontsize=8)
    ax.set_title("WEEK 01 · IN-DEGREE VS OUT-DEGREE", loc="left", fontweight="bold", pad=16)
    ax.set_xlabel("In-degree · links pointing to a node")
    ax.set_ylabel("Out-degree · links leaving a node")
    ax.legend(frameon=False, labelcolor=PAPER, facecolor=BACKGROUND, loc="upper left")
    style_axes(ax)
    fig.tight_layout()
    fig.savefig(ASSET_DIR / "in_vs_out_degree.png", dpi=180, facecolor=BACKGROUND)
    plt.close(fig)


def save_components(graph, names):
    components = sorted(nx.weakly_connected_components(graph), key=len, reverse=True)
    giant = components[0]
    islands = components[1:]
    summary = {
        "giant_component_size": len(giant),
        "island_count": len(islands),
        "islands": [
            {
                "size": len(component),
                "nodes": sorted(names.get(node_id, node_id) for node_id in component),
            }
            for component in islands
        ],
    }
    with (ANALYSIS_DIR / "components_summary.json").open("w", encoding="utf-8") as file:
        json.dump(summary, file, ensure_ascii=False, indent=2)
    return summary


def save_network_art(graph, names, top5, component):
    subgraph = graph.subgraph(component).to_undirected()
    positions = nx.spring_layout(subgraph, seed=28, k=0.32, iterations=120)
    fig, ax = plt.subplots(figsize=(12, 9), facecolor=BACKGROUND)
    ax.set_facecolor(BACKGROUND)
    regular = [node_id for node_id in subgraph if node_id not in top5]
    hubs = [node_id for node_id in subgraph if node_id in top5]
    nx.draw_networkx_edges(subgraph, positions, ax=ax, edge_color="#9a60c4", alpha=.16, width=.45)
    nx.draw_networkx_nodes(subgraph, positions, nodelist=regular, ax=ax, node_color=LILAC, node_size=18, alpha=.7, linewidths=0)
    nx.draw_networkx_nodes(subgraph, positions, nodelist=hubs, ax=ax, node_color=MAGENTA, node_size=80, edgecolors=PAPER, linewidths=.5)
    nx.draw_networkx_labels(
        subgraph,
        positions,
        labels={node_id: names.get(node_id, node_id) for node_id in hubs},
        ax=ax,
        font_color=PAPER,
        font_size=7,
        font_family="DejaVu Sans",
    )
    ax.set_title("WEEK 01 · MARVEL SUPERHEROES / GIANT COMPONENT", color=PAPER, loc="left", fontweight="bold", pad=14)
    ax.axis("off")
    fig.tight_layout()
    fig.savefig(ASSET_DIR / "network_art.png", dpi=180, facecolor=BACKGROUND, bbox_inches="tight")
    plt.close(fig)


def main():
    ASSET_DIR.mkdir(parents=True, exist_ok=True)
    graph, names = load_graph()
    top5 = {
        node_id
        for node_id, _ in sorted(dict(graph.degree()).items(), key=lambda item: (-item[1], str(item[0])))[:5]
    }
    save_degree_distributions(graph)
    save_degree_comparison(graph, names, top5)
    summary = save_components(graph, names)
    components = sorted(nx.weakly_connected_components(graph), key=len, reverse=True)
    save_network_art(graph, names, top5, components[0])

    top_in = max(graph.in_degree, key=lambda item: (item[1], str(item[0])))
    top_out = max(graph.out_degree, key=lambda item: (item[1], str(item[0])))
    print(f"Giant component: {summary['giant_component_size']} nodes")
    print(f"Islands: {summary['island_count']}")
    print(f"Top in-degree: {names.get(top_in[0], top_in[0])} ({top_in[1]})")
    print(f"Top out-degree: {names.get(top_out[0], top_out[0])} ({top_out[1]})")
    print("Plausible reason: hub pages may be linked TO by many articles, while list-heavy pages may link OUT to many others.")


if __name__ == "__main__":
    main()
