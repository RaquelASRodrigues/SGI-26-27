const palette = { ink: "#0a090d", lilac: "#bd7dff", magenta: "#e84e83", cyan: "#21f3c6", paper: "#f2eaf5", muted: "#a99caf", purple: "#7d2ed8" };
const tooltip = d3.select("#tooltip");
const showTip = (event, html) => tooltip.html(html).style("left", `${event.clientX + 14}px`).style("top", `${event.clientY + 14}px`).style("opacity", 1);
const hideTip = () => tooltip.style("opacity", 0);
const chartFrame = (svg, margin) => { const width = svg.node().clientWidth || 600, height = svg.node().clientHeight || 300; svg.attr("viewBox", `0 0 ${width} ${height}`).selectAll("*").remove(); return { width, height, innerWidth: width - margin.left - margin.right, innerHeight: height - margin.top - margin.bottom, chart: svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`) }; };
const addAxes = (frame, x, y) => { frame.chart.append("g").attr("transform", `translate(0,${frame.innerHeight})`).attr("class", "matrix-label").call(d3.axisBottom(x)).selectAll("text").attr("fill", palette.paper); frame.chart.append("g").attr("class", "matrix-label").call(d3.axisLeft(y)).selectAll("text").attr("fill", palette.paper); };

let data, state = { run: "kept", colour: "true" }, selected;
const fmt = d3.format(".1%");

fetch("../data/week6_text_vs_network.json").then(response => { if (!response.ok) throw Error(response.status); return response.json(); }).then(payload => { data = payload; initialise(); }).catch(error => {
  document.querySelectorAll(".widget-card").forEach(card => card.insertAdjacentHTML("beforeend", '<p class="small-note">The Week 6 analysis data could not be loaded.</p>'));
  console.error(error);
});

function initialise() {
  document.querySelector("#method-copy").textContent = `${data.preprocessing.tokenizer}. ${data.preprocessing.stopwords} ${data.preprocessing.tfidf.ngrams}; sublinear TF and ${data.preprocessing.tfidf.normalization} normalization. Names: tokens capitalized in at least ${fmt(data.preprocessing.names.capitalized_ratio_at_least)} of uses (at least ${data.preprocessing.names.minimum_uses} uses), plus every node-id token.`;
  document.querySelector("#limitation-copy").textContent = `Scope: the ${data.communities.length} largest Louvain communities (${d3.sum(data.communities, d => d.size)} of the network’s pages), with ${data.preprocessing.cross_validation.folds}-fold stratified cross-validation. The saved Week 5 partition is reused.`;
  document.querySelectorAll("[data-run]").forEach(button => button.addEventListener("click", () => { state.run = button.dataset.run; document.querySelectorAll("[data-run]").forEach(item => item.classList.toggle("is-active", item === button)); update(); }));
  document.querySelectorAll("[data-colour]").forEach(button => button.addEventListener("click", () => { state.colour = button.dataset.colour; document.querySelectorAll("[data-colour]").forEach(item => item.classList.toggle("is-active", item === button)); drawNetwork(); }));
  update();
}

function run() { return data.runs[state.run]; }
function byId() { return new Map(run().characters.map(row => [row.id, row])); }
function update() {
  const current = run(), misfits = current.characters.filter(row => row.misfit);
  document.querySelector("#metrics").innerHTML = `<div class="metric"><b>${fmt(current.accuracy)}</b><span>Held-out accuracy</span></div><div class="metric"><b>${fmt(current.majority_baseline)}</b><span>Majority baseline</span></div><div class="metric"><b>${fmt(current.shuffled_label_baseline.mean_accuracy)}</b><span>Shuffled labels · ${current.shuffled_label_baseline.runs} runs</span></div>`;
  document.querySelector("#finding-copy").textContent = `With names ${state.run === "kept" ? "kept" : "removed"}, language gets ${fmt(current.accuracy)} correct out of sample, versus ${fmt(current.majority_baseline)} for always choosing the largest community and ${fmt(current.shuffled_label_baseline.mean_accuracy)} after label shuffling. ${misfits.length} pages disagree with their link-defined community.`;
  selected = selected && current.characters.some(row => row.id === selected.id) ? byId().get(selected.id) : current.characters.find(row => row.misfit) || current.characters[0];
  drawNetwork(); drawMatrix(); drawMisfits(); renderDetail(selected);
}

function communityColour(value) { return d3.scaleOrdinal(data.communities.map(row => row.id), [palette.magenta, palette.lilac, palette.cyan, "#f2b84b", "#6fd1ff"])(value); }
function drawNetwork() {
  const svg = d3.select("#network-svg"), frame = chartFrame(svg, { top: 16, right: 16, bottom: 16, left: 16 });
  const nodes = data.network.nodes.map(node => ({ ...node, ...byId().get(node.id) }));
  const x = d3.scaleLinear().domain(d3.extent(nodes, node => node.position[0])).range([0, frame.innerWidth]);
  const y = d3.scaleLinear().domain(d3.extent(nodes, node => node.position[1])).range([frame.innerHeight, 0]);
  const lookup = new Map(nodes.map(node => [node.id, node]));
  frame.chart.append("g").selectAll("line").data(data.network.edges).join("line").attr("class", "network-link").attr("x1", edge => x(lookup.get(edge.source).position[0])).attr("y1", edge => y(lookup.get(edge.source).position[1])).attr("x2", edge => x(lookup.get(edge.target).position[0])).attr("y2", edge => y(lookup.get(edge.target).position[1]));
  const groups = frame.chart.append("g").selectAll("g").data(nodes).join("g").attr("transform", node => `translate(${x(node.position[0])},${y(node.position[1])})`);
  groups.append("circle").attr("class", "network-node").attr("r", node => selected && node.id === selected.id ? 6 : 3.6).attr("fill", node => communityColour(state.colour === "true" ? node.true : node.predicted)).attr("opacity", .9)
    .on("pointerenter", (event, node) => showTip(event, `<strong>${node.name}</strong><br>network: ${node.true} · text: ${node.predicted}<br>confidence: ${fmt(node.confidence)}${node.misfit ? "<br><b>labels disagree</b>" : ""}`)).on("pointerleave", hideTip).on("click", (_, node) => { selected = node; drawNetwork(); renderDetail(node); });
  groups.filter(node => node.misfit).append("circle").attr("class", "network-ring").attr("r", node => selected && node.id === selected.id ? 8.5 : 5.8);
}

function renderDetail(row) {
  if (!row) return;
  const node = data.network.nodes.find(item => item.id === row.id), neighbours = new Map();
  data.network.edges.forEach(edge => { const other = edge.source === row.id ? edge.target : edge.target === row.id ? edge.source : null; if (other) { const neighbor = data.network.nodes.find(item => item.id === other); neighbours.set(neighbor.community, (neighbours.get(neighbor.community) || 0) + 1); } });
  const maximum = d3.max(row.terms, term => term.value) || 1;
  document.querySelector("#detail").innerHTML = `<h3>${node.name}</h3><p class="small-note">NETWORK ${row.true} · TEXT ${row.predicted} · ${fmt(row.confidence)} confidence${row.misfit ? " · DISAGREEMENT" : ""}</p><div>${row.terms.map(term => `<div class="term-row ${term.is_name ? "name" : ""}"><span>${term.term}</span><span class="term-bar"><i style="width:${100 * term.value / maximum}%"></i></span><span>${term.is_name ? "name" : term.value.toFixed(3)}</span></div>`).join("")}</div>${row.snippets?.length ? `<h3>In the page</h3>${row.snippets.map(snippet => `<div class="snippet"><b>${snippet.term}</b> — ${snippet.text}</div>`).join("")}` : ""}<h3>Linked neighbours</h3><ul class="neighbor-list">${[...neighbours.entries()].sort((a,b) => b[1]-a[1]).map(([community, count]) => `<li>Community ${community}: ${count}</li>`).join("") || "<li>No induced neighbours.</li>"}</ul>`;
}

function drawMatrix() {
  const current = run(), svg = d3.select("#matrix-svg"), frame = chartFrame(svg, { top: 28, right: 10, bottom: 42, left: 42 }), classes = current.classes;
  const x = d3.scaleBand().domain(classes).range([0, frame.innerWidth]).padding(.05), y = d3.scaleBand().domain(classes).range([0, frame.innerHeight]).padding(.05), max = d3.max(current.confusion.flat()) || 1, fill = d3.scaleSequential([0, max], d3.interpolateRgb("#251531", palette.magenta));
  addAxes(frame, x, y);
  const cells = classes.flatMap((truth, r) => classes.map((prediction, c) => ({ truth, prediction, count: current.confusion[r][c] })));
  frame.chart.selectAll("rect").data(cells).join("rect").attr("class", "matrix-cell").attr("x", cell => x(cell.prediction)).attr("y", cell => y(cell.truth)).attr("width", x.bandwidth()).attr("height", y.bandwidth()).attr("fill", cell => fill(cell.count)).on("click", (_, cell) => showCell(cell.truth, cell.prediction));
  frame.chart.selectAll("text.value").data(cells).join("text").attr("class", "matrix-value").attr("x", cell => x(cell.prediction) + x.bandwidth()/2).attr("y", cell => y(cell.truth) + y.bandwidth()/2 + 4).attr("text-anchor", "middle").text(cell => cell.count);
}

function showCell(truth, prediction) {
  const rows = run().characters.filter(row => row.true === truth && row.predicted === prediction).sort((a,b) => b.confidence-a.confidence);
  document.querySelector("#cell-heading").textContent = `Network ${truth} → text ${prediction} (${rows.length})`;
  document.querySelector("#cell-list").innerHTML = rows.length ? `<table class="cell-list">${rows.map(row => { const name = data.network.nodes.find(node => node.id === row.id).name; return `<tr><td><button class="w6-button" data-id="${row.id}">${name}</button></td><td>${fmt(row.confidence)}</td></tr>`; }).join("")}</table>` : "No pages in this cell.";
  document.querySelectorAll("#cell-list [data-id]").forEach(button => button.addEventListener("click", () => { selected = byId().get(button.dataset.id); drawNetwork(); renderDetail(selected); document.querySelector("#network-svg").scrollIntoView({ behavior: "smooth", block: "center" }); }));
}

function drawMisfits() {
  const rows = run().characters.filter(row => row.misfit).sort((a,b) => b.confidence-a.confidence).slice(0, 12);
  document.querySelector("#misfit-rows").innerHTML = rows.map(row => { const name = data.network.nodes.find(node => node.id === row.id).name; return `<tr><td><button data-id="${row.id}">${name}</button></td><td>${row.true}</td><td>${row.predicted}</td><td>${fmt(row.confidence)}</td><td>${row.terms[0]?.term || "—"}</td></tr>`; }).join("");
  document.querySelectorAll("#misfit-rows [data-id]").forEach(button => button.addEventListener("click", () => { selected = byId().get(button.dataset.id); drawNetwork(); renderDetail(selected); document.querySelector("#network-svg").scrollIntoView({ behavior: "smooth", block: "center" }); }));
}

window.addEventListener("resize", () => { if (data) { drawNetwork(); drawMatrix(); } });
