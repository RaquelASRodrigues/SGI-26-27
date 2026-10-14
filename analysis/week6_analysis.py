"""Build the held-out text-versus-network evidence for Week 6.

Run from the repository root: python analysis/week6_analysis.py
"""
from __future__ import annotations

import csv
import json
import re
import urllib.parse
from collections import Counter
from pathlib import Path

import networkx as nx
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import StratifiedKFold

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
PAGES = DATA / "marvel_pages"
SEED = 261014
COMMUNITIES = 5
FOLDS = 5
TOKEN = re.compile(r"[^\W\d_]+(?:['’][^\W\d_]+)*", re.UNICODE)


def rows(path):
    with path.open(encoding="utf-8", newline="") as f:
        yield from csv.DictReader((line for line in f if not line.startswith("#")), delimiter="\t")


def edge_rows(path):
    """The frozen edge file documents its header in a comment line."""
    with path.open(encoding="utf-8", newline="") as f:
        return list(csv.reader((line for line in f if line.strip() and not line.startswith("#")), delimiter="\t"))


def words(text):
    return [(match.group(0), match.group(0).lower()) for match in TOKEN.finditer(text)]


def read_pages(node_ids):
    pages = {}
    for path in PAGES.glob("*.txt"):
        node_id = urllib.parse.unquote(path.stem)
        if node_id in node_ids:
            pages[node_id] = path.read_text(encoding="utf-8", errors="replace")
    missing = node_ids - pages.keys()
    if missing:
        raise ValueError(f"Missing {len(missing)} pages, e.g. {sorted(missing)[:3]}")
    return pages


def name_terms(pages, node_ids):
    """Tokens capitalized in >=65% of observed uses, plus all node-id words."""
    total, capital = Counter(), Counter()
    for text in pages.values():
        for raw, token in words(text):
            total[token] += 1
            if raw[:1].isupper():
                capital[token] += 1
    detected = {token for token, count in total.items() if count >= 2 and capital[token] / count >= .65}
    ids = {token for node_id in node_ids for _, token in words(node_id.replace("_", " "))}
    return detected | ids, {"capitalized_ratio_at_least": .65, "minimum_uses": 2, "node_id_tokens_added": len(ids)}


def snippets(text, terms):
    result = []
    for term in terms[:3]:
        hit = re.search(r"\b" + re.escape(term).replace("\\ ", r"\\s+") + r"\b", text, re.I)
        if not hit:
            continue
        start, end = max(0, hit.start() - 92), min(len(text), hit.end() + 104)
        excerpt = " ".join(text[start:end].split())
        if start: excerpt = "…" + excerpt
        if end < len(text): excerpt += "…"
        result.append({"term": term, "text": excerpt})
    return result


def make_vectorizer():
    return TfidfVectorizer(tokenizer=str.split, preprocessor=None, token_pattern=None,
                           lowercase=False, sublinear_tf=True, norm="l2")


