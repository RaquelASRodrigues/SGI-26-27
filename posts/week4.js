"use strict";

const DATA_URL = "../data/week4_communities.json";
const PARTITION_GOLDEN_ANGLE = 137.507764;
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

async function initOverlapExplorer() {
  const response = await fetch("../data/week4_link_communities.json");
  if (!response.ok) throw new Error(`HTTP ${response.status} while loading link communities`);
  const data = await response.json();
  const canvas = $("#overlap-network");
  const context = canvas.getContext("2d");
  const metrics = $("#overlap-metrics");
  const legend = $("#overlap-legend");
  const detail = $("#overlap-detail");
  const methodNote = $("#overlap-method-note");
  const search = $("#overlap-search");
  const options = $("#overlap-options");
  const communitySelect = $("#overlap-community-select");
  const nodes = data.nodes.map((node, index) => ({ ...node, index }));
  const communityById = new Map(data.communities.map(community => [community.id, community]));
  const nodesByName = new Map(nodes.map(node => [normalize(node.name), node]));
  const adjacency = nodes.map(() => new Set());
  const directedEdgeCountByCommunity = new Map();
  data.edges.forEach(edge => {
    adjacency[edge.source].add(edge.target);
    adjacency[edge.target].add(edge.source);
    directedEdgeCountByCommunity.set(
      edge.community,
      (directedEdgeCountByCommunity.get(edge.community) ?? 0) + 1,
    );
  });
  const colorScale = d3.scaleSequential(d3.interpolateSinebow)
    .domain([1, Math.max(2, data.stats.communities)]);
  const colorForCommunity = communityId => colorScale(communityId);
  const coordinate = node => [node.x * width, node.y * height];
  let selectedNode = null;
  let selectedCommunity = null;
  let width = 0;
  let height = 0;
  let pixelRatio = 1;
  let transform = d3.zoomIdentity;

  function nodeInCommunity(node, communityId) {
    return node.memberships.includes(communityId);
  }

  function drawArrow(source, target) {
    const [x1, y1] = coordinate(source);
    const [x2, y2] = coordinate(target);
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const distance = Math.hypot(x2 - x1, y2 - y1);
    if (distance < 12) return;
    const length = 5 / transform.k;
    const tipX = x2 - Math.cos(angle) * 4 / transform.k;
    const tipY = y2 - Math.sin(angle) * 4 / transform.k;
    context.beginPath();
    context.moveTo(tipX, tipY);
    context.lineTo(tipX - length * Math.cos(angle - Math.PI / 6), tipY - length * Math.sin(angle - Math.PI / 6));
    context.lineTo(tipX - length * Math.cos(angle + Math.PI / 6), tipY - length * Math.sin(angle + Math.PI / 6));
    context.closePath();
    context.fillStyle = "#e84e83";
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
    const trayX = width * .815;
    context.fillStyle = "rgba(189,125,255,.045)";
    context.fillRect(trayX, height * .045, width * .17, height * .91);
    context.setLineDash([4 / transform.k, 4 / transform.k]);
    context.strokeStyle = "rgba(189,125,255,.45)";
    context.lineWidth = .7 / transform.k;
    context.strokeRect(trayX, height * .045, width * .17, height * .91);
    context.setLineDash([]);
    context.fillStyle = "rgba(242,234,245,.75)";
    context.font = `${10 / transform.k}px "DM Mono", monospace`;
    context.fillText(`${format(data.stats.isolated_nodes)} ISOLATED`, trayX + width * .012, height * .082);

    const hasHighlight = selectedNode !== null || selectedCommunity !== null;
    data.edges.forEach(edge => {
      const source = nodes[edge.source];
      const target = nodes[edge.target];
      const egoEdge = selectedNode !== null && (edge.source === selectedNode || edge.target === selectedNode);
      const chosenEdge = selectedCommunity !== null && edge.community === selectedCommunity;
      context.strokeStyle = colorForCommunity(edge.community);
      if (egoEdge) {
        context.globalAlpha = .95;
        context.lineWidth = (1.35 + Math.log1p(edge.weight) * .22) / transform.k;
      } else if (chosenEdge) {
        context.globalAlpha = .82;
        context.lineWidth = (1 + Math.log1p(edge.weight) * .18) / transform.k;
      } else if (hasHighlight) {
        context.globalAlpha = .025;
        context.lineWidth = .25 / transform.k;
      } else {
        context.globalAlpha = .20;
        context.lineWidth = (.3 + Math.log1p(edge.weight) * .11) / transform.k;
      }
      const [x1, y1] = coordinate(source);
      const [x2, y2] = coordinate(target);
      context.beginPath();
      context.moveTo(x1, y1);
      context.lineTo(x2, y2);
      context.stroke();
      if (egoEdge) drawArrow(source, target);
    });

    const neighbours = selectedNode === null ? null : adjacency[selectedNode];
    nodes.forEach(node => {
      const selected = node.index === selectedNode;
      const neighbour = neighbours?.has(node.index);
      const chosenMember = selectedCommunity !== null && nodeInCommunity(node, selectedCommunity);
      const dimmed = hasHighlight && !selected && !neighbour && !chosenMember;
      const [x, y] = coordinate(node);
      const radius = selected ? 5.4 / transform.k : neighbour || chosenMember ? 3.5 / transform.k : 2.1 / transform.k;
      context.globalAlpha = dimmed ? .12 : 1;
      if (node.isolated) {
        context.fillStyle = "#81738a";
        context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
      } else {
        context.fillStyle = node.memberships.length ? colorForCommunity(node.memberships[0]) : "#81738a";
        context.beginPath();
        context.arc(x, y, radius, 0, Math.PI * 2);
        context.fill();
        if (node.membership_count > 1) {
          context.beginPath();
          context.arc(x, y, (radius + 2.4 / transform.k), 0, Math.PI * 2);
          context.strokeStyle = "#e84e83";
          context.lineWidth = 1.15 / transform.k;
          context.stroke();
        }
      }
      if (selected) {
        context.beginPath();
        context.arc(x, y, 8 / transform.k, 0, Math.PI * 2);
        context.strokeStyle = "#f2eaf5";
        context.lineWidth = 1.4 / transform.k;
        context.stroke();
      }
    });
    context.globalAlpha = 1;
    context.restore();
  }

  function metric(value, label, className = "") {
    const tile = createElement("div", undefined, "metric-tile");
    tile.append(createElement("span", value, `metric-value ${className}`.trim()), createElement("span", label, "metric-label"));
    return tile;
  }

  function renderMetrics() {
    metrics.replaceChildren(
      metric(format(data.stats.communities), "edge communities detected"),
      metric(format(data.stats.membership_total), "node memberships"),
      metric(format(data.stats.multiple_membership_nodes), "nodes with multiple memberships"),
      metric(`${format(data.stats.undirected_edges)} / ${format(data.stats.directed_edges)}`, "undirected pairs / directed display edges"),
    );
  }

  function renderNodeDetail(node) {
    const neighbourNames = [...adjacency[node.index]].map(index => nodes[index].name).sort((left, right) => left.localeCompare(right));
    const memberships = node.memberships.length
      ? node.memberships.map(id => {
        const community = communityById.get(id);
        return `Community ${id} · ${format(community.edge_count)} edges · ${format(community.node_count)} nodes`;
      }).join("\n")
      : "No memberships: this philosopher is isolated.";
    const ego = node.isolated
      ? "Ego network: no incident edges."
      : `Ego network: ${format(neighbourNames.length)} immediate neighbours. ${neighbourNames.slice(0, 18).join(" · ")}${neighbourNames.length > 18 ? " …" : ""}`;
    const heading = createElement("h3", node.name);
    const link = createElement("a", "Open the Wikipedia article");
    link.href = node.url;
    link.target = "_blank";
    link.rel = "noopener";
    detail.replaceChildren(
      heading,
      link,
      createElement("p", `${format(node.membership_count)} edge-community membership${node.membership_count === 1 ? "" : "s"}. ${node.membership_count > 1 ? "Double outline = overlapping memberships." : "Single fill = one membership."}`),
      createElement("p", ego),
      createElement("p", memberships, "membership-list"),
    );
  }

  function renderCommunityDetail(communityId) {
    if (communityId === null) {
      detail.replaceChildren(
        createElement("h3", "Choose a philosopher or community"),
        createElement("p", "The picker contains every detected edge community. Search for a philosopher to inspect their ego network and overlapping memberships."),
      );
      return;
    }
    const community = communityById.get(communityId);
    const names = community.members.map(index => nodes[index].name);
    detail.replaceChildren(
      createElement("h3", `Edge community ${communityId}`),
      createElement("p", `${format(community.edge_count)} undirected links represent ${format(directedEdgeCountByCommunity.get(communityId) ?? 0)} directed display arcs; ${format(community.node_count)} endpoint philosophers inherit this edge-community membership. Connections brighten in the network.`),
      createElement("p", `Examples: ${names.slice(0, 12).join(" · ")}${names.length > 12 ? " …" : ""}.`),
    );
  }

  function renderLegend() {
    const largest = data.communities.slice(0, 24);
    legend.replaceChildren();
    largest.forEach(community => {
      const button = createElement("button", undefined, "overlap-community-button");
      button.type = "button";
      button.classList.toggle("is-active", selectedCommunity === community.id);
      const swatch = createElement("span", undefined, "swatch");
      swatch.style.backgroundColor = colorForCommunity(community.id);
      button.setAttribute("aria-pressed", String(selectedCommunity === community.id));
      button.append(swatch, createElement("span", `Community ${community.id}`, "community-name"), createElement("span", `${format(community.edge_count)} links`, "community-size"));
      button.addEventListener("click", () => {
        selectedCommunity = selectedCommunity === community.id ? null : community.id;
        selectedNode = null;
        communitySelect.value = selectedCommunity ?? "";
        search.value = "";
        renderExplorer();
      });
      legend.appendChild(button);
    });
  }

  function renderExplorer() {
    renderMetrics();
    renderLegend();
    if (selectedNode !== null) renderNodeDetail(nodes[selectedNode]);
    else renderCommunityDetail(selectedCommunity);
    draw();
  }

  function selectNode(node, focus = false) {
    selectedNode = node.index;
    selectedCommunity = null;
    communitySelect.value = "";
    search.value = node.name;
    if (focus) {
      const [x, y] = coordinate(node);
      const zoomed = d3.zoomIdentity.translate(width / 2 - x * 2, height / 2 - y * 2).scale(2);
      d3.select(canvas).transition().duration(220).call(zoom.transform, zoomed);
    }
    renderExplorer();
  }

  function searchForNode() {
    const query = normalize(search.value);
    if (!query) return;
    const exact = nodesByName.get(query);
    const partial = nodes.find(node => normalize(node.name).includes(query));
    if (exact || partial) selectNode(exact ?? partial, true);
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

  const zoom = d3.zoom().scaleExtent([.75, 8]).on("zoom", event => {
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
  communitySelect.replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select an edge community…";
  communitySelect.appendChild(placeholder);
  data.communities.forEach(community => {
    const option = document.createElement("option");
    option.value = String(community.id);
    option.textContent = `Community ${community.id} · ${format(community.edge_count)} links · ${format(community.node_count)} nodes`;
    communitySelect.appendChild(option);
  });
  search.addEventListener("change", searchForNode);
  search.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      searchForNode();
    }
  });
  communitySelect.addEventListener("change", () => {
    selectedCommunity = communitySelect.value ? Number(communitySelect.value) : null;
    selectedNode = null;
    search.value = "";
    renderExplorer();
  });
  $("#reset-overlap").addEventListener("click", () => {
    selectedNode = null;
    selectedCommunity = null;
    search.value = "";
    communitySelect.value = "";
    d3.select(canvas).transition().duration(180).call(zoom.transform, d3.zoomIdentity);
    renderExplorer();
  });
  methodNote.textContent = `${data.meta.method_note} ${data.meta.preprocessing} ${data.meta.interpretation_note} Partition density at the selected cut: ${data.stats.partition_density.toFixed(6)}. Community sizes count undirected links; reciprocal or one-way original arcs in the display inherit that link's colour. The 24 largest communities are shown as buttons; the picker contains all ${format(data.stats.communities)}.`;
  window.addEventListener("resize", resize);
  resize();
  renderExplorer();
}

