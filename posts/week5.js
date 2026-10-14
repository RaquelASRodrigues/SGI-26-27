const DATA = "../data/";
const TOKEN_RE = /\p{L}+(?:['’]\p{L}+)*/gu;
const $ = selector => document.querySelector(selector);
const fmt = value => new Intl.NumberFormat("en-US").format(value);
const percent = value => `${(value * 100).toFixed(1)}%`;
const safeText = value => String(value ?? "");

async function fetchJson(file) {
  const response = await fetch(`${DATA}${file}`);
  if (!response.ok) throw new Error(`Could not load ${file}: HTTP ${response.status}`);
  return response.json();
}

function showError(element, error) {
  element.classList.add("widget-error");
  element.textContent = `This widget could not load its data. ${error.message}`;
}

function tokenize(text) {
  return (text.match(TOKEN_RE) ?? []).map(token => token.toLowerCase());
}

function renderSummary(summary) {
  const corpus = summary.corpus;
  const copy = summary.copy;
  $("#copy-method-intro").textContent =
    `We compared exact runs of ${fmt(copy.shingle_size)} normalized word tokens across ` +
    `${fmt(corpus.pages)} character pages. An edge joins two pages when they share at least ` +
    `one ${fmt(copy.shingle_size)}-gram shingle; its weight counts distinct shared shingles. ` +
    `Then we remove shingles seen in more than ${fmt(copy.max_shingle_df)} pages and keep only ` +
    `edges with a shared prose run of at least ${fmt(copy.min_prose_run_tokens)} tokens.`;
  $("#copy-metrics").innerHTML = `
    <div class="metric-tile"><span class="metric-value">${fmt(copy.naive_largest_component)} / ${fmt(copy.nodes)}</span><span class="metric-label">pages connected by naive 8-gram edges</span></div>
    <div class="metric-tile"><span class="metric-value">${fmt(copy.naive_edges)}</span><span class="metric-label">naive page-pair edges</span></div>
    <div class="metric-tile"><span class="metric-value">${fmt(copy.filtered_edges)} / ${fmt(copy.filtered_pages_in_nontrivial_components)}</span><span class="metric-label">filtered prose edges / participating pages · largest group ${fmt(copy.filtered_largest_component)}</span></div>`;
  $("#copy-method-note").textContent =
    `Corpus: ${fmt(corpus.pages)} pages · ${fmt(corpus.tokens)} normalized tokens · ` +
    `8-word shingles · filter df ≤ 3 and a ≥30-token maximal prose run. ` +
    `The radial page layout uses seed ${fmt(copy.layout_seed)} and does not encode graph relations. ` +
    `The common shingle “in american comic books published by marvel comics” ` +
    `appears in ${fmt(copy.common_shingle_pages)} pages.`;
  $("#copy-surprise").textContent =
    `What surprised me most was how sharply the network collapsed once boilerplate was pruned. ` +
    `A naive 8-gram scan connects ${fmt(copy.naive_largest_component)} of ${fmt(copy.nodes)} pages, ` +
    `but the filtered prose network leaves only ${fmt(copy.filtered_edges)} edges across ` +
    `${fmt(copy.filtered_pages_in_nontrivial_components)} pages, with a largest component of ` +
    `${fmt(copy.filtered_largest_component)}. Standard editorial phrases drive much of the first impression.`;
  renderEvidence(summary.hero_evidence);
  return summary;
}

function renderEvidence(evidence) {
  const target = $("#copy-evidence");
  target.replaceChildren();
  evidence.forEach(item => {
    const card = document.createElement("article");
    card.className = "evidence-card";
    const heading = document.createElement("h3");
    heading.textContent = `${item.left} ↔ ${item.right} · ${fmt(item.tokens)} shared tokens`;
    const cite = document.createElement("p");
    cite.className = "small-note";
    cite.innerHTML = `Wikipedia page text · <a href="${item.a_url}" target="_blank" rel="noopener">source A</a> · <a href="${item.b_url}" target="_blank" rel="noopener">source B</a> · CC BY-SA`;
    const quote = document.createElement("blockquote");
    quote.textContent = item.a;
    card.append(heading, cite, quote);
    target.appendChild(card);
  });
}

function decompressJson(encoded) {
  if (!("DecompressionStream" in window)) {
    throw new Error("This browser does not support the built-in deflate decoder needed for passage data.");
  }
  const binary = atob(encoded.data);
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Response(stream).json();
}

function initCopyNetwork() {
  const canvas = $("#copy-canvas");
  const context = canvas.getContext("2d");
  const detail = $("#edge-detail");
  const picker = $("#edge-picker");
  let network;
  let passages;
  let mode = "naive";
  let activeEdge;
  let width = 0;
  let height = 0;

  const edgeArray = () => mode === "naive" ? network.naive : network.filtered;
  const nodePosition = node => [
    node.x * width / 800,
    node.y * height / 600,
  ];
  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    width = rect.width;
    height = rect.height;
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    draw();
  };

  function draw() {
    if (!network) return;
    context.clearRect(0, 0, width, height);
    const nodes = network.nodes;
    const edges = edgeArray();
    const index = new Map(nodes.map((node, i) => [i, node]));
    const renderEdges = mode === "naive" ? edges : edges;
    context.lineWidth = 1;
    for (const edge of renderEdges) {
      const from = nodePosition(index.get(edge[0]));
      const to = nodePosition(index.get(edge[1]));
      const selected = activeEdge && activeEdge[3] === edge[3];
      context.beginPath();
      context.moveTo(from[0], from[1]);
      context.lineTo(to[0], to[1]);
      context.strokeStyle = selected
        ? "#e84e83"
        : mode === "naive" ? "rgba(189,125,255,.055)" : "rgba(232,78,131,.76)";
      context.lineWidth = selected ? 2.4 : mode === "naive"
        ? Math.min(1.3, .35 + Math.log1p(edge[2]) * .11)
        : 1.8;
      context.stroke();
    }
    for (let i = 0; i < nodes.length; i += 1) {
      const [x, y] = nodePosition(nodes[i]);
      const selected = activeEdge && (activeEdge[0] === i || activeEdge[1] === i);
      context.beginPath();
      context.arc(x, y, selected ? 4.2 : 2.1, 0, Math.PI * 2);
      context.fillStyle = selected ? "#f2eaf5" : "#bd7dff";
      context.fill();
    }
  }

  async function showPassage(edge) {
    if (!edge || !passages) return;
    activeEdge = edge;
    const [sourceIndex, targetIndex, weight, runId] = edge;
    const source = network.nodes[sourceIndex];
    const target = network.nodes[targetIndex];
    const shared = passages[runId];
    const showProse = mode === "filtered" && shared.prose_tokens >= 30;
    const textA = showProse ? shared.prose_a : shared.a;
    const textB = showProse ? shared.prose_b : shared.b;
    const tokenLength = showProse ? shared.prose_tokens : shared.tokens;
    const label = showProse ? "Prose run" : shared.class;
    detail.replaceChildren();
    const title = document.createElement("h3");
    title.textContent = `${source.name} ↔ ${target.name}`;
    const meta = document.createElement("p");
    meta.className = "small-note";
    meta.textContent = `${fmt(weight)} shared distinct 8-grams · longest displayed run: ${fmt(tokenLength)} tokens · ${label}`;
    const grid = document.createElement("div");
    grid.className = "passage-grid";
    [[source.name, textA], [target.name, textB]].forEach(([name, text]) => {
      const section = document.createElement("section");
      section.className = "passage";
      const caption = document.createElement("span");
      caption.className = "passage-label";
      caption.textContent = name;
      const quote = document.createElement("span");
      quote.textContent = text ?? "No qualifying prose run is available for this pair; the longest shared run is shown above.";
      section.append(caption, quote);
      grid.appendChild(section);
    });
    detail.append(title, meta, grid);
    draw();
  }

  function nearestEdge(x, y) {
    const nodes = network.nodes;
    const byIndex = new Map(nodes.map((node, i) => [i, node]));
    let best = null;
    let bestDistance = 9;
    for (const edge of edgeArray()) {
      const [x1, y1] = nodePosition(byIndex.get(edge[0]));
      const [x2, y2] = nodePosition(byIndex.get(edge[1]));
      const dx = x2 - x1;
      const dy = y2 - y1;
      const denominator = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / denominator));
      const distance = Math.hypot(x - x1 - t * dx, y - y1 - t * dy);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = edge;
      }
    }
    return best;
  }

  fetchJson("week5_edges.json")
    .then(async loaded => {
      network = loaded;
      const passageData = await fetchJson("week5_passages.json");
      passages = await decompressJson(passageData);
      function populatePicker() {
        const pickerEdges = edgeArray()
          .slice()
          .sort((a, b) => b[2] - a[2])
          .slice(0, 250);
        picker.replaceChildren();
        pickerEdges.forEach(edge => {
          const option = document.createElement("option");
          option.value = String(edge[3]);
          option.textContent = `${loaded.nodes[edge[0]].name} ↔ ${loaded.nodes[edge[1]].name} · ${fmt(edge[2])} shared 8-grams`;
          picker.appendChild(option);
        });
      }
      populatePicker();
      $("#show-edge").addEventListener("click", () => {
        const edge = edgeArray().find(item => item[3] === Number(picker.value));
        showPassage(edge);
      });
      $("#copy-canvas").addEventListener("click", event => {
        const rect = canvas.getBoundingClientRect();
        const edge = nearestEdge(event.clientX - rect.left, event.clientY - rect.top);
        if (!edge) return;
        picker.value = String(edge[3]);
        showPassage(edge);
      });
      document.querySelectorAll("[data-copy-mode]").forEach(button => {
        button.addEventListener("click", () => {
          mode = button.dataset.copyMode;
          document.querySelectorAll("[data-copy-mode]").forEach(item => {
            item.classList.toggle("is-active", item === button);
          });
          activeEdge = null;
          draw();
          populatePicker();
        });
      });
      window.addEventListener("resize", resize);
      resize();
    })
    .catch(error => showError(detail, error));
}

