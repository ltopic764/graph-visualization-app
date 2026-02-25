from visualizer_simple_plugin.plugin import SimpleVisualizer
from api.graph_api.model.graph import Graph
from api.graph_api.model.node import Node
from api.graph_api.model.edge import Edge

# TEST ZA VISUALIZER SIMPLE PLUGIN
def test_rendering():
    g = Graph(directed=True)

    # Root
    g.add_node(Node("1", "id:1"))

    # Layer 1
    for i in ["2", "3", "4", "5"]:
        g.add_node(Node(i, f"id:{i}"))
        g.add_edge(Edge("1", i))

    # Layer 2
    g.add_node(Node("6", "id:6"))
    g.add_edge(Edge("3", "6"))

    # Additional id:4 -> id:6 for two arrows on one
    g.add_edge(Edge("4", "6"))

    # Initialize plugin
    visualizer = SimpleVisualizer()

    print(f"Testiranje plugina: {visualizer.display_name}")

    # render method
    html_output = visualizer.render(g)

    # Save in
    with open("test_prikaz.html", "w", encoding="utf-8") as f:
        f.write(html_output)

    print("Gotovo! Otvori 'test_prikaz.html' u svom browseru.")


if __name__ == "__main__":
    test_rendering()