async function initAristotleCase() {
  const [linkResponse, caseResponse, partitionResponse] = await Promise.all([
    fetch("../data/week4_link_communities.json"),
    fetch("../data/week4_aristotle_case.json"),
    fetch("../data/week4_communities.json"),
  ]);
  if (!linkResponse.ok) throw new Error(`HTTP ${linkResponse.status} while loading link communities`);
  if (!caseResponse.ok) throw new Error(`HTTP ${caseResponse.status} while loading k-clique results`);
  if (!partitionResponse.ok) throw new Error(`HTTP ${partitionResponse.status} while loading Louvain and Infomap assignments`);
  const [linkData, caseData, partitionData] = await Promise.all([
    linkResponse.json(),
    caseResponse.json(),
    partitionResponse.json(),
  ]);
  const canvas = $("#case-network");
  const context = canvas.getContext("2d");
  const stage = $("#case-stage");
  const tooltip = $("#case-tooltip");
  const metrics = $("#case-metrics");
  const detail = $("#case-detail");
  const members = $("#case-members");
  const methodNote = $("#case-method-note");
  const evidence = $("#case-evidence");
  const interpretation = $("#case-interpretation");
  const search = $("#case-search");
  const options = $("#case-options");
  const methodSelect = $("#case-method");
  const viewSelect = $("#case-view");
  const kControl = $("#case-k-control");
  const kSelect = $("#case-k");
  const communitySelect = $("#case-community");
  const nodes = linkData.nodes.map((node, index) => ({ ...node, index }));
  const partitionNodesById = new Map(partitionData.nodes.map(node => [node.id, node]));
  const analysisAristotle = partitionNodesById.get("Aristotle");
  if (!analysisAristotle) throw new Error("Aristotle is missing from the Louvain/Infomap assignments.");
  const louvainAristotleMembers = partitionData.nodes.filter(node => node.louvain === analysisAristotle.louvain);
  const infomapAristotleMembers = partitionData.nodes.filter(node => node.infomap === analysisAristotle.infomap);
  const infomapAristotleIds = new Set(infomapAristotleMembers.map(node => node.id));
  const sharedAristotleMembers = louvainAristotleMembers.filter(node => infomapAristotleIds.has(node.id));
  const edges = linkData.edges;
  const directedPairs = new Set(edges.map(edge => `${edge.source}:${edge.target}`));
  const linkCommunities = new Map(linkData.communities.map(group => [group.id, group]));
  const nodesByName = new Map(nodes.map(node => [normalize(node.name), node]));
  const adjacency = nodes.map(() => []);
  const directedCounts = new Map();
  const colorScale = d3.scaleSequential(d3.interpolateSinebow)
    .domain([1, Math.max(2, linkData.stats.communities)]);
  const colorForCommunity = id => colorScale(id);
  const kValues = caseData.supported_k.map(String);
  const cliqueResults = caseData.results;
  let selectedNode = nodes[caseData.aristotle_index];
  let method = "link";
  let k = kValues[kValues.length - 1];
  let selectedCommunity = null;
  let viewMode = "ego";
  let positions = new Map();
  let egoEdges = [];
  let visibleEdges = [];
  let width = 0;
  let height = 0;
  let pixelRatio = 1;
  let transform = d3.zoomIdentity;

  edges.forEach(edge => {
    adjacency[edge.source].push(edge);
    adjacency[edge.target].push(edge);
    directedCounts.set(edge.community, (directedCounts.get(edge.community) ?? 0) + 1);
  });

  function currentMemberships(node) {
    if (method === "link") return node.memberships;
    return cliqueResults[k].memberships[String(node.index)] ?? [];
  }

  function currentCommunity(id) {
    if (method === "link") return linkCommunities.get(id);
    return cliqueResults[k].communities[id - 1];
  }

  function communityMembers(id) {
    if (method === "link") return currentCommunity(id)?.members ?? [];
    return currentCommunity(id)?.members ?? [];
  }

  function computeView() {
    const neighbours = new Set();
    egoEdges = [];
    adjacency[selectedNode.index].forEach(edge => {
      egoEdges.push(edge);
      neighbours.add(edge.source === selectedNode.index ? edge.target : edge.source);
    });
    if (viewMode === "full") {
      positions = new Map(nodes.map(node => [
        node.index,
        [node.x * width, node.y * height],
      ]));
      visibleEdges = edges;
      return;
    }
    const neighbourNodes = [...neighbours].map(index => nodes[index])
      .sort((left, right) => left.name.localeCompare(right.name));
    positions = new Map([[selectedNode.index, [width * .47, height * .54]]]);
    const radius = Math.min(width * .35, height * .34);
    neighbourNodes.forEach((node, index) => {
      const angle = -Math.PI / 2 + (Math.PI * 2 * index) / Math.max(1, neighbourNodes.length);
      positions.set(node.index, [
        width * .47 + Math.cos(angle) * radius,
        height * .54 + Math.sin(angle) * radius,
      ]);
    });
    visibleEdges = egoEdges;
  }

  function edgeGeometry(edge) {
    const source = positions.get(edge.source);
    const target = positions.get(edge.target);
    if (!source || !target) return null;
    const reverseExists = edge.source !== edge.target &&
      directedPairs.has(`${edge.target}:${edge.source}`);
    if (!reverseExists) return { source, target, control: null };
    const dx = target[0] - source[0];
    const dy = target[1] - source[1];
    const length = Math.hypot(dx, dy);
    if (!length) return { source, target, control: null };
    const side = edge.source < edge.target ? 1 : -1;
    const offset = Math.min(12, Math.max(5, length * .07));
    return {
      source,
      target,
      control: [
        (source[0] + target[0]) / 2 - dy / length * offset * side,
        (source[1] + target[1]) / 2 + dx / length * offset * side,
      ],
    };
  }

  function drawArrow(geometry, communityId) {
    const { source, target, control } = geometry;
    const tangent = control
      ? [target[0] - control[0], target[1] - control[1]]
      : [target[0] - source[0], target[1] - source[1]];
    const angle = Math.atan2(tangent[1], tangent[0]);
    const length = 5 / transform.k;
    const tipX = target[0] - Math.cos(angle) * 4 / transform.k;
    const tipY = target[1] - Math.sin(angle) * 4 / transform.k;
    context.beginPath();
    context.moveTo(tipX, tipY);
    context.lineTo(tipX - length * Math.cos(angle - Math.PI / 6), tipY - length * Math.sin(angle - Math.PI / 6));
    context.lineTo(tipX - length * Math.cos(angle + Math.PI / 6), tipY - length * Math.sin(angle + Math.PI / 6));
    context.closePath();
    context.fillStyle = colorForCommunity(communityId);
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
    const activeMembers = selectedCommunity === null
      ? new Set()
      : new Set(communityMembers(selectedCommunity));
    visibleEdges.forEach(edge => {
      const geometry = edgeGeometry(edge);
      if (!geometry) return;
      const { source, target, control } = geometry;
      const selectedLink = method === "link" && edge.community === selectedCommunity;
      const selectedClique = method === "clique" &&
        activeMembers.has(edge.source) && activeMembers.has(edge.target);
      const focused = selectedCommunity !== null && (selectedLink || selectedClique);
      context.globalAlpha = viewMode === "full" && selectedCommunity !== null
        ? focused ? .98 : .035
        : focused ? .98 : viewMode === "full" ? .2 : .78;
      context.strokeStyle = colorForCommunity(edge.community);
      context.lineWidth = (.45 + Math.log1p(edge.weight) * .11) / transform.k;
      context.beginPath();
      context.moveTo(source[0], source[1]);
      if (control) context.quadraticCurveTo(control[0], control[1], target[0], target[1]);
      else context.lineTo(target[0], target[1]);
      context.stroke();
      drawArrow(geometry, edge.community);
    });

    const membersPresent = new Set();
    membersPresent.add(selectedNode.index);
    if (viewMode === "full") nodes.forEach(node => membersPresent.add(node.index));
    else visibleEdges.forEach(edge => {
      membersPresent.add(edge.source);
      membersPresent.add(edge.target);
    });
    membersPresent.forEach(index => {
      const point = positions.get(index);
      const node = nodes[index];
      const selected = index === selectedNode.index;
      const inCommunity = activeMembers.has(index);
      const radius = selected ? 6 : inCommunity ? 4.3 : 2.6;
      context.globalAlpha = viewMode === "full" && selectedCommunity !== null
        ? selected || inCommunity ? 1 : .16
        : 1;
      context.fillStyle = selected ? "#f2eaf5"
        : inCommunity ? "#ffc86b"
          : node.memberships.length ? colorForCommunity(node.memberships[0]) : "#81738a";
      context.beginPath();
      context.arc(point[0], point[1], radius / transform.k, 0, Math.PI * 2);
      context.fill();
      if (selected || inCommunity) {
        context.beginPath();
        context.arc(point[0], point[1], (radius + 2.2) / transform.k, 0, Math.PI * 2);
        context.strokeStyle = selected ? "#e84e83" : "#ffc86b";
        context.lineWidth = 1.15 / transform.k;
        context.stroke();
      }
    });
    context.globalAlpha = 1;
    context.restore();
  }

  function metric(value, label, className = "") {
    const tile = createElement("div", undefined, "metric-tile");
    tile.append(
      createElement("span", value, `metric-value ${className}`.trim()),
      createElement("span", label, "metric-label"),
    );
    return tile;
  }

  function updateMetrics() {
    const nodeMemberships = currentMemberships(selectedNode);
    const neighbourCount = new Set(egoEdges.map(edge =>
      edge.source === selectedNode.index ? edge.target : edge.source)).size;
    const communityCount = method === "link"
      ? linkData.stats.communities
      : cliqueResults[k].stats.communities;
    const groupLabel = method === "link"
      ? "edge communities in graph"
      : `k=${k} clique communities · ${format(cliqueResults[k].stats.k_cliques)} k-cliques found`;
    metrics.replaceChildren(
      metric(format(neighbourCount), `${selectedNode.name} · immediate neighbours`),
      metric(format(egoEdges.length), "directed arcs · original weights retained"),
      metric(format(nodeMemberships.length), `${method === "link" ? "edge" : `k=${k} node`} memberships`),
      metric(format(communityCount), groupLabel),
    );
  }

  function updateCommunityOptions() {
    const membershipIds = currentMemberships(selectedNode);
    communitySelect.replaceChildren();
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = membershipIds.length ? "Choose one of this philosopher’s communities…" : "No memberships for this k";
    communitySelect.appendChild(placeholder);
    membershipIds.forEach(id => {
      const group = currentCommunity(id);
      const option = document.createElement("option");
      option.value = String(id);
      option.textContent = method === "link"
        ? `Link community ${id} · ${format(group.node_count)} philosophers · ${format(group.edge_count)} links`
        : `k=${k} community ${id} · ${format(group.size)} philosophers (united k-clique group)`;
      communitySelect.appendChild(option);
    });
    if (!membershipIds.includes(selectedCommunity)) selectedCommunity = null;
    communitySelect.value = selectedCommunity === null ? "" : String(selectedCommunity);
  }

  function updateMembers() {
    members.replaceChildren();
    const group = selectedCommunity === null ? null : currentCommunity(selectedCommunity);
    const memberIndices = group ? communityMembers(selectedCommunity) : [];
    const others = memberIndices.filter(index => index !== selectedNode.index)
      .sort((left, right) => nodes[left].name.localeCompare(nodes[right].name));
    if (!group) {
      members.appendChild(createElement("p", "Select one of this philosopher’s memberships to browse its other members."));
      return;
    }
    if (!others.length) {
      members.appendChild(createElement("p", "No other philosophers in this community."));
      return;
    }
    others.forEach(index => {
      const button = createElement("button", nodes[index].name, "case-member-button");
      button.type = "button";
      button.title = `Show ${nodes[index].name} and their direct connections`;
      button.addEventListener("click", () => selectNode(nodes[index], true));
      members.appendChild(button);
    });
  }

  function updateDetail() {
    const membershipIds = currentMemberships(selectedNode);
    const partitionNode = partitionNodesById.get(selectedNode.id);
    const currentLouvainMembers = partitionNode
      ? partitionData.nodes.filter(node => node.louvain === partitionNode.louvain)
      : [];
    const currentInfomapMembers = partitionNode?.infomap === null || partitionNode?.infomap === undefined
      ? []
      : partitionData.nodes.filter(node => node.infomap === partitionNode.infomap);
    const currentInfomapIds = new Set(currentInfomapMembers.map(node => node.id));
    const currentSharedMembers = currentLouvainMembers.filter(node => currentInfomapIds.has(node.id));
    const membershipText = membershipIds.length
      ? `${format(membershipIds.length)} ${method === "link" ? "edge-community" : `k=${k} clique-community`} membership${membershipIds.length === 1 ? "" : "s"}.`
      : `No k=${k} clique membership at this threshold.`;
    const heading = createElement("h3", selectedNode.name);
    const link = createElement("a", "Open the Wikipedia article");
    link.href = selectedNode.url;
    link.target = "_blank";
    link.rel = "noopener";
    detail.replaceChildren(heading, link, createElement("p", membershipText));
    const louvainLabel = partitionNode?.louvain === null || partitionNode?.louvain === undefined
      ? "unassigned"
      : `community ${partitionNode.louvain}`;
    const infomapLabel = partitionNode?.infomap === null || partitionNode?.infomap === undefined
      ? "unassigned"
      : `community ${partitionNode.infomap}`;
    detail.appendChild(createElement(
      "p",
      `Across the non-overlapping partitions: Louvain ${louvainLabel} (${format(currentLouvainMembers.length)} philosophers); Infomap ${infomapLabel} (${format(currentInfomapMembers.length)} philosophers). The two groups share ${format(currentSharedMembers.length)} philosophers.`,
    ));
    if (selectedCommunity !== null) {
      const group = currentCommunity(selectedCommunity);
      const text = method === "link"
        ? `Link community ${selectedCommunity}: ${format(group.edge_count)} undirected links · ${format(directedCounts.get(selectedCommunity) ?? 0)} directed display arcs · ${format(group.node_count)} philosophers. Only actual arcs assigned this computed link-community ID are highlighted.`
        : `k=${k} clique community ${selectedCommunity}: ${format(group.size)} philosophers. An individual k-clique has exactly k nodes; this larger community is the union of k-cliques linked through overlaps of k−1 nodes. Only actual network arcs between community members are highlighted; their edge colours still report link-community assignments.`;
      detail.appendChild(createElement("p", text));
    }
    detail.appendChild(createElement("p",
      `${format(egoEdges.length)} directed arcs to/from ${selectedNode.name}; ${format(new Set(egoEdges.map(edge => edge.source === selectedNode.index ? edge.target : edge.source)).size)} distinct immediate neighbours.`));
  }

  function updateMethodNote() {
    methodNote.textContent = method === "link"
      ? `${linkData.meta.method_note} ${linkData.meta.preprocessing} ${linkData.meta.interpretation_note} The result has ${format(linkData.stats.communities)} edge communities and ${format(linkData.stats.undirected_edges)} undirected edge memberships (one assignment per projected link); those map to ${format(linkData.stats.directed_edges)} displayed directed arcs. Nodes have ${format(linkData.stats.membership_total)} memberships in total; Aristotle has ${format(nodes[caseData.aristotle_index].memberships.length)}. Community sizes count undirected links; reciprocal directed arcs share their one link’s community. Edge thickness follows original directed-edge weight.`
      : `An individual k=${k} clique has exactly ${k} philosophers, with every pair connected. NetworkX percolates such cliques when they overlap by k−1 nodes; a resulting node community can therefore be much larger than k. The graph contains ${format(caseData.undirected_edges)} undirected connections and ${format(cliqueResults[k].stats.k_cliques)} k=${k} cliques, producing ${format(cliqueResults[k].stats.communities)} communities. ${caseData.meta.preprocessing} Node communities do not assign edges; the display shows only real arcs, coloured by their independent link-community assignments. Only precomputed k=${kValues.join(", ")} are selectable.`;
  }

  function updateCaseEvidence() {
    const aristotle = nodes[caseData.aristotle_index];
    const incident = edges.filter(edge => edge.source === aristotle.index || edge.target === aristotle.index);
    const arcCounts = new Map();
    incident.forEach(edge => arcCounts.set(edge.community, (arcCounts.get(edge.community) ?? 0) + 1));
    const ranked = [...arcCounts].sort((left, right) => right[1] - left[1]);
    const largest = ranked[0];
    const largestGroup = linkCommunities.get(largest[0]);
    const examples = aristotle.memberships
      .map(id => linkCommunities.get(id))
      .filter(group => group.node_count >= 4 && group.node_count <= 8)
      .sort((left, right) => left.node_count - right.node_count)[0];
    const exampleNames = examples
      ? examples.members.filter(index => index !== aristotle.index).map(index => nodes[index].name)
      : [];
    const cliqueSummary = kValues.map(value => {
      const result = cliqueResults[value];
      const groupSizes = result.stats.aristotle_memberships
        .map(id => result.communities[id - 1].size)
        .sort((left, right) => right - left);
      return { k: value, memberships: result.stats.aristotle_memberships.length, groupSizes };
    });
    const k5 = cliqueSummary.find(result => result.k === "5");
    const k5Result = cliqueResults["5"];
    const k5Groups = k5Result.stats.aristotle_memberships.map(id => k5Result.communities[id - 1]);
    const k5Example = k5Groups.find(group => group.id === 3);
    const k5ExampleNames = k5Example
      ? k5Example.members
        .filter(index => index !== aristotle.index)
        .map(index => nodes[index].name)
      : [];
    evidence.replaceChildren();
    [
      `${aristotle.name} has ${format(incident.length)} directed article-link arcs to/from ${format(new Set(incident.map(edge => edge.source === aristotle.index ? edge.target : edge.source)).size)} distinct philosophers. Those arcs carry ${format(aristotle.memberships.length)} link-community memberships.`,
      `The non-overlapping partitions place Aristotle in Louvain community ${analysisAristotle.louvain} (${format(louvainAristotleMembers.length)} philosophers) and Infomap community ${analysisAristotle.infomap} (${format(infomapAristotleMembers.length)} assigned philosophers). Those groups share ${format(sharedAristotleMembers.length)} members. Louvain and Infomap assign one group per philosopher; their IDs are arbitrary, and membership differences are not historical classifications.`,
      `The largest incident group is link community ${largest[0]}: ${format(largest[1])} of ${format(incident.length)} directed arcs (${(100 * largest[1] / incident.length).toFixed(1)}%) carry that ID. Its full group has ${format(largestGroup.node_count)} philosophers; the other ${format(incident.length - largest[1])} arcs span ${format(ranked.length - 1)} other link communities.`,
      exampleNames.length
        ? `A much smaller incident link group (community ${examples.id}, ${examples.node_count} philosophers) also contains ${exampleNames.join(", ")}. These are graph-linked peers, not a named school.`
        : "Several small edge groups also include Aristotle, alongside the largest incident community.",
      `On the binary undirected projection, the k-clique results vary with k: ${cliqueSummary.map(result => `k=${result.k}: Aristotle in ${result.memberships} communities (${result.groupSizes.length ? `sizes ${result.groupSizes.join(", ")}` : "no group"})`).join("; ")}. At k=5, ${format(k5Result.stats.k_cliques)} five-node cliques percolate into ${format(k5Result.stats.communities)} communities; Aristotle belongs to six (sizes ${k5.groupSizes.join(", ")}). The 467-node group is a union of overlapping 5-cliques, not one 467-node clique.${k5ExampleNames.length ? ` Community 3 also includes ${k5ExampleNames.join(", ")}.` : ""}`,
    ].forEach(text => evidence.appendChild(createElement("li", text)));
    interpretation.textContent = "The evidence supports a structural reading of Aristotle as a hub whose links participate in one dominant edge group and many smaller groups; the selected clique threshold changes which shared-neighbourhood clusters are visible. Neither result identifies a philosophical tradition. Wikipedia links reflect editorial and citation relationships, and the graph alone cannot establish philosophical identity or intellectual agreement.";
  }

  function render() {
    computeView();
    updateCommunityOptions();
    updateMetrics();
    updateMembers();
    updateDetail();
    updateMethodNote();
    draw();
  }

  function selectNode(node, focus = false) {
    selectedNode = node;
    if (!currentMemberships(node).includes(selectedCommunity)) selectedCommunity = null;
    viewMode = "ego";
    viewSelect.value = viewMode;
    search.value = node.name;
    tooltip.style.display = "none";
    if (focus) d3.select(canvas).transition().duration(180).call(zoom.transform, d3.zoomIdentity);
    render();
  }

  function searchForNode() {
    const query = normalize(search.value);
    if (!query) return;
    const exact = nodesByName.get(query);
    const partial = nodes.find(node => normalize(node.name).includes(query));
    if (exact || partial) selectNode(exact ?? partial, true);
  }

  function resize() {
    const bounds = canvas.getBoundingClientRect();
    width = Math.max(1, bounds.width);
    height = Math.max(1, bounds.height);
    pixelRatio = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * pixelRatio);
    canvas.height = Math.round(height * pixelRatio);
    computeView();
    draw();
  }

  function pointSegmentDistance(point, start, end) {
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const lengthSquared = dx * dx + dy * dy;
    const ratio = lengthSquared
      ? Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared))
      : 0;
    return Math.hypot(point[0] - start[0] - ratio * dx, point[1] - start[1] - ratio * dy);
  }

  function showTooltip(text, event) {
    tooltip.textContent = text;
    tooltip.style.display = "block";
    const bounds = stage.getBoundingClientRect();
    tooltip.style.left = `${Math.min(event.clientX - bounds.left + 12, bounds.width - tooltip.offsetWidth - 8)}px`;
    tooltip.style.top = `${Math.max(42, event.clientY - bounds.top + 12)}px`;
  }

  const zoom = d3.zoom().scaleExtent([.7, 6]).on("zoom", event => {
    transform = event.transform;
    draw();
  });
  d3.select(canvas).call(zoom).on("dblclick.zoom", null);
  canvas.addEventListener("mousemove", event => {
    const bounds = canvas.getBoundingClientRect();
    const point = [(event.clientX - bounds.left - transform.x) / transform.k, (event.clientY - bounds.top - transform.y) / transform.k];
    let hoveredNode = null;
    positions.forEach((position, index) => {
      if (Math.hypot(point[0] - position[0], point[1] - position[1]) < (index === selectedNode.index ? 9 : 7) / transform.k) {
        hoveredNode = nodes[index];
      }
    });
    if (hoveredNode) {
      canvas.style.cursor = "pointer";
      showTooltip(`${hoveredNode.name}\nClick to show this philosopher’s direct connections.`, event);
      return;
    }
    let hoveredEdge = null;
    let nearestDistance = 6 / transform.k;
    visibleEdges.forEach(edge => {
      const geometry = edgeGeometry(edge);
      if (!geometry) return;
      const samples = [];
      for (let step = 0; step <= 12; step += 1) {
        const t = step / 12;
        const oneMinusT = 1 - t;
        samples.push(geometry.control
          ? [
            oneMinusT * oneMinusT * geometry.source[0] +
              2 * oneMinusT * t * geometry.control[0] + t * t * geometry.target[0],
            oneMinusT * oneMinusT * geometry.source[1] +
              2 * oneMinusT * t * geometry.control[1] + t * t * geometry.target[1],
          ]
          : [
            oneMinusT * geometry.source[0] + t * geometry.target[0],
            oneMinusT * geometry.source[1] + t * geometry.target[1],
          ]);
      }
      let distance = Infinity;
      for (let pointIndex = 1; pointIndex < samples.length; pointIndex += 1) {
        distance = Math.min(
          distance,
          pointSegmentDistance(point, samples[pointIndex - 1], samples[pointIndex]),
        );
      }
      if (distance < nearestDistance) {
        nearestDistance = distance;
        hoveredEdge = edge;
      }
    });
    if (hoveredEdge) {
      canvas.style.cursor = "help";
      showTooltip(`${nodes[hoveredEdge.source].name} → ${nodes[hoveredEdge.target].name}\nDirection: source article → target article\nWeight: ${format(hoveredEdge.weight)}\nLink community: ${hoveredEdge.community}`, event);
    } else {
      canvas.style.cursor = "grab";
      tooltip.style.display = "none";
    }
  });
  canvas.addEventListener("mouseleave", () => { tooltip.style.display = "none"; });
  canvas.addEventListener("click", event => {
    if (event.defaultPrevented) return;
    const bounds = canvas.getBoundingClientRect();
    const point = [(event.clientX - bounds.left - transform.x) / transform.k, (event.clientY - bounds.top - transform.y) / transform.k];
    let nearest = null;
    let distance = 9 / transform.k;
    positions.forEach((position, index) => {
      const candidate = Math.hypot(point[0] - position[0], point[1] - position[1]);
      if (candidate < distance) {
        distance = candidate;
        nearest = nodes[index];
      }
    });
    if (nearest && nearest.index !== selectedNode.index) selectNode(nearest);
  });

  nodes.slice().sort((left, right) => left.name.localeCompare(right.name)).forEach(node => {
    const option = document.createElement("option");
    option.value = node.name;
    options.appendChild(option);
  });
  kValues.forEach(value => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = `k = ${value}`;
    kSelect.appendChild(option);
  });
  kSelect.value = k;
  methodSelect.addEventListener("change", () => {
    method = methodSelect.value;
    kControl.hidden = method !== "clique";
    selectedCommunity = null;
    viewMode = "ego";
    viewSelect.value = viewMode;
    render();
  });
  kSelect.addEventListener("change", () => {
    if (!kValues.includes(kSelect.value)) return;
    k = kSelect.value;
    selectedCommunity = null;
    viewMode = "ego";
    viewSelect.value = viewMode;
    render();
  });
  communitySelect.addEventListener("change", () => {
    selectedCommunity = communitySelect.value ? Number(communitySelect.value) : null;
    viewMode = selectedCommunity === null ? "ego" : "full";
    viewSelect.value = viewMode;
    render();
  });
  viewSelect.addEventListener("change", () => {
    viewMode = viewSelect.value;
    render();
  });
  search.addEventListener("change", searchForNode);
  search.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      searchForNode();
    }
  });
  $("#case-reset").addEventListener("click", () => {
    methodSelect.value = "link";
    method = "link";
    kControl.hidden = true;
    k = kValues[kValues.length - 1];
    kSelect.value = k;
    selectedCommunity = null;
    viewMode = "ego";
    viewSelect.value = viewMode;
    selectNode(nodes[caseData.aristotle_index], true);
  });
  window.addEventListener("resize", resize);
  resize();
  render();
  updateCaseEvidence();
}

