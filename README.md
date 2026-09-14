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

Future weekly posts will be added under [`posts/`](posts/).

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