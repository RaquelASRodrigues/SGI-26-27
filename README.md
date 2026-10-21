# Networks are awesome!!

> Weekly network-science explorations for the **Social Graphs and Interactions** course at DTU (2026–27).

**Website:** [raquelasrodrigues.github.io/SGI-26-27](https://raquelasrodrigues.github.io/SGI-26-27/)

## Group members

| Name | GitHub |
| --- | --- |
| Marta Machado | [@`Martaaaaa1997`](https://github.com/Martaaaaa1997) |
| Raquel Rodrigues | [@`RaquelASRodrigues`](https://github.com/RaquelASRodrigues) |
| Teresa Simão | [@`Teresa7810`](https://github.com/Teresa7810) |

## About the project

This repository contains our group website for **Social Graphs and Interactions**. Throughout the course, we publish one post per week documenting a network-analysis topic, the methods we applied, and what we learned from the results.

The posts explore a directed network of Marvel Comics superhero Wikipedia pages. Nodes represent characters and directed edges represent links between their pages. The site combines written explanations, static figures, and interactive D3 visualizations so that the analyses are accessible in the browser.

## Weekly posts

### Week 1 — Degree and directed graphs

An exploration of in-degree, out-degree, degree distributions, hubs, isolated nodes, and connected components in the Marvel network.

### Week 2 — Models and null models

A comparison between the observed network and Erdős–Rényi, Barabási–Albert, Watts–Strogatz, and degree-preserving null models.

### Week 7 — Text similarity and directed links

An interactive comparison of TF-IDF, 100-dimensional LSA, and MiniLM embedding cosine neighbours with incoming/outgoing direct Wikipedia links. The cached cosine matrices retain the mathematically correct self-similarity of 1 on their diagonals; all neighbour rankings explicitly exclude the selected page. Install the Week 7 embedding dependency with `python -m pip install -r requirements-week7.txt`, then regenerate browser data with `python analysis/week7_analysis.py`; the pinned MiniLM model is downloaded from Hugging Face and cached on first use if it is not already available. The script caches the 100-dimensional LSA vectors in `data/week7_lsa_vectors.npz` and MiniLM embeddings in `data/week7_embeddings.npz`, and also runs a fixed-network TF-IDF text-assignment permutation test.

To optionally add `mixedbread-ai/mxbai-embed-large-v1`, use a machine with sufficient RAM/VRAM (the current CPU-only environment has about 1.5 GB available RAM and did not generate mxbai output). Run `python -m pip install -r requirements-week7-mxbai.txt`, `python analysis/week7_mxbai_embeddings.py`, `python analysis/preprocess_week7_mxbai.py`, then `python analysis/week7_unexpected.py`. The generation script pins model revision `b33106f585b9ce46904ad7443a3b52b7a63e231c` (1,024 dimensions) and saves validated page vectors plus metadata to `data/week7_mxbai_embeddings.npz`; preprocessing saves `data/week7_mxbai_similarities.npz` and integrates its validated matrix into `data/week7_text_network.json`. Re-run `python analysis/week7_analysis.py` after that if regenerating the other Week 7 matrices; it preserves the mxbai matrix when the validated NPZ is present. The website only uses precomputed data and never loads the model. If mxbai artifacts are absent, its option is disabled with the exact generation commands.

The Unexpected Connections module uses the cached representations and builds `data/week7_unexpected_pairs.json` with `python analysis/week7_unexpected.py`. Its reproducible directed degree-preserving null uses seed `721026`, 100 randomized graphs, and five accepted target swaps per observed edge; each randomized graph is checked for exact per-node in- and out-degree preservation. Reachability and paths are recalculated for each null graph. The same randomized graphs produce conditional pairwise path-distance z-scores and method-specific aggregate null cohorts both with and without the 17 observed isolated nodes; pair-specific null reachability frequencies are reported separately from finite-distance z-scores.

Each weekly post lives under [`posts/`](posts/) and is linked from the homepage dispatch list.

## Repository layout

```text
.
├── index.html               # Website homepage
├── styles.css               # Shared styles
├── script.js                # Homepage post list and interactive graph
├── posts/                   # One HTML page (and optional JS) per weekly post
├── data/                    # Input datasets and generated browser-ready JSON
├── analysis/                # Python analysis scripts and generated summaries
├── assets/                  # Images embedded in posts
└── build_graph_data.py      # Builds the homepage graph JSON from Week 1 data
```

## Running the website locally

Because the pages load JSON with `fetch`, serve the project through a local HTTP server rather than opening `index.html` directly from the file system.

```bash
python -m http.server 8000
```

Then visit [http://localhost:8000](http://localhost:8000).

## Regenerating analysis outputs

The Python scripts use NetworkX, pandas, NumPy, and Matplotlib. Once those dependencies are installed, run the following commands from the repository root:

```bash
python build_graph_data.py
python analysis/week1_analysis.py
python analysis/week2_analysis.py
```

These commands overwrite the generated JSON, CSV/summary, and image outputs associated with their respective analyses.