async function initBackboneExplorer() {
  const response = await fetch("../data/week4_backbone.json");
  if (!response.ok) throw new Error(`HTTP ${response.status} while loading disparity scores`);
  const data = await response.json();
  const originalCanvas = $("#backbone-original");
  const filteredCanvas = $("#backbone-filtered");
  const originalContext = originalCanvas.getContext("2d");
  const filteredContext = filteredCanvas.getContext("2d");
  const alphaSlider = $("#backbone-alpha");
  const alphaValue = $("#backbone-alpha-value");
  const search = $("#backbone-search");
  const options = $("#backbone-options");
  const detail = $("#backbone-detail");
  const metrics = $("#backbone-metrics");
  const selectionMetrics = $("#backbone-selection-metrics");
  const methodNote = $("#backbone-method-note");
  const canvases = [originalCanvas, filteredCanvas];
  const contexts = [originalContext, filteredContext];
  const nodes = data.nodes.map((node, index) => ({ ...node, index }));
  const nodesByName = new Map(nodes.map(node => [normalize(node.name), node]));
  const nodeIndexById = new Map(nodes.map(node => [node.id, node.index]));
  const edges = data.edges.map(edge => ({
    ...edge,
    source: nodeIndexById.get(edge.source),
    target: nodeIndexById.get(edge.target),
  }));
  const directedPairs = new Set(edges.map(edge => `${edge.source}:${edge.target}`));
  const outgoing = nodes.map(() => []);
  const incoming = nodes.map(() => []);
  edges.forEach(edge => {
    outgoing[edge.source].push(edge);
    incoming[edge.target].push(edge);
  });
  let alpha = Number(alphaSlider.value);
  let selectedNode = null;
  let sizes = canvases.map(() => ({ width: 0, height: 0, pixelRatio: 1 }));
  let transform = d3.zoomIdentity;
  let syncingZoom = false;

  function isRetained(edge) {
    return edge.alpha <= alpha;
  }

  function coordinate(node, viewSize) {
    return [node.x * viewSize.width, node.y * viewSize.height];
  }

  function edgeGeometry(edge, viewSize) {
    const source = nodes[edge.source];
    const target = nodes[edge.target];
    const [x1, y1] = coordinate(source, viewSize);
    const [x2, y2] = coordinate(target, viewSize);
    const reciprocal = directedPairs.has(`${edge.target}:${edge.source}`);
    if (!reciprocal) return { source: [x1, y1], target: [x2, y2], control: null };
    const dx = x2 - x1;
    const dy = y2 - y1;
    const distance = Math.hypot(dx, dy);
    if (!distance) return { source: [x1, y1], target: [x2, y2], control: null };
    const side = edge.source < edge.target ? 1 : -1;
    const offset = Math.min(12, Math.max(5, distance * .07));
    return {
      source: [x1, y1],
      target: [x2, y2],
      control: [
        (x1 + x2) / 2 - dy / distance * offset * side,
        (y1 + y2) / 2 + dx / distance * offset * side,
      ],
    };
  }

  function drawArrow(context, geometry, color) {
    const { source, target, control } = geometry;
    const tangent = control
      ? [target[0] - control[0], target[1] - control[1]]
      : [target[0] - source[0], target[1] - source[1]];
    const angle = Math.atan2(tangent[1], tangent[0]);
    const tipX = target[0] - Math.cos(angle) * 4 / transform.k;
    const tipY = target[1] - Math.sin(angle) * 4 / transform.k;
    const length = 5 / transform.k;
    context.beginPath();
    context.moveTo(tipX, tipY);
    context.lineTo(tipX - length * Math.cos(angle - Math.PI / 6), tipY - length * Math.sin(angle - Math.PI / 6));
    context.lineTo(tipX - length * Math.cos(angle + Math.PI / 6), tipY - length * Math.sin(angle + Math.PI / 6));
    context.closePath();
    context.fillStyle = color;
    context.fill();
  }

  function drawView(viewIndex) {
    const context = contexts[viewIndex];
    const viewSize = sizes[viewIndex];
    if (!viewSize.width || !viewSize.height) return;
    context.setTransform(viewSize.pixelRatio, 0, 0, viewSize.pixelRatio, 0, 0);
    context.clearRect(0, 0, viewSize.width, viewSize.height);
    context.fillStyle = "#0d0a12";
    context.fillRect(0, 0, viewSize.width, viewSize.height);
    context.save();
    context.translate(transform.x, transform.y);
    context.scale(transform.k, transform.k);
    edges.forEach(edge => {
      const retained = isRetained(edge);
      if (viewIndex === 1 && !retained) return;
      const geometry = edgeGeometry(edge, viewSize);
      const incident = selectedNode !== null &&
        (edge.source === selectedNode || edge.target === selectedNode);
      const incomingEdge = incident && edge.target === selectedNode;
      const directionColor = incomingEdge ? "#85b8ff" : "#e84e83";
      context.globalAlpha = incident
        ? retained ? .96 : .48
        : viewIndex === 1 ? .39 : retained ? .2 : .045;
      context.strokeStyle = incident ? directionColor : "#bd7dff";
      context.lineWidth = (.25 + Math.log1p(edge.weight) * .095) / transform.k;
      context.setLineDash(viewIndex === 0 && !retained
        ? [3 / transform.k, 3 / transform.k]
        : []);
      context.beginPath();
      context.moveTo(geometry.source[0], geometry.source[1]);
      if (geometry.control) {
        context.quadraticCurveTo(
          geometry.control[0], geometry.control[1], geometry.target[0], geometry.target[1],
        );
      } else {
        context.lineTo(geometry.target[0], geometry.target[1]);
      }
      context.stroke();
      context.setLineDash([]);
      if (incident) drawArrow(context, geometry, directionColor);
    });
    nodes.forEach(node => {
      const [x, y] = coordinate(node, viewSize);
      const selected = node.index === selectedNode;
      const retainedDegree = outgoing[node.index].filter(isRetained).length +
        incoming[node.index].filter(isRetained).length;
      context.globalAlpha = selected ? 1 : viewIndex === 1 && retainedDegree === 0 ? .15 : .72;
      context.fillStyle = selected ? "#f2eaf5" : retainedDegree ? "#bd7dff" : "#81738a";
      const radius = selected ? 4.5 / transform.k : 1.55 / transform.k;
      if (node.isolated) {
        context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
      } else {
        context.beginPath();
        context.arc(x, y, radius, 0, Math.PI * 2);
        context.fill();
      }
      if (selected) {
        context.beginPath();
        context.arc(x, y, 7 / transform.k, 0, Math.PI * 2);
        context.strokeStyle = "#e84e83";
        context.lineWidth = 1.2 / transform.k;
        context.stroke();
      }
    });
    context.globalAlpha = 1;
    context.restore();
  }

  function draw() {
    drawView(0);
    drawView(1);
  }

  function weakComponentStats(retainedEdges) {
    const parent = nodes.map((_, index) => index);
    const sizesByRoot = new Uint32Array(nodes.length);
    nodes.forEach((_, index) => { sizesByRoot[index] = 1; });
    function find(index) {
      while (parent[index] !== index) {
        parent[index] = parent[parent[index]];
        index = parent[index];
      }
      return index;
    }
    retainedEdges.forEach(edge => {
      let sourceRoot = find(edge.source);
      let targetRoot = find(edge.target);
      if (sourceRoot === targetRoot) return;
      if (sizesByRoot[sourceRoot] < sizesByRoot[targetRoot]) {
        [sourceRoot, targetRoot] = [targetRoot, sourceRoot];
      }
      parent[targetRoot] = sourceRoot;
      sizesByRoot[sourceRoot] += sizesByRoot[targetRoot];
    });
    const componentSizes = new Map();
    nodes.forEach((_, index) => {
      const root = find(index);
      componentSizes.set(root, (componentSizes.get(root) ?? 0) + 1);
    });
    const sizes = [...componentSizes.values()];
    return {
      count: sizes.length,
      largest: Math.max(...sizes),
      isolates: sizes.filter(size => size === 1).length,
    };
  }

  function metric(value, label) {
    const tile = createElement("div", undefined, "metric-tile");
    tile.append(
      createElement("span", value, "metric-value"),
      createElement("span", label, "metric-label"),
    );
    return tile;
  }

  function renderMetrics() {
    const retainedEdges = edges.filter(isRetained);
    const originalComponents = weakComponentStats(edges);
    const backboneComponents = weakComponentStats(retainedEdges);
    const retainedPercent = (100 * retainedEdges.length / edges.length).toFixed(1);
    metrics.replaceChildren(
      metric(`${format(retainedEdges.length)} / ${format(edges.length)}`, `${retainedPercent}% directed arcs retained`),
      metric(format(alpha), "disparity significance α"),
      metric(`${format(originalComponents.count)} → ${format(backboneComponents.count)}`, "weak components · original → backbone"),
      metric(`${format(originalComponents.largest)} → ${format(backboneComponents.largest)}`, `largest weak component · backbone isolates ${format(backboneComponents.isolates)}`),
    );
  }

  function renderDetail() {
    if (selectedNode === null) {
      detail.replaceChildren(
        createElement("h3", "Choose a philosopher"),
        createElement("p", "Search for a name or click either network to compare which of their incoming and outgoing connections survive."),
      );
      selectionMetrics.replaceChildren(
        metric("—", "incoming directed arcs retained / total"),
        metric("—", "outgoing directed arcs retained / total"),
      );
      return;
    }
    const node = nodes[selectedNode];
    const inRetained = incoming[selectedNode].filter(isRetained);
    const outRetained = outgoing[selectedNode].filter(isRetained);
    selectionMetrics.replaceChildren(
      metric(
        `${format(inRetained.length)} / ${format(incoming[selectedNode].length)}`,
        "incoming directed arcs retained / total",
      ),
      metric(
        `${format(outRetained.length)} / ${format(outgoing[selectedNode].length)}`,
        "outgoing directed arcs retained / total",
      ),
    );
    const heading = createElement("h3", node.name);
    const link = createElement("a", "Open the Wikipedia article");
    link.href = node.url;
    link.target = "_blank";
    link.rel = "noopener";
    const connectionLine = createElement(
      "p",
      `${format(inRetained.length)} / ${format(incoming[selectedNode].length)} incoming and ${format(outRetained.length)} / ${format(outgoing[selectedNode].length)} outgoing arcs retained at α=${alpha.toFixed(3)}.`,
    );
    const retained = [];
    const excluded = [];
    [...incoming[selectedNode], ...outgoing[selectedNode]].forEach(edge => {
      const description = edge.source === selectedNode
        ? `${node.name} → ${nodes[edge.target].name} · weight ${format(edge.weight)} · α* ${edge.alpha.toPrecision(3)}`
        : `${nodes[edge.source].name} → ${node.name} · weight ${format(edge.weight)} · α* ${edge.alpha.toPrecision(3)}`;
      (isRetained(edge) ? retained : excluded).push(description);
    });
    const list = createElement("p", undefined, "backbone-neighbours");
    list.textContent = `RETAINED (${retained.length})\n${retained.slice(0, 18).join("\n") || "None"}${retained.length > 18 ? "\n…" : ""}\n\nNOT RETAINED (${excluded.length})\n${excluded.slice(0, 18).join("\n") || "None"}${excluded.length > 18 ? "\n…" : ""}`;
    detail.replaceChildren(heading, link, connectionLine, list);
  }

  function render() {
    alpha = Number(alphaSlider.value);
    alphaValue.textContent = alpha.toFixed(3);
    renderMetrics();
    renderDetail();
    draw();
  }

  function selectNode(node) {
    selectedNode = node.index;
    search.value = node.name;
    render();
  }

  function searchForNode() {
    const query = normalize(search.value);
    if (!query) return;
    const exact = nodesByName.get(query);
    const partial = nodes.find(node => normalize(node.name).includes(query));
    if (exact || partial) selectNode(exact ?? partial);
  }

  function resize(index) {
    const canvas = canvases[index];
    const bounds = canvas.getBoundingClientRect();
    sizes[index] = {
      width: Math.max(1, bounds.width),
      height: Math.max(1, bounds.height),
      pixelRatio: window.devicePixelRatio || 1,
    };
    canvas.width = Math.round(sizes[index].width * sizes[index].pixelRatio);
    canvas.height = Math.round(sizes[index].height * sizes[index].pixelRatio);
    draw();
  }

  function pointToNetwork(event, canvas, viewSize) {
    const bounds = canvas.getBoundingClientRect();
    return [
      (event.clientX - bounds.left - transform.x) / transform.k / viewSize.width,
      (event.clientY - bounds.top - transform.y) / transform.k / viewSize.height,
    ];
  }

  canvases.forEach((canvas, viewIndex) => {
    const zoom = d3.zoom().scaleExtent([.65, 8]).on("zoom", event => {
      transform = event.transform;
      draw();
      if (syncingZoom) return;
      syncingZoom = true;
      const otherCanvas = canvases[1 - viewIndex];
      d3.select(otherCanvas).call(zoom.transform, transform);
      syncingZoom = false;
    });
    d3.select(canvas).call(zoom).on("dblclick.zoom", null);
    canvas.addEventListener("click", event => {
      if (event.defaultPrevented) return;
      const [x, y] = pointToNetwork(event, canvas, sizes[viewIndex]);
      let nearest = null;
      let nearestDistance = .012 / transform.k;
      nodes.forEach(node => {
        const distance = Math.hypot(node.x - x, node.y - y);
        if (distance < nearestDistance) {
          nearest = node;
          nearestDistance = distance;
        }
      });
      if (nearest) selectNode(nearest);
    });
  });

  nodes.slice().sort((left, right) => left.name.localeCompare(right.name)).forEach(node => {
    const option = document.createElement("option");
    option.value = node.name;
    options.appendChild(option);
  });
  search.addEventListener("change", searchForNode);
  search.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      searchForNode();
    }
  });
  alphaSlider.addEventListener("input", render);
  $("#backbone-reset").addEventListener("click", () => {
    selectedNode = null;
    search.value = "";
    render();
  });
  methodNote.textContent = `${data.meta.method}. ${data.meta.parameter} ${data.meta.directionality} ${data.meta.null_model} ${data.meta.interpretation}`;
  window.addEventListener("resize", () => canvases.forEach((_, index) => resize(index)));
  canvases.forEach((_, index) => resize(index));
  render();
}

