const formatValue = (value, metric) => {
  if (metric === "Degree") return value.toFixed(0);
  if (metric === "PageRank") return value.toFixed(5);
  return value.toFixed(4);
};

const formatZ = value => `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;

const metricControls = document.querySelector("#metric-controls");
const orderControls = document.querySelector("#order-controls");
const candidateList = document.querySelector("#candidate-list");
const candidateHeading = document.querySelector("#candidate-heading");
const detailHeading = document.querySelector("#detail-heading");
const detailTable = document.querySelector("#detail-table");
const fragmentationChart = d3.select("#fragmentation-chart");
const fragmentationDetail = document.querySelector("#fragmentation-detail");
const fragmentationTable = document.querySelector("#fragmentation-table-body");
const fragmentationSummary = document.querySelector("#fragmentation-summary");
const directionControls = document.querySelector("#direction-controls");
const directionChart = d3.select("#direction-chart");
const directionDetail = document.querySelector("#direction-detail");
const directionSynthesis = document.querySelector("#direction-synthesis");
const pathStart = document.querySelector("#path-start");
const pathDestination = document.querySelector("#path-destination");
const pathExplore = document.querySelector("#path-explore");
const pathOptions = document.querySelector("#path-character-options");
const pathMessage = document.querySelector("#path-message");
const pathTreeControls = document.querySelector("#path-tree-controls");
const pathResult = document.querySelector("#path-result");
const pathSvg = d3.select("#path-svg");
const pathPrevious = document.querySelector("#path-previous");
const pathPlay = document.querySelector("#path-play");
const pathNext = document.querySelector("#path-next");
const pathStep = document.querySelector("#path-step");
const pathDetail = document.querySelector("#path-detail");
const pathInsight = document.querySelector("#path-insight");

let data;
let mode = "top";
let metric = "Degree";
let selectedId;
let directionMode = "links_out_more";
let selectedDirectionId;
let pathData;
let pathAdjacency;
let selectedPath = [];
let pathStepIndex = 0;
let pathTimer;
let pathSearch;
let pathStartId;
let nearestPathIds = [];
let furthestPathIds = [];
let pathViewMode = "all";

function getCandidates() {
  const filtered = data.rows.filter(row => row.centrality === metric && row.z !== null);
  return filtered
    .slice()
    .sort((a, b) => {
      const diff = mode === "top" ? b.z - a.z : a.z - b.z;
      return diff !== 0 ? diff : a.character.localeCompare(b.character);
    })
    .slice(0, 3);
}

function renderCandidates() {
  const candidates = getCandidates();
  candidateHeading.textContent = `${mode === "top" ? "TOP 3" : "LOWEST 3"} · ${metric.toUpperCase()}`;
  candidateList.replaceChildren();
  candidates.forEach((item, index) => {
    const button = document.createElement("button");
    button.className = `candidate${item.id === selectedId ? " is-selected" : ""}`;
    button.type = "button";
    button.innerHTML = `<span class="candidate-rank">${index + 1}</span>${item.character}<span class="candidate-z">z = ${formatZ(item.z)}</span>`;
    button.addEventListener("click", () => {
      selectedId = item.id;
      renderCandidates();
      renderDetail(item);
    });
    candidateList.appendChild(button);
  });
}

function renderDetail(focus) {
  const rows = data.rows.filter(row => row.id === focus.id);
  detailHeading.textContent = focus.character;
  detailTable.replaceChildren();
  rows.forEach(row => {
    const tr = document.createElement("tr");
    tr.className = row.centrality === focus.centrality ? "focus" : "";
    tr.innerHTML = `<td>${row.character}</td><td>${row.centrality}</td><td>${formatValue(row.real, row.centrality)}</td><td>${formatValue(row.null_mean, row.centrality)}</td><td>${formatValue(row.null_sd, row.centrality)}</td><td>${row.z === null ? "—" : formatZ(row.z)}</td>`;
    detailTable.appendChild(tr);
  });
}

function updateSelectionAfterChange() {
  const candidates = getCandidates();
  selectedId = candidates.length ? candidates[0].id : undefined;
  renderCandidates();
  if (candidates.length) renderDetail(candidates[0]);
}

function formatPercent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function renderFragmentationDetail(row, data) {
  const previousTop3 = data.fragmentation.top3_betweenness_ids.includes(row.id);
  const top5 = data.fragmentation.top5.some(item => item.id === row.id);
  const highestBetweenness = row.betweenness_rank === 1;
  const betweennessMedian = d3.median(data.fragmentation.rows, item => item.betweenness);
  const reductionMedian = d3.median(data.fragmentation.rows, item => item.reduction);
  const interpretation = [];

  if (row.betweenness >= betweennessMedian && row.reduction >= reductionMedian) {
    interpretation.push("This character has relatively high betweenness and its removal also causes a relatively large reduction in the giant component.");
  } else if (row.betweenness >= betweennessMedian) {
    interpretation.push("This character has relatively high betweenness, but its removal causes a smaller-than-median reduction in the giant component.");
  } else if (row.reduction >= reductionMedian) {
    interpretation.push("This character is not highly ranked by betweenness, but its removal causes a relatively large reduction in the giant component.");
  } else {
    interpretation.push("This character has relatively low betweenness and its removal causes a relatively small reduction in the giant component.");
  }
  if (previousTop3) interpretation.push("This character was also among the previous Top 3 betweenness observations.");
  if (top5) interpretation.push("It is in the Top 5 most disruptive characters by giant component reduction.");
  if (highestBetweenness) interpretation.push("It has the highest raw betweenness in the original network.");

  fragmentationDetail.innerHTML = `
    <h3>${row.character}</h3>
    <dl class="fragmentation-stats">
      <div><dt>Betweenness</dt><dd>${row.betweenness.toFixed(5)}</dd></div>
      <div><dt>Betweenness rank</dt><dd>${row.betweenness_rank}</dd></div>
      <div><dt>Giant before removal</dt><dd>${row.giant_before} nodes</dd></div>
      <div><dt>Giant after removal</dt><dd>${row.giant_after} nodes</dd></div>
      <div><dt>Giant reduction</dt><dd>${formatPercent(row.reduction)}</dd></div>
      <div><dt>Fragmentation rank</dt><dd>${row.fragmentation_rank}</dd></div>
    </dl>
    <p>${interpretation.join(" ")}</p>`;
}

function renderFragmentation(data) {
  const rows = data.fragmentation.rows;
  const top5Ids = new Set(data.fragmentation.top5.map(row => row.id));
  const highestBetweennessId = rows.find(row => row.betweenness_rank === 1).id;
  const width = fragmentationChart.node().clientWidth || 820;
  const height = fragmentationChart.node().clientHeight || 470;
  const margin = { top: 28, right: 28, bottom: 68, left: 74 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const x = d3.scaleLinear().domain([0, d3.max(rows, row => row.betweenness)]).nice().range([0, innerWidth]);
  const y = d3.scaleLinear().domain([0, d3.max(rows, row => row.reduction)]).nice().range([innerHeight, 0]);
  fragmentationChart.attr("viewBox", `0 0 ${width} ${height}`).selectAll("*").remove();
  const chart = fragmentationChart.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
  chart.append("g").attr("class", "fragmentation-grid").attr("transform", `translate(0,${innerHeight})`)
    .call(d3.axisBottom(x).ticks(6).tickSize(-innerHeight).tickFormat(""));
  chart.append("g").attr("class", "fragmentation-grid")
    .call(d3.axisLeft(y).ticks(6).tickSize(-innerWidth).tickFormat(""));
  chart.append("g").attr("class", "fragmentation-axis").attr("transform", `translate(0,${innerHeight})`)
    .call(d3.axisBottom(x).ticks(6)).selectAll("text").attr("fill", "#f2eaf5").attr("font-family", "DM Mono").attr("font-size", "10px");
  chart.append("g").attr("class", "fragmentation-axis")
    .call(d3.axisLeft(y).ticks(6).tickFormat(formatPercent)).selectAll("text").attr("fill", "#f2eaf5").attr("font-family", "DM Mono").attr("font-size", "10px");
  chart.append("text").attr("class", "fragmentation-label").attr("x", innerWidth / 2).attr("y", innerHeight + 52).attr("text-anchor", "middle").text("Raw betweenness centrality");
  chart.append("text").attr("class", "fragmentation-label").attr("transform", "rotate(-90)").attr("x", -innerHeight / 2).attr("y", -52).attr("text-anchor", "middle").text("Giant component reduction");

  const regression = (() => {
    const meanX = d3.mean(rows, row => row.betweenness);
    const meanY = d3.mean(rows, row => row.reduction);
    const slope = d3.sum(rows, row => (row.betweenness - meanX) * (row.reduction - meanY)) /
      d3.sum(rows, row => (row.betweenness - meanX) ** 2);
    return { slope, intercept: meanY - slope * meanX };
  })();
  const line = d3.line()
    .x(point => x(point.betweenness))
    .y(point => y(point.reduction));
  chart.append("path")
    .datum([
      { betweenness: d3.min(rows, row => row.betweenness), reduction: regression.intercept + regression.slope * d3.min(rows, row => row.betweenness) },
      { betweenness: d3.max(rows, row => row.betweenness), reduction: regression.intercept + regression.slope * d3.max(rows, row => row.betweenness) },
    ])
    .attr("fill", "none").attr("stroke", "#f2eaf5").attr("stroke-opacity", .65).attr("stroke-dasharray", "5 4").attr("d", line);

  const points = chart.append("g").selectAll("circle").data(rows).join("circle")
    .attr("class", "fragmentation-point")
    .attr("cx", row => x(row.betweenness)).attr("cy", row => y(row.reduction))
    .attr("r", row => row.id === highestBetweennessId ? 7 : top5Ids.has(row.id) ? 6 : 3.5)
    .attr("fill", row => row.id === highestBetweennessId ? "#21f3c6" : top5Ids.has(row.id) ? "#e84e83" : "#bd7dff")
    .attr("stroke", "#0a090d").attr("stroke-width", 1.2).attr("fill-opacity", .9)
    .on("click", (event, row) => {
      selectedFragmentationId = row.id;
      updateFragmentationSelection(data);
    });

  chart.append("text").attr("class", "fragmentation-label").attr("x", innerWidth).attr("y", 0).attr("text-anchor", "end")
    .text(`r = ${data.fragmentation.correlation.toFixed(2)}`);
  renderFragmentationTable(data);
  selectedFragmentationId = data.fragmentation.top5[0].id;
  updateFragmentationSelection(data);
}

let selectedFragmentationId;

function renderFragmentationTable(data) {
  fragmentationTable.replaceChildren();
  data.fragmentation.top5.forEach((row, index) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${index + 1}</td><td><button type="button">${row.character}</button></td><td>${row.betweenness.toFixed(5)}</td><td>${row.giant_after}</td><td>${formatPercent(row.reduction)}</td>`;
    tr.querySelector("button").addEventListener("click", () => {
      selectedFragmentationId = row.id;
      updateFragmentationSelection(data);
    });
    fragmentationTable.appendChild(tr);
  });
  const top = data.fragmentation.top5[0];
  const highest = data.fragmentation.rows.find(row => row.betweenness_rank === 1);
  const overlap = data.fragmentation.top5.filter(row => data.fragmentation.top3_betweenness_ids.includes(row.id)).length;
  const sameLeader = top.id === highest.id;
  const relationship = Math.abs(data.fragmentation.correlation) >= .5 ? "suggests a noticeable relationship" : "does not suggest a strong relationship";
  fragmentationSummary.innerHTML = `<p><strong>${top.character}</strong> causes the greatest giant component reduction at ${formatPercent(top.reduction)}. ${sameLeader ? "This is also the highest-betweenness character." : `${highest.character} has the highest betweenness, but is not the most disruptive when removed.`} The fragmentation Top 5 contains ${overlap} of the previous Top 3 betweenness observations. The scatter plot ${relationship} between betweenness and fragmentation (Pearson r = ${data.fragmentation.correlation.toFixed(2)}).</p>`;
}

