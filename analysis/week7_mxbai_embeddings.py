"""Generate full-page mxbai embeddings in Week 1 node-ID order.

Install the optional dependency with:
    python -m pip install -r requirements-week7-mxbai.txt
Then run from the repository root:
    python analysis/week7_mxbai_embeddings.py

The script downloads the pinned model on first use. Use a machine with enough
RAM/VRAM for the 1,024-dimensional model; it never substitutes another model.
"""
from __future__ import annotations

import csv
import hashlib
import json
import os
import urllib.parse
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
PAGES = DATA / "marvel_pages"
MODEL_ID = "mixedbread-ai/mxbai-embed-large-v1"
MODEL_REVISION = "b33106f585b9ce46904ad7443a3b52b7a63e231c"
OUTPUT = DATA / "week7_mxbai_embeddings.npz"
SEED = 721021


def load_documents() -> tuple[list[str], list[str]]:
    with (DATA / "week1_nodes.tsv").open(encoding="utf-8-sig", newline="") as file:
        rows = list(csv.DictReader(
            (line for line in file if not line.startswith("#")), delimiter="\t"
        ))
    names = [row["node_id"] for row in rows]
    if len(names) != len(set(names)):
        raise ValueError("Week 1 node IDs are not unique.")
    ids = sorted(names)
    pages = {}
    for path in PAGES.glob("*.txt"):
        node_id = urllib.parse.unquote(path.stem)
        if node_id in names:
            if node_id in pages:
                raise ValueError(f"Multiple page files map to Week 1 node ID {node_id}.")
            pages[node_id] = " ".join(path.read_text(encoding="utf-8", errors="replace").split())
    missing = sorted(set(ids) - pages.keys())
    if missing:
        raise ValueError(f"Missing full-page text for {len(missing)} nodes: {missing[:8]}")
    return ids, [pages[node_id] for node_id in ids]


def chunk_document(text: str, tokenizer, content_limit: int) -> tuple[list[str], list[int]]:
    token_ids = tokenizer.encode(text, add_special_tokens=False, truncation=False)
    if not token_ids:
        raise ValueError("A page produced no model tokens.")
    chunks = []
    counts = []
    for offset in range(0, len(token_ids), content_limit):
        token_chunk = token_ids[offset:offset + content_limit]
        chunk = tokenizer.decode(
            token_chunk, skip_special_tokens=True, clean_up_tokenization_spaces=False
        )
        if not chunk.strip():
            raise ValueError("Token chunk decoded to empty text; refusing to drop it.")
        encoded_length = len(tokenizer(
            chunk, add_special_tokens=True, truncation=False
        )["input_ids"])
        if encoded_length > content_limit + tokenizer.num_special_tokens_to_add(pair=False):
            raise ValueError("Decoded chunk exceeds model context; refusing silent truncation.")
        chunks.append(chunk)
        counts.append(len(token_chunk))
    return chunks, counts


def validate_embeddings(ids: list[str], embeddings: np.ndarray, expected_dimension: int) -> None:
    if len(ids) != len(set(ids)):
        raise ValueError("Duplicate node IDs in embedding output.")
    if embeddings.shape != (len(ids), expected_dimension):
        raise ValueError(
            f"Expected {(len(ids), expected_dimension)} embeddings, got {embeddings.shape}."
        )
    if not np.isfinite(embeddings).all():
        raise ValueError("Embedding output contains NaN or infinite values.")
    norms = np.linalg.norm(embeddings, axis=1)
    if np.any(norms == 0) or not np.allclose(norms, 1, atol=1e-4):
        raise ValueError("Every page embedding must be finite and L2-normalized.")