async function initWeightComparisonLegacy() {
  const response = await fetch("../data/week4_weight_comparison.json");
  if (!response.ok) throw new Error(`HTTP ${response.status} while loading weight comparison`);
  const data = await response.json();
  const canvas = $("#weight-network");
  const context = canvas.getContext("2d");
  const metrics = $("#weight-metrics");
  const detail = $("#weight-detail");
  const dataNote = $("#weight-data-note");
  const methodNote = $("#weight-method-note");
  const search = $("#weight-search");
  const options = $("#weight-options");
  const weightedButton = $("#weight-mode-weighted");
  const unweightedButton = $("#weight-mode-unweighted");
  const nodes = data.nodes.map((node, index) => ({ ...node, index }));
  const edges = data.edges.map(edge => ({ ...edge }));
  const nodesByName = new Map(nodes.map(node => [normalize(node.name), node]));
  const outgoing = nodes.map(() => []);
  const incoming = nodes.map(() => []);
  const directedPairs = new Set();
  edges.forEach(edge => {
    outgoing[edge.source].push(edge);
    incoming[edge.target].push(edge);
    directedPairs.add(`${edge.source}:${edge.target}`);
  });
  const weightedCommunityCount = data.stats.weighted_communities;
  const unweightedCommunityCount = data.stats.unweighted_communities;
  const colorScales = {
    weighted: d3.scaleSequential(d3.interpolateSinebow)
      .domain([1, Math.max(2, weightedCommunityCount)]),
    unweighted: d3.scaleSequential(d3.interpolateSinebow)
      .domain([1, Math.max(2, unweightedCommunityCount)]),
  };
  let mode = "weighted";
  let selectedNode = nodes.find(node => normalize(node.name) === "aristotle")?.index ?? null;
  let width = 0;
  let height = 0;
  let pixelRatio = 1;
  let transform = d3.zoomIdentity;

  function activeCommunity(node) {
    return node[`${mode}_community`];
  }

  function coordinate(node) {
    return [node.x * width, node.y * height];
  }

  function edgeGeometry(edge) {
    const source = nodes[edge.source];
    const target = nodes[edge.target];
    const sourcePoint = coordinate(source);
    const targetPoint = coordinate(target);
    if (!directedPairs.has(`${edge.target}:${edge.source}`)) {
      return { source: sourcePoint, target: targetPoint, control: null };
    }
    const dx = targetPoint[0] - sourcePoint[0];
    const dy = targetPoint[1] - sourcePoint[1];
    const distance = Math.hypot(dx, dy);
    if (!distance) return { source: sourcePoint, target: targetPoint, control: null };
    const side = edge.source < edge.target ? 1 : -1;
    const offset = Math.min(11, Math.max(4, distance * .055));
    return {
      source: sourcePoint,
      target: targetPoint,
      control: [
        (sourcePoint[0] + targetPoint[0]) / 2 - dy / distance * offset * side,
        (sourcePoint[1] + targetPoint[1]) / 2 + dx / distance * offset * side,
      ],
    };
  }

  function drawArrow(geometry, color) {
    const { source, target, control } = geometry;
    const tangent = control
      ? [target[0] - control[0], target[1] - control[1]]
      : [target[0] - source[0], target[1] - source[1]];
    const angle = Math.atan2(tangent[1], tangent[0]);
    const tipX = target[0] - Math.cos(angle) * 4 / transform.k;
    const tipY = target[1] - Math.sin(angle) * 4 / transform.k;
    const length = 5 / transform.k;
    context.beginPath();
    context.moveTo(tipX, tipY);
    context.lineTo(tipX - length * Math.cos(angle - Math.PI / 6), tipY - length * Math.sin(angle - Math.PI / 6));
    context.lineTo(tipX - length * Math.cos(angle + Math.PI / 6), tipY - length * Math.sin(angle + Math.PI / 6));
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
    edges.forEach(edge => {
      const geometry = edgeGeometry(edge);
      const selectedEdge = selectedNode !== null &&
        (edge.source === selectedNode || edge.target === selectedNode);
      const directionColor = edge.target === selectedNode ? "#85b8ff" : "#e84e83";
      context.globalAlpha = selectedEdge ? .96 : .12;
      context.strokeStyle = selectedEdge
        ? directionColor
        : colorScales[mode](activeCommunity(nodes[edge.source]));
      context.lineWidth = (mode === "weighted"
        ? .25 + Math.log1p(edge.weight) * .20
        : .35) / transform.k;
      context.beginPath();
      context.moveTo(geometry.source[0], geometry.source[1]);
      if (geometry.control) {
        context.quadraticCurveTo(
          geometry.control[0], geometry.control[1], geometry.target[0], geometry.target[1],
        );
      } else {
        context.lineTo(geometry.target[0], geometry.target[1]);
      }
      context.stroke();
      if (selectedEdge) drawArrow(geometry, directionColor);
    });
    nodes.forEach(node => {
      const [x, y] = coordinate(node);
      const selected = node.index === selectedNode;
      context.globalAlpha = selected ? 1 : .78;
      context.fillStyle = colorScales[mode](activeCommunity(node));
      context.beginPath();
      context.arc(x, y, (selected ? 4.7 : 1.65) / transform.k, 0, Math.PI * 2);
      context.fill();
      if (node.changed) {
        context.beginPath();
        context.arc(x, y, (selected ? 7 : 3.1) / transform.k, 0, Math.PI * 2);
        context.strokeStyle = selected ? "#f2eaf5" : "#e84e83";
        context.lineWidth = 1 / transform.k;
        context.stroke();
      }
    });
    context.globalAlpha = 1;
    context.restore();
  }

  function metric(value, label) {
    const tile = createElement("div", undefined, "metric-tile");
    tile.append(
      createElement("span", value, "metric-value"),
      createElement("span", label, "metric-label"),
    );
    return tile;
  }

  function renderMetrics() {
    metrics.replaceChildren(
      metric(
        `${format(data.stats.weighted_communities)} → ${format(data.stats.unweighted_communities)}`,
        "weighted → unweighted communities",
      ),
      metric(
        `${data.stats.weighted_modularity.toFixed(3)} → ${data.stats.unweighted_modularity.toFixed(3)}`,
        "modularity · each graph’s own weights",
      ),
      metric(data.stats.nmi.toFixed(3), `partition NMI · same ${format(data.stats.nodes)} philosophers`),
      metric(
        `${format(data.stats.changed_nodes)} / ${format(data.stats.nodes)}`,
        "nodes reassigned after best-overlap alignment",
      ),
    );
  }

  function renderDetail() {
    if (selectedNode === null) {
      detail.replaceChildren(
        createElement("h3", "Choose a philosopher"),
        createElement("p", "Search for a name or click a node to inspect its incoming and outgoing article links."),
      );
      return;
    }
    const node = nodes[selectedNode];
    const inEdges = incoming[selectedNode];
    const outEdges = outgoing[selectedNode];
    const inWeight = inEdges.reduce((sum, edge) => sum + edge.weight, 0);
    const outWeight = outEdges.reduce((sum, edge) => sum + edge.weight, 0);
    const heading = createElement("h3", node.name);
    const articleLink = createElement("a", "Open the Wikipedia article");
    articleLink.href = node.url;
    articleLink.target = "_blank";
    articleLink.rel = "noopener";
    const weightedCommunity = node.weighted_community;
    const unweightedCommunity = node.unweighted_community;
    const changedText = node.changed
      ? `This philosopher changes community: weighted ${weightedCommunity} → unweighted ${unweightedCommunity}.`
      : `This philosopher remains in community ${weightedCommunity} in both views.`;
    const measureText = mode === "weighted"
      ? `Directed article arcs: ${format(inEdges.length)} incoming / ${format(outEdges.length)} outgoing. Summed incident weights: ${format(inWeight)} incoming / ${format(outWeight)} outgoing.`
      : `Directed connections: ${format(inEdges.length)} incoming / ${format(outEdges.length)} outgoing (each distinct source–target pair counts once). Corresponding article-link weights: ${format(inWeight)} incoming / ${format(outWeight)} outgoing.`;
    const edgeLines = [];
    inEdges.slice().sort((left, right) => right.weight - left.weight).slice(0, 18)
      .forEach(edge => edgeLines.push(
        `${nodes[edge.source].name} → ${node.name} · source weight ${format(edge.weight)}`,
      ));
    outEdges.slice().sort((left, right) => right.weight - left.weight).slice(0, 18)
      .forEach(edge => edgeLines.push(
        `${node.name} → ${nodes[edge.target].name} · source weight ${format(edge.weight)}`,
      ));
    const list = createElement("p", undefined, "weight-edge-list");
    list.textContent = `${edgeLines.join("\n")}${inEdges.length + outEdges.length > 36 ? "\n…showing up to 18 incoming and 18 outgoing arcs" : ""}`;
    detail.replaceChildren(
      heading,
      articleLink,
      createElement("p", changedText),
      createElement("p", `Active ${mode} Louvain community: ${activeCommunity(node)}.`),
      createElement("p", measureText),
      list,
    );
  }

  function setMode(nextMode) {
    mode = nextMode;
    weightedButton.classList.toggle("is-active", mode === "weighted");
    weightedButton.setAttribute("aria-pressed", String(mode === "weighted"));
    unweightedButton.classList.toggle("is-active", mode === "unweighted");
    unweightedButton.setAttribute("aria-pressed", String(mode === "unweighted"));
    renderMetrics();
    renderDetail();
    draw();
  }

  function selectNode(node) {
    selectedNode = node.index;
    search.value = node.name;
    renderDetail();
    draw();
  }

  function searchForNode() {
    const query = normalize(search.value);
    if (!query) return;
    const exact = nodesByName.get(query);
    const partial = nodes.find(node => normalize(node.name).includes(query));
    if (exact || partial) selectNode(exact ?? partial);
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

  const zoom = d3.zoom().scaleExtent([.65, 8]).on("zoom", event => {
    transform = event.transform;
    draw();
  });
  d3.select(canvas).call(zoom).on("dblclick.zoom", null);
  canvas.addEventListener("click", event => {
    if (event.defaultPrevented) return;
    const bounds = canvas.getBoundingClientRect();
    const point = [
      (event.clientX - bounds.left - transform.x) / transform.k,
      (event.clientY - bounds.top - transform.y) / transform.k,
    ];
    let nearest = null;
    let nearestDistance = 9 / transform.k;
    nodes.forEach(node => {
      const [x, y] = coordinate(node);
      const distance = Math.hypot(point[0] - x, point[1] - y);
      if (distance < nearestDistance) {
        nearest = node;
        nearestDistance = distance;
      }
    });
    if (nearest) selectNode(nearest);
  });
  search.addEventListener("change", searchForNode);
  search.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      searchForNode();
    }
  });
  weightedButton.addEventListener("click", () => setMode("weighted"));
  unweightedButton.addEventListener("click", () => setMode("unweighted"));
  $("#weight-reset").addEventListener("click", () => {
    selectedNode = null;
    search.value = "";
    renderDetail();
    draw();
  });
  nodes.slice().sort((left, right) => left.name.localeCompare(right.name)).forEach(node => {
    const option = document.createElement("option");
    option.value = node.name;
    options.appendChild(option);
  });
  const audit = data.meta.weighted_file_audit;
  dataNote.textContent = audit.matches_philosopher_node_set
    ? `${audit.path} was verified against the philosopher node list (${format(audit.endpoint_count)} endpoints).`
    : `${audit.path} does not describe this philosophers graph: it has ${format(audit.endpoint_count)} endpoints and only ${format(audit.overlap_with_philosopher_nodes)} match the ${format(data.stats.nodes)} philosopher nodes. Its header identifies a separate Week 1 snapshot, so its weights are excluded; both views use the philosopher edge TSV and the notebook's duplicate-summing pipeline.`;
  methodNote.textContent = `${data.meta.method}. ${data.meta.preprocessing} ${data.meta.comparison} ${data.meta.interpretation}`;
  window.addEventListener("resize", resize);
  resize();
  setMode("weighted");
}

