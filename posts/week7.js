const palette = {
  ink: "#0a090d",
  lilac: "#bd7dff",
  magenta: "#e84e83",
  cyan: "#21f3c6",
  paper: "#f2eaf5",
  muted: "#a99caf",
  gold: "#f2b84b"
};
const tooltip = d3.select("#tooltip");
const esc = value => String(value).replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[char]);
const fmt = d3.format(".3f");
let data;
let selectedId = "Spider-Man";
let focusedId = null;

fetch("../data/week7_text_network.json")
  .then(response => {
    if (!response.ok) throw new Error(`Could not load Week 7 analysis: ${response.status}`);
    return response.json();
  })
  .then(payload => {
    data = payload;
    initialise();
  })
  .catch(error => {
    document.querySelector("#selection-summary").textContent = "The Week 7 analysis data could not be loaded.";
    document.querySelector("#character-detail").innerHTML = '<p class="widget-error">Analysis data could not be loaded. Please check the local server and data file.</p>';
    console.error(error);
  });

function initialise() {
  if (!Array.isArray(data.similarities) || !Array.isArray(data.embedding_similarities)) {
    throw new Error("Week 7 data must contain both TF-IDF and neural embedding similarity matrices.");
  }
  const characterSelect = document.querySelector("#character-select");
  characterSelect.replaceChildren(...data.nodes.map(node => new Option(node.name, node.id)));
  characterSelect.value = data.nodes.some(node => node.id === selectedId) ? selectedId : data.nodes[0].id;
  selectedId = characterSelect.value;

  characterSelect.addEventListener("change", () => {
    selectedId = characterSelect.value;
    focusedId = selectedId;
    update();
  });
  document.querySelector("#method-select").addEventListener("change", resetThreshold);
  document.querySelector("#threshold-range").addEventListener("input", event => {
    document.querySelector("#threshold-output").value = Number(event.target.value).toFixed(2);
    update();
  });
  document.querySelector("#direction-select").addEventListener("change", update);

  renderFindings();
  update();
}

function resetThreshold() {
  const method = document.querySelector("#method-select").value;
  const range = document.querySelector("#threshold-range");
  const threshold = method === "embedding" ? 0.65 : 0.15;
  range.min = method === "embedding" ? -1 : 0;
  range.max = method === "embedding" ? 1 : 0.55;
  range.value = threshold;
  document.querySelector("#threshold-output").value = threshold.toFixed(2);
  document.querySelector("#threshold-note").textContent =
    method === "embedding"
      ? "Threshold applies to neural embedding cosine scores. The slider resets to 0.65 when switching methods; cosine scales are not directly comparable."
      : "Threshold applies to TF-IDF cosine scores. The slider resets to 0.15 when switching methods; cosine scales are not directly comparable.";
  update();
}

function neighbourState() {
  const centralIndex = data.nodes.findIndex(node => node.id === selectedId);
  const central = data.nodes[centralIndex];
  const threshold = Number(document.querySelector("#threshold-range").value);
  const method = document.querySelector("#method-select").value;
  const similarities = method === "embedding" ? data.embedding_similarities : data.similarities;
  const direction = document.querySelector("#direction-select").value;
  const textIndices = d3.range(data.nodes.length)
    .filter(index => index !== centralIndex)
    .filter(index => similarities[centralIndex][index] >= threshold);
  const textSet = new Set(textIndices);
  const linkEdges = data.edges.filter(edge => {
    if (direction === "outgoing") return edge.source === central.id;
    if (direction === "incoming") return edge.target === central.id;
    return edge.source === central.id || edge.target === central.id;
  });
  const linkIds = new Set(linkEdges.map(edge => edge.source === central.id ? edge.target : edge.source));
  linkIds.delete(central.id);
  const indexById = new Map(data.nodes.map((node, index) => [node.id, index]));
  const linkSet = new Set([...linkIds].map(id => indexById.get(id)));
  const visibleIndices = new Set([...textSet, ...linkSet, centralIndex]);
  const nodes = [...visibleIndices].map(index => ({
    ...data.nodes[index],
    index,
    similarity: index === centralIndex ? null : similarities[centralIndex][index],
    category: index === centralIndex ? "central" : textSet.has(index) && linkSet.has(index) ? "both" : textSet.has(index) ? "text" : "link"
  }));
  return { central, centralIndex, nodes, textSet, linkSet, linkEdges, threshold, direction, indexById, method, similarities };
}

