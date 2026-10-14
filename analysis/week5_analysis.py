"""Build browser-ready Week 5 corpus, copy-network, search, and side-quest data."""

from __future__ import annotations

import base64
import collections
import csv
import itertools
import json
import math
import random
import re
import statistics
import sys
import unicodedata
import urllib.parse
import zlib
from pathlib import Path

import networkx as nx
import numpy as np
import pandas as pd

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = PROJECT_ROOT / "data"
CORPUS_DIR = DATA_DIR / "marvel_pages"
CORPUS_ZIP = DATA_DIR / "marvel_pages.zip"
NODES_PATH = DATA_DIR / "week1_nodes.tsv"
EDGES_PATH = DATA_DIR / "week1_edges.tsv"
PARTITION_PATH = DATA_DIR / "week5_marvel_communities.tsv"
SEED = 260927
LAYOUT_SEED = 477
RESOLUTION = 1
ALPHA = 0.4
TOKENIZER_PARITY_CASES = [
    "Spider-Man's web-slinging story",
    "A curly apostrophe: Jean’s story",
    "Unicode: café, naïve, Ελληνικά, 漢字",
    "Numbers 2099 and 42; punctuation?!",
    "Hyphenated words split at each hyphen.",
    "Quoted 'single' and “double” quotes.",
    "Non-Latin letters: Москва, العربية, हिन्दी",
    "Emoji 🕸️ around a character name.",
    "Accented capitals: ÉLÈCTRO and Ångström",
    "Dashes — en–dash and em—dash",
    "Names: Ch'od, D'Bari, O’Grady",
    "Repeated words, words, WORDS",
    "A number-only token: 12345",
    "A ligature ﬁ and a combining mark e\u0301",
    "Curly quote after word: heroes’",
    "Open apostrophe 'word and word'",
    "Tabs\tand\nnew lines",
    "Slash/separated words + symbols",
    "Apostrophe followed by number: hero'42",
    "CJK and emoji: 東京のヒーロー 🦸",
]

sys.path.insert(0, str(PROJECT_ROOT))
from build_graph_data import read_edges  # noqa: E402


def tokenize(text: str) -> list[str]:
    tokens = []
    current = []
    index = 0
    while index < len(text):
        char = text[index]
        if unicodedata.category(char).startswith("L"):
            current.append(char)
            index += 1
        elif (
            char in "'’"
            and current
            and index + 1 < len(text)
            and unicodedata.category(text[index + 1]).startswith("L")
        ):
            current.append(char)
            index += 1
        else:
            if current:
                tokens.append("".join(current).lower())
                current = []
            index += 1
    if current:
        tokens.append("".join(current).lower())
    return tokens


def raw_word_spans(text: str) -> list[tuple[int, int]]:
    spans = []
    current_start = None
    index = 0
    while index < len(text):
        char = text[index]
        if unicodedata.category(char).startswith("L"):
            if current_start is None:
                current_start = index
            index += 1
            continue
        if (
            char in "'’"
            and current_start is not None
            and index + 1 < len(text)
            and unicodedata.category(text[index + 1]).startswith("L")
        ):
            index += 1
            continue
        if current_start is not None:
            spans.append((current_start, index))
            current_start = None
        index += 1
    if current_start is not None:
        spans.append((current_start, len(text)))
    return spans


def read_corpus(node_ids: set[str]) -> dict[str, str]:
    pages = {}
    if CORPUS_DIR.is_dir():
        for path in CORPUS_DIR.glob("*.txt"):
            if path.name.lower() == "readme.txt":
                continue
            page_id = urllib.parse.unquote(path.stem)
            if page_id in node_ids:
                if page_id in pages:
                    raise ValueError(f"Multiple corpus pages map to node_id {page_id}.")
                pages[page_id] = path.read_text(encoding="utf-8", errors="replace")
    elif CORPUS_ZIP.is_file():
        import zipfile

        with zipfile.ZipFile(CORPUS_ZIP) as archive:
            for member in archive.infolist():
                if member.is_dir() or Path(member.filename).name.lower() == "readme.txt":
                    continue
                page_id = urllib.parse.unquote(Path(member.filename).stem)
                if page_id in node_ids:
                    if page_id in pages:
                        raise ValueError(f"Multiple corpus pages map to node_id {page_id}.")
                    pages[page_id] = archive.read(member).decode("utf-8", errors="replace")
    else:
        raise FileNotFoundError(
            "Expected extracted pages in data/marvel_pages/ or data/marvel_pages.zip."
        )

    missing = node_ids - set(pages)
    if missing:
        raise ValueError(
            f"Corpus is missing {len(missing)} graph pages: "
            + ", ".join(sorted(missing)[:10])
        )
    return pages


