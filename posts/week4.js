"use strict";

const DATA_URL = "../data/week4_communities.json";
const COMMUNITY_COLORS = [
  "#d18cff", "#e84e83", "#78d6c2", "#ffc86b", "#8e9cff",
  "#ff8f70", "#85b8ff", "#d9dc72", "#d58cc8", "#70d5e8",
];
const ISOLATE_COLOR = "#81738a";
const $ = selector => document.querySelector(selector);
const format = value => new Intl.NumberFormat("en-US").format(value);
const normalize = value => String(value ?? "")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

function errorMessage(error) {
  const message = `This explorer could not load its precomputed data. ${error.message}`;
  ["#community-metrics", "#nmi-note"].forEach(selector => {
    const target = $(selector);
    target.classList.add("widget-error");
    target.textContent = message;
  });
}

function createElement(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}

async function initCommunityExplorer() {
  const response = await fetch(DATA_URL);
  if (!response.ok) throw new Error(`HTTP ${response.status} while loading ${DATA_URL}`);
  const data = await response.json();
  const canvas = $("#community-network");
  const context = canvas.getContext("2d");
  const metrics = $("#community-metrics");
  const legend = $("#community-legend");
  const legendHeading = $("#legend-heading");
  const detail = $("#selection-detail");
  const methodNote = $("#method-note");
  const nmiNote = $("#nmi-note");
  const dataNote = $("#data-note");
  const input = $("#philosopher-search");
  const options = $("#philosopher-options");

  const nodes = data.nodes.map((node, index) => ({ ...node, index }));
  const nodesByName = new Map(nodes.map(node => [normalize(node.name), node]));
  const adjacency = nodes.map(() => new Set());
  const inDegree = new Uint16Array(nodes.length);
  const outDegree = new Uint16Array(nodes.length);
  data.edges.forEach(edge => {
    adjacency[edge.source].add(edge.target);
    adjacency[edge.target].add(edge.source);
    outDegree[edge.source] += 1;
    inDegree[edge.target] += 1;
  });

  let method = "louvain";
  let selectedNode = null;
  let selectedCommunity = null;
  let width = 0;
  let height = 0;
  let pixelRatio = 1;
  let transform = d3.zoomIdentity;

  const activeMethod = () => data.methods[method];
  const methodName = () => method === "louvain" ? "Louvain" : "Infomap";
  const communityColor = community => COMMUNITY_COLORS[
    Math.max(0, activeMethod().communities.findIndex(row => row.id === community)) % COMMUNITY_COLORS.length
  ];
  const nodeColor = node => node.isolated ? ISOLATE_COLOR : communityColor(node[method]);
  const coordinate = node => [node.x * width, node.y * height];
  const selectedNodeNeighbours = () => selectedNode === null ? null : adjacency[selectedNode];
  const isInSelectedCommunity = node => {
    if (selectedCommunity === null) return false;
    if (selectedCommunity === "isolates") return node.isolated;
    return !node.isolated && node[method] === selectedCommunity;
  };

  function pointToCanvas(node) {
    const [x, y] = coordinate(node);
    return [transform.applyX(x), transform.applyY(y)];
  }

  function drawArrow(source, target, color) {
    const [x1, y1] = coordinate(source);
    const [x2, y2] = coordinate(target);
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const distance = Math.hypot(x2 - x1, y2 - y1);
    if (distance < 12) return;
    const length = 5.5 / transform.k;
    const tipX = x2 - Math.cos(angle) * 4.5 / transform.k;
    const tipY = y2 - Math.sin(angle) * 4.5 / transform.k;
    context.beginPath();
    context.moveTo(tipX, tipY);
    context.lineTo(
      tipX - length * Math.cos(angle - Math.PI / 6),
      tipY - length * Math.sin(angle - Math.PI / 6),
    );
    context.lineTo(
      tipX - length * Math.cos(angle + Math.PI / 6),
      tipY - length * Math.sin(angle + Math.PI / 6),
    );
    context.closePath();
    context.fillStyle = color;
    context.fill();
  }

  function draw() {
    if (!width || !height) return;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, width, height);
    context.fillStyle = "#0d0a12";
    context.fillRect(0, 0, width, height);
    context.save();
    context.translate(transform.x, transform.y);
    context.scale(transform.k, transform.k);

    const trayX = width * 0.815;
    context.fillStyle = "rgba(189,125,255,.045)";
    context.fillRect(trayX, height * 0.045, width * 0.17, height * 0.91);
    context.setLineDash([4 / transform.k, 4 / transform.k]);
    context.lineWidth = 0.7 / transform.k;
    context.strokeStyle = "rgba(189,125,255,.45)";
    context.strokeRect(trayX, height * 0.045, width * 0.17, height * 0.91);
    context.setLineDash([]);
    context.fillStyle = "rgba(242,234,245,.75)";
    context.font = `${10 / transform.k}px "DM Mono", monospace`;
    context.fillText(`${format(data.stats.isolated_nodes)} ISOLATED`, trayX + width * 0.012, height * 0.082);

    const hasHighlight = selectedNode !== null || selectedCommunity !== null;
    data.edges.forEach(edge => {
      const source = nodes[edge.source];
      const target = nodes[edge.target];
      const incidentToNode = selectedNode !== null &&
        (edge.source === selectedNode || edge.target === selectedNode);
      const internalToCommunity = selectedCommunity !== null &&
        isInSelectedCommunity(source) && isInSelectedCommunity(target);
      if (hasHighlight && !incidentToNode && !internalToCommunity) {
        context.strokeStyle = "rgba(189,125,255,.025)";
        context.lineWidth = 0.25 / transform.k;
      } else if (incidentToNode) {
        context.strokeStyle = "rgba(232,78,131,.9)";
        context.lineWidth = (1.2 + Math.log1p(edge.weight) * .22) / transform.k;
      } else if (internalToCommunity) {
        context.strokeStyle = "rgba(242,234,245,.45)";
        context.lineWidth = (0.55 + Math.log1p(edge.weight) * .16) / transform.k;
      } else {
        context.strokeStyle = `rgba(189,125,255,${Math.min(.19, .045 + Math.log1p(edge.weight) * .035)})`;
        context.lineWidth = (0.28 + Math.log1p(edge.weight) * .1) / transform.k;
      }
      const [x1, y1] = coordinate(source);
      const [x2, y2] = coordinate(target);
      context.beginPath();
      context.moveTo(x1, y1);
      context.lineTo(x2, y2);
      context.stroke();
      if (incidentToNode) drawArrow(source, target, "rgba(232,78,131,.95)");
    });

    const neighbours = selectedNodeNeighbours();
    nodes.forEach(node => {
      const selected = node.index === selectedNode;
      const neighbour = neighbours?.has(node.index);
      const inCommunity = isInSelectedCommunity(node);
      const dimmed = hasHighlight && !selected && !neighbour && !inCommunity;
      const [x, y] = coordinate(node);
      const radius = selected ? 5.2 / transform.k : neighbour || inCommunity ? 3.2 / transform.k : 2.05 / transform.k;
      context.globalAlpha = dimmed ? .12 : 1;
      context.fillStyle = selected ? "#f2eaf5" : nodeColor(node);
      if (node.isolated) {
        context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
      } else {
        context.beginPath();
        context.arc(x, y, radius, 0, Math.PI * 2);
        context.fill();
      }
      if (selected) {
        context.beginPath();
        context.arc(x, y, 8 / transform.k, 0, Math.PI * 2);
        context.strokeStyle = "#e84e83";
        context.lineWidth = 1.3 / transform.k;
        context.stroke();
      }
    });
    context.globalAlpha = 1;
    context.restore();
  }

  function resetDetail() {
    detail.replaceChildren(
      createElement("h3", "Choose a node or a community"),
      createElement("p", "Search for a philosopher, click a node, or select a row in the legend. The 68 isolates remain visible in the separate tray at right."),
    );
  }

  function renderNodeDetail(node) {
    const heading = createElement("h3", node.name);
    const link = createElement("a", "Open the Wikipedia article");
    link.href = node.url;
    link.target = "_blank";
    link.rel = "noopener";
    const connectionText = node.isolated
      ? "Isolated: no incoming or outgoing link in this philosopher network."
      : `${format(adjacency[node.index].size)} immediate neighbours · ${format(inDegree[node.index])} incoming and ${format(outDegree[node.index])} outgoing directed links.`;
    const louvainAssignment = node.isolated
      ? "Louvain: isolated singleton community"
      : `Louvain: community ${node.louvain}`;
    const infomapAssignment = node.isolated
      ? "Infomap: not assigned (isolated node)"
      : `Infomap: community ${node.infomap}`;
    detail.replaceChildren(
      heading,
      link,
      createElement("p", connectionText),
      createElement("p", louvainAssignment, "assignment-line"),
      createElement("p", infomapAssignment, "assignment-line"),
    );
  }

  function renderCommunityDetail() {
    if (selectedCommunity === null) {
      resetDetail();
      return;
    }
    const members = nodes.filter(isInSelectedCommunity);
    const title = selectedCommunity === "isolates"
      ? "Isolated philosophers"
      : `${methodName()} community ${selectedCommunity}`;
    const status = selectedCommunity === "isolates"
      ? "They are kept in the graph and visually separated because they have no incident edge. Louvain treats each as a singleton; Infomap leaves them unassigned."
      : `${format(members.length)} assigned philosophers are highlighted. ` +
        `Examples: ${members.slice(0, 6).map(node => node.name).join(" · ")}.`;
    detail.replaceChildren(createElement("h3", title), createElement("p", status));
  }

  function metric(value, label, extraClass = "") {
    const tile = createElement("div", undefined, "metric-tile");
    tile.append(
      createElement("span", value, `metric-value ${extraClass}`.trim()),
      createElement("span", label, "metric-label"),
    );
    return tile;
  }

  function renderMetrics() {
    const current = activeMethod();
    const sizes = current.communities.map(row => format(row.size)).join(" · ");
    const quality = method === "louvain" ? current.modularity.toFixed(6) : current.codelength.toFixed(6);
    const qualityLabel = method === "louvain" ? `modularity · seed ${current.seed}` : `codelength · seed ${current.seed}`;
    const connectedLabel = method === "louvain"
      ? `${format(current.communities.length)} among connected philosophers`
      : `${format(current.assigned_node_count)} philosophers assigned`;
    metrics.replaceChildren(
      metric(format(current.community_count), `communities · ${connectedLabel}`),
      metric(sizes, "community-size distribution", "distribution-value"),
      metric(format(data.stats.isolated_nodes), "isolated nodes · always retained"),
      metric(quality, qualityLabel),
    );
  }

  function renderLegend() {
    const current = activeMethod();
    legendHeading.textContent = `${methodName()} communities · click to highlight`;
    legend.replaceChildren();
    current.communities.forEach(community => {
      const button = createElement("button", undefined, "community-button");
      button.type = "button";
      button.classList.toggle("is-active", selectedCommunity === community.id);
      button.setAttribute("aria-pressed", String(selectedCommunity === community.id));
      const swatch = createElement("span", undefined, "swatch");
      swatch.style.backgroundColor = communityColor(community.id);
      button.append(
        swatch,
        createElement("span", `Community ${community.id}`, "community-name"),
        createElement("span", format(community.size), "community-size"),
      );
      button.addEventListener("click", () => {
        selectedNode = null;
        selectedCommunity = selectedCommunity === community.id ? null : community.id;
        input.value = "";
        renderExplorer();
      });
      legend.appendChild(button);
    });
    const isolates = createElement("button", undefined, "community-button isolate-button");
    isolates.type = "button";
    isolates.classList.toggle("is-active", selectedCommunity === "isolates");
    isolates.setAttribute("aria-pressed", String(selectedCommunity === "isolates"));
    const isolateSwatch = createElement("span", undefined, "swatch");
    isolateSwatch.style.backgroundColor = ISOLATE_COLOR;
    isolates.append(
      isolateSwatch,
      createElement("span", method === "louvain" ? "Isolated singleton communities" : "Isolated · no module", "community-name"),
      createElement("span", format(data.stats.isolated_nodes), "community-size"),
    );
    isolates.addEventListener("click", () => {
      selectedNode = null;
      selectedCommunity = selectedCommunity === "isolates" ? null : "isolates";
      input.value = "";
      renderExplorer();
    });
    legend.appendChild(isolates);
  }

  function renderMethodNote() {
    const current = activeMethod();
    const runRange = method === "louvain"
      ? `Across ${current.runs.length} fixed-seed runs, modularity ranges from ${Math.min(...current.runs.map(run => run.modularity)).toFixed(6)} to ${Math.max(...current.runs.map(run => run.modularity)).toFixed(6)}.`
      : `Across ${current.runs.length} fixed-seed runs, codelength ranges from ${Math.min(...current.runs.map(run => run.codelength)).toFixed(6)} to ${Math.max(...current.runs.map(run => run.codelength)).toFixed(6)}.`;
    methodNote.textContent = `${runRange} ${data.meta.louvain_graph} ${data.meta.infomap_graph} ${data.meta.layout_note}`;
  }

  function renderExplorer() {
    renderMetrics();
    renderLegend();
    if (selectedNode !== null) renderNodeDetail(nodes[selectedNode]);
    else renderCommunityDetail();
    renderMethodNote();
    draw();
  }

  function selectNode(node, focus = false) {
    selectedNode = node.index;
    selectedCommunity = null;
    input.value = node.name;
    if (focus) {
      const [x, y] = coordinate(node);
      const zoomed = d3.zoomIdentity.translate(width / 2 - x * 2, height / 2 - y * 2).scale(2);
      d3.select(canvas).transition().duration(220).call(zoom.transform, zoomed);
    }
    renderExplorer();
  }

  function searchForNode() {
    const query = normalize(input.value);
    if (!query) return;
    const exact = nodesByName.get(query);
    const firstPartial = nodes.find(node => normalize(node.name).includes(query));
    if (exact || firstPartial) selectNode(exact ?? firstPartial, true);
  }

  function resize() {
    const bounds = canvas.getBoundingClientRect();
    width = Math.max(1, bounds.width);
    height = Math.max(1, bounds.height);
    pixelRatio = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * pixelRatio);
    canvas.height = Math.round(height * pixelRatio);
    draw();
  }

  const zoom = d3.zoom()
    .scaleExtent([.75, 8])
    .on("zoom", event => {
      transform = event.transform;
      draw();
    });
  d3.select(canvas).call(zoom).on("dblclick.zoom", null);
  canvas.addEventListener("click", event => {
    if (event.defaultPrevented) return;
    const bounds = canvas.getBoundingClientRect();
    const x = (event.clientX - bounds.left - transform.x) / transform.k;
    const y = (event.clientY - bounds.top - transform.y) / transform.k;
    let nearest = null;
    let bestDistance = Math.max(7, 8 / transform.k);
    nodes.forEach(node => {
      const [nodeX, nodeY] = coordinate(node);
      const distance = Math.hypot(x - nodeX, y - nodeY);
      if (distance < bestDistance) {
        nearest = node;
        bestDistance = distance;
      }
    });
    if (nearest) selectNode(nearest);
  });

  nodes.slice().sort((a, b) => a.name.localeCompare(b.name)).forEach(node => {
    const option = document.createElement("option");
    option.value = node.name;
    options.appendChild(option);
  });
  input.addEventListener("change", searchForNode);
  input.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      searchForNode();
    }
  });
  $("#reset-explorer").addEventListener("click", () => {
    selectedNode = null;
    selectedCommunity = null;
    input.value = "";
    d3.select(canvas).transition().duration(180).call(zoom.transform, d3.zoomIdentity);
    renderExplorer();
  });
  document.querySelectorAll("[data-method]").forEach(button => {
    button.addEventListener("click", () => {
      method = button.dataset.method;
      selectedCommunity = null;
      document.querySelectorAll("[data-method]").forEach(control => {
        const active = control === button;
        control.classList.toggle("is-active", active);
        control.setAttribute("aria-pressed", String(active));
      });
      renderExplorer();
    });
  });

  nmiNote.replaceChildren(
    createElement("span", data.comparison.nmi.toFixed(6), "nmi-value"),
    createElement("p", ` NMI is calculated only on the ${format(data.comparison.shared_nodes)} connected philosophers assigned by both methods. This low agreement means the partitions differ; it does not make one method automatically better. Louvain’s modularity objective and Infomap’s flow objective ask different questions of the same links.`),
  );
  dataNote.textContent = `${format(data.stats.nodes)} philosophers · ${format(data.stats.directed_edges_aggregated)} aggregated directed edges · total directed weight ${format(data.stats.total_directed_weight)} · ${format(data.stats.isolated_nodes)} isolates. ${data.meta.weight_definition}`;
  window.addEventListener("resize", resize);
  resize();
  renderExplorer();
}

initCommunityExplorer().catch(errorMessage);
