import os
import sys

try:
    from datasource_json.datasource_json_plugin.plugin import JsonDatasourcePlugin
except ImportError:
    sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
    from datasource_json.datasource_json_plugin.plugin import JsonDatasourcePlugin


def inspect_graph(title, graph):
    print("=" * 70)
    print(f"JSON TEST: {title}")
    print("=" * 70)

    print(f"Statistic:")
    print(f"   - Nodes: {len(graph.nodes)}")
    print(f"   - Edges:   {len(graph.edges)}")

    print(f"\nNodes sample:")
    for i, node in enumerate(graph.nodes[:3]):
        attrs = node.attributes
        details = []

        if 'status' in attrs: details.append(f"Status: {attrs['status']}")
        if 'priority' in attrs: details.append(f"Priority: {attrs['priority']}")

        if 'type' in attrs: details.append(f"Type: {attrs['type']}")
        if 'ip' in attrs: details.append(f"IP: {attrs['ip']}")
        if 'load' in attrs: details.append(f"Load: {attrs['load']}%")

        print(f"   {i + 1}. [{node.node_id}] {node.label}")
        print(f"       └── {', '.join(details)}")

    print(f"\nEdge sample:")
    if not graph.edges:
        print("   (No edges)")
    else:
        for i, edge in enumerate(graph.edges[:5]):
            etype = edge.attributes.get('type') or edge.attributes.get('label')
            extra = ""
            if 'latency' in edge.attributes: extra = f" ({edge.attributes['latency']})"

            print(f"   {i + 1}. {edge.source} --[{etype}{extra}]--> {edge.target}")
    print("\n")


def main():
    plugin = JsonDatasourcePlugin()
    data_dir = "test_data/test_data_json"

    # 1. Acyclic
    try:
        path = os.path.join(data_dir, "graph_220_acyclic.json")
        g = plugin.load_graph(path)
        inspect_graph("Acyclic (Project Management)", g)
    except Exception as e:
        print(f"Error: {e}")

    # 2. Cyclic
    try:
        path = os.path.join(data_dir, "graph_220_cyclic.json")
        g = plugin.load_graph(path)
        inspect_graph("Cyclic (Server Network)", g)
    except Exception as e:
        print(f"Error: {e}")


if __name__ == "__main__":
    main()
    