async function initWeightPartitionComparison() {
  const response = await fetch("../data/week4_partition_comparison.json");
  if (!response.ok) throw new Error(`HTTP ${response.status} while loading partition comparison`);
  const data = await response.json();
  const algorithmSelect = $("#weight-algorithm");
  const search = $("#weight-search");
  const options = $("#weight-options");
  const changedOnly = $("#weight-changed-only");
  const tableBody = $("#weight-rows");
  const tableCount = $("#weight-table-count");
  const metrics = $("#weight-metrics");
  const detail = $("#weight-detail");
  const interpretation = $("#weight-interpretation");
  const methodNote = $("#weight-method-note");
  const canvases = [
    $("#weight-unweighted-network"),
    $("#weight-weighted-network"),
  ];
  const contexts = canvases.map(canvas => canvas.getContext("2d"));
  const communitySelects = [
    $("#weight-unweighted-community"),
    $("#weight-weighted-community"),
  ];
  const memberLists = [
    $("#weight-unweighted-members"),
    $("#weight-weighted-members"),
  ];
  const sizeNotes = [
    $("#weight-unweighted-sizes"),
    $("#weight-weighted-sizes"),
  ];
  const nodes = data.nodes.map((node, index) => ({ ...node, index }));
  const edges = data.edges;
  const nodesByName = new Map(nodes.map(node => [normalize(node.name), node]));
  const directedPairs = new Set(edges.map(edge => `${edge.source}:${edge.target}`));
  const adjacency = nodes.map(() => new Set());
  edges.forEach(edge => {
    adjacency[edge.source].add(edge.target);
    adjacency[edge.target].add(edge.source);
  });
  const partitions = data.partitions;
  const viewNames = ["unweighted", "weighted"];
  const selectedCommunities = [null, null];
  const communityColors = {};
  let algorithm = algorithmSelect.value || "louvain";
  let selectedNode = null;
  let sizes = canvases.map(() => ({ width: 0, height: 0, pixelRatio: 1 }));
  let transform = d3.zoomIdentity;

  for (const method of ["louvain", "infomap"]) {
    for (const view of viewNames) {
      communityColors[`${method}-${view}`] = new Map(
        partitions[method][view].communities.map(({ id }) => [
          id,
          `hsl(${(((id - 1) * PARTITION_GOLDEN_ANGLE) + (method === "infomap" ? 43 : 0) + (view === "weighted" ? 91 : 0)) % 360} 86% ${[60, 70, 52, 76][(id - 1) % 4]}%)`,
        ]),
      );
    }
  }

  function partition(view) {
    return partitions[algorithm][view];
  }

  function communityOf(nodeIndex, view) {
    return partition(view).assignments[nodeIndex];
  }

  function communityMembers(view, communityId) {
    return nodes.filter(node => communityOf(node.index, view) === communityId);
  }

  function coordinate(node, viewIndex) {
    return [node.x * sizes[viewIndex].width, node.y * sizes[viewIndex].height];
  }

  function edgeCurve(edge, viewIndex) {
    const source = coordinate(nodes[edge.source], viewIndex);
    const target = coordinate(nodes[edge.target], viewIndex);
    if (!directedPairs.has(`${edge.target}:${edge.source}`)) {
      return { source, target, control: null };
    }
    const dx = target[0] - source[0];
    const dy = target[1] - source[1];
    const distance = Math.hypot(dx, dy);
    if (!distance) return { source, target, control: null };
    const direction = edge.source < edge.target ? 1 : -1;
    const offset = Math.min(9, Math.max(3, distance * .045));
    return {
      source,
      target,
      control: [
        (source[0] + target[0]) / 2 - dy / distance * offset * direction,
        (source[1] + target[1]) / 2 + dx / distance * offset * direction,
      ],
    };
  }

  function drawArrow(context, geometry) {
    const tangent = geometry.control
      ? [geometry.target[0] - geometry.control[0], geometry.target[1] - geometry.control[1]]
      : [geometry.target[0] - geometry.source[0], geometry.target[1] - geometry.source[1]];
    const angle = Math.atan2(tangent[1], tangent[0]);
    const tip = [
      geometry.target[0] - Math.cos(angle) * 3.3,
      geometry.target[1] - Math.sin(angle) * 3.3,
    ];
    context.beginPath();
    context.moveTo(tip[0], tip[1]);
    context.lineTo(tip[0] - 4 * Math.cos(angle - Math.PI / 6), tip[1] - 4 * Math.sin(angle - Math.PI / 6));
    context.lineTo(tip[0] - 4 * Math.cos(angle + Math.PI / 6), tip[1] - 4 * Math.sin(angle + Math.PI / 6));
    context.closePath();
    context.fill();
  }

  function drawView(viewIndex) {
    const context = contexts[viewIndex];
    const view = viewNames[viewIndex];
    const viewSize = sizes[viewIndex];
    if (!viewSize.width || !viewSize.height) return;
    context.setTransform(viewSize.pixelRatio, 0, 0, viewSize.pixelRatio, 0, 0);
    context.clearRect(0, 0, viewSize.width, viewSize.height);
    context.fillStyle = "#0d0a12";
    context.fillRect(0, 0, viewSize.width, viewSize.height);
    context.save();
    context.translate(transform.x, transform.y);
    context.scale(transform.k, transform.k);
    const selectedCommunity = selectedCommunities[viewIndex];
    const changedNodes = new Set(data.stats.comparisons[algorithm].changed_indices);
    const members = selectedCommunity === null
      ? null
      : new Set(communityMembers(view, selectedCommunity).map(node => node.index));
    const hasHighlight = selectedNode !== null || members !== null;
    edges.forEach(edge => {
      const incident = selectedNode !== null &&
        (edge.source === selectedNode || edge.target === selectedNode);
      const inCommunity = members !== null && members.has(edge.source) && members.has(edge.target);
      const hasChangedEndpoint = changedNodes.has(edge.source) || changedNodes.has(edge.target);
      const geometry = edgeCurve(edge, viewIndex);
      context.globalAlpha = incident ? 1
        : changedOnly.checked ? hasChangedEndpoint ? .62 : .025
          : inCommunity ? .95 : hasHighlight ? .025 : .2;
      context.strokeStyle = incident
        ? edge.target === selectedNode ? "#85b8ff" : "#e84e83"
        : communityColors[`${algorithm}-${view}`].get(communityOf(edge.source, view));
      context.lineWidth = (
        view === "weighted" ? .35 + Math.log1p(edge.weight) * .17 : .35
      ) / transform.k;
      context.beginPath();
      context.moveTo(geometry.source[0], geometry.source[1]);
      if (geometry.control) {
        context.quadraticCurveTo(
          geometry.control[0], geometry.control[1], geometry.target[0], geometry.target[1],
        );
      } else {
        context.lineTo(geometry.target[0], geometry.target[1]);
      }
      context.stroke();
      if (incident) {
        context.fillStyle = context.strokeStyle;
        drawArrow(context, geometry);
      }
    });
    nodes.forEach(node => {
      const [x, y] = coordinate(node, viewIndex);
      const selected = node.index === selectedNode;
      const inCommunity = members?.has(node.index) ?? false;
      const changed = changedNodes.has(node.index);
      const dimmed = hasHighlight && !selected && !inCommunity &&
        !(selectedNode !== null && adjacency[selectedNode].has(node.index));
      context.globalAlpha = selected ? 1
        : changedOnly.checked && !changed ? .075
          : dimmed ? .1 : 1;
      context.fillStyle = node.isolated
        ? "#81738a"
        : communityColors[`${algorithm}-${view}`].get(communityOf(node.index, view));
      context.beginPath();
      context.arc(x, y, (selected ? 5.4 : inCommunity ? 3.6 : 2.15) / transform.k, 0, Math.PI * 2);
      context.fill();
      if (changed || selected) {
        context.globalAlpha = selected ? 1 : .92;
        context.beginPath();
        context.arc(x, y, (selected ? 8 : 3.4) / transform.k, 0, Math.PI * 2);
        context.strokeStyle = selected ? "#f2eaf5" : "#e84e83";
        context.lineWidth = 1 / transform.k;
        context.stroke();
      }
    });
    context.globalAlpha = 1;
    context.restore();
  }

  function draw() {
    canvases.forEach((_, index) => drawView(index));
  }

  function metric(value, label) {
    const tile = createElement("div", undefined, "metric-tile");
    tile.append(
      createElement("span", value, "metric-value"),
      createElement("span", label, "metric-label"),
    );
    return tile;
  }

  function updateMetrics() {
    const comparison = data.stats.comparisons[algorithm];
    const left = partition("unweighted");
    const right = partition("weighted");
    const algorithmLabel = algorithm === "louvain" ? "LOUVAIN" : "INFOMAP";
    $("#weight-unweighted-heading").textContent =
      `${algorithmLabel} · UNWEIGHTED · ${format(left.community_count)} COMMUNITIES · ${algorithm === "louvain" ? `MODULARITY ${left.quality.toFixed(3)}` : `CODELENGTH ${left.quality.toFixed(3)}`}`;
    $("#weight-weighted-heading").textContent =
      `${algorithmLabel} · WEIGHTED · ${format(right.community_count)} COMMUNITIES · ${algorithm === "louvain" ? `MODULARITY ${right.quality.toFixed(3)}` : `CODELENGTH ${right.quality.toFixed(3)}`}`;
    metrics.replaceChildren(
      metric(left.community_count, `${algorithmLabel} · unweighted communities`),
      metric(right.community_count, `${algorithmLabel} · weighted communities`),
      metric(comparison.nmi.toFixed(3), `${algorithm === "louvain" ? "Louvain" : "Infomap"} NMI · ${format(comparison.comparable_nodes)} philosophers`),
      metric(
        `${format(comparison.changed_count)} / ${format(comparison.comparable_nodes)} · ${(comparison.changed_fraction * 100).toFixed(1)}%`,
        "philosophers with changed co-members",
      ),
    );
    const sensitivity = Object.entries(data.stats.comparisons)
      .sort((a, b) => a[1].nmi - b[1].nmi);
    const comparisonText = sensitivity[0][0] === sensitivity[1][0]
      ? "Both methods have the same partition agreement."
      : `${sensitivity[0][0] === "louvain" ? "Louvain" : "Infomap"} has lower weighted/unweighted agreement (NMI ${sensitivity[0][1].nmi.toFixed(3)} vs ${sensitivity[1][1].nmi.toFixed(3)}), so it is more sensitive to this weighting under these settings.`;
    const examples = comparison.changed_indices
      .map(index => nodes[index].name)
      .sort((leftName, rightName) => leftName.localeCompare(rightName))
      .slice(0, 4)
      .join(", ");
    interpretation.textContent =
      `${algorithm === "louvain" ? "Louvain" : "Infomap"} has NMI ${comparison.nmi.toFixed(3)} and ${format(comparison.changed_count)} of ${format(comparison.comparable_nodes)} philosophers whose set of co-members differs between representations. Examples include ${examples}; the table lists all affected philosophers. ${comparisonText} NMI measures partition agreement, not correctness; sensitivity depends on this network, the link-count weights, and algorithm settings.`;
  }

  function updateSizeNote(viewIndex) {
    const distribution = {};
    const partitionData = partition(viewNames[viewIndex]);
    partitionData.communities.forEach(community => {
      distribution[community.size] = (distribution[community.size] ?? 0) + 1;
    });
    if (algorithm === "louvain") {
      const singletonGroups = partitionData.communities.filter(community => community.size === 1).length;
      const isolateSingletons = nodes.filter(node => node.isolated).length;
      if (singletonGroups < isolateSingletons) {
        distribution[1] = (distribution[1] ?? 0) + isolateSingletons - singletonGroups;
      }
    }
    sizeNotes[viewIndex].textContent = `Community-size distribution (size: number of communities): ${
      Object.entries(distribution).sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(([size, count]) => `${size}: ${count}`).join(" · ")
    }. Singleton communities are included.`;
  }

  function updateCommunityOptions(viewIndex) {
    const view = viewNames[viewIndex];
    const select = communitySelects[viewIndex];
    const previous = selectedCommunities[viewIndex];
    select.replaceChildren(createElement("option", "Highlight a community…"));
    select.options[0].value = "";
    partition(view).communities.forEach(community => {
      const option = createElement(
        "option",
        `Community ${community.id} · ${format(community.size)} philosophers`,
      );
      option.value = String(community.id);
      select.appendChild(option);
    });
    if (previous !== null && partition(view).communities.some(row => row.id === previous)) {
      select.value = String(previous);
    } else {
      selectedCommunities[viewIndex] = null;
      select.value = "";
    }
    updateMembers(viewIndex);
    updateSizeNote(viewIndex);
  }

  function updateMembers(viewIndex) {
    const communityId = selectedCommunities[viewIndex];
    const list = memberLists[viewIndex];
    list.replaceChildren();
    if (communityId === null) {
      list.appendChild(createElement("p", "Select a community to inspect and navigate its members."));
      return;
    }
    communityMembers(viewNames[viewIndex], communityId)
      .slice().sort((left, right) => left.name.localeCompare(right.name))
      .forEach(node => {
        const button = createElement("button", node.name, "partition-member");
        button.type = "button";
        button.addEventListener("click", () => selectNode(node));
        list.appendChild(button);
      });
  }

  function updateDetail() {
    if (selectedNode === null) {
      detail.replaceChildren(
        createElement("h3", "Choose a philosopher"),
        createElement("p", "Search for a name or select one from the changed-philosopher table to compare its community membership in both views."),
      );
      return;
    }
    const node = nodes[selectedNode];
    const url = createElement("a", "Open the Wikipedia article");
    url.href = node.url;
    url.target = "_blank";
    url.rel = "noopener";
    const leftId = communityOf(selectedNode, "unweighted");
    const rightId = communityOf(selectedNode, "weighted");
    const changed = data.stats.comparisons[algorithm].changed_indices.includes(selectedNode);
    detail.replaceChildren(
      createElement("h3", node.name),
      url,
      createElement("p", `Unweighted ${algorithm === "louvain" ? "Louvain" : "Infomap"}: community ${leftId}. Weighted ${algorithm === "louvain" ? "Louvain" : "Infomap"}: community ${rightId}.`),
      createElement("p", changed
        ? "This philosopher's set of co-members differs between the two partitions."
        : "This philosopher's set of co-members is the same in both partitions."),
      createElement("p", `Directed article connections: ${format(edges.filter(edge => edge.source === selectedNode).length)} outgoing and ${format(edges.filter(edge => edge.target === selectedNode).length)} incoming.`),
    );
  }

  function renderTable() {
    const query = normalize(search.value);
    const changedIndices = new Set(data.stats.comparisons[algorithm].changed_indices);
    const rows = nodes.filter(node =>
      (!changedOnly.checked || changedIndices.has(node.index)) &&
      (!query || normalize(node.name).includes(query))
    ).sort((left, right) => left.name.localeCompare(right.name));
    tableBody.replaceChildren();
    rows.forEach(node => {
      const row = document.createElement("tr");
      const nameCell = document.createElement("td");
      const button = createElement("button", node.name, "partition-philosopher");
      button.type = "button";
      button.addEventListener("click", () => selectNode(node));
      nameCell.appendChild(button);
      row.append(
        nameCell,
        createElement("td", algorithm === "louvain" ? "Louvain" : "Infomap"),
        createElement("td", partition("unweighted").assignments[node.index]),
        createElement("td", partition("weighted").assignments[node.index]),
        createElement("td", changedIndices.has(node.index) ? "membership differs" : "same co-members"),
      );
      if (node.index === selectedNode) row.className = "is-selected";
      tableBody.appendChild(row);
    });
    tableCount.textContent = `${format(rows.length)} philosophers shown · ${format(changedIndices.size)} changed memberships in this algorithm`;
  }

  function render() {
    updateMetrics();
    communitySelects.forEach((_, index) => updateCommunityOptions(index));
    renderTable();
    updateDetail();
    draw();
  }

  function selectNode(node) {
    selectedNode = node.index;
    search.value = node.name;
    renderTable();
    updateDetail();
    draw();
  }

  function searchForNode() {
    const query = normalize(search.value);
    if (!query) return;
    const exact = nodesByName.get(query);
    const partial = nodes.find(node => normalize(node.name).includes(query));
    if (exact || partial) selectNode(exact ?? partial);
  }

  function resize(viewIndex) {
    const canvas = canvases[viewIndex];
    const bounds = canvas.getBoundingClientRect();
    sizes[viewIndex] = {
      width: Math.max(1, bounds.width),
      height: Math.max(1, bounds.height),
      pixelRatio: window.devicePixelRatio || 1,
    };
    canvas.width = Math.round(sizes[viewIndex].width * sizes[viewIndex].pixelRatio);
    canvas.height = Math.round(sizes[viewIndex].height * sizes[viewIndex].pixelRatio);
    draw();
  }

  canvases.forEach((canvas, viewIndex) => {
    const zoom = d3.zoom().scaleExtent([.65, 8]).on("zoom", event => {
      transform = event.transform;
      draw();
      if (syncingZoom) return;
      syncingZoom = true;
      d3.select(canvases[1 - viewIndex]).call(zoom.transform, transform);
      syncingZoom = false;
    });
    d3.select(canvas).call(zoom).on("dblclick.zoom", null);
    canvas.addEventListener("click", event => {
      if (event.defaultPrevented) return;
      const bounds = canvas.getBoundingClientRect();
      const point = [
        (event.clientX - bounds.left - transform.x) / transform.k / sizes[viewIndex].width,
        (event.clientY - bounds.top - transform.y) / transform.k / sizes[viewIndex].height,
      ];
      let nearest = null;
      let distance = .014 / transform.k;
      nodes.forEach(node => {
        const candidate = Math.hypot(node.x - point[0], node.y - point[1]);
        if (candidate < distance) {
          nearest = node;
          distance = candidate;
        }
      });
      if (nearest) selectNode(nearest);
    });
    communitySelects[viewIndex].addEventListener("change", () => {
      selectedCommunities[viewIndex] = communitySelects[viewIndex].value
        ? Number(communitySelects[viewIndex].value)
        : null;
      updateMembers(viewIndex);
      draw();
    });
  });
  let syncingZoom = false;
  nodes.slice().sort((left, right) => left.name.localeCompare(right.name)).forEach(node => {
    const option = document.createElement("option");
    option.value = node.name;
    options.appendChild(option);
  });
  algorithmSelect.addEventListener("change", () => {
    algorithm = algorithmSelect.value;
    selectedCommunities.fill(null);
    render();
  });
  search.addEventListener("input", renderTable);
  search.addEventListener("change", searchForNode);
  search.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      searchForNode();
    }
  });
  changedOnly.addEventListener("change", () => {
    renderTable();
    draw();
  });
  $("#weight-clear").addEventListener("click", () => {
    selectedNode = null;
    selectedCommunities.fill(null);
    search.value = "";
    render();
  });
  methodNote.textContent =
    `${data.meta.weight_definition} ${data.meta.preprocessing} ${data.meta.settings} ${data.meta.comparison} ${data.meta.interpretation}`;
  window.addEventListener("resize", () => canvases.forEach((_, index) => resize(index)));
  canvases.forEach((_, index) => resize(index));
  render();
}

