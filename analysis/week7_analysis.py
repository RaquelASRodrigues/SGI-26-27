"""Build Week 7 text-similarity and direct-link comparison data.

Run from the repository root: python analysis/week7_analysis.py
"""
from __future__ import annotations

import csv
import hashlib
import json
import os
import urllib.parse
from pathlib import Path

import networkx as nx
import numpy as np
import torch
import torch.nn.functional as functional
from transformers import AutoModel, AutoTokenizer
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
from sklearn.decomposition import TruncatedSVD
from sklearn.preprocessing import normalize

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
PAGES = DATA / "marvel_pages"
SEED = 261021
PERMUTATIONS = 999
MODEL_ID = "sentence-transformers/all-MiniLM-L6-v2"
MODEL_REVISION = "fa97f6e7cb1a59073dff9e6b13e2715cf7475ac9"
MAX_SEQUENCE_LENGTH = 256
EMBEDDING_BATCH_SIZE = 32
EMBEDDING_CACHE = DATA / "week7_embeddings.npz"
LSA_CACHE = DATA / "week7_lsa_vectors.npz"
LSA_DIMENSIONS = 100
LSA_ITERATIONS = 7
MXBAI_MODEL_ID = "mixedbread-ai/mxbai-embed-large-v1"
MXBAI_MODEL_REVISION = "b33106f585b9ce46904ad7443a3b52b7a63e231c"
MXBAI_MATRIX_CACHE = DATA / "week7_mxbai_similarities.npz"


def read_tsv(path):
    with path.open(encoding="utf-8-sig", newline="") as file:
        return list(csv.DictReader((line for line in file if not line.startswith("#")), delimiter="\t"))


def encode_pages(documents, ids):
    corpus_hash = hashlib.sha256("\n".join(documents).encode("utf-8")).hexdigest()
    if EMBEDDING_CACHE.exists():
        with np.load(EMBEDDING_CACHE, allow_pickle=False) as cached:
            cache_keys = {"node_ids", "model_id", "model_revision", "corpus_sha256", "max_sequence_length", "embeddings"}
            if (cache_keys.issubset(cached.files)
                    and cached["node_ids"].tolist() == ids
                    and cached["model_id"].item() == MODEL_ID
                    and cached["model_revision"].item() == MODEL_REVISION
                    and cached["corpus_sha256"].item() == corpus_hash
                    and int(cached["max_sequence_length"]) == MAX_SEQUENCE_LENGTH):
                print(f"Loaded cached MiniLM embeddings for {len(ids)} pages.")
                return cached["embeddings"]

    os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
    torch.set_num_threads(max(1, min(4, os.cpu_count() or 1)))
    tokenizer = AutoTokenizer.from_pretrained(MODEL_ID, revision=MODEL_REVISION)
    tokenizer.model_max_length = 10**9
    model = AutoModel.from_pretrained(MODEL_ID, revision=MODEL_REVISION).eval()
    model_max = min(MAX_SEQUENCE_LENGTH, model.config.max_position_embeddings)
    special_count = tokenizer.num_special_tokens_to_add(pair=False)
    content_limit = model_max - special_count
    if content_limit <= 0:
        raise ValueError("The embedding model has no token capacity after special tokens.")

    features = []
    for document_index, document in enumerate(documents):
        token_ids = tokenizer.encode(document, add_special_tokens=False, truncation=False)
        if not token_ids:
            raise ValueError(f"Page {ids[document_index]} has no model tokens.")
        for offset in range(0, len(token_ids), content_limit):
            chunk = token_ids[offset:offset + content_limit]
            input_ids = tokenizer.build_inputs_with_special_tokens(chunk)
            special_mask = tokenizer.get_special_tokens_mask(input_ids, already_has_special_tokens=True)
            features.append({
                "document_index": document_index,
                "input_ids": input_ids,
                "attention_mask": [1] * len(input_ids),
                "content_mask": [int(not special) for special in special_mask],
            })

    totals = torch.zeros((len(documents), model.config.hidden_size), dtype=torch.float32)
    token_totals = torch.zeros(len(documents), dtype=torch.float32)
    with torch.inference_mode():
        for start in range(0, len(features), EMBEDDING_BATCH_SIZE):
            batch_features = features[start:start + EMBEDDING_BATCH_SIZE]
            max_length = max(len(row["input_ids"]) for row in batch_features)
            pad_length = lambda row, key, fill: (
                [fill] * (max_length - len(row[key])) + row[key]
                if tokenizer.padding_side == "left"
                else row[key] + [fill] * (max_length - len(row[key]))
            )
            input_ids = torch.tensor([
                pad_length(row, "input_ids", tokenizer.pad_token_id)
                for row in batch_features
            ], dtype=torch.long)
            attention_mask = torch.tensor([
                pad_length(row, "attention_mask", 0)
                for row in batch_features
            ], dtype=torch.long)
            content_mask = torch.tensor([
                pad_length(row, "content_mask", 0)
                for row in batch_features
            ], dtype=torch.float32).unsqueeze(-1)
            hidden = model(input_ids=input_ids, attention_mask=attention_mask).last_hidden_state
            sums = (hidden * content_mask).sum(dim=1)
            counts = content_mask.sum(dim=1).squeeze(-1)
            for local_index, feature in enumerate(batch_features):
                doc_index = feature["document_index"]
                totals[doc_index] += sums[local_index]
                token_totals[doc_index] += counts[local_index]
            if start == 0 or start + EMBEDDING_BATCH_SIZE >= len(features):
                print(f"Encoded {min(start + EMBEDDING_BATCH_SIZE, len(features))}/{len(features)} page chunks.")

    if torch.any(token_totals == 0):
        raise ValueError("At least one page produced an empty embedding.")
    embeddings = functional.normalize(totals / token_totals.unsqueeze(-1), p=2, dim=1).numpy()
    np.savez_compressed(
        EMBEDDING_CACHE,
        node_ids=np.asarray(ids),
        model_id=np.asarray(MODEL_ID),
        model_revision=np.asarray(MODEL_REVISION),
        corpus_sha256=np.asarray(corpus_hash),
        max_sequence_length=np.asarray(MAX_SEQUENCE_LENGTH),
        embeddings=embeddings,
    )
    return embeddings