def evaluate(texts, labels, ids, names, raw_pages):
    cv = StratifiedKFold(n_splits=FOLDS, shuffle=True, random_state=SEED)
    classes = np.unique(labels)
    predicted = np.empty(len(labels), dtype=int)
    probabilities = np.zeros((len(labels), len(classes)))
    term_lists = [None] * len(labels)

    # Fit both vocabulary/IDF and classifier inside each training fold.  This is
    # deliberately more strict than transforming held-out pages with a corpus-wide IDF.
    for train, test in cv.split(texts, labels):
        vectorizer = make_vectorizer()
        train_matrix = vectorizer.fit_transform([texts[i] for i in train])
        test_matrix = vectorizer.transform([texts[i] for i in test])
        model = LogisticRegression(max_iter=3000, C=1, random_state=SEED)
        model.fit(train_matrix, labels[train])
        fold_prediction = model.predict(test_matrix)
        fold_probabilities = model.predict_proba(test_matrix)
        features = vectorizer.get_feature_names_out()
        for local, index in enumerate(test):
            predicted[index] = fold_prediction[local]
            probabilities[index] = fold_probabilities[local]
            predicted_index = int(np.where(model.classes_ == fold_prediction[local])[0][0])
            contribution = test_matrix[local].toarray()[0] * model.coef_[predicted_index]
            order = np.argsort(contribution)[::-1]
            term_lists[index] = [{"term": features[j], "value": round(float(contribution[j]), 6), "is_name": features[j] in names}
                                 for j in order if contribution[j] > 0][:8]

    # A genuine null: same folds and fitting procedure, but training labels permuted.
    shuffled_scores = []
    rng = np.random.default_rng(SEED + 19)
    for _ in range(30):
        shuffled = rng.permutation(labels)
        shuffled_prediction = np.empty(len(labels), dtype=int)
        for train, test in cv.split(texts, labels):
            vectorizer = make_vectorizer()
            train_matrix = vectorizer.fit_transform([texts[i] for i in train])
            test_matrix = vectorizer.transform([texts[i] for i in test])
            model = LogisticRegression(max_iter=3000, C=1, random_state=SEED)
            model.fit(train_matrix, shuffled[train])
            shuffled_prediction[test] = model.predict(test_matrix)
        shuffled_scores.append(float(np.mean(shuffled_prediction == labels)))
    records = []
    for i, node_id in enumerate(ids):
        predicted_index = int(np.where(classes == predicted[i])[0][0])
        terms = term_lists[i]
        strong = [item["term"] for item in terms]
        confidence = float(probabilities[i, predicted_index])
        record = {"id": node_id, "true": int(labels[i]), "predicted": int(predicted[i]),
                  "confidence": round(confidence, 6),
                  "probabilities": {str(label): round(float(probabilities[i, j]), 6) for j, label in enumerate(classes)},
                  "terms": terms, "misfit": bool(predicted[i] != labels[i])}
        if record["misfit"]:
            record["snippets"] = snippets(raw_pages[node_id], strong)
        records.append(record)
    confusion = [[int(np.sum((labels == true) & (predicted == guess))) for guess in classes] for true in classes]
    return {"accuracy": round(float(np.mean(predicted == labels)), 6),
            "majority_baseline": round(float(np.max(np.bincount(labels)) / len(labels)), 6),
            "shuffled_label_baseline": {"mean_accuracy": round(float(np.mean(shuffled_scores)), 6), "runs": len(shuffled_scores), "seed": SEED + 19},
            "classes": [int(x) for x in classes], "confusion": confusion, "characters": records,
            "vocabulary": "fold-specific"}


def main():
    nodes = list(rows(DATA / "week1_nodes.tsv"))
    node_by_id = {row["node_id"]: row for row in nodes}
    assignment = {row["node_id"]: int(row["community"]) for row in rows(DATA / "week5_marvel_communities.tsv")}
    sizes = Counter(assignment.values())
    chosen = [community for community, _ in sizes.most_common(COMMUNITIES)]
    selected = sorted(node_id for node_id, community in assignment.items() if community in chosen)
    pages = read_pages(set(node_by_id))
    names, name_rule = name_terms(pages, set(node_by_id))
    labels = np.array([assignment[node_id] for node_id in selected])
    kept = [" ".join(token for _, token in words(pages[node_id])) for node_id in selected]
    removed = [" ".join(token for _, token in words(pages[node_id]) if token not in names) for node_id in selected]
    if any(not text for text in removed):
        raise ValueError("Name removal unexpectedly emptied a page.")
    edges = [(source, target) for source, target in edge_rows(DATA / "week1_edges.tsv")]
    graph = nx.Graph(); graph.add_nodes_from(selected); graph.add_edges_from((a, b) for a, b in edges if a in set(selected) and b in set(selected))
    positions = nx.spring_layout(graph, seed=SEED, k=.35, iterations=150)
    layouts = {node: [round(float(x), 5), round(float(y), 5)] for node, (x, y) in positions.items()}
    payload = {
        "question": "Can page language recover a link-defined community, and where do they disagree?",
        "preprocessing": {"tokenizer": "Unicode letter tokens, allowing internal apostrophes; lowercased", "stopwords": "kept (TF-IDF downweights common terms)", "tfidf": {"sublinear_tf": True, "normalization": "L2", "ngrams": "unigrams"}, "names": name_rule, "cross_validation": {"folds": FOLDS, "stratified": True, "seed": SEED, "meaning": "each displayed prediction comes from a model that did not train on that page"}},
        "communities": [{"id": c, "size": sizes[c]} for c in chosen],
        "network": {"nodes": [{"id": node, "name": node_by_id[node]["name"], "community": assignment[node], "position": layouts[node]} for node in selected], "edges": [{"source": a, "target": b} for a, b in edges if a in graph and b in graph]},
        "runs": {"kept": evaluate(kept, labels, selected, names, pages), "removed": evaluate(removed, labels, selected, names, pages)}
    }
    out = DATA / "week6_text_vs_network.json"
    out.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {out.relative_to(ROOT)} ({len(selected)} pages; {len(payload['network']['edges'])} induced edges).")


if __name__ == "__main__":
    main()