function updateFragmentationSelection(data) {
  const row = data.fragmentation.rows.find(item => item.id === selectedFragmentationId);
  renderFragmentationDetail(row, data);
  fragmentationChart.selectAll(".fragmentation-point")
    .attr("stroke", item => item.id === row.id ? "#f2eaf5" : "#0a090d")
    .attr("stroke-width", item => item.id === row.id ? 3 : 1.2);
}

function pathLookup(value) {
  const query = value.trim().toLowerCase();
  if (!query) return null;
  return pathData.nodes.find(node => node.character.toLowerCase() === query) ||
    pathData.nodes.find(node => node.character.toLowerCase().includes(query));
}

function shortestPath(startId, endId) {
  const queue = [startId];
  const previous = new Map([[startId, null]]);
  while (queue.length) {
    const current = queue.shift();
    if (current === endId) break;
    (pathAdjacency.get(current) || []).forEach(next => {
      if (!previous.has(next)) {
        previous.set(next, current);
        queue.push(next);
      }
    });
  }
  if (!previous.has(endId)) return null;
  const path = [];
  let current = endId;
  while (current !== null) {
    path.unshift(current);
    current = previous.get(current);
  }
  return path;
}

function pathsFrom(startId) {
  const distance = new Map([[startId, 0]]);
  const previous = new Map([[startId, null]]);
  const queue = [startId];
  while (queue.length) {
    const current = queue.shift();
    (pathAdjacency.get(current) || []).forEach(next => {
      if (!distance.has(next)) {
        distance.set(next, distance.get(current) + 1);
        previous.set(next, current);
        queue.push(next);
      }
    });
  }
  return { distance, previous };
}