def main() -> None:
    try:
        import torch
        from sentence_transformers import SentenceTransformer
    except ImportError as error:
        raise RuntimeError(
            "mxbai generation requires sentence-transformers. Install "
            "requirements-week7-mxbai.txt in an environment with sufficient RAM/VRAM."
        ) from error

    torch.manual_seed(SEED)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(SEED)
    np.random.seed(SEED)
    os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
    ids, documents = load_documents()
    corpus_hash = hashlib.sha256("\n".join(documents).encode("utf-8")).hexdigest()
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"Loading {MODEL_ID}@{MODEL_REVISION} on {device}; this may require substantial memory.")
    model = SentenceTransformer(
        MODEL_ID, revision=MODEL_REVISION, device=device, trust_remote_code=False
    ).eval()
    tokenizer = model.tokenizer
    max_length = int(model.max_seq_length)
    special_tokens = tokenizer.num_special_tokens_to_add(pair=False)
    content_limit = max_length - special_tokens
    if content_limit < 1:
        raise ValueError(f"Invalid model context length: {max_length}.")
    dimension = int(model.get_sentence_embedding_dimension())
    if dimension != 1024:
        raise ValueError(f"Expected mxbai dimension 1024, model reports {dimension}.")

    page_vectors = np.empty((len(ids), dimension), dtype=np.float32)
    chunk_count = 0
    for page_index, document in enumerate(documents):
        chunks, token_counts = chunk_document(document, tokenizer, content_limit)
        chunk_vectors = model.encode(
            chunks,
            batch_size=2,
            show_progress_bar=False,
            convert_to_numpy=True,
            normalize_embeddings=True,
        )
        chunk_vectors = np.asarray(chunk_vectors, dtype=np.float32)
        if chunk_vectors.shape != (len(chunks), dimension) or not np.isfinite(chunk_vectors).all():
            raise ValueError(f"Invalid chunk vectors for page {ids[page_index]}.")
        page_vector = np.average(chunk_vectors, axis=0, weights=token_counts)
        norm = float(np.linalg.norm(page_vector))
        if not np.isfinite(norm) or norm == 0:
            raise ValueError(f"Invalid aggregated page vector for {ids[page_index]}.")
        page_vectors[page_index] = page_vector / norm
        chunk_count += len(chunks)
        if page_index == 0 or (page_index + 1) % 10 == 0 or page_index + 1 == len(ids):
            print(f"Encoded {page_index + 1}/{len(ids)} pages ({chunk_count} chunks).")

    validate_embeddings(ids, page_vectors, dimension)
    metadata = {
        "model_id": MODEL_ID,
        "model_revision": MODEL_REVISION,
        "vector_dimension": dimension,
        "page_count": len(ids),
        "corpus_sha256": corpus_hash,
        "node_order": "Lexicographically sorted Week 1 node_id values; page filenames URL-decoded to node_id.",
        "preprocessing": "Full supplied page text with whitespace collapsed; no stop-word removal or prompt prefix.",
        "input_format": "SentenceTransformer model's native tokenizer and pooling modules; no task prompt for symmetric page-to-page cosine comparison.",
        "chunking": (
            f"Tokenize each complete page without special tokens, split into non-overlapping "
            f"chunks of at most {content_limit} tokens, decode each chunk, then re-tokenize "
            f"with model special tokens. Each input is checked against max_seq_length={max_length}; "
            "all page tokens are represented."
        ),
        "aggregation": "Encode each chunk with SentenceTransformer's configured CLS pooling and L2 normalization; token-count-weighted mean of chunk vectors, then L2-normalize each page vector.",
        "max_seq_length": max_length,
        "random_seed": SEED,
        "seed_note": "Evaluation-mode inference uses fixed seeds; backend and hardware floating-point differences may still produce minor numerical variation.",
        "chunk_count": chunk_count,
        "embedding_file": str(OUTPUT.relative_to(ROOT)),
    }
    np.savez_compressed(
        OUTPUT,
        node_ids=np.asarray(ids),
        embeddings=page_vectors,
        metadata_json=np.asarray(json.dumps(metadata, ensure_ascii=False, sort_keys=True)),
    )
    with np.load(OUTPUT, allow_pickle=False) as saved:
        saved_ids = saved["node_ids"].tolist()
        saved_vectors = saved["embeddings"]
        saved_metadata = json.loads(saved["metadata_json"].item())
        if saved_ids != ids:
            raise ValueError("Saved embedding node order does not match Week 1 node IDs.")
        validate_embeddings(saved_ids, saved_vectors, dimension)
        if saved_metadata != metadata:
            raise ValueError("Saved metadata did not round-trip exactly.")
    print(f"Validated and saved {len(ids)} embeddings to {OUTPUT.relative_to(ROOT)}.")


if __name__ == "__main__":
    main()
