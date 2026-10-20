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
  const [linkResponse, caseResponse] = await Promise.all([
    fetch("../data/week4_link_communities.json"),
    fetch("../data/week4_aristotle_case.json"),
  ]);
  if (!linkResponse.ok) throw new Error(`HTTP ${linkResponse.status} while loading link communities`);
  if (!caseResponse.ok) throw new Error(`HTTP ${caseResponse.status} while loading k-clique results`);
  const [linkData, caseData] = await Promise.all([linkResponse.json(), caseResponse.json()]);
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
  const kControl = $("#case-k-control");
  const kSelect = $("#case-k");
  const communitySelect = $("#case-community");
  const nodes = linkData.nodes.map((node, index) => ({ ...node, index }));
  const edges = linkData.edges;
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

  function setInitialCommunity() {
    const membershipIds = currentMemberships(selectedNode);
    if (!membershipIds.length) {
      selectedCommunity = null;
      return;
    }
    selectedCommunity = method === "link"
      ? membershipIds.slice().sort((left, right) =>
        (directedCounts.get(right) ?? 0) - (directedCounts.get(left) ?? 0))[0]
      : membershipIds[0];
  }

  function computeEgo() {
    const neighbours = new Set();
    egoEdges = [];
    adjacency[selectedNode.index].forEach(edge => {
      egoEdges.push(edge);
      neighbours.add(edge.source === selectedNode.index ? edge.target : edge.source);
    });
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
    const activeMembers = selectedCommunity === null
      ? new Set()
      : new Set(communityMembers(selectedCommunity));
    const additionalMembers = [...activeMembers]
      .filter(index => !positions.has(index))
      .sort((left, right) => nodes[left].name.localeCompare(nodes[right].name));
    const communityRadius = Math.min(width * .46, height * .46);
    additionalMembers.forEach((index, position) => {
      const angle = -Math.PI / 2 + (Math.PI * 2 * position) / Math.max(1, additionalMembers.length);
      positions.set(index, [
        width * .47 + Math.cos(angle) * communityRadius,
        height * .54 + Math.sin(angle) * communityRadius,
      ]);
    });
    const edgeKeys = new Set(egoEdges.map(edge => `${edge.source}:${edge.target}`));
    visibleEdges = egoEdges.slice();
    if (selectedCommunity !== null) {
      edges.forEach(edge => {
        const highlight = method === "link"
          ? edge.community === selectedCommunity
          : activeMembers.has(edge.source) && activeMembers.has(edge.target);
        const key = `${edge.source}:${edge.target}`;
        if (highlight && !edgeKeys.has(key) && positions.has(edge.source) && positions.has(edge.target)) {
          edgeKeys.add(key);
          visibleEdges.push(edge);
        }
      });
    }
  }

  function drawArrow(source, target, communityId) {
    const angle = Math.atan2(target[1] - source[1], target[0] - source[0]);
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
      const source = positions.get(edge.source);
      const target = positions.get(edge.target);
      if (!source || !target) return;
      const selectedLink = method === "link" && edge.community === selectedCommunity;
      const selectedClique = method === "clique" &&
        activeMembers.has(edge.source) && activeMembers.has(edge.target);
      if (selectedClique) {
        context.globalAlpha = .88;
        context.strokeStyle = "#f2eaf5";
        context.lineWidth = (2.7 + Math.log1p(edge.weight) * .12) / transform.k;
        context.beginPath();
        context.moveTo(source[0], source[1]);
        context.lineTo(target[0], target[1]);
        context.stroke();
      }
      context.globalAlpha = selectedLink ? .98 : selectedClique ? .94 : .48;
      context.strokeStyle = colorForCommunity(edge.community);
      context.lineWidth = (.45 + Math.log1p(edge.weight) * .11 + (selectedLink ? 1.2 : 0)) / transform.k;
      context.beginPath();
      context.moveTo(source[0], source[1]);
      context.lineTo(target[0], target[1]);
      context.stroke();
      drawArrow(source, target, edge.community);
    });

    const membersPresent = new Set();
    visibleEdges.forEach(edge => {
      membersPresent.add(edge.source);
      membersPresent.add(edge.target);
    });
    membersPresent.forEach(index => {
      const point = positions.get(index);
      const node = nodes[index];
      const selected = index === selectedNode.index;
      const inCommunity = activeMembers.has(index);
      const radius = selected ? 6 : inCommunity ? 4.3 : 2.6;
      context.globalAlpha = 1;
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
    metrics.replaceChildren(
      metric(format(neighbourCount), `${selectedNode.name} · immediate neighbours`),
      metric(format(egoEdges.length), "directed arcs · original weights retained"),
      metric(format(nodeMemberships.length), `${method === "link" ? "edge" : `k=${k} node`} memberships`),
      metric(format(communityCount), `${method === "link" ? "edge" : `k=${k} clique`} communities in graph`),
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
        : `k=${k} community ${id} · ${format(group.size)} philosophers`;
      communitySelect.appendChild(option);
    });
    if (!membershipIds.includes(selectedCommunity)) setInitialCommunity();
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
    const membershipText = membershipIds.length
      ? `${format(membershipIds.length)} ${method === "link" ? "edge-community" : `k=${k} clique-community`} membership${membershipIds.length === 1 ? "" : "s"}.`
      : `No k=${k} clique membership at this threshold.`;
    const heading = createElement("h3", selectedNode.name);
    const link = createElement("a", "Open the Wikipedia article");
    link.href = selectedNode.url;
    link.target = "_blank";
    link.rel = "noopener";
    detail.replaceChildren(heading, link, createElement("p", membershipText));
    if (selectedCommunity !== null) {
      const group = currentCommunity(selectedCommunity);
      const text = method === "link"
        ? `Link community ${selectedCommunity}: ${format(group.edge_count)} undirected links · ${format(directedCounts.get(selectedCommunity) ?? 0)} directed display arcs · ${format(group.node_count)} philosophers. The coloured arcs in this ego view carry this computed link-community ID.`
        : `k=${k} clique community ${selectedCommunity}: ${format(group.size)} philosophers. Clique percolation assigns memberships to nodes, not edges: the displayed edge colours still report each link community. Bright outlines mark arcs whose endpoints are both members.`;
      detail.appendChild(createElement("p", text));
    }
    detail.appendChild(createElement("p",
      `${format(egoEdges.length)} directed arcs to/from ${selectedNode.name}; ${format(new Set(egoEdges.map(edge => edge.source === selectedNode.index ? edge.target : edge.source)).size)} distinct immediate neighbours.`));
  }

  function updateMethodNote() {
    methodNote.textContent = method === "link"
      ? `${linkData.meta.method_note} ${linkData.meta.preprocessing} ${linkData.meta.interpretation_note} Edge thickness follows the original directed-edge weight. Community sizes count undirected links; reciprocal directed arcs share the colour of their single undirected link.`
      : `A k-clique is a set of k philosophers with every pair connected; clique percolation joins k-cliques that share k−1 philosophers, so node communities can overlap. ${caseData.meta.preprocessing} This view retains link-community edge colours; clique communities assign node memberships, not edges. Only precomputed k=${kValues.join(", ")} are selectable.`;
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
    evidence.replaceChildren();
    [
      `${aristotle.name} has ${format(incident.length)} directed article-link arcs to/from ${format(new Set(incident.map(edge => edge.source === aristotle.index ? edge.target : edge.source)).size)} distinct philosophers. Those arcs carry ${format(aristotle.memberships.length)} link-community memberships.`,
      `The largest incident group is link community ${largest[0]}: ${format(largest[1])} of ${format(incident.length)} directed arcs (${(100 * largest[1] / incident.length).toFixed(1)}%) carry that ID. Its full group has ${format(largestGroup.node_count)} philosophers; the other ${format(incident.length - largest[1])} arcs span ${format(ranked.length - 1)} other link communities.`,
      exampleNames.length
        ? `A much smaller incident link group (community ${examples.id}, ${examples.node_count} philosophers) also contains ${exampleNames.join(", ")}. These are graph-linked peers, not a named school.`
        : "Several small edge groups also include Aristotle, alongside the largest incident community.",
      `On the explicitly undirected projection, k-clique memberships change with k: ${cliqueSummary.map(result => `k=${result.k}: ${result.memberships} (${result.groupSizes.length ? `group sizes ${result.groupSizes.join(", ")}` : "no group"})`).join("; ")}. At k=5, Aristotle’s ${k5.memberships} groups include ${format(k5.groupSizes[0])} philosophers in the largest group plus smaller groups.`,
    ].forEach(text => evidence.appendChild(createElement("li", text)));
    interpretation.textContent = "The evidence supports a structural reading of Aristotle as a hub whose links participate in one dominant edge group and many smaller groups; the selected clique threshold changes which shared-neighbourhood clusters are visible. Neither result identifies a philosophical tradition. Wikipedia links reflect editorial and citation relationships, and the graph alone cannot establish philosophical identity or intellectual agreement.";
  }

  function render() {
    computeEgo();
    updateCommunityOptions();
    updateMetrics();
    updateMembers();
    updateDetail();
    updateMethodNote();
    draw();
  }

  function selectNode(node, focus = false) {
    selectedNode = node;
    if (!currentMemberships(node).includes(selectedCommunity)) setInitialCommunity();
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
    computeEgo();
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
      const distance = pointSegmentDistance(point, positions.get(edge.source), positions.get(edge.target));
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
    setInitialCommunity();
    render();
  });
  kSelect.addEventListener("change", () => {
    if (!kValues.includes(kSelect.value)) return;
    k = kSelect.value;
    setInitialCommunity();
    render();
  });
  communitySelect.addEventListener("change", () => {
    selectedCommunity = communitySelect.value ? Number(communitySelect.value) : null;
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
    selectNode(nodes[caseData.aristotle_index], true);
  });
  window.addEventListener("resize", resize);
  setInitialCommunity();
  resize();
  render();
  updateCaseEvidence();
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
initAristotleCase().catch(error => {
  const message = `The Aristotle case study could not load its precomputed results. ${error.message}`;
  ["#case-metrics", "#case-detail", "#case-method-note", "#case-evidence", "#case-interpretation"].forEach(selector => {
    const target = $(selector);
    target.classList.add("widget-error");
    target.textContent = message;
  });
});
