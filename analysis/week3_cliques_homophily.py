"""Build cached Wikipedia metadata and the Week 3 clique/homophily dataset.

The graph is the same undirected projection used in ``week3_analysis.py``.  The
only web requests made here are to the character pages supplied in the frozen
Week 1 node file.  Their compact extracted fields are cached, so reruns do not
download them again unless ``--refresh`` is passed.
"""

from __future__ import annotations

import argparse
import json
import random
import re
import sys
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

import networkx as nx
import pandas as pd
from bs4 import BeautifulSoup

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = PROJECT_ROOT / "data"
NODES_PATH = DATA_DIR / "week1_nodes.tsv"
CACHE_PATH = DATA_DIR / "week3_wikipedia_metadata.json"
OUTPUT_PATH = DATA_DIR / "week3_cliques_homophily.json"

sys.path.insert(0, str(PROJECT_ROOT))
from build_graph_data import read_edges  # noqa: E402

USER_AGENT = "SGI-course-project/1.0 (educational static analysis; contact: course-project@example.invalid)"
REQUEST_DELAY_SECONDS = 0.15
SEED = 260927
NULL_RUNS = 100
MAX_CLIQUES = 12
MIN_ATTRIBUTE_COVERAGE = 0.35
YEAR_PATTERN = re.compile(r"\b(?:1[89]\d{2}|20\d{2})\b")


def load_graph():
    nodes = pd.read_csv(NODES_PATH, sep="\t", comment="#", quoting=3)
    edges = read_edges(DATA_DIR / "week1_edges.tsv")
    graph = nx.Graph()
    graph.add_nodes_from(nodes["node_id"])
    graph.add_edges_from(edges.itertuples(index=False, name=None))
    return graph, nodes


def clean_text(value):
    return re.sub(r"\s+", " ", value).strip()


def infobox_fields(html):
    """Extract only explicitly labelled infobox values; never infer from prose."""
    soup = BeautifulSoup(html, "html.parser")
    fields = {}
    for row in soup.select("table.infobox tr"):
        header = row.find("th")
        cell = row.find("td")
        if not header or not cell:
            continue
        label = clean_text(header.get_text(" ", strip=True)).lower()
        fields[label] = cell

    affiliations = fields.get("team affiliations") or fields.get("affiliations")
    teams = []
    if affiliations:
        # Link labels are the structured, human-curated items in the infobox.
        # Deduplicate while preserving Wikipedia's displayed order.
        for link in affiliations.select("a"):
            label = clean_text(link.get_text(" ", strip=True))
            href = link.get("href", "")
            if label and not href.startswith("#") and label not in teams:
                teams.append(label)

    first = fields.get("first appearance")
    first_appearance = clean_text(first.get_text(" ", strip=True)) if first else None
    year_match = YEAR_PATTERN.search(first_appearance or "")
    year = int(year_match.group()) if year_match else None
    return {"teams": teams, "first_appearance": first_appearance, "year": year}