function decodeVector(encoded) {
  const raw = atob(encoded);
  const bytes = Uint8Array.from(raw, character => character.charCodeAt(0));
  const values = [];
  let cursor = 0;
  while (cursor < bytes.length) {
    let value = 0;
    let shift = 0;
    let byte;
    do {
      byte = bytes[cursor++];
      value |= (byte & 127) << shift;
      shift += 7;
    } while (byte & 128);
    values.push(value);
  }
  const vector = new Map();
  let tokenId = 0;
  for (let i = 0; i < values.length; i += 2) {
    tokenId += values[i];
    vector.set(tokenId, values[i + 1]);
  }
  return vector;
}

function initSearch(summary) {
  const input = $("#search-query");
  const results = $("#search-results");
  const status = $("#search-status");
  const failure = $("#search-failure");
  const stopToggle = $("#stopword-toggle");
  let searchData;
  let vocabularyIndex;
  let stopwords;
  let pages;
  let pending;

  async function ensureData() {
    if (searchData) return;
    status.textContent = "Loading the corpus search index…";
    searchData = await fetchJson("week5_search.json");
    vocabularyIndex = new Map(searchData.vocabulary.map((token, index) => [token, index]));
    stopwords = new Set(searchData.stopwords);
    pages = searchData.pages.map(page => ({
      ...page,
      vector: decodeVector(page.vector),
      filteredNorm: null,
    }));
    pages.forEach(page => {
      let square = 0;
      for (const [index, count] of page.vector) {
        if (!stopwords.has(searchData.vocabulary[index])) square += count * count;
      }
      page.filteredNorm = Math.sqrt(square);
    });
    status.textContent = `${fmt(pages.length)} pages indexed · raw count vectors · cosine similarity`;
  }

  function runSearch() {
    const query = input.value.trim();
    results.replaceChildren();
    failure.hidden = true;
    if (!query) return;
    ensureData().then(() => {
      const tokens = tokenize(query);
      const queryCounts = new Map();
      tokens.forEach(token => {
        if (stopToggle.checked && stopwords.has(token)) return;
        const index = vocabularyIndex.get(token);
        if (index !== undefined) queryCounts.set(index, (queryCounts.get(index) ?? 0) + 1);
      });
      const queryNorm = Math.sqrt([...queryCounts.values()].reduce((sum, count) => sum + count * count, 0));
      if (!queryNorm) {
        status.textContent = "No query terms are in the corpus vocabulary.";
        return;
      }
      const ranked = pages.map(page => {
        let dot = 0;
        const contributions = [];
        for (const [index, count] of queryCounts) {
          const frequency = page.vector.get(index) ?? 0;
          if (frequency) {
            dot += count * frequency;
            contributions.push({
              token: searchData.vocabulary[index],
              value: count * frequency,
            });
          }
        }
        const norm = stopToggle.checked ? page.filteredNorm : page.norm;
        return {
          page,
          score: norm ? dot / (queryNorm * norm) : 0,
          contributions: contributions.sort((a, b) => b.value - a.value).slice(0, 4),
        };
      }).sort((a, b) => b.score - a.score || a.page.name.localeCompare(b.page.name)).slice(0, 10);
      status.textContent = `Top 10 from ${fmt(pages.length)} pages · ${tokens.length} query tokens · ${queryCounts.size} in-vocabulary terms`;
      ranked.forEach((row, index) => {
        const item = document.createElement("li");
        item.className = "search-result";
        const rank = document.createElement("span");
        rank.className = "search-rank";
        rank.textContent = String(index + 1).padStart(2, "0");
        const name = document.createElement("span");
        name.textContent = row.page.name;
        const terms = document.createElement("small");
        terms.className = "search-contrib";
        terms.textContent = `Contributing words: ${row.contributions.map(term => term.token).join(", ") || "none"}`;
        name.appendChild(terms);
        const score = document.createElement("span");
        score.className = "search-score";
        score.textContent = row.score.toFixed(4);
        item.append(rank, name, score);
        results.appendChild(item);
      });
      if (/norse god of thunder/i.test(query)) {
        failure.hidden = false;
        failure.textContent = `Structural limit: the node list has no plain Thor page; it has ${summary.missing_famous.find(item => item.title === "Thor").alternatives.join(" and ")} instead. The nearest lexical result is not a missing Thor page.`;
      } else if (/armored billionaire inventor/i.test(query)) {
        failure.hidden = false;
        failure.textContent = "Structural limit: there is no plain main-universe Iron Man node in this corpus slice; the graph contains only other Iron Man page variants.";
      } else if (/breakfast yesterday/i.test(query)) {
        failure.hidden = false;
        failure.textContent = "No page is expected to answer this question: cosine returns the least-bad lexical overlap, not evidence that the requested fact exists.";
      } else if (/archer with trick arrows/i.test(query)) {
        failure.hidden = false;
        failure.textContent = "A stopword-heavy phrase can dilute the meaningful terms. Toggle stopwords and compare whether Hawkeye moves up.";
      }
    }).catch(error => showError(results, error));
  }

  input.addEventListener("input", () => {
    clearTimeout(pending);
    pending = setTimeout(runSearch, 120);
  });
  stopToggle.addEventListener("change", runSearch);
  document.querySelectorAll(".search-preset").forEach(button => {
    button.addEventListener("click", () => {
      input.value = button.textContent;
      runSearch();
    });
  });
}