function update() {
  if (!data) return;
  const state = neighbourState();
  const shared = [...state.textSet].filter(index => state.linkSet.has(index)).length;
  const union = state.textSet.size + state.linkSet.size - shared;
  const jaccard = union ? shared / union : 0;
  document.querySelector("#explorer-metrics").innerHTML = `
    <div class="metric"><b>${state.textSet.size}</b><span>Text neighbours ≥ ${state.threshold.toFixed(2)}</span></div>
    <div class="metric"><b>${state.linkSet.size}</b><span>Direct hyperlink neighbours</span></div>
    <div class="metric"><b>${shared}</b><span>Shared neighbours</span></div>
    <div class="metric"><b>${jaccard.toFixed(3)}</b><span>Jaccard overlap</span></div>`;
  document.querySelector("#selection-summary").textContent =
    `${state.central.name} · ${state.method === "embedding" ? "Neural embedding cosine" : "TF-IDF cosine"} · all other pages at or above ${state.threshold.toFixed(2)} similarity · ${state.direction} direct links.`;
  drawGraph(state);
  const selectedNode = state.nodes.find(node => node.id === focusedId) || state.nodes.find(node => node.id === state.central.id);
  focusedId = selectedNode.id;
  renderDetail(selectedNode, state);
}

function categoryColor(category) {
  return category === "central" ? palette.magenta
    : category === "both" ? palette.cyan
      : category === "text" ? palette.lilac : palette.gold;
}

function nodeInfo(node, state) {
  const centerName = state.central.name;
  const relation = node.id === state.central.id
    ? `Central character · ${node.in_degree} incoming and ${node.out_degree} outgoing links in the full graph`
    : state.linkSet.has(node.index)
      ? `${node.category === "both" ? "Text + hyperlink neighbour" : "Direct hyperlink neighbour"} · ${state.linkEdges.some(edge => edge.source === state.central.id && edge.target === node.id) ? `${centerName} → ${node.name}` : ""}${state.linkEdges.some(edge => edge.target === state.central.id && edge.source === node.id) ? `${state.linkEdges.some(edge => edge.source === state.central.id && edge.target === node.id) ? " · " : ""}${node.name} → ${centerName}` : ""}`
      : "Text-only neighbour · no direct link in the selected direction";
  const similarity = node.similarity === null ? "—" : fmt(node.similarity);
  const methodName = state.method === "embedding" ? "Neural embedding cosine" : "TF-IDF cosine";
  return `${node.name}\n${node.category === "central" ? "Central character" : `${methodName}: ${similarity}`}\n${relation}`;
}