def fetch_metadata(nodes, refresh=False):
    cache = {}
    if CACHE_PATH.exists() and not refresh:
        with CACHE_PATH.open(encoding="utf-8") as file:
            cache = json.load(file).get("nodes", {})

    def save_cache():
        payload = {
            "metadata_source": "Wikipedia REST HTML infoboxes from URLs in week1_nodes.tsv",
            "extraction": "Only explicitly labelled 'Team affiliations'/'Affiliations' and 'First appearance' infobox rows; no prose inference.",
            "nodes": cache,
        }
        with CACHE_PATH.open("w", encoding="utf-8") as file:
            json.dump(payload, file, ensure_ascii=False, separators=(",", ":"))

    def wiki_links(value):
        labels = []
        for target, label in re.findall(r"\[\[([^\]|]+)(?:\|([^\]]+))?\]\]", value):
            cleaned = clean_text(re.sub(r"<.*?>|''", "", label or target))
            if cleaned and cleaned not in labels:
                labels.append(cleaned)
        return labels

    def source_fields(source):
        """Read explicit fields from the first comics-character infobox source."""
        start = re.search(r"\{\{[Ii]nfobox comics character\b", source)
        if not start:
            return {"teams": [], "first_appearance": None, "year": None}
        depth, end = 0, start.start()
        for index in range(start.start(), len(source) - 1):
            token = source[index:index + 2]
            if token == "{{":
                depth += 1
            elif token == "}}":
                depth -= 1
                if depth == 0:
                    end = index + 2
                    break
        box = source[start.start():end]
        debut = re.search(r"(?mi)^\|\s*(?:debut|first appearance)\s*=\s*(.*)$", box)
        alliances = re.search(r"(?mis)^\|\s*(?:alliances|team affiliations|affiliations)\s*=\s*(.*?)(?=^\|\s*[A-Za-z_ ]+\s*=|\Z)", box)
        first = clean_text(re.sub(r"<.*?>|''", "", debut.group(1))) if debut else None
        year_match = YEAR_PATTERN.search(first or "")
        return {"teams": wiki_links(alliances.group(1)) if alliances else [], "first_appearance": first,
                "year": int(year_match.group()) if year_match else None}

    missing = [node for _, node in nodes.iterrows() if node["node_id"] not in cache]
    changed = False
    # MediaWiki permits up to 50 titles per query. This is deliberately batched
    # to avoid hundreds of page requests while still using only source infoboxes.
    for offset in range(0, len(missing), 50):
        batch = missing[offset:offset + 50]
        params = "action=query&format=json&formatversion=2&prop=revisions&rvprop=content&rvslots=main&titles="
        titles = "|".join(node["url"].rsplit("/", 1)[-1].replace("_", " ") for node in batch)
        try:
            request = Request("https://en.wikipedia.org/w/api.php?" + params + quote(titles), headers={"User-Agent": USER_AGENT})
            with urlopen(request, timeout=45) as response:
                pages = json.load(response)["query"]["pages"]
            by_title = {page["title"].replace(" ", "_"): page for page in pages}
            for node in batch:
                page = by_title.get(node["url"].rsplit("/", 1)[-1])
                source = page.get("revisions", [{}])[0].get("slots", {}).get("main", {}).get("content", "") if page else ""
                entry = source_fields(source)
                entry["status"] = "ok" if source else "unavailable"
                cache[node["node_id"]] = entry
        except (HTTPError, URLError, TimeoutError, KeyError) as error:
            for node in batch:
                cache[node["node_id"]] = {"teams": [], "first_appearance": None, "year": None, "status": f"error: {type(error).__name__}"}
        changed = True
        save_cache()
        print(f"cached {len(cache)} / {len(nodes)}", flush=True)
        time.sleep(1)

    if changed or not CACHE_PATH.exists():
        save_cache()
    return cache


def dominant(values, denominator):
    if not values:
        return None
    counts = {}
    for value in values:
        counts[value] = counts.get(value, 0) + 1
    label, count = sorted(counts.items(), key=lambda item: (-item[1], item[0]))[0]
    return {"label": label, "count": count, "of": denominator, "distinct": len(counts)}


def clique_data(graph, names, metadata):
    cliques = sorted(
        nx.find_cliques(graph),
        key=lambda clique: (-len(clique), tuple(sorted(names[node] for node in clique))),
    )
    selected = cliques[:MAX_CLIQUES]
    result = []
    for index, clique in enumerate(selected, start=1):
        members = sorted(clique, key=lambda node: names[node])
        size = len(members)
        possible = size * (size - 1) // 2
        team_values = [team for node in members for team in metadata[node]["teams"]]
        decades = [f"{metadata[node]['year'] // 10 * 10}s" for node in members if metadata[node]["year"]]
        result.append({
            "id": f"clique-{index:02d}", "rank": index, "size": size,
            "internal_edges": graph.subgraph(members).number_of_edges(), "possible_edges": possible,
            "density": 1.0 if possible else 0.0,
            "members": [{"id": node, "name": names[node], "teams": metadata[node]["teams"],
                         "decade": f"{metadata[node]['year'] // 10 * 10}s" if metadata[node]["year"] else None}
                        for node in members],
            "team": dominant(team_values, size),
            "team_known_members": sum(bool(metadata[node]["teams"]) for node in members),
            "decade": dominant(decades, size),
            "decade_known_members": len(decades),
        })
    for clique in result:
        member_ids = {member["id"] for member in clique["members"]}
        overlaps = []
        for other in result:
            if other["id"] == clique["id"]:
                continue
            overlap = len(member_ids & {member["id"] for member in other["members"]})
            if overlap:
                overlaps.append({"id": other["id"], "rank": other["rank"], "count": overlap})
        clique["overlap"] = max(overlaps, key=lambda item: (item["count"], -item["rank"]), default=None)
    return {"maximum_size": len(cliques[0]), "maximum_count": sum(len(c) == len(cliques[0]) for c in cliques),
            "algorithm": "NetworkX Bron–Kerbosch maximal-clique enumeration", "cliques": result}