function reconstructPath(previous, endId) {
  const path = [];
  let current = endId;
  while (current !== null && current !== undefined) {
    path.unshift(current);
    current = previous.get(current);
  }
  return path;
}

function nodeInfo(id) {
  return pathData.nodes.find(node => node.id === id);
}

function pathNames(ids) {
  return ids.map(id => nodeInfo(id).character);
}

function renderPathChain(ids) {
  return pathNames(ids).map((name, index) => `<strong>${name}</strong>${index < ids.length - 1 ? " → " : ""}`).join("");
}

function renderPathSvg() {
  const width = pathSvg.node().clientWidth || 820;
  const height = 470;
  const margin = { left: 50, right: 50 };
  const stepWidth = selectedPath.length > 1 ? (width - margin.left - margin.right) / (selectedPath.length - 1) : 0;
  pathSvg.attr("viewBox", `0 0 ${width} ${height}`).selectAll("*").remove();
  if (!selectedPath.length) return;
  const positions = selectedPath.map((id, index) => ({ id, x: selectedPath.length === 1 ? width / 2 : margin.left + index * stepWidth, y: height / 2 }));
  const group = pathSvg.append("g");
  group.selectAll("line").data(positions.slice(0, -1)).join("line")
    .attr("class", (point, index) => `path-svg-line${index < pathStepIndex ? " lit" : ""}`)
    .attr("x1", point => point.x).attr("y1", point => point.y)
    .attr("x2", (point, index) => positions[index + 1].x).attr("y2", (point, index) => positions[index + 1].y);
  const nodes = group.selectAll("g").data(positions).join("g")
    .on("click", (event, point) => {
      pathStepIndex = positions.findIndex(item => item.id === point.id);
      renderPathSvg();
      renderPathDetail();
    });
  nodes.append("circle")
    .attr("class", (point, index) => `path-svg-node${index <= pathStepIndex ? " lit" : ""}${index === pathStepIndex ? " current" : ""}`)
    .attr("cx", point => point.x).attr("cy", point => point.y).attr("r", 13);
  nodes.append("text").attr("class", "path-svg-label")
    .attr("x", point => point.x).attr("y", point => point.y - 24).attr("text-anchor", "middle")
    .text(point => nodeInfo(point.id).character);
}

function pathEdgeKey(source, target) {
  return `${source}::${target}`;
}

function pathBranchEdges(ids) {
  const edges = new Set();
  ids.forEach((id, index) => {
    if (index > 0) edges.add(pathEdgeKey(ids[index - 1], id));
  });
  return edges;
}

