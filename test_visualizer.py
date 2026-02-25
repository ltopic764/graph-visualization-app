import random
from visualizer_block_plugin.plugin import BlockVisualizer
from visualizer_simple_plugin.plugin import SimpleVisualizer
from api.graph_api.model.graph import Graph
from api.graph_api.model.node import Node
from api.graph_api.model.edge import Edge


def smaller_test_graph():
    g = Graph(directed=True)
    g.add_node(Node("1", "id:1"))
    for i in ["2", "3", "4", "5"]:
        g.add_node(Node(i, f"id:{i}", {"name": "node", "number2": i * 2}))
        g.add_edge(Edge("1", i))
    g.add_node(Node("6", "id:6"))
    g.add_edge(Edge("3", "6"))
    g.add_edge(Edge("4", "6"))
    return g


def bigger_test_graph():
    """
    Complex graph with 30 nodes and 5 layers.
    Layer 4 nodes have many attributes to trigger the scrollbar decorator.
    """
    g = Graph(directed=True)

    # --- Layer 0: Root ---
    g.add_node(Node("1", "Main Hub", {"type": "Root", "priority": "High"}))

    # --- Layer 1: Nodes 2 to 6 ---
    for i in range(2, 7):
        node_id = str(i)
        g.add_node(Node(node_id, f"Branch {node_id}", {
            "layer": 1,
            "load": f"{random.randint(10, 90)}%"
        }))
        g.add_edge(Edge("1", node_id))

    # --- Layer 2: Nodes 7 to 16 ---
    current_id = 7
    for parent_id in range(2, 7):
        for _ in range(2):
            node_id = str(current_id)
            g.add_node(Node(node_id, f"Sub {node_id}", {
                "layer": 2,
                "active": True
            }))
            g.add_edge(Edge(str(parent_id), node_id))
            current_id += 1

    # --- Layer 3: Nodes 17 to 25 ---
    for i in range(17, 26):
        node_id = str(i)
        g.add_node(Node(node_id, f"Leaf {node_id}", {
            "layer": 3,
            "val": i * 1.5
        }))
        parent_id = str(random.randint(7, 16))
        g.add_edge(Edge(parent_id, node_id))

    # --- Layer 4: THE SCROLL TEST COLUMN (Nodes 26 to 30) ---
    # These nodes have 7-8 attributes each
    for i in range(26, 31):
        node_id = str(i)
        many_attrs = {
            "layer": 4,
            "status": "Overflow",
            "version": "1.0.4",
            "author": "Kolega3",
            "created": "2026-02-25",
            "checksum": "AX-992",
            "metadata": "hidden_data",
            "last_log": "success"
        }
        g.add_node(Node(node_id, f"DataNode {node_id}", many_attrs))

        # Connect to some nodes from Layer 3
        parent_id = str(random.randint(17, 25))
        g.add_edge(Edge(parent_id, node_id))

    # Cross-connection for testing
    g.add_edge(Edge("30", "1"))

    return g


def test_rendering(use_bigger=True):
    # Switch between graphs here
    if use_bigger:
        g = bigger_test_graph()
        suffix = "bigger"
    else:
        g = smaller_test_graph()
        suffix = "smaller"

    # Initialize plugin (toggle between Simple and Block)
    #visualizer = SimpleVisualizer()
    visualizer = BlockVisualizer()

    print(f"Testiranje plugina: {visualizer.display_name} na {len(g.nodes)} cvorova.")

    # Render
    html_output = visualizer.render(g)

    # Save
    filename = f"test_view_{suffix}.html"
    with open(filename, "w", encoding="utf-8") as f:
        f.write(html_output)

    print(f"Gotovo! Otvori '{filename}' u svom browseru.")


if __name__ == "__main__":
    # Test smaller or bigger graph
    test_rendering(use_bigger=True)