async function initModularityBenchmark(container, plot, statsElement) {
  const response = await fetch("../data/week4_modularity_null.json");
  if (!response.ok) throw new Error(`HTTP ${response.status} while loading modularity benchmark`);
  const data = await response.json();
  const values = data.stats.histogram;
  const width = Math.max(320, plot.clientWidth || 720);
  const height = 220;
  const margin = { top: 22, right: 22, bottom: 34, left: 42 };
  const x = d3.scaleLinear()
    .domain([
      Math.min(data.stats.random_min, data.stats.observed_modularity),
      Math.max(data.stats.random_max, data.stats.observed_modularity),
    ])
    .nice()
    .range([margin.left, width - margin.right]);
  const maximumCount = d3.max(values, row => row.count) || 1;
  const y = d3.scaleLinear()
    .domain([0, maximumCount])
    .nice()
    .range([height - margin.bottom, margin.top]);
  const svg = d3.select(plot)
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("preserveAspectRatio", "xMidYMid meet");
  svg.selectAll("*").remove();
  svg.append("g")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).ticks(7).tickFormat(d3.format(".2f")))
    .call(group => group.selectAll("text").attr("fill", "#c9bdcc").style("font", "9px 'DM Mono', monospace"))
    .call(group => group.selectAll("path,line").attr("stroke", "rgba(189,125,255,.4)"));
  svg.append("text")
    .attr("x", (margin.left + width - margin.right) / 2)
    .attr("y", height - 5)
    .attr("fill", "#c9bdcc")
    .attr("text-anchor", "middle")
    .style("font", "9px 'DM Mono', monospace")
    .text("Directed weighted Louvain modularity");
  svg.append("text")
    .attr("transform", `translate(12, ${(margin.top + height - margin.bottom) / 2}) rotate(-90)`)
    .attr("fill", "#c9bdcc")
    .attr("text-anchor", "middle")
    .style("font", "9px 'DM Mono', monospace")
    .text("Random networks");
  svg.append("g")
    .attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y).ticks(4).tickFormat(d3.format("d")))
    .call(group => group.selectAll("text").attr("fill", "#c9bdcc").style("font", "9px 'DM Mono', monospace"))
    .call(group => group.selectAll("path,line").attr("stroke", "rgba(189,125,255,.4)"));
  svg.selectAll(".null-bin")
    .data(values)
    .join("rect")
    .attr("class", "null-bin")
    .attr("x", row => x(row.lower) + 1)
    .attr("y", row => y(row.count))
    .attr("width", row => Math.max(1, x(row.upper) - x(row.lower) - 2))
    .attr("height", row => Math.max(0, y(0) - y(row.count)))
    .attr("fill", "#9b6ec5")
    .attr("opacity", .78);
  svg.append("line")
    .attr("x1", x(data.stats.observed_modularity))
    .attr("x2", x(data.stats.observed_modularity))
    .attr("y1", margin.top)
    .attr("y2", height - margin.bottom)
    .attr("stroke", "#ff6c9d")
    .attr("stroke-width", 2);
  svg.append("text")
    .attr("x", Math.min(width - margin.right - 4, x(data.stats.observed_modularity) + 5))
    .attr("y", margin.top + 10)
    .attr("fill", "#ff9dbc")
    .style("font", "9px 'DM Mono', monospace")
    .text(`observed ${data.stats.observed_modularity.toFixed(3)}`);
  statsElement.textContent =
    `Observed directed weighted Louvain modularity Q = ${data.stats.observed_modularity.toFixed(4)} ` +
    `(${format(data.stats.observed_communities)} communities). Across ${format(data.meta.randomizations)} degree-preserving rewires: ` +
    `mean Q = ${data.stats.random_mean.toFixed(4)}, SD = ${data.stats.random_sd.toFixed(4)}, ` +
    `range ${data.stats.random_min.toFixed(4)}–${data.stats.random_max.toFixed(4)}; ` +
    `empirical p = ${data.stats.empirical_p.toFixed(4)} (${data.stats.exceedances} null scores ≥ observed). ` +
    `This fixed-seed benchmark uses the same Louvain seed on observed and randomized graphs; the partition above reports the best of 20 seeds.`;
  container.dataset.loaded = "true";
}

