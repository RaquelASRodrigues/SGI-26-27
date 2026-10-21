(() => {
  const colors = { pink: "#e84e83", teal: "#21f3c6", lilac: "#bd7dff", paper: "#f2eaf5", muted: "#a99caf", ink: "#0d0a12" };
  const fmt = d3.format(".3f");
  const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
  const tooltip = d3.select("#tooltip");
  const formulaic = new Set(["marvel", "comic", "comics", "published", "character", "series", "issue", "writer", "artist", "story", "appeared", "fictional", "superhero", "created"]);
  let data;
  let selectedPairKey = null;
  let visibleCount = 50;
  let filteredPairs = [];
  let pairsByKey;
  let indexById;
  let edgeLookup;

  fetch("../data/week7_unexpected_pairs.json")
    .then(response => {
      if (!response.ok) throw new Error(`Could not load unexpected-pairs analysis: ${response.status}`);
      return response.json();
    })
    .then(payload => {
      data = payload;
      configureMethodOptions();
      initialise();
    })
    .catch(error => {
      document.querySelector("#unexpected-filter-summary").innerHTML =
        '<span class="unexpected-error">Unexpected-pairs analysis could not be loaded. Check that the analysis output has been generated.</span>';
      document.querySelector("#unexpected-null-detail").textContent = "Null-model results are unavailable.";
      console.error(error);
    });

  function initialise() {
    indexById = new Map(data.nodes.map((node, index) => [node.id, index]));
    pairsByKey = new Map(data.pairs.map(pair => [pairKey(pair), pair]));
    edgeLookup = new Set(data.edges.map(edge => `${edge.source}\u0000${edge.target}`));
    const initialThreshold = methodThreshold(method()).default;
    const maximumDistance = d3.max(data.pairs.flatMap(pair =>
      [pair.a_to_b, pair.b_to_a, pair.undirected].filter(value => value !== null)
    )) || 1;
    document.querySelector("#unexpected-distance").max = maximumDistance;
    document.querySelector("#unexpected-method").addEventListener("change", resetMethodThreshold);
    document.querySelector("#unexpected-include-isolates").addEventListener("change", () => {
      visibleCount = 50;
      updatePairs();
      renderInterpretation(isolatePopulation());
      if (selectedPairKey) renderSelectedPair();
    });
    document.querySelector("#unexpected-include-unreachable").addEventListener("change", () => {
      visibleCount = 50;
      updatePairs();
    });
    document.querySelector("#unexpected-threshold").addEventListener("input", event => {
      document.querySelector("#unexpected-threshold-output").value = Number(event.target.value).toFixed(2);
      updatePairs();
    });
    document.querySelector("#unexpected-distance").addEventListener("input", event => {
      document.querySelector("#unexpected-distance-output").value = event.target.value;
      updatePairs();
    });
    document.querySelector("#unexpected-path-mode").addEventListener("change", () => {
      updatePairs();
      renderInterpretation(isolatePopulation());
    });
    document.querySelector("#unexpected-more").addEventListener("click", () => {
      visibleCount += 50;
      renderPairList();
    });
    document.querySelector("#unexpected-threshold").min = methodThreshold(method()).min;
    document.querySelector("#unexpected-threshold").max = methodThreshold(method()).max;
    document.querySelector("#unexpected-threshold").value = initialThreshold;
    document.querySelector("#unexpected-threshold-output").value = initialThreshold.toFixed(2);
    updatePairs();
    renderInterpretation(isolatePopulation());
  }

  function configureMethodOptions() {
    const option = document.querySelector('#unexpected-method option[value="mxbai"]');
    const available = data.meta.methods.includes("mxbai") &&
      data.meta.mxbai?.available === true &&
      data.meta.similarity_thresholds.mxbai &&
      data.pairs.every(pair => Number.isFinite(pair.mxbai));
    option.disabled = !available;
    option.textContent = available
      ? "mxbai embedding cosine"
      : "mxbai embedding cosine · pair results not generated";
    option.title = available
      ? "Validated mxbai pair scores and method-specific null cohort are precomputed."
      : "After preprocessing the validated matrix, run python analysis/week7_unexpected.py to add mxbai pair and null results.";
  }

  function pairKey(pair) { return `${pair.a}:${pair.b}`; }
  function method() { return document.querySelector("#unexpected-method").value; }
  function methodLabel(methodId = method()) {
    return ({
      tfidf: "TF-IDF cosine",
      lsa: "LSA cosine",
      minilm: "MiniLM embedding cosine",
      mxbai: "mxbai embedding cosine"
    })[methodId] || "Unavailable method";
  }
  function methodThreshold(methodId) {
    return data.meta.similarity_thresholds[methodId];
  }
  function mode() { return document.querySelector("#unexpected-path-mode").value; }
  function includeIsolates() { return document.querySelector("#unexpected-include-isolates").checked; }
  function includeUnreachable() { return document.querySelector("#unexpected-include-unreachable").checked; }
  function isolatePopulation() { return includeIsolates() ? "all" : "non_isolated"; }
  function isIsolated(node) { return node.in_degree === 0 && node.out_degree === 0; }
  function threshold() { return Number(document.querySelector("#unexpected-threshold").value); }
  function selectedDistance(pair) {
    if (mode() === "undirected") return pair.undirected;
    const distances = [pair.a_to_b, pair.b_to_a].filter(value => value !== null);
    return distances.length ? Math.min(...distances) : null;
  }
  function directedPathDirection(pair) {
    if (pair.a_to_b === null && pair.b_to_a === null) return null;
    if (pair.b_to_a === null) return [pair.a, pair.b];
    if (pair.a_to_b === null || pair.b_to_a < pair.a_to_b) return [pair.b, pair.a];
    return [pair.a, pair.b];
  }
  function pairDescription(pair) {
    if (mode() === "undirected") {
      return pair.undirected === null ? "Unreachable in undirected projection" :
        pair.undirected === 1 ? "Direct edge in undirected projection" : `${pair.undirected} steps in undirected projection`;
    }
    if (pair.a_to_b === null && pair.b_to_a === null) return "Unreachable in both directed directions";
    const [from, to] = directedPathDirection(pair);
    const distance = from === pair.a ? pair.a_to_b : pair.b_to_a;
    return distance === 1
      ? `Direct link · ${data.nodes[from].name} → ${data.nodes[to].name}`
      : `${distance} steps · ${data.nodes[from].name} → ${data.nodes[to].name}`;
  }
  function directText(pair) {
    const fromA = pair.direct_a_to_b;
    const fromB = pair.direct_b_to_a;
    if (!fromA && !fromB) return "No direct edge";
    if (fromA && fromB) return "Reciprocal direct links";
    return fromA
      ? `${data.nodes[pair.a].name} → ${data.nodes[pair.b].name}`
      : `${data.nodes[pair.b].name} → ${data.nodes[pair.a].name}`;
  }
  function rankPair(a, b) {
    const da = selectedDistance(a), db = selectedDistance(b);
    if (da === null && db !== null) return -1;
    if (da !== null && db === null) return 1;
    if (da !== db) return (db ?? -1) - (da ?? -1);
    return b[method()] - a[method()] || a.a - b.a || a.b - b.b;
  }

  function matchingPairs(includeIsolatedNodes) {
    const minDistance = Number(document.querySelector("#unexpected-distance").value);
    return data.pairs.filter(pair => {
      if (!includeIsolatedNodes && (isIsolated(data.nodes[pair.a]) || isIsolated(data.nodes[pair.b]))) return false;
      const distance = selectedDistance(pair);
      if (!includeUnreachable() && distance === null) return false;
      if (pair[method()] < threshold()) return false;
      return distance === null || distance >= minDistance;
    }).sort(rankPair);
  }

  function pairZScore(pair) {
    const observed = selectedDistance(pair);
    if (observed === null) return { value: null, reason: "Observed pair is unreachable; no finite path statistic." };
    const validRuns = pair[`${mode()}_null_valid_runs`];
    const mean = pair[`${mode()}_null_mean_distance`];
    const sd = pair[`${mode()}_null_sd_distance`];
    if (validRuns < 2 || !Number.isFinite(mean) || !Number.isFinite(sd)) {
      return { value: null, reason: "Fewer than two finite path distances in the null sample." };
    }
    if (sd <= 0) return { value: null, reason: "The finite null path-distance distribution has zero variance." };
    const value = (observed - mean) / sd;
    if (!Number.isFinite(value)) return { value: null, reason: "The z-score is undefined for this pair." };
    const interpretation = value > 0 ? "above the null expectation" : value < 0 ? "below the null expectation" : "at the null expectation";
    return { value, interpretation, validRuns };
  }

  function resetMethodThreshold() {
    const currentMethod = method();
    const slider = document.querySelector("#unexpected-threshold");
    const defaultValue = methodThreshold(currentMethod).default;
    slider.min = methodThreshold(currentMethod).min;
    slider.max = methodThreshold(currentMethod).max;
    slider.min = methodThreshold(currentMethod).min;
    slider.max = methodThreshold(currentMethod).max;
    slider.value = defaultValue;
    document.querySelector("#unexpected-threshold-output").value = defaultValue.toFixed(2);
    visibleCount = 50;
    updatePairs();
    renderInterpretation(isolatePopulation());
  }

  function updatePairs() {
    if (!data) return;
    const includedPairs = matchingPairs(true);
    const nonIsolatedPairs = matchingPairs(false);
    filteredPairs = includeIsolates() ? includedPairs : nonIsolatedPairs;
    visibleCount = Math.min(visibleCount, 50);
    const baseEligibleCount = data.pairs.filter(pair =>
      (includeIsolates() || (!isIsolated(data.nodes[pair.a]) && !isIsolated(data.nodes[pair.b]))) &&
      (includeUnreachable() || selectedDistance(pair) !== null)
    ).length;
    document.querySelector("#unexpected-filter-summary").textContent =
      `${filteredPairs.length.toLocaleString()} of ${baseEligibleCount.toLocaleString()} eligible distinct unordered pairs meet these filters · ordered by unreachable status, then longer path and higher similarity.`;
    const populationRows = data.pairs.filter(pair =>
      (includeIsolates() || (!isIsolated(data.nodes[pair.a]) && !isIsolated(data.nodes[pair.b]))) &&
      pair[method()] >= threshold()
    );
    const reachableAfterTextFilter = populationRows.filter(pair => selectedDistance(pair) !== null).length;
    const unreachableAfterTextFilter = populationRows.length - reachableAfterTextFilter;
    const reachabilityEligible = includeUnreachable()
      ? populationRows.length
      : reachableAfterTextFilter;
    document.querySelector("#unexpected-reachability-summary").textContent =
      `Pair reachability uses the ${mode()} definition: ${reachableAfterTextFilter.toLocaleString()} reachable and ${unreachableAfterTextFilter.toLocaleString()} unreachable pairs pass the method threshold and isolate filter. In directed mode, reachable means a path exists in at least one direction; it does not imply a reverse path. ${includeUnreachable() ? "Unreachable pairs are included" : "Unreachable pairs are excluded"}; ${reachabilityEligible.toLocaleString()} pairs remain before minimum-distance filtering.`;
    const includedLeading = includedPairs.slice(0, 5).map(pairKey);
    const nonIsolatedLeading = nonIsolatedPairs.slice(0, 5).map(pairKey);
    const leadingChange = includedLeading.length === 0 && nonIsolatedLeading.length === 0
      ? "Neither population has a leading pair under these filters."
      : includedLeading.join("|") === nonIsolatedLeading.join("|")
        ? "The leading ranked pairs do not change."
        : "The leading ranked pairs change when isolates are excluded.";
    const isolatedCount = data.nodes.filter(isIsolated).length;
    const isolatesIncluded = includeIsolates() ? isolatedCount : 0;
    const isolatesExcluded = isolatedCount - isolatesIncluded;
    const pairsRemoved = data.meta.eligible_unordered_pairs - data.meta.non_isolated_unordered_pairs;
    document.querySelector("#unexpected-isolate-summary").textContent =
      `${data.meta.eligible_unordered_pairs.toLocaleString()} eligible pairs with isolates included; ${data.meta.non_isolated_unordered_pairs.toLocaleString()} without. Isolated characters: ${isolatesIncluded} included / ${isolatesExcluded} excluded (${isolatedCount} total); excluding them removes ${pairsRemoved.toLocaleString()} pairs containing at least one isolate. Current filter matches: ${includedPairs.length.toLocaleString()} including / ${nonIsolatedPairs.length.toLocaleString()} excluding isolates. ${leadingChange}`;
    const population = isolatePopulation();
    renderNullDetail(data.meta.null_model.null_results_by_population[population][method()][mode()], method(), mode());
    renderPairList();
    if (!selectedPairKey || !filteredPairs.some(pair => pairKey(pair) === selectedPairKey)) {
      selectedPairKey = filteredPairs.length ? pairKey(filteredPairs[0]) : null;
      if (selectedPairKey) renderSelectedPair();
      else renderEmpty();
    } else renderSelectedPair();
  }

  function renderPairList() {
    const list = document.querySelector("#unexpected-pair-list");
    const slice = filteredPairs.slice(0, visibleCount);
    list.innerHTML = slice.length ? slice.map(pair => {
      const a = data.nodes[pair.a], b = data.nodes[pair.b];
      const distance = selectedDistance(pair);
      const z = pairZScore(pair);
      const why = distance === null
        ? `Unreachable in ${mode()} network · text match`
        : distance === 1 ? "Directly linked · text match" : `${distance} path edges · text match`;
      const key = pairKey(pair);
      const zLabel = z.value === null
        ? "Z-score: N/A"
        : `Z-score: ${z.value > 0 ? "+" : ""}${z.value.toFixed(2)} · ${z.interpretation} (n=${z.validRuns})`;
      const zClass = z.value === null ? "is-na" : z.value < 0 ? "is-negative" : "";
      return `<button type="button" class="unexpected-pair ${key === selectedPairKey ? "is-selected" : ""}" data-pair="${key}">
        <span class="unexpected-pair-names">${escapeHtml(a.name)} <span style="color:#a99caf">↔</span> ${escapeHtml(b.name)}</span>
        <span class="unexpected-pair-meta"><span class="unexpected-pair-similarity">${escapeHtml(methodLabel())} ${fmt(pair[method()])}</span><br>${escapeHtml(pairDescription(pair))}</span>
        <span class="unexpected-pair-zscore ${zClass}" title="${escapeHtml(z.reason || `Observed minus null mean divided by sample SD; finite paths in ${z.validRuns} of ${data.meta.null_model.networks} randomized graphs. ${z.interpretation}. Descriptive only, not an individual significance test.`)}">${escapeHtml(zLabel)}</span>
        <span class="unexpected-pair-why">${why}<br>${escapeHtml(directText(pair))}</span>
      </button>`;
    }).join("") : '<p class="unexpected-analysis">No pairs meet these filters. Try a lower similarity threshold or path distance.</p>';
    list.querySelectorAll("[data-pair]").forEach(button => button.addEventListener("click", () => {
      selectedPairKey = button.dataset.pair;
      renderPairList();
      renderSelectedPair();
    }));
    const more = document.querySelector("#unexpected-more");
    more.hidden = filteredPairs.length <= visibleCount;
    more.textContent = `SHOW ${Math.min(50, filteredPairs.length - visibleCount)} MORE PAIRS`;
  }

  function renderEmpty() {
    document.querySelector("#unexpected-kpis").innerHTML = "";
    document.querySelector("#unexpected-path-svg").replaceChildren();
    document.querySelector("#unexpected-path-note").textContent = "No pair meets the current filters.";
    document.querySelector("#unexpected-node-inspect").textContent = "Select another filter combination to see path information.";
    document.querySelector("#unexpected-explanation").innerHTML =
      "<h3>WHY ARE THESE CHARACTERS SIMILAR?</h3><p>No pair is currently selected.</p>";
  }

  function bfs(startId, goalId, directed) {
    const adjacency = new Map(data.nodes.map(node => [node.id, []]));
    for (const edge of data.edges) {
      adjacency.get(edge.source).push(edge.target);
      if (!directed) adjacency.get(edge.target).push(edge.source);
    }
    for (const neighbours of adjacency.values()) neighbours.sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
    const queue = [startId];
    const previous = new Map([[startId, null]]);
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const current = queue[cursor];
      if (current === goalId) break;
      for (const next of adjacency.get(current)) {
        if (previous.has(next)) continue;
        previous.set(next, current);
        queue.push(next);
      }
    }
    if (!previous.has(goalId)) return null;
    const path = [];
    for (let node = goalId; node !== null; node = previous.get(node)) path.push(node);
    return path.reverse();
  }

  function findPath(pair) {
    if (mode() === "undirected") return bfs(data.nodes[pair.a].id, data.nodes[pair.b].id, false);
    const direction = directedPathDirection(pair);
    if (!direction) return null;
    return bfs(data.nodes[direction[0]].id, data.nodes[direction[1]].id, true);
  }

  function renderSelectedPair() {
    const pair = pairsByKey.get(selectedPairKey);
    if (!pair) return;
    const a = data.nodes[pair.a], b = data.nodes[pair.b];
    const path = findPath(pair);
    const pathLength = path ? path.length - 1 : null;
    const direct = pair.direct_a_to_b || pair.direct_b_to_a;
    const population = isolatePopulation();
    const cohortResult = data.meta.null_model.null_results_by_population[population][method()][mode()];
    const pairZ = pairZScore(pair);
    const pairZLabel = pairZ.value === null
      ? `Pair path z-score · ${pairZ.reason}`
      : `Pair path z-score · ${pairZ.interpretation} (n=${pairZ.validRuns})`;
    const nullUnreachableRuns = pair[`${mode()}_null_unreachable_runs`];
    const nullValidRuns = pair[`${mode()}_null_valid_runs`];
    const nullNetworkCount = data.meta.null_model.networks;
    const nullMeanDistance = pair[`${mode()}_null_mean_distance`];
    const nullUnreachableText = Number.isFinite(nullUnreachableRuns) && nullNetworkCount > 0
      ? `unreachable in ${nullUnreachableRuns}/${nullNetworkCount} null graphs (${(100 * nullUnreachableRuns / nullNetworkCount).toFixed(1)}%)`
      : "null reachability unavailable";
    const observedReachability = pathLength === null
      ? (mode() === "directed" ? "unreachable in both directed directions" : "unreachable in the undirected projection")
      : (mode() === "directed" ? "reachable in at least one directed direction" : "reachable in the undirected projection");
    const nullUnreachDefinition = mode() === "directed"
      ? "null graphs with neither directed path"
      : "null graphs unreachable in the undirected projection";
    const pairNullSummary =
      `Observed ${observedReachability}; ${nullUnreachableText} (${nullUnreachDefinition}). Finite null distances: ${Number.isFinite(nullMeanDistance) ? `${fmt(nullMeanDistance)} mean (n=${nullValidRuns})` : "none"}. No pair-specific empirical p-value is implemented.`;

    const terms = explainPair(pair);
    const kpis = [
      [fmt(pair[method()]), `Semantic similarity · ${methodLabel()}`],
      [pathLength === null ? "Unreachable" : pathLength, `${mode() === "directed" ? "Directed" : "Undirected"} shortest path`],
      [direct ? "YES" : "NO", direct ? directText(pair) : "No direct edge either way"],
      [pathLength === null ? "N/A" : Math.max(0, pathLength - 1), "Intermediate characters"],
      [Number.isFinite(nullUnreachableRuns) && nullNetworkCount > 0 ? `${(100 * nullUnreachableRuns / nullNetworkCount).toFixed(1)}%` : "N/A", pairNullSummary],
      [pairZ.value === null ? "N/A" : `${pairZ.value > 0 ? "+" : ""}${pairZ.value.toFixed(2)}`, pairZLabel],
      [terms.length, method() === "tfidf" ? "Shared contributing terms" : "Shared context clues"]
    ];
    document.querySelector("#unexpected-kpis").innerHTML = kpis.map(([value, label]) =>
      `<div class="unexpected-kpi"><b>${escapeHtml(value)}</b><span>${escapeHtml(label)}</span></div>`).join("");

    const noPathNote = path === null
      ? mode() === "directed"
        ? `No directed path exists from ${a.name} to ${b.name} or from ${b.name} to ${a.name}. The pair remains explicitly unreachable; no finite distance is assigned.`
        : `No path exists between ${a.name} and ${b.name} in the undirected projection. No finite distance is assigned.`
      : mode() === "directed"
        ? `Shortest directed route: ${path.map(id => data.nodes[indexById.get(id)].name).join(" → ")} · ${path.length - 1} edge${path.length === 2 ? "" : "s"}.`
        : `Undirected-projection route: ${path.map(id => data.nodes[indexById.get(id)].name).join(" — ")} · ${path.length - 1} edge${path.length === 2 ? "" : "s"}; arrows below retain actual Wikipedia link direction.`;
    document.querySelector("#unexpected-path-note").textContent = noPathNote;
    renderPath(path, [a.id, b.id]);
    renderExplanation(pair, terms, a, b, pairNullSummary);
    renderNullDetail(cohortResult, method(), mode());
  }

  function renderPath(path, endpoints) {
    const svg = d3.select("#unexpected-path-svg");
    const width = svg.node().clientWidth || 700, height = svg.node().clientHeight || 300;
    svg.attr("viewBox", `0 0 ${width} ${height}`).selectAll("*").remove();
    const defs = svg.append("defs");
    defs.append("marker").attr("id", "unexpected-arrow").attr("viewBox", "0 -5 10 10")
      .attr("refX", 8).attr("refY", 0).attr("markerWidth", 7).attr("markerHeight", 7)
      .attr("orient", "auto").append("path").attr("d", "M0,-5L10,0L0,5").attr("fill", colors.teal);
    const pair = pairsByKey.get(selectedPairKey);
    if (!path) {
      const left = data.nodes[pair.a], right = data.nodes[pair.b];
      drawNode(svg, left, width * .28, height / 2, true);
      drawNode(svg, right, width * .72, height / 2, true);
      svg.append("text").attr("x", width / 2).attr("y", height / 2 - 22).attr("text-anchor", "middle")
        .attr("fill", colors.pink).attr("font-family", "DM Mono").attr("font-size", 11).text("UNREACHABLE");
      return;
    }
    const left = 54, right = width - 54, y = height / 2;
    const spacing = path.length === 1 ? 0 : (right - left) / (path.length - 1);
    const coords = new Map(path.map((id, i) => [id, { x: path.length === 1 ? width / 2 : left + spacing * i, y }]));
    for (let index = 0; index < path.length - 1; index++) {
      const from = path[index], to = path[index + 1];
      const forward = edgeLookup.has(`${from}\u0000${to}`);
      const actualSource = forward ? from : to;
      const actualTarget = forward ? to : from;
      const sourcePoint = coords.get(actualSource), targetPoint = coords.get(actualTarget);
      const bend = index % 2 === 0 ? -12 : 12;
      svg.append("path").attr("class", "unexpected-path-edge")
        .attr("d", `M${sourcePoint.x},${sourcePoint.y} Q${(sourcePoint.x + targetPoint.x) / 2},${y + bend} ${targetPoint.x},${targetPoint.y}`)
        .attr("marker-end", "url(#unexpected-arrow)");
      if (mode() === "undirected" && !forward) {
        svg.append("text").attr("x", (sourcePoint.x + targetPoint.x) / 2).attr("y", y + bend - 5)
          .attr("text-anchor", "middle").attr("fill", colors.pink).attr("font-family", "DM Mono").attr("font-size", 8)
          .text("arrow opposes travel");
      }
    }
    path.forEach((id, i) => {
      const point = coords.get(id), node = data.nodes[indexById.get(id)];
      drawNode(svg, node, point.x, point.y, endpoints.includes(id));
    });
  }

  function drawNode(svg, node, x, y, endpoint) {
    const group = svg.append("g").attr("tabindex", 0).attr("role", "button")
      .attr("aria-label", `${node.name}: ${node.in_degree} incoming links, ${node.out_degree} outgoing links`)
      .on("mouseenter", event => showNodeTooltip(event, node))
      .on("mousemove", event => showNodeTooltip(event, node))
      .on("mouseleave", hideTooltip)
      .on("focus", event => showNodeTooltip(event, node))
      .on("blur", hideTooltip)
      .on("click", () => inspectNode(node))
      .on("keydown", event => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); inspectNode(node); }
      });
    group.append("circle").attr("class", "unexpected-path-node").attr("cx", x).attr("cy", y)
      .attr("r", endpoint ? 11 : 8).attr("fill", endpoint ? colors.pink : colors.teal);
    group.append("text").attr("class", "unexpected-path-label")
      .attr("x", x).attr("y", y + 28).attr("text-anchor", "middle")
      .text(node.name.length > 24 ? `${node.name.slice(0, 22)}…` : node.name);
  }

  function showNodeTooltip(event, node) {
    tooltip.text(`${node.name}\nIn-degree ${node.in_degree} · Out-degree ${node.out_degree}`)
      .style("white-space", "pre-line")
      .style("left", `${Math.min(event.clientX + 12, window.innerWidth - 300)}px`)
      .style("top", `${Math.min(event.clientY + 12, window.innerHeight - 90)}px`)
      .style("opacity", 1);
  }
  function hideTooltip() { tooltip.style("opacity", 0); }

  function inspectNode(node) {
    document.querySelector("#unexpected-node-inspect").innerHTML =
      `<h4>${escapeHtml(node.name)}</h4><p>In-degree ${node.in_degree} · out-degree ${node.out_degree}</p><p>${escapeHtml(node.text.slice(0, 550))}${node.text.length > 550 ? "…" : ""}</p>${node.url ? `<a class="detail-link" href="${escapeHtml(node.url)}" target="_blank" rel="noopener noreferrer">OPEN WIKIPEDIA PAGE ↗</a>` : ""}`;
  }

  function sharedTermContributions(pair) {
    const a = data.tfidf_sparse_rows[pair.a], b = data.tfidf_sparse_rows[pair.b];
    const aWeights = new Map(a.indices.map((index, i) => [index, a.weights[i]]));
    const contributions = [];
    for (let i = 0; i < b.indices.length; i++) {
      const termIndex = b.indices[i];
      const aWeight = aWeights.get(termIndex);
      if (aWeight === undefined) continue;
      const contribution = aWeight * b.weights[i];
      if (contribution > 0) contributions.push({ term: data.tfidf_terms[termIndex], contribution });
    }
    return contributions.sort((x, y) => y.contribution - x.contribution);
  }

  function explainPair(pair) {
    return sharedTermContributions(pair).slice(0, 6);
  }

  function contextFor(text, term) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = new RegExp(`(?<!\\w)${escaped}(?!\\w)`, "i").exec(text);
    if (!match) return "Term occurs in this page; a nearby excerpt was not found.";
    const start = Math.max(0, match.index - 105), end = Math.min(text.length, match.index + match[0].length + 105);
    return `${start ? "…" : ""}${text.slice(start, end).replace(/\s+/g, " ")}${end < text.length ? "…" : ""}`;
  }

  function termTag(term, aName, bName) {
    const normalized = term.toLowerCase();
    const names = `${aName} ${bName}`.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    if (names.includes(normalized)) return "name/title wording";
    if (formulaic.has(normalized)) return "common page language";
    return "";
  }

  function renderExplanation(pair, terms, a, b, pairNullSummary) {
    const selectedMethodLabel = methodLabel();
    const lexicalTitle = method() === "tfidf" ? "Shared terms ranked by their exact TF-IDF dot-product contribution." :
      method() === "lsa" ? "Shared TF-IDF terms are contextual clues to the latent-space similarity; individual words do not decompose LSA cosine." :
        `Shared terms are contextual clues only; ${methodLabel()} does not decompose into word contributions.`;
    const termsHtml = terms.map(item => {
      const tag = termTag(item.term, a.name, b.name);
      const value = method() === "tfidf" ? `dot-product contribution ${item.contribution.toFixed(5)}` : "shared-vocabulary clue; not a model contribution";
      return `<div class="unexpected-term"><div class="unexpected-term-head">${escapeHtml(item.term)} <span class="unexpected-term-value">${escapeHtml(value)}</span>${tag ? `<span class="unexpected-tag">${escapeHtml(tag)}</span>` : ""}</div>
        <div class="unexpected-contexts"><div class="unexpected-context"><small>${escapeHtml(a.name)}</small>${escapeHtml(contextFor(a.text, item.term))}</div><div class="unexpected-context"><small>${escapeHtml(b.name)}</small>${escapeHtml(contextFor(b.text, item.term))}</div></div></div>`;
    }).join("");
    const contributionTotal = terms.reduce((sum, item) => sum + item.contribution, 0);
    const interpretation = method() === "tfidf"
      ? `The selected ${selectedMethodLabel} score is ${fmt(pair.tfidf)}. The displayed terms contribute ${contributionTotal.toFixed(5)} of the exact sparse-vector dot product; remaining shared terms contribute the balance. Context excerpts show how the terms are used, not whether their overlap is narratively meaningful.`
      : `The selected ${selectedMethodLabel} score is ${fmt(pair[method()])}. The contexts below are shared TF-IDF terms that help a reader inspect lexical overlap; they are not a decomposition or causal explanation of this method’s score.`;
    document.querySelector("#unexpected-explanation").innerHTML =
      `<h3>WHY ARE THESE CHARACTERS SIMILAR?</h3><p>${escapeHtml(lexicalTitle)}</p><p class="unexpected-analysis">${escapeHtml(interpretation)}</p><p class="unexpected-analysis">Observed ${escapeHtml(pairDescription(pair))}; direct edge: ${escapeHtml(directText(pair))}. ${escapeHtml(pairNullSummary)}</p><p class="unexpected-analysis">Page degrees: ${escapeHtml(a.name)} in ${a.in_degree} / out ${a.out_degree}; ${escapeHtml(b.name)} in ${b.in_degree} / out ${b.out_degree}.</p>${termsHtml || '<p>No shared informative terms were found by the TF-IDF vocabulary.</p>'}<p class="unexpected-null-note">Names and recurring article conventions can inflate lexical overlap. Read both contexts before treating shared terms as common powers, affiliations, or story arcs.</p>`;
  }

  function renderNullDetail(result, selectedMethod, selectedMode) {
    const modeLabel = selectedMode === "directed" ? "minimum reachable distance in either directed travel direction" : "undirected-projection distance";
    const unreachableRange = result.unreachable_pair_count_range.join("-");
    const nullModel = data.meta.null_model;
    const populationLabel = isolatePopulation() === "all" ? "all observed characters" : "pairs excluding observed isolates";
    document.querySelector("#unexpected-null-detail").textContent =
      `Degree-preserving null; ${nullModel.networks} rewired graphs; ${nullModel.accepted_swaps_per_network.toLocaleString()} accepted target swaps per graph; seed ${nullModel.seed}. For the fixed top 1% ${methodLabel(selectedMethod)} cohort of ${result.cohort_size} pairs from ${result.eligible_pair_count.toLocaleString()} eligible pairs (${populationLabel}), observed mean reachable ${modeLabel} ${fmt(result.observed.mean_reachable_distance)} vs null mean ${fmt(result.null_mean_reachable_distance)}; observed minus null = ${fmt(result.observed_minus_null_mean)}, null SD ${fmt(result.null_sd_reachable_distance)}, standardized shift ${fmt(result.standardized_shift)}, Holm-adjusted upper-tail p = ${fmt(result.holm_adjusted_upper_tail_p)}. Observed cohort unreachable fraction ${fmt(result.observed_unreachable_fraction)} vs null mean ${fmt(result.null_mean_unreachable_fraction)} (Holm-adjusted upper-tail p ${fmt(result.holm_adjusted_unreachable_upper_tail_p)}); directed cohort unreachable-pair count range across nulls ${unreachableRange}. Full-network connectivity diagnostics (unchanged by this pair-population filter): observed ordered directed unreachable pairs ${nullModel.directed_unreachable_ordered_pairs_observed.toLocaleString()} vs randomized mean ${nullModel.directed_unreachable_ordered_pairs_null_mean.toLocaleString()} (range ${nullModel.directed_unreachable_ordered_pairs_null_range.join("-")}); observed unordered unreachable pairs in the undirected projection ${nullModel.undirected_unreachable_unordered_pairs_observed.toLocaleString()} vs randomized mean ${nullModel.undirected_unreachable_unordered_pairs_null_mean.toLocaleString()} (range ${nullModel.undirected_unreachable_unordered_pairs_null_range.join("-")}). Weak components observed ${nullModel.weak_components_observed} vs randomized ${nullModel.weak_components_null_range.join("-")}; strong components observed ${nullModel.strong_components_observed} vs randomized ${nullModel.strong_components_null_range.join("-")}. These describe the unchanged full graph and cohort summaries, not a p-value for the selected pair.`;
  }

  function renderInterpretation(population) {
    const nulls = data.meta.null_model.null_results_by_population[population];
    const summaries = data.meta.methods.map(methodId => {
      const result = nulls[methodId][mode()];
      return `${methodLabel(methodId)} ${fmt(result.observed.mean_reachable_distance)} vs null ${fmt(result.null_mean_reachable_distance)} (Holm p ${fmt(result.holm_adjusted_upper_tail_p)})`;
    }).join("; ");
    const populationLabel = population === "all" ? "including isolates" : "excluding pairs containing isolates";
    document.querySelector("#unexpected-interpretation").textContent =
      `For the top 1% text-similar pair cohort ${populationLabel}, mean reachable ${mode()} distance by method is ${summaries}. Each method’s cohort is ranked within its own score scale. This describes aggregate cohorts; the displayed pairwise z-scores standardize each reachable pair’s path distance against finite paths for that pair in the same rewired networks, and are not individual significance tests.`;
  }

  window.addEventListener("resize", () => {
    if (selectedPairKey) renderSelectedPair();
  });
})();
