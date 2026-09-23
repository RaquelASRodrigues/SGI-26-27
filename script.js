const posts = [
  {
    number: "04",
    date: "WEEK 04 · 23.09.26",
    type: "COMMUNITIES",
    title: "Groups have a story",
    summary: "Zooming out from individual philosophers to communities, overlapping groups, weighted ties, and network backbones.",
    link: "posts/week4.html"
  },
  {
    number: "03",
    date: "WEEK 03 · 16.09.26",
    type: "CENTRALITY / NULL MODELS",
    title: "The Surprising Ones",
    summary: "Ranking Marvel character–centrality observations by z-score, then opening each candidate's complete centrality profile.",
    link: "posts/week3.html"
  },
  {
    number: "02",
    date: "WEEK 02 · 09.09.26",
    type: "MODELS & NULL MODELS",
    title: "When Chance Gives Up",
    summary: "Testing Marvel against Erdős–Rényi, Barabási–Albert, Watts–Strogatz, and degree-preserving null shuffles to see what makes superhero networks unique.",
    link: "posts/week2.html"
  },
  {
    number: "01",
    date: "WEEK 01 · 02.09.26",
    type: "DEGREE / DIRECTED GRAPHS",
    title: "Every node has a story",
    summary: "Exploring in-degree vs out-degree distributions in the Marvel Universe.",
    link: "posts/week1.html"
  }
];

const postsList = document.querySelector("#posts-list");
posts.forEach((post, index) => {
  const link = document.createElement("a");
  link.className = "post-link";
  link.href = post.link;
  link.innerHTML = `
    <article class="post">
    <div class="post-number">${post.number}</div>
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
    .force("charge", d3.forceManyBody().strength(-45).distanceMax(260))
    .force("center", d3.forceCenter(width / 2, height / 2))
    .force("collide", d3.forceCollide().radius(node => radius(node.in_degree + node.out_degree) + 3));

  const link = svg.append("g")
    .attr("stroke", "#a66be0")
    .attr("stroke-opacity", .15)
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

  // Hub labels, now with a backing rect so they're legible over dense areas
  node.filter(nodeData => nodeData.is_top5).each(function (nodeData) {
    const group = d3.select(this);
    const charWidth = 5.6;
    const padding = 5;
    const textWidth = nodeData.name.length * charWidth;
    group.append("rect")
      .attr("x", 14 - padding / 2)
      .attr("y", -5)
      .attr("width", textWidth + padding)
      .attr("height", 12)
      .attr("rx", 2)
      .attr("fill", "#0a090d")
      .attr("fill-opacity", .65);
    group.append("text")
      .text(nodeData.name)
      .attr("x", 14)
      .attr("y", 4)
      .attr("fill", "#f2eaf5")
      .attr("font-family", "DM Mono")
      .attr("font-size", "8px")
      .attr("letter-spacing", "1px");
  });

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

  // Localized cursor interaction: only nodes near the pointer react,
  // with force fading out over `radius` pixels, instead of nudging the whole graph.
  simulation.force("mouse", null);
  svg.on("pointermove", event => {
    const [mx, my] = d3.pointer(event);
    const radius = 90;
    const strength = 0.6;
    for (const d of data.nodes) {
      const dx = d.x - mx, dy = d.y - my;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      if (dist < radius) {
        const force = (1 - dist / radius) * strength;
        d.vx += (dx / dist) * force;
        d.vy += (dy / dist) * force;
      }
    }
    if (simulation.alpha() < 0.15) simulation.alpha(0.15).restart();
  }).on("pointerleave", () => {
    simulation.alphaTarget(0);
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