async function initCommunityOverview() {
  const response = await fetch("../data/week4_communities.json");
  if (!response.ok) throw new Error(`HTTP ${response.status} while loading community overview`);
  const data = await response.json();
  const methodSelect = $("#overview-method");
  const communitySelect = $("#overview-community");
  const metrics = $("#overview-metrics");
  const membersList = $("#overview-members");
  const connections = $("#overview-connections");
  const overlapNote = $("#overview-overlap");
  const note = $("#overview-note");
  const nodes = data.nodes;
  const groupByMethod = {};
  for (const method of ["louvain", "infomap"]) {
    groupByMethod[method] = new Map();
    nodes.forEach((node, index) => {
      const id = node[method];
      if (id === null || id === undefined) return;
      if (!groupByMethod[method].has(id)) groupByMethod[method].set(id, []);
      groupByMethod[method].get(id).push(index);
    });
  }
  const comparable = nodes
    .map((node, index) => node.louvain !== null && node.infomap !== null ? index : null)
    .filter(index => index !== null);
  const comparableSet = new Set(comparable);
  const coMembers = (method, index) => new Set(
    groupByMethod[method].get(nodes[index][method]).filter(member => comparableSet.has(member)),
  );
  const crossMethodChanged = new Set(comparable.filter(index => {
    const left = coMembers("louvain", index);
    const right = coMembers("infomap", index);
    return left.size !== right.size || [...left].some(member => !right.has(member));
  }));

  function metric(value, label) {
    const tile = createElement("div", undefined, "metric-tile");
    tile.append(
      createElement("span", value, "metric-value"),
      createElement("span", label, "metric-label"),
    );
    return tile;
  }

  function render() {
    const method = methodSelect.value;
    const groups = groupByMethod[method];
    const id = Number(communitySelect.value);
    const memberIndices = groups.get(id) ?? [];
    const memberSet = new Set(memberIndices);
    const internalEdges = data.edges.filter(edge => memberSet.has(edge.source) && memberSet.has(edge.target));
    const boundaryEdges = data.edges.filter(edge => memberSet.has(edge.source) !== memberSet.has(edge.target));
    const totalWeight = internalEdges.reduce((sum, edge) => sum + edge.weight, 0);
    const internalDegree = new Map(memberIndices.map(index => [index, { in: 0, out: 0 }]));
    internalEdges.forEach(edge => {
      internalDegree.get(edge.source).out += 1;
      internalDegree.get(edge.target).in += 1;
    });
    const leaders = memberIndices.slice().sort((left, right) => {
      const leftDegree = internalDegree.get(left);
      const rightDegree = internalDegree.get(right);
      return rightDegree.in + rightDegree.out - leftDegree.in - leftDegree.out ||
        nodes[left].name.localeCompare(nodes[right].name);
    }).slice(0, 8);
    const strongest = internalEdges.slice().sort((left, right) =>
      right.weight - left.weight ||
      nodes[left.source].name.localeCompare(nodes[right.source].name) ||
      nodes[left.target].name.localeCompare(nodes[right.target].name)
    ).slice(0, 12);
    const otherMethod = method === "louvain" ? "infomap" : "louvain";
    const otherGroups = groupByMethod[otherMethod];
    const changedMembers = memberIndices.filter(index => crossMethodChanged.has(index));
    const comparedMembers = memberIndices.filter(index => comparableSet.has(index));
    let bestOverlap = null;
    otherGroups.forEach((otherMembers, otherId) => {
      const intersection = comparedMembers.filter(index => nodes[index][otherMethod] === otherId).length;
      const otherComparableMembers = otherMembers.filter(index => comparableSet.has(index)).length;
      const union = comparedMembers.length + otherComparableMembers - intersection;
      const jaccard = union ? intersection / union : 0;
      if (!bestOverlap || jaccard > bestOverlap.jaccard) {
        bestOverlap = { id: otherId, intersection, union, jaccard };
      }
    });

    metrics.replaceChildren(
      metric(format(memberIndices.length), `${method} community ${id} · philosophers`),
      metric(format(internalEdges.length), "internal directed arcs"),
      metric(format(totalWeight), "internal article-link weight"),
      metric(format(boundaryEdges.length), "directed boundary arcs"),
    );
    membersList.replaceChildren();
    const leadersSet = new Set(leaders);
    const orderedMembers = memberIndices.slice().sort((left, right) =>
      (leadersSet.has(right) ? 1 : 0) - (leadersSet.has(left) ? 1 : 0) ||
      nodes[left].name.localeCompare(nodes[right].name)
    );
    orderedMembers.forEach(index => {
      const row = document.createElement("li");
      const button = createElement("button", nodes[index].name);
      button.type = "button";
      const rank = internalDegree.get(index);
      button.title = `Within-community directed degree: ${rank.in} incoming + ${rank.out} outgoing`;
      button.addEventListener("click", () => {
        const search = $("#case-search");
        search.value = nodes[index].name;
        search.dispatchEvent(new Event("change", { bubbles: true }));
        $("#case-explorer").scrollIntoView({ behavior: "smooth", block: "start" });
      });
      row.append(button, ` · internal degree ${internalDegree.get(index).in + internalDegree.get(index).out}`);
      membersList.appendChild(row);
    });
    connections.textContent = strongest.length
      ? strongest.map(edge =>
        `${nodes[edge.source].name} → ${nodes[edge.target].name} · weight ${format(edge.weight)}`
      ).join("\n")
      : "No internal directed arcs are present in this community.";
    const overlapText = bestOverlap
      ? `Best overlap with ${otherMethod === "louvain" ? "Louvain" : "Infomap"} community ${bestOverlap.id}: ${format(bestOverlap.intersection)} shared philosophers, Jaccard ${bestOverlap.jaccard.toFixed(3)} (intersection / union).`
      : `No assigned ${otherMethod} community is available for comparison.`;
    const changedExamples = changedMembers.slice(0, 5).map(index => nodes[index].name).join(", ");
    overlapNote.textContent =
      `${overlapText} ${format(changedMembers.length)} of ${format(comparedMembers.length)} selected members have different co-member sets across methods` +
      `${changedExamples ? `, including ${changedExamples}` : ""}. Comparison is restricted to the ${format(comparable.length)} philosophers assigned by both methods; this is structural evidence, not historical identity.`;
    const meta = data.methods[method];
    const objective = method === "louvain"
      ? `Observed directed modularity Q = ${meta.modularity.toFixed(4)}.`
      : `Observed directed Infomap codelength = ${meta.codelength.toFixed(4)}.`;
    note.textContent =
      `${objective} The selected group has ${format(memberIndices.length)} members and ${format(internalEdges.length)} actual internal directed arcs. ` +
      `${format(leaders.length)} leading members shown first are ranked by within-community in-degree + out-degree; strongest links are ranked by aggregated article-link count. These metrics describe graph structure only.`;
  }

  function updateCommunityOptions() {
    const method = methodSelect.value;
    const groups = groupByMethod[method];
    communitySelect.replaceChildren();
    [...groups.entries()]
      .sort((left, right) => right[1].length - left[1].length || Number(left[0]) - Number(right[0]))
      .forEach(([id, members]) => {
        const option = document.createElement("option");
        option.value = String(id);
        option.textContent = `Community ${id} · ${format(members.length)} philosophers`;
        communitySelect.appendChild(option);
      });
    render();
  }

  methodSelect.addEventListener("change", updateCommunityOptions);
  communitySelect.addEventListener("change", render);
  note.textContent = "Loading structural characteristics…";
  updateCommunityOptions();
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
  const benchmark = $("#modularity-benchmark");
  const benchmarkPlot = $("#modularity-null-plot");
  const benchmarkStats = $("#modularity-null-stats");
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
  const methodColors = new Map();

  const activeMethod = () => data.methods[method];
  const methodName = () => method === "louvain" ? "Louvain" : "Infomap";
  function updateCommunityColors() {
    methodColors.clear();
    activeMethod().communities.forEach((community, index) => {
      const hue = (index * PARTITION_GOLDEN_ANGLE + (method === "infomap" ? 43 : 0)) % 360;
      const lightness = [60, 70, 52, 76][index % 4];
      methodColors.set(community.id, `hsl(${hue.toFixed(2)} 86% ${lightness}%)`);
    });
  }
  const communityColor = community => methodColors.get(community) ?? ISOLATE_COLOR;
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
    const communitySizes = new Map();
    nodes.forEach(node => {
      const community = node[method];
      if (community === null || community === undefined) return;
      communitySizes.set(community, (communitySizes.get(community) ?? 0) + 1);
    });
    const distribution = new Map();
    communitySizes.forEach(size => {
      distribution.set(size, (distribution.get(size) ?? 0) + 1);
    });
    const sizes = [...distribution.entries()]
      .sort((left, right) => left[0] - right[0])
      .map(([size, count]) => `${format(size)}:${format(count)}`)
      .join(" · ");
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
    methodNote.textContent = `${runRange} ${data.meta.louvain_graph} ${data.meta.infomap_graph} ${data.meta.layout_note} Louvain assigns each isolate its own singleton module; Infomap leaves the ${format(data.stats.isolated_nodes)} isolates unassigned, so its community-size distribution covers assigned philosophers only. IDs and categorical colours are partition-specific; selecting a community fades unrelated nodes and edges.`;
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
      updateCommunityColors();
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
  updateCommunityColors();
  initModularityBenchmark(benchmark, benchmarkPlot, benchmarkStats).catch(error => {
    benchmarkStats.classList.add("widget-error");
    benchmarkStats.textContent = `The modularity benchmark could not load its precomputed results. ${error.message}`;
  });
  window.addEventListener("resize", resize);
  resize();
  renderExplorer();
}

