const palette = {
  ink: "#0a090d",
  lilac: "#bd7dff",
  magenta: "#e84e83",
  cyan: "#21f3c6",
  paper: "#f2eaf5",
  muted: "#a99caf",
  purple: "#7d2ed8"
};

const tooltip = d3.select("#tooltip");
const format = value => d3.format(".3f")(value);
const metricValue = metric => typeof metric === "number" ? metric : metric.mean;
const axisStyle = selection => selection.selectAll("text")
  .attr("fill", palette.paper)
  .attr("font-family", "DM Mono")
  .attr("font-size", "10px");
const showTip = (event, html) => tooltip.html(html)
  .style("left", `${event.clientX + 14}px`)
  .style("top", `${event.clientY + 14}px`)
  .style("opacity", 1);
const hideTip = () => tooltip.style("opacity", 0);

fetch("../data/week2_models.json")
  .then(response => {
    if (!response.ok) throw new Error(`Could not load Week 2 data: ${response.status}`);
    return response.json();
  })
  .then(data => {
    renderCcdf(data);
    renderFriendship(data);
    renderNullModel(data);
    renderScoreboard(data);
    renderWs(data);
    document.querySelector("#interpretation-copy").textContent = data.interpretation.text;
    const global = data.friendship.global;
    document.querySelector("#mean-degree-copy").textContent = `${format(global.mean_degree)} connections on average, while a reached friend has ${format(global.mean_friend_degree)}`;
  })
  .catch(error => {
    document.querySelectorAll(".widget").forEach(widget => widget.insertAdjacentHTML("beforeend", `<p class="small-note">The Week 2 data could not be loaded.</p>`));
    console.error(error);
  });

function chartFrame(svg, margin) {
  const width = svg.node().clientWidth || 780;
  const height = svg.node().clientHeight || 410;
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  svg.attr("viewBox", `0 0 ${width} ${height}`).selectAll("*").remove();
  const chart = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
  const clipId = `${svg.attr("id")}-clip`;
  svg.append("defs").append("clipPath").attr("id", clipId)
    .append("rect").attr("width", innerWidth).attr("height", innerHeight);
  return { width, height, innerWidth, innerHeight, chart, plot: chart.append("g").attr("clip-path", `url(#${clipId})`) };
}

function addAxes(frame, x, y, xLabel, yLabel, xTicks, yTicks) {
  const { chart, innerWidth, innerHeight } = frame;
  chart.append("g").attr("class", "chart-grid").attr("transform", `translate(0,${innerHeight})`)
    .call(d3.axisBottom(x).ticks(xTicks).tickSize(-innerHeight).tickFormat(""));
  chart.append("g").attr("class", "chart-grid")
    .call(d3.axisLeft(y).ticks(yTicks).tickSize(-innerWidth).tickFormat(""));
  chart.append("g").attr("class", "chart-axis").attr("transform", `translate(0,${innerHeight})`)
    .call(d3.axisBottom(x).ticks(xTicks)).call(axisStyle);
  chart.append("g").attr("class", "chart-axis").call(d3.axisLeft(y).ticks(yTicks)).call(axisStyle);
  chart.append("text").attr("class", "chart-label").attr("x", innerWidth / 2).attr("y", innerHeight + 38)
    .attr("text-anchor", "middle").text(xLabel);
  chart.append("text").attr("class", "chart-label").attr("transform", "rotate(-90)")
    .attr("x", -innerHeight / 2).attr("y", -36).attr("text-anchor", "middle").text(yLabel);
}