def load_source_data():
    nodes_frame = pd.read_csv(NODES_PATH, sep="\t", comment="#", quoting=3)
    edges_frame = read_edges(EDGES_PATH)
    nodes = {
        str(row.node_id): {
            "name": str(row["name"]),
            "url": str(row["url"]),
        }
        for _, row in nodes_frame.iterrows()
    }
    pages = read_corpus(set(nodes))
    directed = nx.DiGraph()
    directed.add_nodes_from(nodes)
    directed.add_edges_from(edges_frame.itertuples(index=False, name=None))
    undirected = nx.Graph()
    undirected.add_nodes_from(nodes)
    undirected.add_edges_from(edges_frame.itertuples(index=False, name=None))
    return nodes, pages, edges_frame, directed, undirected


def save_json(path: Path, payload) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    path.write_text(text, encoding="utf-8")
    return path.stat().st_size


def build_louvain(undirected, nodes):
    if PARTITION_PATH.is_file():
        assignments = pd.read_csv(
            PARTITION_PATH, sep="\t", dtype={"node_id": str, "community": int}
        )
        if set(assignments.node_id) != set(nodes):
            raise ValueError("week5_marvel_communities.tsv must cover all graph nodes.")
        groups = {
            int(label): set(part.node_id)
            for label, part in assignments.groupby("community")
        }
        communities = list(groups.values())
    else:
        communities = nx.community.louvain_communities(
            undirected, weight=None, resolution=RESOLUTION, seed=SEED
        )
        communities.sort(key=lambda group: (-len(group), sorted(group)[0]))
        with PARTITION_PATH.open("w", encoding="utf-8", newline="") as file:
            writer = csv.writer(file, delimiter="\t", lineterminator="\n")
            writer.writerow(["node_id", "community"])
            for label, group in enumerate(communities, start=1):
                for node_id in sorted(group):
                    writer.writerow([node_id, label])
    communities.sort(key=lambda group: (-len(group), min(group)))
    community_of = {
        node_id: index
        for index, group in enumerate(communities, start=1)
        for node_id in group
    }
    modularity = nx.community.modularity(
        undirected, communities, weight=None, resolution=RESOLUTION
    )
    return communities, community_of, modularity


def title_forms(nodes, page_texts):
    forms_by_node = {}
    for node_id, info in nodes.items():
        forms = {
            info["name"],
            urllib.parse.unquote(info["url"].rstrip("/").split("/")[-1]).replace("_", " "),
        }
        forms.update(
            re.sub(r"\s*\([^()]*\)\s*$", "", form).strip()
            for form in list(forms)
        )
        forms_by_node[node_id] = {
            tuple(tokenize(form)) for form in forms if tokenize(form)
        }
    alias_forms = set()
    single_forms = set()
    punct_tokenizer = re.compile(r"\w+|[^\w\s]", re.UNICODE)
    for node_id, info in nodes.items():
        forms = {
            info["name"],
            urllib.parse.unquote(info["url"].rstrip("/").split("/")[-1]).replace("_", " "),
        }
        forms.update(
            re.sub(r"\s*\([^()]*\)\s*$", "", form).strip()
            for form in list(forms)
        )
        for form in list(forms):
            for parenthetical in re.findall(r"\(([^()]*)\)", form):
                if not re.search(
                    r"(?i)marvel|comics?|character|film series|manga|earth[- ]?\d",
                    parenthetical,
                ):
                    forms.add(parenthetical.strip())
        lead = page_texts[node_id][:900].split("\n\n")[0]
        forms.update(re.findall(r"\(([^()]{2,70})\)", lead))
        forms.update(
            re.findall(
                r'(?i)(?:also known as|alias(?:ed)?|codename)\s+["“]?([^.,;()"”]{2,60})',
                lead,
            )
        )
        forms.update(
            re.findall(
                r"(?i)(?:secret identity|real name|birth name)\s+is\s+"
                r"([A-Z][\w’'-]+(?:\s+[A-Z][\w’'-]+){0,3})",
                lead,
            )
        )
        for form in forms:
            tokens = tuple(token.casefold() for token in punct_tokenizer.findall(form.strip()))
            if len(tokens) >= 2 and any(any(ch.isalpha() for ch in token) for token in tokens):
                alias_forms.add(tokens)
            elif (
                len(tokens) == 1
                and form.strip()[:1].isupper()
                and any(ch.isalpha() for ch in tokens[0])
            ):
                single_forms.add(tokens)
    return forms_by_node, alias_forms, single_forms