function renderPathTree() {
  if (pathTreeControls.hidden || !pathSearch || !pathStartId) return;
  const entries = [...pathSearch.distance.entries()]
    .map(([id, distance]) => ({ id, distance, parent: pathSearch.previous.get(id) }))
    .sort((a, b) => a.distance - b.distance || nodeInfo(a.id).character.localeCompare(nodeInfo(b.id).character));
  const levels = d3.group(entries, entry => entry.distance);
  const maxDistance = d3.max(entries, entry => entry.distance) || 0;
  const width = pathSvg.node().clientWidth || 820;
  const height = 470;
  const margin = { left: 52, right: 52, top: 26, bottom: 24 };
  const levelWidth = maxDistance ? (width - margin.left - margin.right) / maxDistance : 0;
  const positions = new Map();
  levels.forEach((levelEntries, distance) => {
    levelEntries.forEach((entry, index) => {
      positions.set(entry.id, {
        x: maxDistance ? margin.left + distance * levelWidth : width / 2,
        y: margin.top + (index + 1) * (height - margin.top - margin.bottom) / (levelEntries.length + 1),
      });
    });
  });
  const nearestEdges = new Set(nearestPathIds.flatMap(pathBranchEdges));
  const furthestEdges = new Set(furthestPathIds.flatMap(pathBranchEdges));
  pathSvg.attr("viewBox", `0 0 ${width} ${height}`).selectAll("*").remove();
  const chart = pathSvg.append("g");
  chart.selectAll("line").data(entries.filter(entry => entry.parent !== null)).join("line")
    .attr("class", entry => {
      const key = pathEdgeKey(entry.parent, entry.id);
      return `path-tree-link${nearestEdges.has(key) ? " nearest" : furthestEdges.has(key) ? " furthest" : ""}`;
    })
    .attr("x1", entry => positions.get(entry.parent).x).attr("y1", entry => positions.get(entry.parent).y)
    .attr("x2", entry => positions.get(entry.id).x).attr("y2", entry => positions.get(entry.id).y);
  const nodes = chart.selectAll("g").data(entries).join("g")
    .on("click", (event, entry) => {
      setSelectedPath(reconstructPath(pathSearch.previous, entry.id));
    });
  nodes.append("circle")
    .attr("class", entry => {
      const nearest = nearestPathIds.some(path => path.includes(entry.id));
      const furthest = furthestPathIds.some(path => path.includes(entry.id));
      return `path-tree-node${entry.id === pathStartId ? " root" : nearest ? " nearest" : furthest ? " furthest" : ""}`;
    })
    .attr("cx", entry => positions.get(entry.id).x).attr("cy", entry => positions.get(entry.id).y)
    .attr("r", entry => {
      const count = levels.get(entry.distance).length;
      return Math.max(3, Math.min(7, 180 / Math.sqrt(count)));
    });
  nodes.append("title").text(entry => `${nodeInfo(entry.id).character} · ${entry.distance} link${entry.distance === 1 ? "" : "s"} from ${nodeInfo(pathStartId).character}`);
  nodes.filter(entry => levels.get(entry.distance).length <= 20 || entry.id === pathStartId)
    .append("text").attr("class", "path-tree-label")
    .attr("x", entry => positions.get(entry.id).x + 9).attr("y", entry => positions.get(entry.id).y + 3)
    .text(entry => nodeInfo(entry.id).character);
}

function setStartOnlyPath(mode) {
  if (pathTreeControls.hidden || !pathSearch || !pathStartId) return;
  pathViewMode = mode;
  if (mode === "all") {
    selectedPath = [];
    pathStepIndex = 0;
    pathDetail.hidden = true;
    pathInsight.hidden = true;
    pathStep.textContent = "Full shortest-path tree";
    renderPathTree();
  } else {
  const paths = mode === "longest" ? furthestPathIds : nearestPathIds;
    if (paths.length) setSelectedPath(paths[0]);
  }
  pathTreeControls.querySelectorAll("button").forEach(button => {
    button.classList.toggle("is-active", button.dataset.treeMode === mode);
  });
}

function renderPathDetail() {
  if (!selectedPath.length) {
    pathDetail.hidden = true;
    pathStep.textContent = "No path selected";
    return;
  }
  const current = nodeInfo(selectedPath[pathStepIndex]);
  const next = pathStepIndex < selectedPath.length - 1 ? nodeInfo(selectedPath[pathStepIndex + 1]) : null;
  pathDetail.hidden = false;
  pathStep.textContent = `Step ${pathStepIndex + 1} of ${selectedPath.length}${next ? ` · Current: ${current.character} · Next: ${next.character}` : ` · Current: ${current.character}`}`;
  pathDetail.innerHTML = `
    <h3>${current.character}</h3>
    <dl class="path-stats">
      <div><dt>Step</dt><dd>${pathStepIndex + 1} of ${selectedPath.length}</dd></div>
      <div><dt>In-degree</dt><dd>${current.in_degree}</dd></div>
      <div><dt>Out-degree</dt><dd>${current.out_degree}</dd></div>
      <div><dt>Closeness</dt><dd>${current.centrality.Closeness.toFixed(4)}</dd></div>
      <div><dt>Betweenness</dt><dd>${current.centrality.Betweenness.toFixed(4)}</dd></div>
      <div><dt>PageRank</dt><dd>${current.centrality.PageRank.toFixed(5)}</dd></div>
    </dl>
    <p class="small-note">${current.description}</p>`;
}

function setSelectedPath(ids) {
  pathViewMode = "linear";
  pathTreeControls.querySelectorAll("button").forEach(button => button.classList.remove("is-active"));
  selectedPath = ids || [];
  pathStepIndex = 0;
  pathPlay.textContent = "PLAY PATH";
  if (pathTimer) clearInterval(pathTimer);
  renderPathSvg();
  renderPathDetail();
  if (selectedPath.length) {
    pathInsight.hidden = false;
    const intermediaries = Math.max(0, selectedPath.length - 2);
    const maxBetweenness = Math.max(...selectedPath.map(id => nodeInfo(id).centrality.Betweenness));
    const highest = nodeInfo(selectedPath.find(id => nodeInfo(id).centrality.Betweenness === maxBetweenness));
    pathInsight.innerHTML = `<h3>What does the path tell us?</h3><p><strong>Network observation:</strong> this route contains ${selectedPath.length - 1} links and ${intermediaries} intermediary character${intermediaries === 1 ? "" : "s"}. Among the characters on the route, ${highest.character} has the highest betweenness (${highest.centrality.Betweenness.toFixed(4)}). <strong>Possible interpretation:</strong> the route shows a short connection in the undirected network; the available measures describe the characters on it, but do not by themselves establish why the editorial links exist.</p>`;
  } else {
    pathInsight.hidden = true;
  }
}

