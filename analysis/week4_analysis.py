from pathlib import Path
import json
import networkx as nx
import pandas as pd

DATA_DIR=Path(__file__).resolve().parent
NODES_PATH=DATA_DIR/"week4_philosophers_nodes.tsv"
EDGES_PATH=DATA_DIR/"week4_philosophers_edges.tsv"
OUTPUT_PATH=DATA_DIR/"week4_philosophers.json"

def main():
    nodes=pd.read_csv(NODES_PATH,sep="\t",comment="#",quoting=3)
    edges=pd.read_csv(EDGES_PATH,sep="\t",comment="#")
    G=nx.Graph()
    G.add_nodes_from(nodes.node_id)

    for s,t,w in edges.itertuples(index=False):
        if G.has_edge(s,t):G[s][t]["weight"]+=w
        else:G.add_edge(s,t,weight=w)
    giant_nodes=max(nx.connected_components(G),key=len);giant=G.subgraph(giant_nodes)
    rows=nodes.set_index("node_id")
    payload={"meta":{"title":"Week 4 · Philosophers","source":"Wikipedia philosopher lists"},"stats":{"nodes":G.number_of_nodes(),"directed_edges":len(edges),"links":G.number_of_edges(),"giant_nodes":giant.number_of_nodes(),"giant_links":giant.number_of_edges()},"nodes":[],"links":[]}

    for node_id,row in rows.iterrows():
        payload["nodes"].append({"id":node_id,"name":str(row["name"]) if "name" in row and pd.notna(row["name"]) else str(node_id),"era":None if "era" not in row or pd.isna(row["era"]) else str(row["era"])})
    payload["links"]=[{"source":s,"target":t,"weight":d["weight"]} for s,t,d in G.edges(data=True)]
    OUTPUT_PATH.write_text(json.dumps(payload,ensure_ascii=False,separators=(",",":")),encoding="utf-8")
    print(f"Wrote {OUTPUT_PATH}");print(f"G: {G.number_of_nodes()} nodes, {G.number_of_edges()} links");print(f"Giant: {giant.number_of_nodes()} nodes, {giant.number_of_edges()} links")

if __name__== "__main__":
    main()
