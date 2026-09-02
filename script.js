const posts = [
  { date: "WEEK 01 · 14.09.26", type: "INTRO / METHODS", title: "Tudo começa com um ponto", summary: "Uma primeira aproximação aos grafos: como transformar uma pergunta sobre o mundo numa rede que podemos observar." },
  { date: "WEEK 02 · 21.09.26", type: "FIELD NOTE", title: "A força de estar entre", summary: "Sobre pontes, betweenness e as pessoas que tornam possível uma conversa entre comunidades distantes." },
  { date: "WEEK 03 · 28.09.26", type: "TOOLKIT", title: "Desenhar o invisível", summary: "Layouts, escolhas visuais e o que um grafo nos mostra — ou esconde — antes de sequer abrirmos os dados." },
  { date: "WEEK 04 · 05.10.26", type: "CASE STUDY", title: "Quando a rede ganha voz", summary: "Seguimos rastos de informação para perceber como uma ideia muda quando passa de nó em nó." }
];

const postsList = document.querySelector("#posts-list");
posts.forEach((post, index) => {
  const article = document.createElement("article");
  article.className = "post";
  article.innerHTML = `
    <div class="post-number">${String(index + 1).padStart(2, "0")}</div>
    <div>
      <div class="post-date">${post.date}</div>
      <h3 class="post-title">${post.title}</h3>
      <p class="post-summary">${post.summary}</p>
    </div>
    <div class="post-meta">
      <div class="post-type">${post.type}</div>
      <div class="post-date">READ → 04 MIN</div>
    </div>
    <div class="post-arrow">↗</div>
  `;
  postsList.appendChild(article);
});

const svg = d3.select("#network-svg");
const visual = document.querySelector(".hero-visual");
const colors = { person: "#bd7dff", idea: "#e84e83", bridge: "#f2eaf5" };
const names = ["MARTA", "INES", "DIOGO", "BEA", "TOM", "RUI", "SNA", "DATA", "IDEA", "LINK", "NODE", "LAB", "JO", "ANA", "MIGUEL", "FLOW", "PONTO", "SOFIA"];
const nodes = names.map((name, id) => ({ id, name, group: id % 7 === 0 ? "bridge" : id % 4 === 0 ? "idea" : "person", radius: id % 7 === 0 ? 8 : id % 3 === 0 ? 6 : 4 }));
const links = [];
for (let i = 0; i < nodes.length; i += 1) {
  links.push({ source: i, target: (i + 1) % nodes.length });
  if (i % 2 === 0) links.push({ source: i, target: (i + 5) % nodes.length });
  if (i % 5 === 0) links.push({ source: i, target: (i + 9) % nodes.length });
}

function drawGraph() {
  const width = visual.clientWidth;
  const height = visual.clientHeight;
  svg.attr("viewBox", `0 0 ${width} ${height}`);
  svg.selectAll("*").remove();

  const simulation = d3.forceSimulation(nodes)
    .force("link", d3.forceLink(links).id(d => d.id).distance(58).strength(.7))
    .force("charge", d3.forceManyBody().strength(-105))
    .force("center", d3.forceCenter(width / 2, height / 2))
    .force("collide", d3.forceCollide().radius(d => d.radius + 9));

  const link = svg.append("g").attr("stroke", "#a66be0").attr("stroke-opacity", .48)
    .selectAll("line").data(links).join("line").attr("stroke-width", d => d.source.group === "bridge" ? 2 : 1);
  const node = svg.append("g").selectAll("g").data(nodes).join("g").attr("cursor", "grab");
  node.append("circle").attr("r", d => d.radius + 5).attr("fill", "none").attr("stroke", d => colors[d.group]).attr("stroke-opacity", .16);
  node.append("circle").attr("r", d => d.radius).attr("fill", d => colors[d.group]);
  node.append("circle").attr("r", 2).attr("fill", "#0a090d");
  node.filter(d => d.radius > 7).append("text").text(d => d.name).attr("x", 12).attr("y", 4).attr("fill", "#f2eaf5").attr("font-family", "DM Mono").attr("font-size", "8px").attr("letter-spacing", "1px");

  node.call(d3.drag()
    .on("start", (event, d) => { if (!event.active) simulation.alphaTarget(.3).restart(); d.fx = d.x; d.fy = d.y; })
    .on("drag", (event, d) => { d.fx = event.x; d.fy = event.y; })
    .on("end", (event, d) => { if (!event.active) simulation.alphaTarget(0); d.fx = null; d.fy = null; }));

  svg.on("pointermove", event => {
    const [x, y] = d3.pointer(event);
    simulation.force("mouse", d3.forceRadial(115, x, y).strength(.012));
    simulation.alpha(.18).restart();
  }).on("pointerleave", () => {
    simulation.force("mouse", null);
    simulation.alpha(.12).restart();
  });

  simulation.on("tick", () => {
    link.attr("x1", d => d.source.x).attr("y1", d => d.source.y).attr("x2", d => d.target.x).attr("y2", d => d.target.y);
    node.attr("transform", d => `translate(${d.x},${d.y})`);
  });
}

drawGraph();
window.addEventListener("resize", drawGraph);