function initMetrics(summary) {
  const svg = d3.select("#metrics-chart");
  let tab = "mentions";
  const margin = { top: 25, right: 28, bottom: 55, left: 62 };
  const palette = { ink: "#f2eaf5", lilac: "#bd7dff", magenta: "#e84e83", grid: "rgba(125,46,216,.22)" };

  function setup(data) {
    const node = svg.node();
    const width = node.clientWidth || 820;
    const height = node.clientHeight || 360;
    const iw = width - margin.left - margin.right;
    const ih = height - margin.top - margin.bottom;
    svg.attr("viewBox", `0 0 ${width} ${height}`).selectAll("*").remove();
    const plot = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
    const axisStyle = selection => selection.selectAll("text").attr("fill", palette.ink).attr("font-family", "DM Mono").attr("font-size", "9px");

    if (tab === "mentions") {
      const values = [
        { label: "Name mention", value: data.network.mentioned_edges, color: palette.magenta },
        { label: "No literal title", value: data.network.unmentioned_edges, color: palette.lilac },
      ];
      const x = d3.scaleLinear().domain([0, data.network.directed_edges]).range([0, iw]);
      const y = d3.scaleBand().domain(values.map(item => item.label)).range([0, ih]).padding(.35);
      plot.append("g").attr("class", "chart-grid").attr("transform", `translate(0,${ih})`).call(d3.axisBottom(x).ticks(5).tickSize(-ih).tickFormat(""));
      plot.append("g").attr("class", "chart-axis").attr("transform", `translate(0,${ih})`).call(d3.axisBottom(x).ticks(5)).call(axisStyle);
      plot.append("g").attr("class", "chart-axis").call(d3.axisLeft(y)).call(axisStyle);
      plot.selectAll(".mention-bar").data(values).join("rect").attr("x", 0).attr("y", row => y(row.label))
        .attr("width", row => x(row.value)).attr("height", y.bandwidth()).attr("fill", row => row.color);
      plot.selectAll(".mention-count").data(values).join("text").attr("class", "chart-label")
        .attr("x", row => x(row.value) + 7).attr("y", row => y(row.label) + y.bandwidth() / 2 + 4)
        .text(row => fmt(row.value));
      $("#metric-summary").innerHTML = `<p><strong>${fmt(data.network.mentioned_edges)} / ${fmt(data.network.directed_edges)}</strong> directed edges have a literal target-page title match, including undisambiguated title forms (${percent(data.network.mention_share)}).</p>`;
      $("#metric-detail").textContent = "This is text evidence for a link, not a semantic relation label; unrelated name collisions can still create false matches.";
    } else if (tab === "heaps") {
      const points = data.heaps.points;
      const x = d3.scaleLog().domain(d3.extent(points, point => point.tokens)).range([0, iw]);
      const y = d3.scaleLog().domain(d3.extent(points, point => point.types)).range([ih, 0]);
      plot.append("g").attr("class", "chart-grid").attr("transform", `translate(0,${ih})`).call(d3.axisBottom(x).ticks(5, "~s").tickSize(-ih).tickFormat(""));
      plot.append("g").attr("class", "chart-axis").attr("transform", `translate(0,${ih})`).call(d3.axisBottom(x).ticks(5, "~s")).call(axisStyle);
      plot.append("g").attr("class", "chart-axis").call(d3.axisLeft(y).ticks(5, "~s")).call(axisStyle);
      const line = d3.line().x(point => x(point.tokens)).y(point => y(point.types));
      plot.append("path").datum(points).attr("fill", "none").attr("stroke", palette.magenta).attr("stroke-width", 2.5).attr("d", line);
      plot.selectAll(".chart-point").data(points).join("circle").attr("class", "chart-point").attr("cx", point => x(point.tokens)).attr("cy", point => y(point.types)).attr("r", 4);
      plot.append("text").attr("class", "chart-label").attr("x", iw / 2).attr("y", ih + 42).attr("text-anchor", "middle").text("Cumulative tokens · log scale");
      $("#metric-summary").innerHTML = `<p><strong>V = ${data.heaps.K.toFixed(2)} N<sup>${data.heaps.beta.toFixed(4)}</sup></strong> · log-log R² = ${data.heaps.r_squared.toFixed(4)}</p>`;
      $("#metric-detail").textContent = `Mean over ${fmt(data.heaps.orders)} seeded random page orders. At ${fmt(points[0].tokens)} tokens: ${fmt(Math.round(points[0].types))} types; at ${fmt(points.at(-1).tokens)} tokens: ${fmt(Math.round(points.at(-1).types))} types.`;
    } else {
      const rows = data.m6.rows;
      const x = d3.scaleLinear().domain([0, d3.max(rows, row => row.degree)]).nice().range([0, iw]);
      const y = d3.scaleLinear().domain([0, d3.max(rows, row => row.tokens)]).nice().range([ih, 0]);
      plot.append("g").attr("class", "chart-grid").attr("transform", `translate(0,${ih})`).call(d3.axisBottom(x).ticks(6).tickSize(-ih).tickFormat(""));
      plot.append("g").attr("class", "chart-axis").attr("transform", `translate(0,${ih})`).call(d3.axisBottom(x).ticks(6)).call(axisStyle);
      plot.append("g").attr("class", "chart-axis").call(d3.axisLeft(y).ticks(6, "~s")).call(axisStyle);
      const focus = new Set([data.m6.degree_leader.id, data.m6.longest_page.id]);
      plot.selectAll(".chart-point").data(rows).join("circle")
        .attr("class", row => `chart-point${focus.has(row.id) ? " focus" : ""}`)
        .attr("cx", row => x(row.degree)).attr("cy", row => y(row.tokens)).attr("r", row => focus.has(row.id) ? 5 : 3)
        .append("title").text(row => `${row.name}: degree ${row.degree}, ${fmt(row.tokens)} tokens`);
      plot.append("text").attr("class", "chart-label").attr("x", iw / 2).attr("y", ih + 42).attr("text-anchor", "middle").text("Undirected degree");
      $("#metric-summary").innerHTML = `<p>Spearman <strong>ρ = ${data.m6.spearman_degree_tokens.toFixed(3)}</strong> · degree leader: <strong>${data.m6.degree_leader.name}</strong> (${fmt(data.m6.degree_leader.degree)} links, ${fmt(data.m6.degree_leader.tokens)} tokens) · longest: <strong>${data.m6.longest_page.name}</strong> (${fmt(data.m6.longest_page.tokens)} tokens).</p>`;
      $("#metric-detail").textContent = "Degree is an in-network visibility proxy, not an external fame measure; this association is not evidence of causation.";
    }
  }

  document.querySelectorAll("[data-metric-tab]").forEach(button => {
    button.addEventListener("click", () => {
      tab = button.dataset.metricTab;
      document.querySelectorAll("[data-metric-tab]").forEach(item => item.classList.toggle("is-active", item === button));
      setup(summary);
    });
  });
  setup(summary);
}

