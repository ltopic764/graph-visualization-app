import os
import sys

try:
    from datasource_csv.datasource_csv_plugin.plugin import CsvDatasourcePlugin
except ImportError:
    sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
    from datasource_csv.datasource_csv_plugin.plugin import CsvDatasourcePlugin


def print_graph_inspection(title, graph):
    print("=" * 60)
    print(f"TEST: {title}")
    print("=" * 60)

    print(f"Statistics:")
    print(f"   - Nodes: {len(graph.nodes)}")
    print(f"   - Edges:   {len(graph.edges)}")

    print(f"\nNodes sample:")
    for i, node in enumerate(graph.nodes[:3]):
        attrs = node.attributes
        info = []
        if 'role' in attrs: info.append(f"Role: {attrs['role']}")
        if 'city' in attrs: info.append(f"City: {attrs['city']}")
        if 'salary' in attrs: info.append(f"Salary: {attrs['salary']}")
        if 'efficiency_score' in attrs: info.append(f"Score: {attrs['efficiency_score']}")

        info_str = " | ".join(info)
        print(f"   {i + 1}. [{node.node_id}] {node.label}  --> ({info_str})")

    print(f"\nEdges sample:")
    if not graph.edges:
        print("   (No edges)")
    else:
        for i, edge in enumerate(graph.edges[:5]):
            edge_type = edge.attributes.get('label', 'unknown')
            print(f"   {i + 1}. {edge.source} --[{edge_type}]--> {edge.target}")

    print("\n")


def main():
    plugin = CsvDatasourcePlugin()
    data_dir = "test_data/test_data_csv"

    path_acyclic = os.path.join(data_dir, "dataset_acyclic.csv")
    if os.path.exists(path_acyclic):
        try:
            graph_acyclic = plugin.load_graph(path_acyclic)
            print_graph_inspection("Acyclic graph (Org Chart)", graph_acyclic)
        except Exception as e:
            print(f"Error loading: {e}")
    else:
        print(f"File not found: {path_acyclic}")

    path_cyclic = os.path.join(data_dir, "dataset_cyclic.csv")
    if os.path.exists(path_cyclic):
        try:
            graph_cyclic = plugin.load_graph(path_cyclic)
            print_graph_inspection("Cyclic graph (Project Collab)", graph_cyclic)
        except Exception as e:
            print(f"Error loading: {e}")
    else:
        print(f"File not found: {path_cyclic}")


if __name__ == "__main__":
    main()