function renderPathResult(html) {
  pathResult.hidden = false;
  pathResult.innerHTML = html;
}

function explorePath() {
  const start = pathLookup(pathStart.value);
  const destination = pathLookup(pathDestination.value);
  if (!start) {
    pathSearch = null;
    pathStartId = null;
    nearestPathIds = [];
    furthestPathIds = [];
    pathMessage.textContent = "Please select or type a valid starting character.";
    pathResult.hidden = true;
    pathTreeControls.hidden = true;
    setSelectedPath([]);
    return;
  }
  pathStart.value = start.character;
  if (destination) pathDestination.value = destination.character;
  if (pathDestination.value.trim() && !destination) {
    pathSearch = null;
    pathStartId = null;
    nearestPathIds = [];
    furthestPathIds = [];
    pathTreeControls.hidden = true;
    pathMessage.textContent = "Please select or type a valid destination character.";
    return;
  }
  if (destination) {
    pathSearch = null;
    pathStartId = null;
    nearestPathIds = [];
    furthestPathIds = [];
    pathViewMode = "linear";
    pathTreeControls.hidden = true;
    const ids = shortestPath(start.id, destination.id);
    if (!ids) {
      pathMessage.textContent = `${start.character} and ${destination.character} are not connected in the network.`;
      pathResult.hidden = true;
      setSelectedPath([]);
      return;
    }
    pathMessage.textContent = "Shortest path found.";
    renderPathResult(`<h3>Shortest path</h3><div class="path-chain">${renderPathChain(ids)}</div><p><strong>Distance:</strong> ${ids.length - 1} links</p><button class="path-button" id="path-load-result" type="button">EXPLORE THIS PATH</button>`);
    document.querySelector("#path-load-result").addEventListener("click", () => setSelectedPath(ids));
    return;
  }
  const search = pathsFrom(start.id);
  pathStartId = start.id;
  pathSearch = search;
  pathTreeControls.hidden = false;
  const reachable = [...search.distance.entries()].filter(([id]) => id !== start.id);
  if (!reachable.length) {
    pathMessage.textContent = `${start.character} has no other reachable characters.`;
    pathResult.hidden = true;
    pathTreeControls.hidden = true;
    setSelectedPath([]);
    return;
  }
  const nearestDistance = Math.min(...reachable.map(([, distance]) => distance));
  const furthestDistance = Math.max(...reachable.map(([, distance]) => distance));
  const nearest = reachable.filter(([, distance]) => distance === nearestDistance).map(([id]) => id);
  const furthest = reachable.filter(([, distance]) => distance === furthestDistance).map(([id]) => id);
  nearestPathIds = nearest.map(id => reconstructPath(search.previous, id));
  furthestPathIds = furthest.map(id => reconstructPath(search.previous, id));
  const furthestButtons = furthest.map(id => `<button class="path-option" data-furthest-id="${id}" type="button">${nodeInfo(id).character}</button>`).join("");
  renderPathResult(`<h3>Reachability from ${start.character}</h3><p>${reachable.length} reachable characters; unreachable characters are excluded.</p><p><strong>Shortest reachable path:</strong> ${nearestDistance} link${nearestDistance === 1 ? "" : "s"} (${nearest.map(id => nodeInfo(id).character).join(", ")})</p><p><strong>Furthest reachable character${furthest.length > 1 ? "s" : ""}:</strong> ${furthest.map(id => nodeInfo(id).character).join(", ")} · <strong>Shortest-path distance:</strong> ${furthestDistance} links</p><table class="fragmentation-table"><thead><tr><th>Path</th><th>Distance</th></tr></thead><tbody><tr><td>Shortest reachable path</td><td>${nearestDistance} links</td></tr><tr><td>Longest shortest path</td><td>${furthestDistance} links</td></tr></tbody></table><div class="path-options">${furthestButtons}</div><p class="small-note">Average shortest-path distance across reachable characters: ${(d3.mean(reachable, ([, distance]) => distance)).toFixed(2)} links.</p>`);
  document.querySelectorAll("[data-furthest-id]").forEach(button => button.addEventListener("click", () => {
    const ids = reconstructPath(search.previous, button.dataset.furthestId);
    setSelectedPath(ids);
  }));
  setStartOnlyPath("all");
}

pathExplore.addEventListener("click", explorePath);
pathTreeControls.querySelectorAll("button").forEach(button => button.addEventListener("click", () => {
  setStartOnlyPath(button.dataset.treeMode);
}));
pathPrevious.addEventListener("click", () => {
  if (selectedPath.length) {
    pathStepIndex = Math.max(0, pathStepIndex - 1);
    renderPathSvg();
    renderPathDetail();
  }
});
pathNext.addEventListener("click", () => {
  if (selectedPath.length) {
    pathStepIndex = Math.min(selectedPath.length - 1, pathStepIndex + 1);
    renderPathSvg();
    renderPathDetail();
  }
});
pathPlay.addEventListener("click", () => {
  if (!selectedPath.length) return;
  if (pathTimer) {
    clearInterval(pathTimer);
    pathTimer = null;
    pathPlay.textContent = "PLAY PATH";
    return;
  }
  pathPlay.textContent = "PAUSE";
  pathTimer = setInterval(() => {
    if (pathStepIndex >= selectedPath.length - 1) {
      clearInterval(pathTimer);
      pathTimer = null;
      pathPlay.textContent = "PLAY PATH";
      return;
    }
    pathStepIndex += 1;
    renderPathSvg();
    renderPathDetail();
  }, 800);
});

function formatDirectionPercent(value) {
  return `${value.toFixed(1)}%`;
}