function initCommunities() {
  const sample = $("#community-sample");
  const selector = $("#community-picker");
  const replicatePicker = $("#sample-picker");
  fetchJson("week5_communities.json").then(data => {
    data.largest_communities.forEach(community => {
      const option = document.createElement("option");
      option.value = community.id;
      option.textContent = `Community ${community.id} · ${fmt(community.size)} pages`;
      selector.appendChild(option);
    });
    [1, 2, 3].forEach(replicate => {
      const option = document.createElement("option");
      option.value = replicate;
      option.textContent = `Sample ${replicate}`;
      replicatePicker.appendChild(option);
    });
    function update() {
      const chosen = data.samples.find(row =>
        row.community === Number(selector.value) && row.replicate === Number(replicatePicker.value)
      );
      sample.textContent = chosen?.text ?? "No generated sample is available.";
    }
    selector.addEventListener("change", update);
    replicatePicker.addEventListener("change", update);
    update();
    const baseline = data.masked_centroid_baseline;
    const leak = data.unmasked_name_leak;
    $("#community-summary").innerHTML = `
      <p class="small-note">Our own Louvain partition · ${fmt(data.partition.count)} communities · seed ${data.partition.seed} · resolution ${data.partition.resolution} · modularity ${data.partition.modularity.toFixed(6)}. Largest sizes: ${data.largest_communities.map(row => fmt(row.size)).join(", ")}.</p>
      <p class="small-note">Trigram → bigram → unigram backoff multiplier: ${data.backoff_discount}. Generated length: ${fmt(data.generated_word_tokens)} word tokens/sample. In the unmasked-name run, ${fmt(leak.matched)} / ${fmt(leak.samples)} samples exposed a character name; lookup was correct in ${fmt(leak.predicted_correctly_when_matched)} / ${fmt(leak.matched)} name-leaking samples (${percent(leak.accuracy_when_matched)} vs. ${percent(leak.chance)} chance). Masked sample-to-centroid cosine: ${fmt(baseline.correct)} / ${fmt(baseline.samples)} (${percent(baseline.accuracy)} vs. ${percent(baseline.chance)} chance); same-corpus, not held out.</p>`;
  }).catch(error => showError(sample, error));
}

