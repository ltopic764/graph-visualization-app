import os
import json
from api.graph_api.model import Graph

from datasource_json.datasource_json_plugin.plugin import JsonDatasourcePlugin

TEST_DIR = "test_data/test_json_ds"
if not os.path.exists(TEST_DIR):
    os.makedirs(TEST_DIR)

data_tree = {
    "label": "CEO",
    "position": "Chief Executive",
    "children": [
        {
            "label": "VP Engineering",
            "department": "Tech",
            "children": [
                {"label": "Backend Lead", "tech": "Python"},
                {"label": "Frontend Lead", "tech": "React"},
                {"label": "DevOps Lead", "tech": "Docker"}
            ]
        },
        {
            "label": "VP Sales",
            "department": "Business",
            "children": [
                {"label": "Sales Manager EU", "target": "1M"},
                {"label": "Sales Manager US", "target": "2M"}
            ]
        },
        {
            "label": "HR Head",
            "children": [
                {"label": "Recruiter 1"},
                {"label": "Recruiter 2"}
            ]
        }
    ]
}

data_cyclic = [
    {"id": "u1", "name": "Marko", "best_friend": "u2", "colleague": "u3"},
    {"id": "u2", "name": "Jovan", "best_friend": "u1", "manager": "u3"},
    {"id": "u3", "name": "Ana", "subordinate": "u2", "subordinate": "u4"},
    {"id": "u4", "name": "Milica", "sister": "u5"},
    {"id": "u5", "name": "Petar", "brother": "u4"},
    {"id": "u6", "name": "Zoran", "neighbor": "u1"},
    {"id": "u7", "name": "Ivana", "colleague": "u6"},
    {"id": "u8", "name": "Dejan", "manager": "u7"},
    {"id": "u9", "name": "Sonja", "team_lead": "u8"},
    {"id": "u10", "name": "Luka", "mentor": "u9"}
]

data_mixed = [
    {
        "id": "proj_A",
        "name": "Project Alpha",
        "tasks": [
            {"id": "t_A1", "name": "Design DB", "status": "Done"},
            {"id": "t_A2", "name": "Develop API", "status": "In Progress", "depends_on": "t_A1"},
            {"id": "t_A3", "name": "Testing", "status": "Todo", "depends_on": "t_A2"}
        ]
    },
    {
        "id": "proj_B",
        "name": "Project Beta",
        "tasks": [
            {"id": "t_B1", "name": "Frontend Setup", "status": "Done"},
            {"id": "t_B2", "name": "Integrate API", "status": "Blocked", "depends_on": "t_A2"}
        ]
    }
]

files_map = {
    "dataset_tree.json": data_tree,
    "dataset_cyclic.json": data_cyclic,
    "dataset_mixed.json": data_mixed
}

for filename, content in files_map.items():
    path = os.path.join(TEST_DIR, filename)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(content, f, indent=2)

print("\n--- Running tests ---\n")
plugin = JsonDatasourcePlugin()

def print_graph_stats(name: str, graph: Graph):
    print(f" REPORT: {name}")
    print(f"   Nodes: {len(graph.nodes)}")
    print(f"   Edges: {len(graph.edges)}")

    print("   Sample Nodes:")
    for n in graph.nodes[:3]:
        attrs = {k: v for k, v in n.attributes.items() if k != 'children' and k != 'tasks'}
        print(f"    - [{n.node_id}] {n.label} | Attrs: {attrs}")

    print("   Sample Edges:")
    for e in graph.edges[:3]:
        label_info = e.attributes.get('label', 'unknown') if e.attributes else 'unknown'
        print(f"    - {e.source} -> {e.target} (Type: {label_info})")
    print("-" * 50)


# TEST 1: Tree
try:
    path = os.path.join(TEST_DIR, "dataset_tree.json")
    graph = plugin.load_graph(path)
    print_graph_stats("TREE STRUCTURE (dataset_tree.json)", graph)
except Exception as e:
    print(f"Tree test error: {e}")

# TEST 2: Cyclic
try:
    path = os.path.join(TEST_DIR, "dataset_cyclic.json")
    graph = plugin.load_graph(path)
    print_graph_stats("CYCLIC FLAT LIST (dataset_cyclic.json)", graph)
except Exception as e:
    print(f"Cyclic test error: {e}")

# TEST 3: Mixed
try:
    path = os.path.join(TEST_DIR, "dataset_mixed.json")
    graph = plugin.load_graph(path)
    print_graph_stats("MIXED COMPLEX (dataset_mixed.json)", graph)
except Exception as e:
    print(f"Mixed testa error: {e}")