function renderDirectionDetail(row, directionData) {
  const positive = row.direction_difference >= 0;
  const magnitude = Math.abs(row.direction_difference);
  const interpretation = positive
    ? `This character ranks substantially higher for outgoing links than for incoming links. They link to many other characters while receiving relatively few links themselves.`
    : `This character ranks substantially higher for incoming links than for outgoing links. They are referenced by many other characters while linking outward relatively little.`;
  const tagText = row.tags.length
    ? `The page description contains these possible descriptors: ${row.tags.join(", ")}.`
    : "The available page description does not provide a clear shared category.";
  const maxLinks = Math.max(row.in_degree, row.out_degree, 1);
  directionDetail.innerHTML = `
    <h3>${row.character}</h3>
    <div class="direction-layout">
      <div>
        <dl class="direction-stats">
          <div><dt>In-degree</dt><dd>${row.in_degree}</dd></div>
          <div><dt>Out-degree</dt><dd>${row.out_degree}</dd></div>
          <div><dt>In-rank</dt><dd>${row.in_rank}</dd></div>
          <div><dt>Out-rank</dt><dd>${row.out_rank}</dd></div>
          <div><dt>In percentile</dt><dd>${formatDirectionPercent(row.in_percentile)}</dd></div>
          <div><dt>Out percentile</dt><dd>${formatDirectionPercent(row.out_percentile)}</dd></div>
          <div><dt>Direction difference</dt><dd>${formatDirectionPercent(row.direction_difference)} points</dd></div>
        </dl>
        <p>${interpretation} The directional gap is ${magnitude.toFixed(1)} percentage points. ${tagText}</p>
        <p class="small-note">${row.description}</p>
      </div>
      <div class="direction-flow" aria-label="Incoming versus outgoing links">
        <div class="direction-flow-row"><span>Incoming: ${row.in_degree}</span><div class="direction-flow-track"><div class="direction-flow-fill" style="width: ${(row.in_degree / maxLinks) * 100}%"></div></div></div>
        <div class="direction-flow-row outgoing"><span>Outgoing: ${row.out_degree}</span><div class="direction-flow-track"><div class="direction-flow-fill" style="width: ${(row.out_degree / maxLinks) * 100}%"></div></div></div>
      </div>
    </div>`;
}

function renderDirectionSynthesis(directionData) {
  const outgoing = directionData.links_out_more;
  const incoming = directionData.linked_to_more;
  const allRows = directionData.rows;
  const common = directionData.common_tag;
  const overlap = outgoing.filter(row => incoming.some(other => other.id === row.id)).length;
  const outgoingNames = outgoing.slice(0, 3).map(row => row.character).join(", ");
  const incomingNames = incoming.slice(0, 3).map(row => row.character).join(", ");
  const pattern = common
    ? `Across both Top 5 lists, the most frequent descriptor found in the available page text is “${common.label}” (${common.count} of 10 entries), but this is only a textual signal rather than a definitive character category.`
    : "The available page descriptions do not show an obvious common category across the two Top 5 lists.";
  directionSynthesis.innerHTML = `<h3>What do we learn?</h3><p><strong>Network observation:</strong> the strongest outgoing-over-incoming cases are ${outgoingNames}; the strongest incoming-over-outgoing cases are ${incomingNames}. ${overlap ? `There are ${overlap} characters appearing in both lists.` : "There is no overlap between the two Top 5 lists."} The rankings show that some characters link outward a lot while being rarely linked to, while others occupy the opposite role. <strong>Possible interpretation:</strong> ${pattern} The page information should be treated as context for the network pattern, not as proof of a shared type.</p>`;
}

