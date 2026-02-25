import os
from jinja2 import Environment, FileSystemLoader
from api.graph_api.services.visualizer_plugin import VisualizerPlugin
from api.graph_api.model.graph import Graph
from .node_visual_decorator import NodeVisualDecorator

# Standard dimensions for the visualizer
WIDTH = 800
HEIGHT = 600

def get_node_levels(graph: Graph):
    """
    Performs BFS to determine the depth level of each node.
    Returns a dictionary mapping level (int) to a list of node IDs.
    """
    levels = {}
    visited = set()

    # Identify root nodes
    incoming = {edge.target for edge in graph.edges}
    roots = [n for n in graph.nodes if n.node_id not in incoming]

    if not roots and graph.nodes:
        roots = [graph.nodes[0]]

    queue = [(root.node_id, 0) for root in roots]
    for r_id, _ in queue:
        visited.add(r_id)

    while queue:
        curr_id, dist = queue.pop(0)
        levels[curr_id] = dist
        for edge in graph.edges:
            if edge.source == curr_id and edge.target not in visited:
                visited.add(edge.target)
                queue.append((edge.target, dist + 1))

    for node in graph.nodes:
        if node.node_id not in levels:
            levels[node.node_id] = 0

    columns = {}
    for node_id, lvl in levels.items():
        if lvl not in columns:
            columns[lvl] = []
        columns[lvl].append(node_id)
    return columns


class BlockVisualizer(VisualizerPlugin):
    @property
    def plugin_id(self) -> str:
        return "block-visualizer"

    @property
    def display_name(self) -> str:
        return "Block Layered View"

    def render(self, graph: Graph, **options) -> str:
        n_nodes = len(graph.nodes)
        if n_nodes == 0:
            return "<html><body>Empty Graph</body></html>"

        # --- GET LEVELS ---
        columns = get_node_levels(graph)

        # --- Calculate Coords and Scaling ---
        positions = {}
        max_lvl = max(columns.keys()) if columns else 0
        max_nodes_in_column = max(len(ids) for ids in columns.values()) if columns else 0

        width = max(800, (max_lvl + 2) * 250)
        height = max(600, (max_nodes_in_column + 1) * 120)

        dx = width / (max_lvl + 2)

        # Blocks need more space, so we scale size and font based on node count
        scale = max(0.6, 1.0 - (n_nodes / 60))
        block_w = 160 * scale
        block_h = 100 * scale
        font_size = 11 * scale

        for lvl, node_ids in columns.items():
            x = (lvl + 1) * dx
            dy = height / (len(node_ids) + 1)
            for i, node_id in enumerate(node_ids):
                y = dy * (i + 1)
                positions[node_id] = {
                    "x": x,
                    "y": y,
                    "top_x": x - (block_w / 2),
                    "top_y": y - (block_h / 2)
                }

        decorated_nodes = [NodeVisualDecorator(n, max_visible=4) for n in graph.nodes]

        # --- Template Rendering ---
        template_path = os.path.join(os.path.dirname(__file__), 'templates')
        env = Environment(loader=FileSystemLoader(template_path))
        template = env.get_template('block.html')

        return template.render(
            nodes=decorated_nodes,
            edges=graph.edges,
            directed=graph.directed,
            positions=positions,
            block_w=block_w,
            block_h=block_h,
            font_size=font_size,
            width=width,
            height=height,
            scale=scale
        )