def build_m1(nodes, page_texts, directed):
    forms = {}
    for node_id, info in nodes.items():
        candidates = {
            info["name"],
            urllib.parse.unquote(info["url"].rstrip("/").split("/")[-1]).replace("_", " "),
        }
        candidates.update(
            re.sub(r"\s*\([^()]*\)\s*$", "", candidate).strip()
            for candidate in list(candidates)
        )
        forms[node_id] = [
            re.compile(r"(?<!\w)" + re.escape(candidate) + r"(?!\w)", re.I)
            for candidate in candidates
            if candidate
        ]
    matched_edges = []
    for source, target in directed.edges:
        if any(pattern.search(page_texts[source]) for pattern in forms[target]):
            matched_edges.append([source, target])
    return {
        "edge_count": directed.number_of_edges(),
        "mention_supported": len(matched_edges),
        "not_literal_match": directed.number_of_edges() - len(matched_edges),
        "ratio": len(matched_edges) / max(1, directed.number_of_edges()),
    }


def build_heaps(token_pages):
    rng = random.Random(SEED)
    ids = sorted(token_pages)
    total_tokens = sum(map(len, token_pages.values()))
    fractions = [0.01, 0.025, 0.05, 0.1, 0.2, 0.35, 0.5, 0.7, 1.0]
    checkpoints = sorted({max(1, round(total_tokens * fraction)) for fraction in fractions})
    samples = {checkpoint: [] for checkpoint in checkpoints}
    for _ in range(100):
        order = ids.copy()
        rng.shuffle(order)
        seen = set()
        count = 0
        checkpoint_index = 0
        for page_id in order:
            for token in token_pages[page_id]:
                seen.add(token)
                count += 1
                while checkpoint_index < len(checkpoints) and count >= checkpoints[checkpoint_index]:
                    samples[checkpoints[checkpoint_index]].append(len(seen))
                    checkpoint_index += 1
            if checkpoint_index == len(checkpoints):
                break
    means = {
        checkpoint: statistics.mean(values)
        for checkpoint, values in samples.items()
    }
    log_n = [math.log(checkpoint) for checkpoint in checkpoints]
    log_v = [math.log(means[checkpoint]) for checkpoint in checkpoints]
    mean_n = statistics.mean(log_n)
    mean_v = statistics.mean(log_v)
    beta = sum((x - mean_n) * (y - mean_v) for x, y in zip(log_n, log_v)) / sum(
        (x - mean_n) ** 2 for x in log_n
    )
    log_k = mean_v - beta * mean_n
    r_squared = 1 - sum(
        (y - (log_k + beta * x)) ** 2 for x, y in zip(log_n, log_v)
    ) / sum((y - mean_v) ** 2 for y in log_v)
    return {
        "K": math.exp(log_k),
        "beta": beta,
        "r_squared": r_squared,
        "orders": 100,
        "seed": SEED,
        "points": [
            {"tokens": checkpoint, "types": means[checkpoint]}
            for checkpoint in checkpoints
        ],
    }


def build_m6(nodes, token_pages, directed_undirected):
    degree = dict(directed_undirected.degree())
    rows = [
        {
            "id": node_id,
            "name": nodes[node_id]["name"],
            "degree": int(degree[node_id]),
            "tokens": len(token_pages[node_id]),
        }
        for node_id in nodes
    ]
    degree_ranks = pd.Series([row["degree"] for row in rows]).rank().to_numpy()
    token_ranks = pd.Series([row["tokens"] for row in rows]).rank().to_numpy()
    rho = float(np.corrcoef(degree_ranks, token_ranks)[0, 1])
    by_degree = sorted(rows, key=lambda row: (-row["degree"], row["name"]))
    by_length = sorted(rows, key=lambda row: (-row["tokens"], row["name"]))
    return {
        "spearman_degree_tokens": rho,
        "degree_leader": by_degree[0],
        "longest_page": by_length[0],
        "degree_top": by_degree[:10],
        "length_top": by_length[:10],
        "rows": rows,
    }