def reduce_lsa(matrix, ids, corpus_hash):
    if LSA_CACHE.exists():
        with np.load(LSA_CACHE, allow_pickle=False) as cached:
            cache_keys = {"node_ids", "corpus_sha256", "dimensions", "seed", "vectors"}
            if (
                cache_keys.issubset(cached.files)
                and cached["node_ids"].tolist() == ids
                and cached["corpus_sha256"].item() == corpus_hash
                and int(cached["dimensions"]) == LSA_DIMENSIONS
                and int(cached["seed"]) == SEED
            ):
                print(f"Loaded cached {LSA_DIMENSIONS}-dimension LSA vectors for {len(ids)} pages.")
                return cached["vectors"]
    dimensions = min(LSA_DIMENSIONS, len(ids) - 1, matrix.shape[1] - 1)
    if dimensions < 2:
        raise ValueError("The corpus is too small for the configured LSA dimensionality.")
    svd = TruncatedSVD(n_components=dimensions, n_iter=LSA_ITERATIONS, random_state=SEED)
    vectors = normalize(svd.fit_transform(matrix), norm="l2", axis=1)
    np.savez_compressed(
        LSA_CACHE,
        node_ids=np.asarray(ids),
        corpus_sha256=np.asarray(corpus_hash),
        dimensions=np.asarray(dimensions),
        seed=np.asarray(SEED),
        vectors=vectors.astype(np.float32),
    )
    print(f"Computed and cached {dimensions}-dimension LSA vectors for {len(ids)} pages.")
    return vectors


