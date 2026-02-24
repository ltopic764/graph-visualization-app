import os
from jinja2 import Environment, FileSystemLoader
from api.graph_api.services.visualizer_plugin import VisualizerPlugin
from api.graph_api.model.graph import Graph

#Width and height of the space for graph
WIDTH = 800
HEIGHT = 600


def get_node_levels(graph: Graph):
    """
    Performs BFS to determine the depth level of each node.
    Returns a dictionary mapping level (int) to a list of node IDs.
    """
    levels = {}
    visited = set()

    # Identify root nodes (nodes with no incoming edges)
    incoming = {edge.target for edge in graph.edges}
    roots = [n for n in graph.nodes if n.node_id not in incoming]

    # If no clear roots exist (e.g., cyclic graph), pick the first node as starting point
    if not roots and graph.nodes:
        roots = [graph.nodes[0]]

    # Initialize queue for BFS: (node_id, distance)
    queue = [(root.node_id, 0) for root in roots]
    for r_id, _ in queue:
        visited.add(r_id)

    while queue:
        curr_id, dist = queue.pop(0)
        levels[curr_id] = dist

        # Explore neighbors
        for edge in graph.edges:
            if edge.source == curr_id and edge.target not in visited:
                visited.add(edge.target)
                queue.append((edge.target, dist + 1))

    # Assign level 0 to any remaining nodes that were not reachable via BFS
    for node in graph.nodes:
        if node.node_id not in levels:
            levels[node.node_id] = 0

    # Group node IDs by their levels
    columns = {}
    for node_id, lvl in levels.items():
        if lvl not in columns:
            columns[lvl] = []
        columns[lvl].append(node_id)

    return columns


class SimpleVisualizer(VisualizerPlugin):
    @property
    def plugin_id(self) -> str:
        return "simple-visualizer"

    @property
    def display_name(self) -> str:
        return "Simple Layered View"

    def render(self, graph: Graph, **options) -> str:
        n_nodes = len(graph.nodes)
        if n_nodes == 0:
            return "<html><body>Empty Graph</body></html>"

        # --- GET LEVELS USING THE HELPER FUNCTION ---
        columns = get_node_levels(graph)

        # --- Calculate Coords ---
        positions = {}
        width, height = WIDTH, HEIGHT

        # Get max level from columns keys
        max_lvl = max(columns.keys()) if columns else 0
        dx = width / (max_lvl + 2)

        for lvl, node_ids in columns.items():
            x = (lvl + 1) * dx
            dy = height / (len(node_ids) + 1)
            for i, node_id in enumerate(node_ids):
                positions[node_id] = {"x": x, "y": dy * (i + 1)}

        # --- Scaling ---
        scale = max(0.4, 1.0 - (n_nodes / 100))
        radius = 25 * scale
        font_size = 12 * scale

        # --- Template Rendering ---
        template_path = os.path.join(os.path.dirname(__file__), 'templates')
        env = Environment(loader=FileSystemLoader(template_path))
        template = env.get_template('simple.html')

        return template.render(
            nodes=graph.nodes,
            edges=graph.edges,
            positions=positions,
            radius=radius,
            font_size=font_size,
            scale=scale
        )