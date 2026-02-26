from datasource_json.datasource_json_plugin.plugin import JsonDatasourcePlugin
from datasource_csv.datasource_csv_plugin.plugin import CsvDatasourcePlugin

json_plugin = JsonDatasourcePlugin()
csv_plugin  = CsvDatasourcePlugin()

def print_graph_summary(graph, naziv: str, preview: int = 5):
    print(f"\n{'=' * 60}")
    print(f"  {naziv}")
    print(f"{'=' * 60}")
    print(f"  Nodes : {len(graph.nodes)}")
    print(f"  Edges   : {len(graph.edges)}")
    print(f"  Directed  : {graph.directed}")

    print(f"\n  First {preview} nodes:")
    for node in graph.nodes[:preview]:
        print(f"    ID={node.node_id} | Label={node.label} | Attributes={node.attributes}")

    print(f"\n  First {preview} edges:")
    for edge in graph.edges[:preview]:
        print(f"    {edge.source} → {edge.target} | directed={edge.directed} | weight={edge.weight}")

    sources_targets = {(e.source, e.target) for e in graph.edges}
    ciklusi = [(s, t) for (s, t) in sources_targets if (t, s) in sources_targets]
    if ciklusi:
        print(f"\n  Cycle detected (first {preview}):")
        for s, t in ciklusi[:preview]:
            print(f"    {s} ↔ {t}")
    else:
        print(f"\n  No cycles")


try:
    graph = json_plugin.load_graph("test_data/company_acyclic.json")
    print_graph_summary(graph, "TEST 1 – (company_acyclic.json)")
except Exception as e:
    print(f"\nError TEST 1: {e}")


try:
    graph = json_plugin.load_graph("test_data/social_cyclic.json")
    print_graph_summary(graph, "TEST 2 – (social_cyclic.json)")
except Exception as e:
    print(f"\nError TEST 2: {e}")


try:
    graph = csv_plugin.load_graph("test_data/roads_acyclic.csv")
    print_graph_summary(graph, "TEST 3 – (roads_acyclic.csv)")
except Exception as e:
    print(f"\nError TEST 3: {e}")


try:
    graph = csv_plugin.load_graph("test_data/network_cyclic.csv")
    print_graph_summary(graph, "TEST 4 – (network_cyclic.csv)")
except Exception as e:
    print(f"\nError TEST 4: {e}")