def load_mxbai_matrix(ids):
    if not MXBAI_MATRIX_CACHE.exists():
        return None, {
            "available": False,
            "model": MXBAI_MODEL_ID,
            "model_revision": MXBAI_MODEL_REVISION,
            "reason": (
                "No validated local similarity matrix is present. Generate it with "
                "analysis/week7_mxbai_embeddings.py and analysis/preprocess_week7_mxbai.py; "
                "the website never runs the model."
            ),
        }
    with np.load(MXBAI_MATRIX_CACHE, allow_pickle=False) as cached:
        cached_ids = cached["node_ids"].tolist()
        similarities = np.asarray(cached["similarities"], dtype=np.float32)
        metadata = json.loads(cached["metadata_json"].item())
    if cached_ids != ids:
        raise ValueError("mxbai similarity node ordering does not match Week 1.")
    if metadata.get("model_id") != MXBAI_MODEL_ID or metadata.get("model_revision") != MXBAI_MODEL_REVISION:
        raise ValueError("mxbai matrix metadata does not match the required pinned model.")
    if similarities.shape != (len(ids), len(ids)) or not np.isfinite(similarities).all():
        raise ValueError("mxbai similarity matrix has invalid dimensions or values.")
    if not np.allclose(similarities, similarities.T, atol=1e-6):
        raise ValueError("mxbai similarity matrix is not symmetric.")
    if not np.allclose(np.diag(similarities), 1, atol=1e-6):
        raise ValueError("mxbai similarity matrix diagonal must be 1.")
    return similarities, {**metadata, "available": True, "model": MXBAI_MODEL_ID}