initCommunityExplorer().catch(errorMessage);
initCommunityOverview().catch(error => {
  const message = `The whole-network overview could not load its precomputed results. ${error.message}`;
  ["#overview-metrics", "#overview-members", "#overview-connections", "#overview-overlap", "#overview-note"].forEach(selector => {
    const target = $(selector);
    target.classList.add("widget-error");
    target.textContent = message;
  });
});
initAristotleCase().catch(error => {
  const message = `The Aristotle case study could not load its precomputed results. ${error.message}`;
  ["#case-metrics", "#case-detail", "#case-method-note", "#case-evidence", "#case-interpretation"].forEach(selector => {
    const target = $(selector);
    target.classList.add("widget-error");
    target.textContent = message;
  });
});
initBackboneExplorer().catch(error => {
  const message = `The disparity backbone could not load its precomputed data. ${error.message}`;
  ["#backbone-metrics", "#backbone-selection-metrics", "#backbone-detail", "#backbone-method-note"].forEach(selector => {
    const target = $(selector);
    target.classList.add("widget-error");
    target.textContent = message;
  });
});
initWeightPartitionComparison().catch(error => {
  const message = `The partition comparison could not load its precomputed data. ${error.message}`;
  ["#weight-metrics", "#weight-detail", "#weight-method-note", "#weight-interpretation"].forEach(selector => {
    const target = $(selector);
    target.classList.add("widget-error");
    target.textContent = message;
  });
});