function initWeird() {
  const table = $("#weird-rows");
  const selector = $("#weird-picker");
  const detail = $("#weird-detail");
  fetchJson("week5_weird.json").then(data => {
    const methodology = $("#weird-heading").nextElementSibling;
    methodology.textContent =
      `Asked. Which page looks most unlike its length peers? Did. Ranked ${data.measures.length} text measures ` +
      `within ${fmt(data.length_bins)} equal-count page-length bins, then averaged percentile ranks.`;
    data.rows.forEach((row, index) => {
      const tr = document.createElement("tr");
      tr.dataset.id = row.id;
      tr.innerHTML = `<td>${index + 1}</td><td>${row.name}</td><td>${fmt(row.tokens)}</td><td>${row.average_rank.toFixed(3)}</td>`;
      tr.addEventListener("click", () => {
        selector.value = row.id;
        update(row);
      });
      table.appendChild(tr);
      const option = document.createElement("option");
      option.value = row.id;
      option.textContent = `${index + 1}. ${row.name}`;
      selector.appendChild(option);
    });
    function update(selected) {
      const row = selected ?? data.rows.find(item => item.id === selector.value);
      if (!row) return;
      table.querySelectorAll("tr").forEach(tr => tr.classList.toggle("is-selected", tr.dataset.id === row.id));
      detail.textContent = row.excerpt;
    }
    selector.addEventListener("change", () => update());
    update(data.rows[0]);
  }).catch(error => showError(detail, error));
}

