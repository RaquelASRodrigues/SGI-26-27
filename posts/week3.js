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

let data;
let mode = "top";
let metric = "Degree";
let selectedId;

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
  })
  .catch(error => {
    detailHeading.textContent = "DATA UNAVAILABLE";
    detailTable.innerHTML = `<tr><td colspan="6">The Week 3 centrality data could not be loaded.</td></tr>`;
    console.error(error);
  });