function drawGraph(state) {
  const svg = d3.select("#neighbour-svg");
  const element = svg.node();
  const width = element.clientWidth || 700;
  const height = element.clientHeight || 550;
  svg.attr("viewBox", `0 0 ${width} ${height}`).selectAll("*").remove();
  const defs = svg.append("defs");
  defs.append("marker").attr("id", "week7-arrow").attr("viewBox", "0 -5 10 10")
    .attr("refX", 8).attr("refY", 0).attr("markerWidth", 6).attr("markerHeight", 6)
    .attr("orient", "auto").append("path").attr("d", "M0,-5L10,0L0,5").attr("fill", palette.cyan);

  const center = { x: width / 2, y: height / 2 };
  const radius = Math.min(width * .36, height * .39);
  const textNodes = state.nodes.filter(node => node.category === "text");
  const linkNodes = state.nodes.filter(node => node.category === "link");
  const bothNodes = state.nodes.filter(node => node.category === "both");
  const positions = new Map([[state.central.id, center]]);
  function setArc(nodes, start, end) {
    nodes.forEach((node, i) => {
      const angle = nodes.length === 1 ? (start + end) / 2 : start + (end - start) * i / (nodes.length - 1);
      const radians = angle * Math.PI / 180;
      positions.set(node.id, { x: center.x + Math.cos(radians) * radius, y: center.y + Math.sin(radians) * radius });
    });
  }
  if (state.nodes.length > 80) {
    const peripheral = state.nodes.filter(node => node.category !== "central");
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    peripheral.forEach((node, i) => {
      const distance = radius * Math.sqrt((i + .5) / peripheral.length);
      const angle = i * goldenAngle;
      positions.set(node.id, { x: center.x + Math.cos(angle) * distance, y: center.y + Math.sin(angle) * distance });
    });
  } else {
    setArc(textNodes, 125, 235);
    setArc(linkNodes, -85, 85);
    bothNodes.forEach((node, i) => {
      const step = Math.min(48, (width - 50) / Math.max(bothNodes.length, 1));
      positions.set(node.id, {
        x: center.x + (i - (bothNodes.length - 1) / 2) * step,
        y: Math.min(height - 26, center.y + radius * .78)
      });
    });
  }

  const chart = svg.append("g");
  chart.selectAll(".sim-link").data(state.nodes.filter(node => node.category === "text" || node.category === "both"))
    .join("line").attr("class", "sim-link")
    .attr("x1", center.x).attr("y1", center.y)
    .attr("x2", node => positions.get(node.id).x).attr("y2", node => positions.get(node.id).y);

  const reciprocal = new Set(state.linkEdges.map(edge => `${edge.source}>${edge.target}`));
  chart.selectAll(".hyper-link").data(state.linkEdges).join("path").attr("class", "hyper-link")
    .attr("d", edge => {
      const from = positions.get(edge.source);
      const to = positions.get(edge.target);
      const dx = to.x - from.x, dy = to.y - from.y;
      const length = Math.hypot(dx, dy) || 1;
      const reciprocalEdge = reciprocal.has(`${edge.target}>${edge.source}`);
      const offset = reciprocalEdge ? (edge.source === state.central.id ? -7 : 7) : 0;
      const mx = (from.x + to.x) / 2 - dy / length * offset;
      const my = (from.y + to.y) / 2 + dx / length * offset;
      return `M${from.x},${from.y} Q${mx},${my} ${to.x},${to.y}`;
    })
    .attr("marker-end", "url(#week7-arrow)");

  const groups = chart.selectAll(".node-group").data(state.nodes, node => node.id).join("g")
    .attr("class", "node-group")
    .attr("transform", node => `translate(${positions.get(node.id).x},${positions.get(node.id).y})`)
    .attr("tabindex", 0).attr("role", "button")
    .attr("aria-label", node => nodeInfo(node, state))
    .on("pointerenter", (event, node) => showTip(event, nodeInfo(node, state)))
    .on("pointermove", (event, node) => showTip(event, nodeInfo(node, state)))
    .on("pointerleave", hideTip)
    .on("focus", (event, node) => showTip(event, nodeInfo(node, state)))
    .on("blur", hideTip)
    .on("click", (_, node) => { focusedId = node.id; renderDetail(node, state); })
    .on("keydown", (event, node) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); focusedId = node.id; renderDetail(node, state); }
    });
  groups.append("circle").attr("class", "graph-node")
    .attr("r", node => node.category === "central" ? 13 : node.category === "both" ? 8 : 6)
    .attr("fill", node => categoryColor(node.category));
  groups.filter(node => node.category === "central" || node.category === "both"
    || (state.nodes.length <= 80 && node.category !== "link"))
    .append("text").attr("class", "node-label")
    .attr("x", node => node.category === "central" ? 17 : 9)
    .attr("y", 3).text(node => node.name);

  if (!state.textSet.size && !state.linkSet.size) {
    chart.append("text").attr("class", "graph-empty").attr("x", width / 2).attr("y", height - 22)
      .attr("text-anchor", "middle").text("No neighbours meet the current threshold and direction.");
  }
}

function showTip(event, content) {
  tooltip.text(content).style("white-space", "pre-line")
    .style("left", `${Math.min(event.clientX + 14, window.innerWidth - 295)}px`)
    .style("top", `${Math.min(event.clientY + 14, window.innerHeight - 125)}px`)
    .style("opacity", 1);
}
function hideTip() { tooltip.style("opacity", 0); }