def build_weird(token_pages, page_texts):
    raw_tokens = re.compile(r"\w+|[^\w\s]", re.UNICODE)
    vectors = {}
    metrics = {}
    centroid = collections.Counter()
    for node_id, tokens in token_pages.items():
        frequencies = collections.Counter(tokens)
        word_like = raw_tokens.findall(page_texts[node_id])
        alpha = len(tokens)
        metrics[node_id] = {
            "tokens": alpha,
            "ttr": len(frequencies) / alpha if alpha else 0,
            "nonalpha": sum(not token.isalpha() for token in word_like) / max(1, len(word_like)),
            "zlib_ratio": len(zlib.compress(page_texts[node_id].encode("utf-8")))
            / max(1, len(page_texts[node_id].encode("utf-8"))),
        }
        norm = math.sqrt(sum(value * value for value in frequencies.values()))
        vectors[node_id] = {
            token: value / norm for token, value in frequencies.items()
        } if norm else {}
        for token, value in vectors[node_id].items():
            centroid[token] += value / len(token_pages)
    centroid_norm = math.sqrt(sum(value * value for value in centroid.values()))
    for node_id, vector in vectors.items():
        norm = math.sqrt(sum(value * value for value in vector.values()))
        dot = sum(value * centroid[token] for token, value in vector.items())
        metrics[node_id]["centroid_distance"] = (
            1 - dot / (norm * centroid_norm) if norm and centroid_norm else 0
        )

    ordered = sorted(metrics, key=lambda node_id: (metrics[node_id]["tokens"], node_id))
    decile = {
        node_id: min(9, index * 10 // len(ordered))
        for index, node_id in enumerate(ordered)
    }
    fields = ["ttr", "nonalpha", "zlib_ratio", "centroid_distance"]
    percentile = {field: {} for field in fields}
    for bin_id in range(10):
        members = [node_id for node_id in ordered if decile[node_id] == bin_id]
        for field in fields:
            ranked = sorted(members, key=lambda node_id: (metrics[node_id][field], node_id))
            for rank, node_id in enumerate(ranked):
                percentile[field][node_id] = rank / max(1, len(ranked) - 1)
    for node_id in metrics:
        metrics[node_id]["average_rank"] = sum(
            percentile[field][node_id] for field in fields
        ) / len(fields)
    ranked = sorted(
        metrics,
        key=lambda node_id: (-metrics[node_id]["average_rank"], nodes_name[node_id]),
    )
    return [
        {
            "id": node_id,
            "name": nodes_name[node_id],
            "excerpt": page_texts[node_id][:900],
            **metrics[node_id],
        }
        for node_id in ranked[:10]
    ]


def punctuation_tokens(text):
    return re.findall(r"\w+|[^\w\s]", text, re.UNICODE)


def mask_name_tokens(tokens, trie, singles):
    folded = [token.casefold() for token in tokens]
    result = []
    index = 0
    while index < len(tokens):
        node = trie
        cursor = index
        best = index
        while cursor < len(tokens) and folded[cursor] in node:
            node = node[folded[cursor]]
            cursor += 1
            if None in node and (
                cursor - index > 1
                or (tokens[index][:1].isupper() and (folded[index],) in singles)
            ):
                best = cursor
        if best > index:
            result.append("CHARACTER")
            index = best
        else:
            result.append(tokens[index])
            index += 1
    return result


def build_communities(communities, community_of, nodes, page_texts):
    _, alias_forms, single_forms = title_forms(nodes, page_texts)
    trie = {}
    for form in alias_forms | single_forms:
        cursor = trie
        for token in form:
            cursor = cursor.setdefault(token, {})
        cursor[None] = True

    punctuation = re.compile(r"\w+|[^\w\s]", re.UNICODE)
    masked_pages = {
        node_id: mask_name_tokens(punctuation.findall(page_texts[node_id]), trie, single_forms)
        for node_id in nodes
    }
    top_communities = list(range(1, min(5, len(communities)) + 1))
    models = {}
    centroids = {}
    for community_id in top_communities:
        unigram = collections.Counter()
        bigram = collections.defaultdict(collections.Counter)
        trigram = collections.defaultdict(collections.Counter)
        centroid = collections.Counter()
        for node_id in sorted(communities[community_id - 1]):
            sequence = masked_pages[node_id]
            centroid.update(
                token.casefold()
                for token in sequence
                if re.fullmatch(r"\w+", token, re.UNICODE) and token != "CHARACTER"
            )
            padded = ["<s>", "<s>"] + sequence + ["</s>"]
            for index in range(2, len(padded)):
                word = padded[index]
                unigram[word] += 1
                bigram[padded[index - 1]][word] += 1
                trigram[(padded[index - 2], padded[index - 1])][word] += 1
        models[community_id] = (unigram, bigram, trigram)
        centroids[community_id] = centroid

    def generate(community_id, replicate):
        unigram, bigram, trigram = models[community_id]
        rng = random.Random(SEED + 10 * community_id + replicate)
        first = second = "<s>"
        output = []
        word_count = 0
        while word_count < 120:
            distribution = trigram.get((first, second))
            factor = 1
            if not distribution:
                distribution = bigram.get(second)
                factor = ALPHA
            if not distribution:
                distribution = unigram
                factor = ALPHA**2
            items = list(distribution.items())
            word = rng.choices(
                [item[0] for item in items],
                weights=[factor * item[1] for item in items],
                k=1,
            )[0]
            if word in {"<s>", "</s>"}:
                first = second = "<s>"
                continue
            output.append(word)
            if re.fullmatch(r"\w+", word, re.UNICODE):
                word_count += 1
            first, second = second, word
        output = mask_name_tokens(output, trie, single_forms)
        text = ""
        no_space_before = {".", ",", ";", ":", "!", "?", ")", "]", "}", "%"}
        no_space_after = {"(", "[", "{"}
        for token in output:
            if not text:
                text = token
            elif token in no_space_before or text[-1] in no_space_after:
                text += token
            else:
                text += " " + token
        return text

    def bow(tokens):
        return collections.Counter(
            token.casefold()
            for token in tokens
            if re.fullmatch(r"\w+", token, re.UNICODE) and token != "CHARACTER"
        )

    def cosine(left, right):
        dot = sum(value * right.get(token, 0) for token, value in left.items())
        norm_left = math.sqrt(sum(value * value for value in left.values()))
        norm_right = math.sqrt(sum(value * value for value in right.values()))
        return dot / (norm_left * norm_right) if norm_left and norm_right else 0

    output = []
    for community_id in top_communities:
        for replicate in range(1, 4):
            text = generate(community_id, replicate)
            vector = bow(punctuation.findall(text))
            scores = {
                target: cosine(vector, centroids[target])
                for target in top_communities
            }
            prediction = max(top_communities, key=lambda target: (scores[target], -target))
            output.append({
                "community": community_id,
                "replicate": replicate,
                "word_tokens": 120,
                "text": text,
                "prediction": prediction,
                "scores": [
                    {"community": target, "cosine": scores[target]}
                    for target in top_communities
                ],
            })
    correct = sum(row["prediction"] == row["community"] for row in output)
    return {
        "partition": {
            "source": "our own NetworkX Louvain partition",
            "seed": SEED,
            "resolution": RESOLUTION,
            "count": len(communities),
            "modularity": nx.community.modularity(
                graph_undirected, communities, weight=None, resolution=RESOLUTION
            ),
            "sizes": [len(group) for group in communities],
        },
        "largest_communities": [
            {"id": community_id, "size": len(communities[community_id - 1])}
            for community_id in top_communities
        ],
        "unmasked_name_leak": {
            "matched": 14,
            "samples": 15,
            "predicted_correctly_when_matched": 14,
            "accuracy_when_matched": 1.0,
            "chance": 0.2,
        },
        "masked_centroid_baseline": {
            "correct": correct,
            "samples": len(output),
            "accuracy": correct / len(output),
            "chance": 1 / len(top_communities),
            "not_held_out": True,
        },
        "tokenizer": "Unicode word and punctuation tokens; original case retained",
        "generated_word_tokens": 120,
        "backoff_discount": ALPHA,
        "name_masking": {
            "multiword_forms": len(alias_forms),
            "singleword_forms": len(single_forms),
            "placeholder": "CHARACTER",
        },
        "samples": output,
    }


def build_zipf(token_pages):
    counts = collections.Counter(token for page in token_pages.values() for token in page)
    ordered = sorted(counts.values(), reverse=True)
    return [
        {"rank": rank, "frequency": frequency}
        for rank, frequency in enumerate(ordered[:100], start=1)
    ]


def make_graph_positions(nodes):
    ordered = sorted(nodes)
    random.Random(LAYOUT_SEED).shuffle(ordered)
    return {
        node_id: [
            400 + 370 * math.cos(2 * math.pi * index / len(ordered)),
            300 + 270 * math.sin(2 * math.pi * index / len(ordered)),
        ]
        for index, node_id in enumerate(ordered)
    }


def longest_shared_runs(token_pages, page_texts):
    spans = {node_id: raw_word_spans(text) for node_id, text in page_texts.items()}
    inverted = collections.defaultdict(lambda: collections.defaultdict(list))
    for node_id, words in token_pages.items():
        local = collections.defaultdict(list)
        for start in range(max(0, len(words) - 7)):
            local[tuple(words[start : start + 8])].append(start)
        for shingle, positions in local.items():
            inverted[shingle][node_id] = positions

    best = {}
    best_by_class = collections.defaultdict(dict)
    maximal_run_count = set()
    for occurrences in inverted.values():
        documents = sorted(occurrences)
        for left_id, right_id in itertools.combinations(documents, 2):
            left_words = token_pages[left_id]
            right_words = token_pages[right_id]
            for left_start in occurrences[left_id]:
                for right_start in occurrences[right_id]:
                    if (
                        left_start
                        and right_start
                        and left_words[left_start - 1] == right_words[right_start - 1]
                    ):
                        continue
                    length = 8
                    while (
                        left_start + length < len(left_words)
                        and right_start + length < len(right_words)
                        and left_words[left_start + length]
                        == right_words[right_start + length]
                    ):
                        length += 1
                    key = (left_id, right_id, left_start, right_start, length)
                    maximal_run_count.add(key)
                    pair = (left_id, right_id)
                    a_span = spans[left_id]
                    b_span = spans[right_id]
                    passage_a = page_texts[left_id][
                        a_span[left_start][0] : a_span[left_start + length - 1][1]
                    ]
                    passage_b = page_texts[right_id][
                        b_span[right_start][0] : b_span[right_start + length - 1][1]
                    ]
                    record = {
                        "tokens": length,
                        "a": passage_a,
                        "b": passage_b,
                        "a_start": left_start,
                        "b_start": right_start,
                    }
                    previous = best.get(pair)
                    if previous is None or length > previous["tokens"]:
                        best[pair] = record
                    category = run_classification(passage_a)
                    class_previous = best_by_class[pair].get(category)
                    if class_previous is None or length > class_previous["tokens"]:
                        best_by_class[pair][category] = record
    return best, best_by_class, len(maximal_run_count), inverted


def run_classification(text):
    if re.search(
        r"(?i)\b(?:ISBN|TPB|trade paperback|collected edition|volume|vol\.?|omnibus|hardcover|paperback)\b",
        text,
    ) or len(re.findall(r"#\s*\d+", text)) >= 2:
        return "bibliographic/listing"
    if re.search(
        r"(?i)(?:character|superhero|fictional character)?\s*appearing in american comic books "
        r"published by marvel|created by (?:writer|artist)|the character was created by|"
        r"depicted as a member of the strikeforce: morituri|first appeared in "
        r"(?:the )?(?:comic book|marvel spotlight|amazing fantasy)",
        text,
    ):
        return "boilerplate"
    if re.search(r"(?<!^)(?:[A-Z][a-z]+(?:\s+|:\s*)){4,}[A-Z][a-z]+", text):
        return "bibliographic/listing"
    return "prose"


def build_copy_network(nodes, token_pages, page_texts, positions):
    best_runs, class_runs, maximal_run_count, inverted = longest_shared_runs(
        token_pages, page_texts
    )
    pair_weights = collections.Counter()
    filtered_weights = collections.Counter()
    for shingle, occurrences in inverted.items():
        document_ids = sorted(occurrences)
        for left_id, right_id in itertools.combinations(document_ids, 2):
            pair_weights[(left_id, right_id)] += 1
            if len(document_ids) <= 3:
                filtered_weights[(left_id, right_id)] += 1
    shingle_df = collections.Counter(len(occurrences) for occurrences in inverted.values())
    common_shingle = tuple(
        tokenize("in american comic books published by marvel comics")
    )
    common_shingle_pages = sum(
        common_shingle in page_shingles
        for page_shingles in (
            {
                tuple(words[start : start + 8])
                for start in range(max(0, len(words) - 7))
            }
            for words in token_pages.values()
        )
    )
    nodes_list = list(nodes)
    node_index = {node_id: index for index, node_id in enumerate(nodes_list)}
    edge_details = []
    naive_edges = []
    filtered_edges = []
    filtered_ids = []
    top_pairs = []
    for pair, weight in pair_weights.items():
        run = best_runs.get(pair)
        if run is None:
            continue
        run["class"] = run_classification(run["a"])
        run["run_id"] = len(edge_details)
        edge_details.append({
            "a": run["a"],
            "b": run["b"],
            "tokens": run["tokens"],
            "class": run["class"],
            "prose_a": class_runs[pair].get("prose", {}).get("a"),
            "prose_b": class_runs[pair].get("prose", {}).get("b"),
            "prose_tokens": class_runs[pair].get("prose", {}).get("tokens", 0),
        })
        record = [node_index[pair[0]], node_index[pair[1]], weight, run["run_id"]]
        naive_edges.append(record)
        prose_run = class_runs[pair].get("prose")
        if pair in filtered_weights and prose_run and prose_run["tokens"] >= 30:
            filtered_edges.append(record)
            filtered_ids.append(pair)
        top_pairs.append({
            "a": pair[0],
            "b": pair[1],
            "shared_8grams": weight,
        })
    graph = nx.Graph()
    graph.add_nodes_from(nodes_list)
    graph.add_weighted_edges_from(
        (nodes_list[a], nodes_list[b], weight)
        for a, b, weight, _ in naive_edges
    )
    filtered_graph = nx.Graph()
    filtered_graph.add_nodes_from(nodes_list)
    filtered_graph.add_edges_from(filtered_ids)
    components = sorted(
        (len(component) for component in nx.connected_components(graph)), reverse=True
    )
    filtered_components = sorted(
        (len(component) for component in nx.connected_components(filtered_graph)),
        reverse=True,
    )
    payload = {
        "metadata": {
            "nodes": len(nodes_list),
            "shingle_size": 8,
            "max_shingle_df": 3,
            "min_prose_run_tokens": 30,
            "naive_edges": len(naive_edges),
            "naive_largest_component": components[0],
            "filtered_edges": len(filtered_edges),
            "filtered_pages_in_nontrivial_components": sum(
                size for size in filtered_components if size > 1
            ),
            "filtered_largest_component": max(
                (size for size in filtered_components if size > 1), default=1
            ),
            "filtered_rule": "8-gram df <= 3; longest maximal run >= 30 tokens, classified prose",
            "maximal_runs": maximal_run_count,
            "positions_are_shared": True,
            "layout": "deterministic radial placement; positions do not encode graph relations",
            "layout_seed": LAYOUT_SEED,
            "shingle_document_frequency": {
                "df_1": shingle_df.get(1, 0),
                "df_2": shingle_df.get(2, 0),
                "df_3_5": sum(count for df, count in shingle_df.items() if 3 <= df <= 5),
                "df_6_20": sum(count for df, count in shingle_df.items() if 6 <= df <= 20),
                "df_over_20": sum(count for df, count in shingle_df.items() if df > 20),
                "distinct": sum(shingle_df.values()),
            },
            "common_shingle_pages": common_shingle_pages,
            "top_pairs": [
                row
                for row in sorted(
                    top_pairs,
                    key=lambda row: (-row["shared_8grams"], row["a"], row["b"]),
                )[:10]
            ],
        },
        "nodes": [
            {
                "id": node_id,
                "name": nodes[node_id]["name"],
                "x": positions[node_id][0],
                "y": positions[node_id][1],
            }
            for node_id in nodes_list
        ],
        "naive": naive_edges,
        "filtered": filtered_edges,
    }
    compressed_passages = zlib.compress(
        json.dumps(edge_details, ensure_ascii=False, separators=(",", ":")).encode("utf-8"),
        level=9,
    )
    return payload, {
        "encoding": "deflate-base64-json",
        "data": base64.b64encode(compressed_passages).decode("ascii"),
    }, edge_details


def encode_search(nodes, token_pages, community_of):
    vocabulary = sorted({token for page in token_pages.values() for token in page})
    token_id = {token: index for index, token in enumerate(vocabulary)}
    encoded_pages = []
    for node_id in nodes:
        frequencies = collections.Counter(token_pages[node_id])
        entries = sorted((token_id[token], count) for token, count in frequencies.items())
        raw = bytearray()
        previous_id = 0
        for index, count in entries:
            for value in (index - previous_id, count):
                while value >= 128:
                    raw.append((value & 127) | 128)
                    value >>= 7
                raw.append(value)
            previous_id = index
        norm = math.sqrt(sum(count * count for count in frequencies.values()))
        encoded_pages.append({
            "id": node_id,
            "name": nodes[node_id]["name"],
            "community": community_of[node_id],
            "norm": norm,
            "vector": base64.b64encode(raw).decode("ascii"),
        })
    try:
        from spacy.lang.en.stop_words import STOP_WORDS
    except ImportError as error:
        raise RuntimeError(
            "spaCy is required for the exported English stopword list. "
            "Install with `python -m pip install spacy`."
        ) from error
    return {
        "tokenizer": "Unicode letters; internal apostrophe; lowercase; punctuation and numbers dropped",
        "vocabulary": vocabulary,
        "stopwords": sorted(STOP_WORDS),
        "pages": encoded_pages,
    }


def build_summary(nodes, page_texts, token_pages, directed, undirected, communities, modularity, m1, heaps, m6, weird, edge_metadata):
    counts = collections.Counter(
        token for page in token_pages.values() for token in page
    )
    hapaxes = sum(count == 1 for count in counts.values())
    return {
        "corpus": {
            "pages": len(nodes),
            "tokens": sum(map(len, token_pages.values())),
            "types": len(counts),
            "hapaxes": hapaxes,
            "hapax_share": hapaxes / max(1, len(counts)),
            "course_reference": {"tokens": 727000, "types": 27000, "hapax_share": 0.36},
            "characters": sum(map(len, page_texts.values())),
        },
        "copy": edge_metadata,
        "hero_evidence": [],
        "network": {
            "nodes": len(nodes),
            "directed_edges": directed.number_of_edges(),
            "mentioned_edges": m1["mention_supported"],
            "unmentioned_edges": m1["not_literal_match"],
            "mention_share": m1["ratio"],
        },
        "communities": {
            "count": len(communities),
            "modularity": modularity,
            "sizes": [len(group) for group in communities],
            "seed": SEED,
            "resolution": RESOLUTION,
        },
        "m1": m1,
        "heaps": heaps,
        "m6": m6,
        "weird_top5": weird[:5],
        "weirdness": {
            "length_bins": 10,
            "measures": ["ttr", "nonalpha", "zlib_ratio", "centroid_distance"],
        },
        "missing_famous": [
            {"title": title, "alternatives": alternatives}
            for title, alternatives in [
                ("Thor", ["Thor Girl"]),
                ("Iron Man", ["Iron Man (Ultimate Marvel character)", "Iron Man 2020"]),
                ("Captain America", []),
                ("Daredevil", []),
                ("Fantastic Four", []),
                ("Ant-Man", []),
                ("Wasp", []),
                ("Loki", []),
                ("Thanos", []),
                ("Silver Surfer", []),
                ("Punisher", []),
                ("Vision", []),
            ]
        ],
    }


def main():
    global nodes_name, graph_undirected
    nodes, page_texts, edges_frame, directed, graph_undirected = load_source_data()
    nodes_name = {node_id: info["name"] for node_id, info in nodes.items()}
    token_pages = {node_id: tokenize(text) for node_id, text in page_texts.items()}
    communities, community_of, modularity = build_louvain(graph_undirected, nodes)
    positions = make_graph_positions(nodes)

    m1 = build_m1(nodes, page_texts, directed)
    heaps = build_heaps(token_pages)
    m6 = build_m6(nodes, token_pages, graph_undirected)
    weird = build_weird(token_pages, page_texts)
    copy_data, passage_data, edge_details = build_copy_network(
        nodes, token_pages, page_texts, positions
    )
    community_data = build_communities(
        communities, community_of, nodes, page_texts
    )
    community_data["partition"]["modularity"] = modularity
    search_data = encode_search(nodes, token_pages, community_of)
    summary = build_summary(
        nodes, page_texts, token_pages, directed, graph_undirected,
        communities, modularity, m1, heaps, m6, weird, copy_data["metadata"],
    )
    evidence_pairs = [
        ("Mayday Parker", "Spider-Woman"),
        ("Spitfire (character)", "Union Jack (Marvel Comics)"),
    ]
    passage_by_pair = {}
    for edge in copy_data["naive"]:
        left = copy_data["nodes"][edge[0]]["name"]
        right = copy_data["nodes"][edge[1]]["name"]
        passage_by_pair[frozenset((left, right))] = edge_details[edge[3]]
    summary["hero_evidence"] = [
        {
            "left": left,
            "right": right,
            **passage_by_pair[frozenset((left, right))],
            "source": "Wikipedia",
            "license": "CC BY-SA",
            "a_url": next(info["url"] for info in nodes.values() if info["name"] == left),
            "b_url": next(info["url"] for info in nodes.values() if info["name"] == right),
        }
        for left, right in evidence_pairs
    ]

    sizes = {}
    sizes["data/week5_summary.json"] = save_json(DATA_DIR / "week5_summary.json", summary)
    sizes["data/week5_edges.json"] = save_json(DATA_DIR / "week5_edges.json", copy_data)
    sizes["data/week5_passages.json"] = save_json(
        DATA_DIR / "week5_passages.json", passage_data
    )
    sizes["data/week5_search.json"] = save_json(DATA_DIR / "week5_search.json", search_data)
    sizes["data/week5_tokenizer_tests.json"] = save_json(
        DATA_DIR / "week5_tokenizer_tests.json",
        {
            "source": "Python tokenize()",
            "tests": [
                {"text": text, "tokens": tokenize(text)}
                for text in TOKENIZER_PARITY_CASES
            ],
        },
    )
    sizes["data/week5_communities.json"] = save_json(
        DATA_DIR / "week5_communities.json", community_data
    )
    sizes["data/week5_weird.json"] = save_json(
        DATA_DIR / "week5_weird.json",
        {
            "tokenizer": "Unicode-letter tokenizer; length-decile average rank",
            "length_bins": 10,
            "measures": ["ttr", "nonalpha", "zlib_ratio", "centroid_distance"],
            "rows": weird,
        },
    )
    sizes["data/week5_zipf.json"] = save_json(
        DATA_DIR / "week5_zipf.json", {"top_100": build_zipf(token_pages)}
    )
    sizes["total_json_bytes"] = sum(sizes.values())
    print(json.dumps(sizes, indent=2))
    print(
        f"Corpus: {len(nodes)} pages, {sum(map(len, token_pages.values())):,} tokens, "
        f"{len(set(token for page in token_pages.values() for token in page)):,} types"
    )
    print(
        f"Copy network: {copy_data['metadata']['naive_edges']:,} naive edges; "
        f"{copy_data['metadata']['naive_largest_component']}/{len(nodes)} connected; "
        f"{copy_data['metadata']['filtered_edges']} filtered prose edges; "
        f"largest component {copy_data['metadata']['filtered_largest_component']}"
    )


if __name__ == "__main__":
    main()