function initTokenizerParityCheck() {
  const note = document.createElement("p");
  note.className = "small-note";
  $("#search-heading").parentElement.appendChild(note);
  fetchJson("week5_tokenizer_tests.json")
    .then(data => {
      const passed = data.tests.filter(test =>
        JSON.stringify(tokenize(test.text)) === JSON.stringify(test.tokens)
      ).length;
      note.textContent = `Python-to-JavaScript tokenizer parity: ${passed}/${data.tests.length} test strings match.`;
      if (passed !== data.tests.length) {
        console.error("Week 5 Python-to-JavaScript tokenizer parity check failed.", data);
      }
    })
    .catch(error => showError(note, error));
}

function initializeModule(target, initialize) {
  try {
    initialize();
  } catch (error) {
    showError(target, error);
    console.error("Week 5 widget initialization failed.", error);
  }
}

initializeModule($("#edge-detail"), initCopyNetwork);
initializeModule($("#community-sample"), initCommunities);
initializeModule($("#weird-detail"), initWeird);
initializeModule($("#search-status"), initTokenizerParityCheck);

fetchJson("week5_summary.json")
  .then(summary => {
    initializeModule($("#copy-metrics"), () => renderSummary(summary));
    initializeModule($("#search-status"), () => initSearch(summary));
    initializeModule($("#metric-summary"), () => initMetrics(summary));
  })
  .catch(error => {
    showError($("#copy-metrics"), error);
    showError($("#metric-summary"), error);
    showError($("#search-status"), error);
    console.error("Week 5 summary could not be loaded.", error);
  });