function renderDetail(node, state) {
  const panel = document.querySelector("#character-detail");
  const center = state.central;
  const status = node.id === center.id ? "CENTRAL CHARACTER"
    : node.category === "both" ? "TEXT + HYPERLINK"
      : node.category === "text" ? "TEXT ONLY" : "HYPERLINK ONLY";
  const similarity = node.similarity === null ? "Not applicable" : fmt(node.similarity);
  const methodName = state.method === "embedding" ? "Neural embedding cosine" : "TF-IDF cosine";
  let relation = `${node.in_degree} incoming · ${node.out_degree} outgoing links in the full graph`;
  if (node.id !== center.id && state.linkSet.has(node.index)) {
    const outgoing = state.linkEdges.some(edge => edge.source === center.id && edge.target === node.id);
    const incoming = state.linkEdges.some(edge => edge.target === center.id && edge.source === node.id);
    relation = `${outgoing ? `${esc(center.name)} → ${esc(node.name)}` : ""}${outgoing && incoming ? " · " : ""}${incoming ? `${esc(node.name)} → ${esc(center.name)}` : ""}`;
  } else if (node.id !== center.id) {
    relation = "No direct hyperlink in the selected direction";
  }
  const excerpt = node.excerpt || "No page excerpt is available.";
  panel.innerHTML = `<h3>${esc(node.name)}</h3><p class="small-note">${status}</p><p><strong>${methodName} to ${esc(center.name)}:</strong> ${similarity}</p><p class="detail-link">${relation}</p><p class="small-note">Full-page excerpt</p><div class="detail-excerpt">${esc(excerpt)}${excerpt.length >= 360 ? "…" : ""}</div>${node.url ? `<p><a class="detail-link" href="${esc(node.url)}" target="_blank" rel="noopener noreferrer">OPEN WIKIPEDIA PAGE ↗</a></p>` : ""}`;
}

function renderFindings() {
  const analysis = data.analysis;
  const nullResult = data.meta.null;
  const edgeStats = data.meta.edge_similarity;
  const overlapRate = 100 * (1 - analysis.text_only_fraction_of_ranked_neighbours);
  document.querySelector("#result-metrics").innerHTML = `
    <div class="result"><b>${analysis.mean_shared_neighbours.toFixed(2)} / 5</b><span>Mean shared top-five text neighbours</span></div>
    <div class="result"><b>${overlapRate.toFixed(1)}%</b><span>Top-five text-neighbour entries also directly linked</span></div>
    <div class="result"><b>${analysis.nodes_with_zero_shared_neighbours} / ${data.meta.node_count}</b><span>Characters with no top-five / direct-link overlap</span></div>`;

  const overlap = analysis.top_overlap[0];
  const shared = analysis.top_overlap_neighbours[overlap.id] || [];
  const textExample = analysis.top_text_without_direct_link[0];
  const linkExample = analysis.lowest_similarity_direct_links[0];
  const nextLinkExample = analysis.lowest_similarity_direct_links[1];
  document.querySelector("#finding-cards").innerHTML = `
    <div class="analysis-card"><strong>Agreement — ${esc(overlap.name)}.</strong> All ${overlap.shared} of its five highest TF-IDF neighbours are direct incoming or outgoing neighbours (${overlap.hyperlink_count} direct links total; Jaccard ${overlap.jaccard.toFixed(2)}). They are ${shared.map(row => `${esc(row.name)} (${fmt(row.similarity)})`).join(", ")}. This is a strong local match, not a universal pattern.</div>
    <div class="analysis-card"><strong>Text without a direct tie — ${esc(textExample.central_name)} and ${esc(textExample.name)}.</strong> Their page score is ${fmt(textExample.similarity)}, making ${esc(textExample.name)} a top-five TF-IDF neighbour, but the two pages have no direct hyperlink in either direction. Shared page vocabulary can therefore surface relationships the direct edge list does not.</div>
    <div class="analysis-card"><strong>A link with little shared vocabulary — ${esc(linkExample.source_name)} and ${esc(linkExample.target_name)}.</strong> This direct edge has TF-IDF cosine ${fmt(linkExample.similarity)}. For comparison, the median across all character-page pairs is ${fmt(edgeStats.all_page_pair_median)}. ${esc(nextLinkExample.source_name)} and ${esc(nextLinkExample.target_name)} also link directly despite a score of ${fmt(nextLinkExample.similarity)}.</div>`;

  const interval = nullResult.null_95_percentile.map(value => fmt(value)).join("–");
  document.querySelector("#null-copy").textContent =
    `Across the ${nullResult.eligible_pairs.toLocaleString()} fixed directed edges, mean endpoint TF-IDF cosine is ${fmt(nullResult.observed_mean)}. Under ${nullResult.permutations} seeded random text-to-node assignments, the mean is ${fmt(nullResult.null_mean)} (central 95% permutation interval ${interval}); the one-sided empirical p-value is ${nullResult.upper_tail_p.toFixed(3)}. That is higher edge-endpoint text similarity than expected under this particular assignment null—not evidence of causality.`;
}

window.addEventListener("resize", () => {
  if (!data) return;
  const state = neighbourState();
  drawGraph(state);
});
