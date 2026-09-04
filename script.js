const posts = [
  {
    date: "WEEK 01 · 14.09.26",
    type: "DEGREE / DIRECTED GRAPHS",
    title: "Every node has a story",
    summary: "This week we explore degree distributions — linear and log–log — then compare in-degree and out-degree: who is linked to most, who links out most, and why are those different people?"
  }
];

const postsList = document.querySelector("#posts-list");
posts.forEach((post, index) => {
  const link = document.createElement("a");
  link.className = "post-link";
  link.href = "posts/week1.html";
  link.innerHTML = `
    <article class="post">
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
    </article>
  `;
  postsList.appendChild(link);
});

const svg = d3.select("#network-svg");
const visual = document.querySelector(".hero-visual");
const colors = { hub: "#e84e83", node: "#bd7dff", isolated: "#f2eaf5" };
let graphData;

function drawGraph(data) {
  const width = visual.clientWidth;
  const height = visual.clientHeight;
  svg.attr("viewBox", `0 0 ${width} ${height}`);
  svg.selectAll("*").remove();

  const maxDegree = d3.max(data.nodes, node => node.in_degree + node.out_degree) || 1;
  const radius = d3.scaleSqrt().domain([0, maxDegree]).range([2.5, 12]);
  const simulation = d3.forceSimulation(data.nodes)
    .force("link", d3.forceLink(data.edges).id(node => node.id).distance(34).strength(.42))
    .force("charge", d3.forceManyBody().strength(-28))
    .force("center", d3.forceCenter(width / 2, height / 2))
    .force("collide", d3.forceCollide().radius(node => radius(node.in_degree + node.out_degree) + 3));

  const link = svg.append("g")
    .attr("stroke", "#a66be0")
    .attr("stroke-opacity", .28)
    .selectAll("line")
    .data(data.edges)
    .join("line")
    .attr("stroke-width", .7);

  const node = svg.append("g")
    .selectAll("g")
    .data(data.nodes)
    .join("g")
    .attr("cursor", "grab");

  node.append("circle")
    .attr("r", nodeData => radius(nodeData.in_degree + nodeData.out_degree) + 3)
    .attr("fill", "none")
    .attr("stroke", nodeData => nodeData.is_top5 ? colors.hub : colors.node)
    .attr("stroke-opacity", .15);
  node.append("circle")
    .attr("r", nodeData => radius(nodeData.in_degree + nodeData.out_degree))
    .attr("fill", nodeData => nodeData.is_top5 ? colors.hub : nodeData.in_degree + nodeData.out_degree === 0 ? colors.isolated : colors.node)
    .attr("fill-opacity", nodeData => nodeData.in_degree + nodeData.out_degree === 0 ? .55 : .9);
  node.filter(nodeData => nodeData.is_top5)
    .append("text")
    .text(nodeData => nodeData.name)
    .attr("x", 14)
    .attr("y", 4)
    .attr("fill", "#f2eaf5")
    .attr("font-family", "DM Mono")
    .attr("font-size", "8px")
    .attr("letter-spacing", "1px");

  node.call(d3.drag()
    .on("start", (event, nodeData) => {
      if (!event.active) simulation.alphaTarget(.25).restart();
      nodeData.fx = nodeData.x;
      nodeData.fy = nodeData.y;
    })
    .on("drag", (event, nodeData) => {
      nodeData.fx = event.x;
      nodeData.fy = event.y;
    })
    .on("end", (event, nodeData) => {
      if (!event.active) simulation.alphaTarget(0);
      nodeData.fx = null;
      nodeData.fy = null;
    }));

  svg.on("pointermove", event => {
    const [x, y] = d3.pointer(event);
    simulation.force("mouse", d3.forceRadial(105, x, y).strength(.009));
    simulation.alpha(.12).restart();
  }).on("pointerleave", () => {
    simulation.force("mouse", null);
    simulation.alpha(.08).restart();
  });

  simulation.on("tick", () => {
    link.attr("x1", edge => edge.source.x).attr("y1", edge => edge.source.y)
      .attr("x2", edge => edge.target.x).attr("y2", edge => edge.target.y);
    node.attr("transform", nodeData => `translate(${nodeData.x},${nodeData.y})`);
  });
}

fetch("data/graph.json")
  .then(response => {
    if (!response.ok) throw new Error(`Could not load graph data: ${response.status}`);
    return response.json();
  })
  .then(data => {
    graphData = data;
    drawGraph(graphData);
  })
  .catch(error => {
    console.error("The interactive graph could not be loaded.", error);
  });

window.addEventListener("resize", () => {
  if (graphData) drawGraph(graphData);
});