def main():
    nodes = read_tsv(DATA / "week1_nodes.tsv")
    by_id = {row["node_id"]: row for row in nodes}
    ids = sorted(by_id)
    pages = {}
    for path in PAGES.glob("*.txt"):
        node_id = urllib.parse.unquote(path.stem)
        if node_id in by_id:
            pages[node_id] = path.read_text(encoding="utf-8", errors="replace")
    missing = set(ids) - pages.keys()
    if missing:
        raise ValueError(f"Missing {len(missing)} character pages: {sorted(missing)[:5]}")

    documents = [" ".join(pages[node_id].split()) for node_id in ids]
    vectorizer = TfidfVectorizer(stop_words="english", sublinear_tf=True, norm="l2")
    matrix = vectorizer.fit_transform(documents)
    similarities = cosine_similarity(matrix).astype(np.float64)
    np.fill_diagonal(similarities, 1)
    corpus_hash = hashlib.sha256("\n".join(documents).encode("utf-8")).hexdigest()
    lsa_vectors = reduce_lsa(matrix, ids, corpus_hash)
    lsa_similarities = lsa_vectors @ lsa_vectors.T
    np.clip(lsa_similarities, -1, 1, out=lsa_similarities)
    np.fill_diagonal(lsa_similarities, 1)
    embeddings = encode_pages(documents, ids)
    embedding_similarities = embeddings @ embeddings.T
    np.clip(embedding_similarities, -1, 1, out=embedding_similarities)
    np.fill_diagonal(embedding_similarities, 1)
    mxbai_similarities, mxbai_metadata = load_mxbai_matrix(ids)
    pair_indices = np.triu_indices(len(ids), k=1)
    similarity_thresholds = {
        "tfidf": {"min": 0, "max": 0.55, "default": 0.15},
        "lsa": {
            "min": -1,
            "max": 1,
            "default": float(np.quantile(lsa_similarities[pair_indices], 0.95)),
        },
        "minilm": {"min": -1, "max": 1, "default": 0.65},
    }
    if mxbai_similarities is not None:
        similarity_thresholds["mxbai"] = mxbai_metadata["thresholds"]

    with (DATA / "week1_edges.tsv").open(encoding="utf-8-sig", newline="") as file:
        edges = [
            (row[0], row[1])
            for row in csv.reader((line for line in file if line.strip() and not line.startswith("#")), delimiter="\t")
        ]
    id_to_index = {node_id: i for i, node_id in enumerate(ids)}
    edge_indices = np.array([(id_to_index[source], id_to_index[target]) for source, target in edges], dtype=int)
    graph = nx.DiGraph()
    graph.add_nodes_from(ids)
    graph.add_edges_from(edges)

    ranks = np.argsort(-similarities, axis=1)
    top_sets = [
        set(sorted(
            (index for index in ranks[i] if index != i),
            key=lambda index: (-similarities[i, index], ids[index]),
        )[:5])
        for i in range(len(ids))
    ]
    overlap_rows = []
    text_only_rows = []
    neighbour_sets = []
    for i, node_id in enumerate(ids):
        linked = set(graph.predecessors(node_id)) | set(graph.successors(node_id))
        linked_indices = {id_to_index[item] for item in linked}
        neighbour_sets.append(linked_indices)
        common = top_sets[i] & linked_indices
        union = top_sets[i] | linked_indices
        jaccard = len(common) / len(union) if union else 0
        overlap_rows.append({
            "id": node_id, "name": by_id[node_id]["name"],
            "shared": len(common), "text_count": 5, "hyperlink_count": len(linked),
            "jaccard": jaccard,
        })
        for j in top_sets[i]:
            if j not in linked_indices:
                text_only_rows.append({
                    "central_id": node_id, "central_name": by_id[node_id]["name"],
                    "id": ids[j], "name": by_id[ids[j]]["name"],
                    "similarity": float(similarities[i, j]),
                })

    observed_edge_scores = similarities[edge_indices[:, 0], edge_indices[:, 1]]
    observed_mean = float(observed_edge_scores.mean())
    rng = np.random.default_rng(SEED)
    null = np.empty(PERMUTATIONS)
    for run in range(PERMUTATIONS):
        assignment = rng.permutation(len(ids))
        null[run] = similarities[assignment[edge_indices[:, 0]], assignment[edge_indices[:, 1]]].mean()
    p_value = (1 + int(np.count_nonzero(null >= observed_mean))) / (PERMUTATIONS + 1)

    undirected_linked = {tuple(sorted((source, target))) for source, target in edges if source != target}
    direct_pair_scores = [
        (float(similarities[id_to_index[a], id_to_index[b]]), a, b)
        for a, b in undirected_linked
    ]
    lowest_edges = [
        {"source": a, "source_name": by_id[a]["name"], "target": b,
         "target_name": by_id[b]["name"], "similarity": score}
        for score, a, b in sorted(direct_pair_scores)[:8]
    ]
    featured_text_only = sorted(text_only_rows, key=lambda row: -row["similarity"])[:8]
    highlights = sorted(overlap_rows, key=lambda row: (-row["shared"], -row["jaccard"], row["name"]))
    shared_examples = {}
    for row in highlights[:5]:
        i = id_to_index[row["id"]]
        shared_examples[row["id"]] = [
            {"id": ids[j], "name": by_id[ids[j]]["name"], "similarity": float(similarities[i, j])}
            for j in sorted(top_sets[i] & neighbour_sets[i], key=lambda j: -similarities[i, j])
        ]
    top_method_neighbors = {}
    for node_id in ("Spider-Man", "Doctor_Strange", "Hulk", "Deadpool"):
        if node_id not in by_id:
            continue
        i = id_to_index[node_id]
        top_method_neighbors[node_id] = [
            {"id": ids[j], "name": by_id[ids[j]]["name"], "similarity": float(similarities[i, j])}
            for j in sorted(
                (index for index in ranks[i] if index != i),
                key=lambda index: (-similarities[i, index], ids[index]),
            )[:5]
        ]

    payload = {
        "meta": {
            "node_count": len(ids), "edge_count": len(edges),
            "directed": True, "isolates": len(list(nx.isolates(graph))),
            "weak_components": nx.number_weakly_connected_components(graph),
            "text_method": "TF-IDF with English stop-word removal, sublinear term frequency, unigrams, and L2 normalization",
            "lsa": {
                "method": "TruncatedSVD on the same L2-normalized TF-IDF matrix; reduced document vectors are L2-normalized before cosine similarity.",
                "dimensions": lsa_vectors.shape[1],
                "seed": SEED,
                "iterations": LSA_ITERATIONS,
                "cache": str(LSA_CACHE.relative_to(ROOT)),
            },
            "similarity_thresholds": similarity_thresholds,
            "embedding": {
                "model": MODEL_ID,
                "revision": MODEL_REVISION,
                "pooling": "Mean of last-layer token hidden states over page tokens, excluding special tokens, weighted across chunks by token count, then L2-normalized.",
                "preprocessing": "Full page text with whitespace collapsed, matching the TF-IDF input; no stop-word removal.",
                "chunking": f"All model tokens are retained in non-overlapping chunks of at most {MAX_SEQUENCE_LENGTH - 2} content tokens; each chunk gets model special tokens. Chunk vectors are combined as a content-token-weighted mean.",
                "max_sequence_length": MAX_SEQUENCE_LENGTH,
                "cache": str(EMBEDDING_CACHE.relative_to(ROOT)),
            },
            "mxbai": {
                **mxbai_metadata,
            },
            "null": {
                "definition": "Mean TF-IDF cosine similarity across the fixed supplied directed edges, compared with 999 random permutations of page-to-node assignments.",
                "eligible_pairs": len(edges), "permutations": PERMUTATIONS, "seed": SEED,
                "observed_mean": observed_mean, "null_mean": float(null.mean()),
                "null_95_percentile": [float(x) for x in np.quantile(null, [0.025, 0.975])],
                "upper_tail_p": p_value,
            },
            "edge_similarity": {
                "directed_edge_mean": observed_mean,
                "directed_edge_median": float(np.median(observed_edge_scores)),
                "undirected_pair_count": len(direct_pair_scores),
                "undirected_pair_median": float(np.median([row[0] for row in direct_pair_scores])),
                "all_page_pair_median": float(np.median(similarities[np.triu_indices(len(ids), k=1)])),
            },
        },
        "nodes": [
            {"id": node_id, "name": by_id[node_id]["name"],
             "in_degree": graph.in_degree(node_id), "out_degree": graph.out_degree(node_id),
             "excerpt": " ".join(pages[node_id].split())[:360],
             "url": by_id[node_id].get("url", "")}
            for node_id in ids
        ],
        "edges": [{"source": source, "target": target} for source, target in edges],
        "similarities": np.round(similarities, 6).tolist(),
        "lsa_similarities": np.round(lsa_similarities, 6).tolist(),
        "embedding_similarities": np.round(embedding_similarities, 6).tolist(),
        "minilm_similarities": np.round(embedding_similarities, 6).tolist(),
        **(
            {"mxbai_similarities": np.round(mxbai_similarities, 6).tolist()}
            if mxbai_similarities is not None else {}
        ),
        "analysis": {
            "top_overlap": highlights[:8],
            "top_overlap_neighbours": shared_examples,
            "top_text_without_direct_link": featured_text_only,
            "lowest_similarity_direct_links": lowest_edges,
            "illustrative_top_five": top_method_neighbors,
            "text_only_fraction_of_ranked_neighbours": (
                sum(5 - row["shared"] for row in overlap_rows) / (5 * len(ids))
            ),
            "nodes_with_zero_shared_neighbours": sum(row["shared"] == 0 for row in overlap_rows),
            "mean_shared_neighbours": float(np.mean([row["shared"] for row in overlap_rows])),
        },
    }
    out = DATA / "week7_text_network.json"
    out.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {out.relative_to(ROOT)}: {len(ids)} pages, {len(edges)} directed edges, {len(vectorizer.vocabulary_)} TF-IDF terms.")
    print(json.dumps(payload["meta"]["null"], indent=2))
    print("Top overlap:", json.dumps(payload["analysis"]["top_overlap"][:5], ensure_ascii=False))
    print("Top text-only:", json.dumps(payload["analysis"]["top_text_without_direct_link"][:5], ensure_ascii=False))
    print("Lowest linked pairs:", json.dumps(payload["analysis"]["lowest_similarity_direct_links"][:5], ensure_ascii=False))


if __name__ == "__main__":
    main()
