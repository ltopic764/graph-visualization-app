from api.graph_api.model import Graph, Node, Edge
from platform.graph_platform.workspace import Workspace
from platform.graph_platform.engine import GraphEngine

# ----------------------------
# 1️⃣ Kreiranje grafa
# ----------------------------
graph = Graph(directed=True)

# Dodavanje čvorova
graph.add_node(Node("1", label="Alice", attributes={"type": "person"}))
graph.add_node(Node("2", label="Bob", attributes={"type": "person"}))
graph.add_node(Node("3", label="CompanyX", attributes={"type": "company"}))

# Dodavanje grana
graph.add_edge(Edge(source="1", target="2", weight=1.5, attributes={"relation": "friend"}))
graph.add_edge(Edge(source="2", target="3", weight=2.0, attributes={"relation": "employee"}))
graph.add_edge(Edge(source="1", target="3", weight=5.0, attributes={"relation": "investor"}))

# ----------------------------
# 2️⃣ Workspace setup
# ----------------------------
workspace = Workspace()
workspace.set_graph(graph)

# ----------------------------
# 3️⃣ Test node search
# ----------------------------
print("Nodes with label containing 'A':")
for node in workspace.find_nodes_by_label("A"):
    print(node.to_dict())

print("\nNodes with attribute type='person':")
for node in workspace.find_nodes_by_attribute("type", "person"):
    print(node.to_dict())

# ----------------------------
# 4️⃣ Test edge search
# ----------------------------
print("\nEdges with weight >= 2:")
for edge in workspace.find_edges_by_weight(min_weight=2.0):
    print(edge.to_dict())

print("\nEdges with attribute relation='friend':")
for edge in workspace.find_edges_by_attribute("relation", "friend"):
    print(edge.to_dict())

# ----------------------------
# 5️⃣ Test GraphEngine delegation
# ----------------------------
engine = GraphEngine()
engine.workspace.set_graph(graph)

print("\nUsing GraphEngine to search nodes by label 'B':")
for node in engine.search_nodes_by_label("B"):
    print(node.to_dict())