def same_category(left, right, attribute):
    if attribute == "team":
        return bool(set(left["teams"]) & set(right["teams"]))
    return left["decade"] == right["decade"]


def homophily(graph, metadata, names):
    attributes = {
        "team": {node: {"teams": metadata[node]["teams"]} for node in graph},
        "decade": {node: {"decade": f"{metadata[node]['year'] // 10 * 10}s" if metadata[node]["year"] else None} for node in graph},
    }
    results = {}
    rng = random.Random(SEED)
    rewired_graphs = []
    for _ in range(NULL_RUNS):
        randomized = graph.copy()
        nx.double_edge_swap(randomized, nswap=10 * randomized.number_of_edges(), max_tries=100 * randomized.number_of_edges(), seed=rng)
        rewired_graphs.append(randomized)

    for attribute, values in attributes.items():
        known = lambda node: bool(values[node]["teams"]) if attribute == "team" else values[node]["decade"] is not None
        valid_real = [(u, v) for u, v in graph.edges if known(u) and known(v)]
        real = sum(same_category(values[u], values[v], attribute) for u, v in valid_real) / len(valid_real) if valid_real else None
        distribution = []
        for randomized in rewired_graphs:
            valid = [(u, v) for u, v in randomized.edges if known(u) and known(v)]
            distribution.append(sum(same_category(values[u], values[v], attribute) for u, v in valid) / len(valid) if valid else 0)
        mean = sum(distribution) / len(distribution)
        variance = sum((value - mean) ** 2 for value in distribution) / (len(distribution) - 1)
        sd = variance ** .5
        coverage = sum(known(node) for node in graph)
        results[attribute] = {
            "label": "Team" if attribute == "team" else "First-appearance decade",
            "kind": "shared any team affiliation" if attribute == "team" else "same first-appearance decade",
            "coverage": {"known_nodes": coverage, "total_nodes": graph.number_of_nodes()},
            "valid_edges": len(valid_real), "real": real, "null_mean": mean, "null_sd": sd,
            "z": (real - mean) / sd if sd else None, "null_distribution": distribution,
        }
    return results


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--refresh", action="store_true", help="re-download cached Wikipedia infobox fields")
    args = parser.parse_args()
    graph, nodes = load_graph()
    raw_metadata = fetch_metadata(nodes, refresh=args.refresh)
    metadata = {node: raw_metadata.get(node, {"teams": [], "year": None}) for node in graph}
    names = nodes.set_index("node_id")["name"].to_dict()
    coverage = {
        "team": {"known_nodes": sum(bool(metadata[n]["teams"]) for n in graph), "total_nodes": graph.number_of_nodes()},
        "decade": {"known_nodes": sum(metadata[n]["year"] is not None for n in graph), "total_nodes": graph.number_of_nodes()},
    }
    output = {
        "metadata": {
            "graph_source": "02805 Week 1 shared Marvel Wikipedia network; undirected projection",
            "nodes": graph.number_of_nodes(), "edges": graph.number_of_edges(), "seed": SEED,
            "null_runs": NULL_RUNS,
            "null_model": "Degree-preserving double-edge swaps: same characters and exact degree sequence, rewired edges.",
            "metadata_source": "Wikipedia page infoboxes cached in data/week3_wikipedia_metadata.json",
            "extraction_limitations": "Missing infobox fields remain null/unknown. Team lists are multi-valued; a team edge means endpoints share any listed affiliation.",
            "coverage": coverage,
        },
        "cliques": clique_data(graph, names, metadata),
        "nodes": [
            {"id": node, "name": names[node], "teams": metadata[node]["teams"],
             "first_appearance": metadata[node].get("first_appearance"),
             "decade": f"{metadata[node]['year'] // 10 * 10}s" if metadata[node].get("year") else None}
            for node in graph
        ],
        "homophily": homophily(graph, metadata, names),
    }
    with OUTPUT_PATH.open("w", encoding="utf-8") as file:
        json.dump(output, file, ensure_ascii=False, separators=(",", ":"))


if __name__ == "__main__":
    main()