function renderCcdf(data) {
  const svg = d3.select("#ccdf-svg");
  const controls = d3.select("#ccdf-controls");
  const modes = { in: "In-Degree", out: "Out-Degree", undirected: "Undirected" };
  let mode = "in";
  Object.entries(modes).forEach(([key, label]) => controls.append("button")
    .attr("class", `widget-button${key === mode ? " is-active" : ""}`)
    .text(label)
    .on("click", function() {
      mode = key;
      controls.selectAll("button").classed("is-active", false);
      d3.select(this).classed("is-active", true);
      draw();
    }));
  function draw() {
    const margin = { top: 22, right: 22, bottom: 62, left: 64 };
    const frame = chartFrame(svg, margin);
    const model = data.degree_ccdf[mode];
    const real = model.real;
    const maxK = d3.max([real, model.poisson || [], model.er_band || [], model.ba_band || []].flat(), point => point.k) || 1;
    const minP = Math.max(.001, d3.min(real, point => point.p) || .001);
    const x = d3.scaleLog().domain([1, maxK]).range([0, frame.innerWidth]);
    const y = d3.scaleLog().domain([minP, 1]).range([frame.innerHeight, 0]);
    addAxes(frame, x, y, "Degree (k)", "P(K ≥ k) — Survival Probability", 5, 3);
    frame.chart.selectAll(".chart-axis").filter((d, index, nodes) => index === 1)
      .call(d3.axisLeft(y).tickValues([1, .1, .01]).tickFormat(d3.format(".0%"))).call(axisStyle);
    const line = d3.line().defined(point => point.p > 0).x(point => x(point.k)).y(point => y(point.p));
    const area = d3.area().x(point => x(point.k)).y0(point => y(point.low)).y1(point => y(point.high));
    if (model.er_band) {
      frame.plot.append("path").datum(model.er_band).attr("fill", palette.cyan).attr("fill-opacity", .2).attr("d", area);
      frame.plot.append("path").datum(model.er_band).attr("fill", "none").attr("stroke", palette.cyan).attr("stroke-opacity", .7).attr("d", d3.line().x(point => x(point.k)).y(point => y(point.mean)));
    }
    if (model.ba_band) {
      frame.plot.append("path").datum(model.ba_band).attr("fill", palette.lilac).attr("fill-opacity", .2).attr("d", area);
      frame.plot.append("path").datum(model.ba_band).attr("fill", "none").attr("stroke", palette.lilac).attr("stroke-opacity", .8).attr("d", d3.line().x(point => x(point.k)).y(point => y(point.mean)));
    }
    frame.plot.append("path").datum(real).attr("fill", "none").attr("stroke", palette.magenta).attr("stroke-width", 2.3).attr("d", line);
    if (model.poisson) frame.plot.append("path").datum(model.poisson).attr("fill", "none").attr("stroke", palette.cyan).attr("stroke-dasharray", "4 4").attr("d", line);
  }
  draw();
}