function renderDirection(data) {
  const directionData = data.direction;
  const rows = directionData[directionMode];
  const width = directionChart.node().clientWidth || 820;
  const height = 410;
  const margin = { top: 20, right: 100, bottom: 42, left: 190 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const maxMagnitude = d3.max(rows, row => Math.abs(row.direction_difference)) || 1;
  const x = d3.scaleLinear().domain(directionMode === "links_out_more" ? [0, maxMagnitude] : [-maxMagnitude, 0]).nice().range([0, innerWidth]);
  const y = d3.scaleBand().domain(rows.map(row => row.character)).range([0, innerHeight]).padding(.22);
  directionChart.attr("viewBox", `0 0 ${width} ${height}`).selectAll("*").remove();
  const chart = directionChart.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
  chart.append("g").attr("class", "direction-grid").attr("transform", `translate(0,${innerHeight})`).call(d3.axisBottom(x).ticks(5).tickSize(-innerHeight).tickFormat(""));
  chart.append("g").attr("class", "direction-axis").call(d3.axisLeft(y).tickSize(0)).selectAll("text").attr("fill", "#f2eaf5").attr("font-family", "DM Mono").attr("font-size", "10px");
  chart.append("g").attr("class", "direction-axis").attr("transform", `translate(0,${innerHeight})`).call(d3.axisBottom(x).ticks(5).tickFormat(value => `${value.toFixed(0)}%`)).selectAll("text").attr("fill", "#f2eaf5").attr("font-family", "DM Mono").attr("font-size", "10px");
  const baseline = directionMode === "links_out_more" ? x(0) : x(0);
  chart.append("line").attr("x1", baseline).attr("x2", baseline).attr("y1", 0).attr("y2", innerHeight).attr("stroke", "#f2eaf5").attr("stroke-opacity", .55);
  const bars = chart.append("g").selectAll("rect").data(rows).join("rect")
    .attr("class", row => `direction-bar${row.id === selectedDirectionId ? " is-selected" : ""}`)
    .attr("x", row => directionMode === "links_out_more" ? x(0) : x(row.direction_difference))
    .attr("y", row => y(row.character))
    .attr("width", row => Math.abs(x(row.direction_difference) - x(0)))
    .attr("height", y.bandwidth())
    .on("click", (event, row) => {
      selectedDirectionId = row.id;
      renderDirection(data);
    });
  bars.append("title").text(row => `${row.character}: ${formatDirectionPercent(row.direction_difference)} points`);
  chart.append("g").selectAll("text").data(rows).join("text")
    .attr("class", "direction-label")
    .attr("x", row => directionMode === "links_out_more" ? x(row.direction_difference) + 8 : x(row.direction_difference) - 8)
    .attr("y", row => y(row.character) + y.bandwidth() / 2 + 4)
    .attr("text-anchor", directionMode === "links_out_more" ? "start" : "end")
    .text(row => formatDirectionPercent(row.direction_difference));
  const selected = directionData.rows.find(row => row.id === selectedDirectionId) || rows[0];
  selectedDirectionId = selected.id;
  renderDirectionDetail(selected, directionData);
  renderDirectionSynthesis(directionData);
}

directionControls.querySelectorAll("button").forEach(button => button.addEventListener("click", () => {
  directionMode = button.dataset.direction;
  directionControls.querySelectorAll("button").forEach(item => item.classList.toggle("is-active", item === button));
  selectedDirectionId = data.direction[directionMode][0].id;
  renderDirection(data);
}));

metricControls.querySelectorAll("button").forEach(button => button.addEventListener("click", () => {
  metric = button.dataset.metric;
  metricControls.querySelectorAll("button").forEach(item => item.classList.toggle("is-active", item === button));
  updateSelectionAfterChange();
}));

orderControls.querySelectorAll("button").forEach(button => button.addEventListener("click", () => {
  mode = button.dataset.mode;
  orderControls.querySelectorAll("button").forEach(item => item.classList.toggle("is-active", item === button));
  updateSelectionAfterChange();
}));

fetch("../data/week3_centrality.json")
  .then(response => {
    if (!response.ok) throw new Error(`Could not load Week 3 data: ${response.status}`);
    return response.json();
  })
  .then(loaded => {
    data = loaded;
    pathData = data.path_network;
    pathAdjacency = new Map(pathData.nodes.map(node => [node.id, []]));
    pathData.edges.forEach(edge => {
      pathAdjacency.get(edge.source).push(edge.target);
      pathAdjacency.get(edge.target).push(edge.source);
    });
    pathData.nodes.sort((a, b) => a.character.localeCompare(b.character)).forEach(node => {
      const option = document.createElement("option");
      option.value = node.character;
      pathOptions.appendChild(option);
    });
    updateSelectionAfterChange();
    renderFragmentation(data);
    selectedDirectionId = data.direction.links_out_more[0].id;
    renderDirection(data);
  })
  .catch(error => {
    detailHeading.textContent = "DATA UNAVAILABLE";
    detailTable.innerHTML = `<tr><td colspan="6">The Week 3 centrality data could not be loaded.</td></tr>`;
    console.error(error);
  });

const cliqueControls = document.querySelector("#clique-controls");
const cliqueChart = d3.select("#clique-chart");
const cliqueSummary = document.querySelector("#clique-summary");
const cliqueTable = document.querySelector("#clique-table-body");
const homophilyControls = document.querySelector("#homophily-controls");
const homophilySummary = document.querySelector("#homophily-summary");
const homophilyChart = d3.select("#homophily-chart");
let cliqueData;
let selectedCliqueId;
let selectedAttribute = "team";

const cliqueCategory = (value, known, label) => value
  ? `${label}: ${value.label} · ${value.count}/${value.of}${value.distinct > 1 ? ` · ${value.distinct} labels` : ""}`
  : `${label}: — (${known} known)`;

function renderClique(clique) {
  const width = cliqueChart.node().clientWidth || 700;
  const height = 420;
  const center = { x: width / 2, y: height / 2 };
  const radius = Math.min(width, height) * .31;
  const members = clique.members.map((member, index) => ({ ...member, angle: -Math.PI / 2 + index * 2 * Math.PI / clique.members.length }));
  const point = member => ({ x: center.x + radius * Math.cos(member.angle), y: center.y + radius * Math.sin(member.angle) });
  cliqueChart.attr("viewBox", `0 0 ${width} ${height}`).selectAll("*").remove();
  const svg = cliqueChart.append("g");
  svg.append("text").attr("class", "clique-label").attr("x", 18).attr("y", 25).text(`CLIQUE ${String(clique.rank).padStart(2, "0")} · EVERY PAIR CONNECTED`);
  svg.selectAll("line").data(d3.cross(members, members).filter(([a, b]) => a.id < b.id)).join("line")
    .attr("class", "clique-link").attr("x1", d => point(d[0]).x).attr("y1", d => point(d[0]).y).attr("x2", d => point(d[1]).x).attr("y2", d => point(d[1]).y);
  const nodes = svg.selectAll("g.member").data(members).join("g").attr("transform", d => `translate(${point(d).x},${point(d).y})`);
  nodes.append("circle").attr("class", "clique-node").attr("r", 8);
  nodes.append("text").attr("class", "clique-label").attr("x", d => Math.cos(d.angle) < -.15 ? -12 : 12).attr("y", 4)
    .attr("text-anchor", d => Math.cos(d.angle) < -.15 ? "end" : "start").text(d => d.name);
  const teamText = clique.team ? `${clique.team.label} appears for ${clique.team.count}/${clique.size} members${clique.team.distinct > 1 ? `; this clique mixes ${clique.team.distinct} listed teams.` : "."}` : "No reliable team affiliation was extracted for this clique.";
  const overlap = clique.overlap ? ` Its closest displayed neighbour is Clique ${String(clique.overlap.rank).padStart(2, "0")} (${clique.overlap.count}/${clique.size} shared characters).` : "";
  cliqueSummary.innerHTML = `<h3>CLIQUE ${String(clique.rank).padStart(2, "0")}</h3><dl class="clique-stats"><div><dt>Circle</dt><dd>${clique.size} CHARACTERS · ${clique.internal_edges} / ${clique.possible_edges} CONNECTIONS</dd></div><div><dt>Team</dt><dd>${cliqueCategory(clique.team, clique.team_known_members, "TEAM")}</dd></div><div><dt>Decade</dt><dd>${cliqueCategory(clique.decade, clique.decade_known_members, "DECADE")}</dd></div></dl><p>${teamText}${overlap}</p>`;
}

function renderCliqueTable() {
  cliqueTable.replaceChildren();
  cliqueData.cliques.cliques.forEach(clique => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td><button type="button">${String(clique.rank).padStart(2, "0")}</button></td><td>${clique.size}</td><td>${clique.internal_edges} / ${clique.possible_edges}</td><td>${clique.team ? `${clique.team.label} · ${clique.team.count}/${clique.size}` : "—"}</td><td>${clique.decade ? `${clique.decade.label} · ${clique.decade.count}/${clique.size}` : "—"}</td>`;
    tr.querySelector("button").addEventListener("click", () => selectClique(clique.id));
    cliqueTable.appendChild(tr);
  });
}

function selectClique(id) {
  selectedCliqueId = id;
  cliqueControls.querySelectorAll("button").forEach(button => button.classList.toggle("is-active", button.dataset.id === id));
  renderClique(cliqueData.cliques.cliques.find(clique => clique.id === id));
}

function renderHomophily() {
  const result = cliqueData.homophily[selectedAttribute];
  const pct = value => `${(value * 100).toFixed(1)}%`;
  const max = Math.max(result.real, result.null_mean) * 1.15;
  homophilySummary.innerHTML = `<h3>${result.label.toUpperCase()}</h3><div class="homophily-bars"><div class="homophily-bar-row"><span>REAL NETWORK</span><div class="homophily-track"><div class="homophily-fill" style="width:${result.real / max * 100}%"></div></div><strong>${pct(result.real)}</strong></div><div class="homophily-bar-row null"><span>RANDOMIZED</span><div class="homophily-track"><div class="homophily-fill" style="width:${result.null_mean / max * 100}%"></div></div><strong>${pct(result.null_mean)} ± ${(result.null_sd * 100).toFixed(1)}</strong></div></div><p><strong>Z = ${formatZ(result.z)}.</strong> ${result.kind[0].toUpperCase() + result.kind.slice(1)} occurs more often than expected under degree-preserving rewiring. ${result.coverage.known_nodes}/${result.coverage.total_nodes} characters and ${result.valid_edges} eligible edges have known values.</p>`;
  const width = homophilyChart.node().clientWidth || 820, height = 170, margin = { top: 25, right: 28, bottom: 35, left: 28 };
  const x = d3.scaleLinear().domain([0, Math.max(result.real, d3.max(result.null_distribution)) * 1.12]).range([margin.left, width - margin.right]);
  homophilyChart.attr("viewBox", `0 0 ${width} ${height}`).selectAll("*").remove();
  homophilyChart.append("g").attr("class", "homophily-axis").attr("transform", `translate(0,${height - margin.bottom})`).call(d3.axisBottom(x).ticks(5).tickFormat(d => `${(d * 100).toFixed(0)}%`));
  homophilyChart.selectAll("circle.null").data(result.null_distribution).join("circle").attr("class", "homophily-dot").attr("cx", d => x(d)).attr("cy", (_, i) => 88 + ((i * 17) % 35)).attr("r", 3.5);
  homophilyChart.append("line").attr("x1", x(result.null_mean)).attr("x2", x(result.null_mean)).attr("y1", 25).attr("y2", 130).attr("stroke", "#bD7Dff").attr("stroke-width", 2);
  homophilyChart.append("circle").attr("class", "homophily-real").attr("cx", x(result.real)).attr("cy", 62).attr("r", 6);
  homophilyChart.append("text").attr("class", "homophily-label").attr("x", x(result.real)).attr("y", 45).attr("text-anchor", "middle").text(`REAL ${pct(result.real)}`);
  homophilyChart.append("text").attr("class", "homophily-label").attr("x", x(result.null_mean)).attr("y", 150).attr("text-anchor", "middle").text(`NULL MEAN ${pct(result.null_mean)}`);
}

fetch("../data/week3_cliques_homophily.json")
  .then(response => { if (!response.ok) throw new Error(`Could not load clique data: ${response.status}`); return response.json(); })
  .then(loaded => {
    cliqueData = loaded;
    loaded.cliques.cliques.forEach(clique => {
      const button = document.createElement("button"); button.type = "button"; button.className = "clique-button"; button.dataset.id = clique.id; button.textContent = `CLIQUE ${String(clique.rank).padStart(2, "0")}`;
      button.addEventListener("click", () => selectClique(clique.id)); cliqueControls.appendChild(button);
    });
    Object.entries(loaded.homophily).forEach(([key, value]) => {
      const button = document.createElement("button"); button.type = "button"; button.className = "homophily-button"; button.dataset.attribute = key; button.textContent = value.label.toUpperCase();
      button.addEventListener("click", () => { selectedAttribute = key; homophilyControls.querySelectorAll("button").forEach(item => item.classList.toggle("is-active", item === button)); renderHomophily(); }); homophilyControls.appendChild(button);
    });
    selectedAttribute = Object.keys(loaded.homophily)[0]; homophilyControls.querySelector("button").classList.add("is-active");
    renderCliqueTable(); selectClique(loaded.cliques.cliques[0].id); renderHomophily();
  })
  .catch(error => { cliqueSummary.innerHTML = "<h3>DATA UNAVAILABLE</h3><p>The clique and homophily dataset could not be loaded.</p>"; console.error(error); });
