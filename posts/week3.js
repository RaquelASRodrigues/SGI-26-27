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

let data;
let mode = "top";
let metric = "Degree";
let selectedId;
let directionMode = "links_out_more";
let selectedDirectionId;

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