function renderFriendship(data) {
  const svg = d3.select("#friendship-svg");
  const rows = data.friendship.characters.filter(row => row.degree > 0 && row.average_neighbor_degree !== null);
  const margin = { top: 22, right: 20, bottom: 62, left: 68 };
  const frame = chartFrame(svg, margin);
  const x = d3.scaleLinear().domain([0, d3.max(rows, row => row.degree)]).nice().range([0, frame.innerWidth]);
  const y = d3.scaleLinear().domain([0, d3.max(rows, row => row.average_neighbor_degree)]).nice().range([frame.innerHeight, 0]);
  addAxes(frame, x, y, "Character Degree k", "Average Neighbor Degree <k_nn>", 6, 5);
  frame.plot.append("line").attr("x1", x(0)).attr("x2", x(d3.max([d3.max(rows, row => row.degree), d3.max(rows, row => row.average_neighbor_degree)])))
    .attr("y1", y(0)).attr("y2", y(d3.max([d3.max(rows, row => row.degree), d3.max(rows, row => row.average_neighbor_degree)])))
    .attr("stroke", palette.cyan).attr("stroke-dasharray", "5 4").attr("stroke-opacity", .8);
  frame.chart.append("text").attr("class", "chart-label").attr("x", frame.innerWidth - 4).attr("y", y(Math.min(d3.max(rows, row => row.average_neighbor_degree), d3.max(rows, row => row.degree))) - 8).attr("text-anchor", "end").text("y = x");
  const points = frame.plot.selectAll("circle").data(rows).join("circle")
    .attr("cx", row => x(row.degree)).attr("cy", row => y(row.average_neighbor_degree))
    .attr("r", row => row.degree > row.average_neighbor_degree ? 4.8 : 3.2)
    .attr("fill", row => row.degree > row.average_neighbor_degree ? palette.magenta : palette.lilac).attr("fill-opacity", .72);
  points.on("pointerenter", (event, row) => showTip(event, `<strong>${row.name}</strong><br>degree: ${row.degree}<br>neighbour average: ${format(row.average_neighbor_degree)}`))
    .on("pointerleave", hideTip);
  const search = document.querySelector("#friendship-search");
  const detail = document.querySelector("#friendship-detail");
  search.addEventListener("input", () => {
    const query = search.value.trim().toLowerCase();
    points.attr("stroke", row => query && row.name.toLowerCase().includes(query) ? palette.paper : "none").attr("stroke-width", 2);
    const row = rows.find(item => item.name.toLowerCase() === query) || rows.find(item => item.name.toLowerCase().includes(query));
    if (!row) {
      detail.textContent = query ? "No matching character found in the network." : "Search for a character to inspect their highest-degree neighbours.";
      return;
    }
    detail.innerHTML = `<strong>${row.name}</strong><br>degree ${row.degree} · neighbour average ${format(row.average_neighbor_degree)}<br><br>Top connected neighbours:`;
    const list = document.createElement("ul");
    list.className = "neighbor-list";
    row.top_neighbors.slice(0, 5).forEach(neighbour => {
      const item = document.createElement("li");
      item.textContent = `${neighbour.name} · ${neighbour.degree}`;
      list.appendChild(item);
    });
    detail.appendChild(list);
  });
}

function renderNullModel(data) {
  const svg = d3.select("#null-model-svg");
  const observed = data.null_models.real_clustering;
  const controls = d3.select("#null-controls");
  let mode = "degree_preserving";
  const modes = {
    degree_preserving: "Degree-preserving",
    er: "ER"
  };
  Object.entries(modes).forEach(([key, label]) => controls.append("button")
    .attr("class", `widget-button${key === mode ? " is-active" : ""}`)
    .text(label)
    .on("click", function() {
      mode = key;
      controls.selectAll("button").classed("is-active", false);
      d3.select(this).classed("is-active", true);
      draw();
    }));
  function draw() {
    const samples = data.null_models[mode].samples;
    const summary = data.null_models[mode].summary;
    document.querySelector("#null-stat").textContent = `Z ${format(summary.z_score)} · p < 1/161`;
  const margin = { top: 22, right: 20, bottom: 62, left: 64 };
  const frame = chartFrame(svg, margin);
  const bins = d3.bin().thresholds(18)(samples);
  const x = d3.scaleLinear().domain([d3.min(samples), Math.max(d3.max(samples), observed)]).nice().range([0, frame.innerWidth]);
  const y = d3.scaleLinear().domain([0, d3.max(bins, bin => bin.length)]).nice().range([frame.innerHeight, 0]);
  addAxes(frame, x, y, "Average Clustering Coefficient (C)", "Frequency (Number of Shuffled Networks)", 5, 5);
  frame.plot.selectAll("rect").data(bins).join("rect").attr("x", bin => x(bin.x0) + 1).attr("y", bin => y(bin.length))
    .attr("width", bin => Math.max(0, x(bin.x1) - x(bin.x0) - 2)).attr("height", bin => y(0) - y(bin.length))
    .attr("fill", palette.lilac).attr("fill-opacity", .72);
  frame.plot.append("line").attr("x1", x(observed)).attr("x2", x(observed)).attr("y1", 0).attr("y2", frame.innerHeight)
    .attr("stroke", palette.magenta).attr("stroke-width", 2).attr("stroke-dasharray", "5 4");
  frame.chart.append("text").attr("class", "chart-label").attr("x", Math.min(frame.innerWidth - 4, x(observed) + 6)).attr("y", 14).attr("fill", palette.magenta).text(`Real Marvel C = ${format(observed)} · Z ${format(summary.z_score)} · p < 1/161`);
  }
  draw();
}

