"""Build and validate the mxbai cosine matrix from cached page embeddings.

Run from the repository root after week7_mxbai_embeddings.py:
    python analysis/preprocess_week7_mxbai.py
Then regenerate method-specific unexpected-pair/null results:
    python analysis/week7_unexpected.py
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np

from week7_mxbai_embeddings import load_documents

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
EMBEDDING_FILE = DATA / "week7_mxbai_embeddings.npz"
MATRIX_FILE = DATA / "week7_mxbai_similarities.npz"
NETWORK_FILE = DATA / "week7_text_network.json"
MODEL_ID = "mixedbread-ai/mxbai-embed-large-v1"


def main() -> None:
    if not EMBEDDING_FILE.exists():
        raise FileNotFoundError(
            f"{EMBEDDING_FILE.name} is missing. Generate it with "
            "`python analysis/week7_mxbai_embeddings.py` first."
        )
    expected_ids, documents = load_documents()
    corpus_hash = hashlib.sha256("\n".join(documents).encode("utf-8")).hexdigest()
    with np.load(EMBEDDING_FILE, allow_pickle=False) as saved:
        ids = saved["node_ids"].tolist()
        embeddings = np.asarray(saved["embeddings"], dtype=np.float32)
        metadata = json.loads(saved["metadata_json"].item())
    if ids != expected_ids:
        raise ValueError("mxbai node ordering does not exactly match sorted Week 1 node IDs.")
    if metadata.get("model_id") != MODEL_ID or metadata.get("model_revision") != "b33106f585b9ce46904ad7443a3b52b7a63e231c":
        raise ValueError("Embedding metadata does not identify the required pinned mxbai model.")
    if metadata.get("vector_dimension") != 1024 or metadata.get("page_count") != 303:
        raise ValueError("Embedding metadata does not report the expected 303 pages and 1,024 dimensions.")
    if metadata.get("corpus_sha256") != corpus_hash:
        raise ValueError("Embedding corpus hash does not match the current full-page text.")
    if len(ids) != 303 or len(ids) != len(set(ids)):
        raise ValueError(f"Expected 303 unique page embeddings, found {len(ids)}.")
    if embeddings.shape != (303, 1024):
        raise ValueError(f"Expected a (303, 1024) embedding matrix, got {embeddings.shape}.")
    if not np.isfinite(embeddings).all():
        raise ValueError("Embedding matrix contains NaN or infinite values.")

    norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
    if np.any(norms == 0) or not np.isfinite(norms).all():
        raise ValueError("Embedding matrix contains a zero or invalid vector.")
    normalized = embeddings / norms
    similarities = normalized @ normalized.T
    np.clip(similarities, -1, 1, out=similarities)
    np.fill_diagonal(similarities, 1)
    if not np.isfinite(similarities).all():
        raise ValueError("Cosine matrix contains NaN or infinite values.")
    if not np.allclose(similarities, similarities.T, atol=1e-6):
        raise ValueError("Cosine matrix is not symmetric.")
    if not np.allclose(np.diag(similarities), 1, atol=1e-6):
        raise ValueError("Cosine matrix diagonal is not 1.")

    pair_values = similarities[np.triu_indices(len(ids), k=1)]
    threshold = float(np.quantile(pair_values, 0.95))
    matrix_metadata = {
        **metadata,
        "similarity_method": "Cosine similarity of L2-normalized mxbai page vectors.",
        "matrix_shape": list(similarities.shape),
        "matrix_diagonal": 1.0,
        "thresholds": {"min": -1.0, "max": 1.0, "default": threshold, "default_rule": "95th percentile of all 45,753 distinct unordered page-pair scores."},
        "similarity_file": str(MATRIX_FILE.relative_to(ROOT)),
    }
    np.savez_compressed(
        MATRIX_FILE,
        node_ids=np.asarray(ids),
        similarities=similarities.astype(np.float32),
        metadata_json=np.asarray(json.dumps(matrix_metadata, ensure_ascii=False, sort_keys=True)),
    )
    with np.load(MATRIX_FILE, allow_pickle=False) as saved:
        if saved["node_ids"].tolist() != ids:
            raise ValueError("Saved matrix node order changed.")
        checked = saved["similarities"]
        if checked.shape != (303, 303) or not np.isfinite(checked).all():
            raise ValueError("Saved matrix failed shape/finite-value validation.")
        if not np.allclose(checked, checked.T, atol=1e-6) or not np.allclose(np.diag(checked), 1, atol=1e-6):
            raise ValueError("Saved matrix failed symmetry/diagonal validation.")

    network = json.loads(NETWORK_FILE.read_text(encoding="utf-8"))
    if [node["id"] for node in network["nodes"]] != ids:
        raise ValueError("Week 7 browser nodes do not match the mxbai matrix ordering.")
    network.setdefault("meta", {}).setdefault("similarity_thresholds", {})["mxbai"] = matrix_metadata["thresholds"]
    network["meta"]["mxbai"] = {
        **matrix_metadata,
        "available": True,
    }
    network["mxbai_similarities"] = np.round(similarities, 6).tolist()
    NETWORK_FILE.write_text(
        json.dumps(network, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    print(f"Validated 303 node mappings and {similarities.shape} cosine matrix.")
    print(f"Default mxbai threshold (all-pair q95): {threshold:.6f}")
    print(f"Saved matrix: {MATRIX_FILE.relative_to(ROOT)}")
    print(f"Integrated validated scores in: {NETWORK_FILE.relative_to(ROOT)}")
    print("Next: python analysis/week7_unexpected.py")


if __name__ == "__main__":
    main()