function renderScoreboard(data) {
  const models = [
    ["Real Marvel", data.scoreboard.real, "Observed reference network"],
    ["ER", data.scoreboard.er, "Good random baseline; misses hubs"],
    [`WS (q=${data.scoreboard.ws.q})`, data.scoreboard.ws.metrics, "Best local-to-global trade-off"],
    ["BA", data.scoreboard.ba, "Gets hubs; misses clustering/islands"]
  ];
  const fields = [["Clustering (C)", "clustering"], ["Path Length (L)", "path_length"], ["Giant Share", "giant_share"], ["Isolates", "isolates"], ["Max Degree", "max_degree"], ["Top-Hub Share", "top_hub_share"]];
  const table = d3.select("#scoreboard-table");
  table.append("thead").append("tr").selectAll("th").data(["Model", ...fields.map(field => field[0]), "Verdict"]).join("th").text(value => value);
  models.forEach(([name, metrics, verdict]) => {
    const row = table.append("tbody").append("tr");
    row.append("td").text(name);
    fields.forEach(([, key]) => row.append("td").text(key === "isolates" || key === "max_degree" ? d3.format(".0f")(metricValue(metrics[key])) : format(metricValue(metrics[key]))));
    row.append("td").text(verdict);
  });
}

function renderWs(data) {
  const svg = d3.select("#ws-svg");
  const rows = data.watts_strogatz.normalized;
  const controls = d3.select("#ws-controls");
  const qLabel = d3.select("#ws-q-label");
  const slider = controls.append("input").attr("class", "q-slider").attr("type", "range").attr("min", 0).attr("max", rows.length - 1).attr("step", 1).attr("value", rows.findIndex(row => row.q === data.scoreboard.ws.q));
  const margin = { top: 22, right: 62, bottom: 62, left: 64 };
  const frame = chartFrame(svg, margin);
  const x = d3.scaleLog().domain([.001, 1]).range([0, frame.innerWidth]);
  const yLeft = d3.scaleLinear().domain([0, 1.1]).range([frame.innerHeight, 0]);
  const yRight = d3.scaleLinear().domain([0, 1.1]).range([frame.innerHeight, 0]);
  addAxes(frame, x, yLeft, "Rewiring Probability q", "C(q)/C(0) — Normalized Clustering", 5, 5);
  frame.chart.append("g").attr("class", "chart-axis").attr("transform", `translate(${frame.innerWidth},0)`).call(d3.axisRight(yRight).ticks(5)).call(axisStyle);
  frame.chart.append("text").attr("class", "chart-label").attr("transform", "rotate(90)").attr("x", frame.innerHeight / 2).attr("y", 48).attr("text-anchor", "middle").text("L(q)/L(0) — Normalized Path Length");
  [["clustering_ratio", palette.magenta], ["path_ratio", palette.cyan]].forEach(([key, color]) => {
    const line = d3.line().x(row => x(Math.max(row.q, .001))).y(row => yLeft(row[key].mean));
    const area = d3.area().x(row => x(Math.max(row.q, .001))).y0(row => yLeft(row[key].low)).y1(row => yLeft(row[key].high));
    frame.plot.append("path").datum(rows).attr("fill", color).attr("fill-opacity", .2).attr("d", area);
    frame.plot.append("path").datum(rows).attr("fill", "none").attr("stroke", color).attr("stroke-width", 2).attr("d", line);
  });
  const marker = frame.plot.append("line").attr("stroke", palette.paper).attr("stroke-dasharray", "3 3").attr("y1", 0).attr("y2", frame.innerHeight);
  function updateMarker() {
    const row = rows[Number(slider.property("value"))];
    qLabel.text(`q = ${row.q}`);
    marker.attr("x1", x(Math.max(row.q, .001))).attr("x2", x(Math.max(row.q, .001)));
  }
  slider.on("input", updateMarker);
  updateMarker();
}
