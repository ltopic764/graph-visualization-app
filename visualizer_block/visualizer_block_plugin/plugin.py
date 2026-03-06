import os
from jinja2 import Environment, FileSystemLoader
from api.graph_api.services.visualizer_plugin import VisualizerPlugin
from api.graph_api.model.graph import Graph
from .node_visual_decorator import NodeVisualDecorator

# Base canvas dimensions used as minimal size for the visualization
WIDTH = 800
HEIGHT = 600


def get_components(graph: Graph):
    """
    Detects connected components in the graph.

    The algorithm treats the graph as undirected (ignores edge direction)
    and performs a BFS traversal to group nodes that are mutually reachable.

    Returns:
        List[List[str]]: A list of components, where each component
        is represented as a list of node IDs belonging to that component.
    """

    # Build adjacency list ignoring edge direction
    adj = {n.node_id: set() for n in graph.nodes}

    for edge in graph.edges:
        adj[edge.source].add(edge.target)
        adj[edge.target].add(edge.source)

    visited = set()
    components = []

    # Traverse graph to discover components
    for node in graph.nodes:
        if node.node_id not in visited:
            component = []
            queue = [node.node_id]
            visited.add(node.node_id)

            while queue:
                curr = queue.pop(0)
                component.append(curr)

                for neighbor in adj[curr]:
                    if neighbor not in visited:
                        visited.add(neighbor)
                        queue.append(neighbor)

            components.append(component)

    return components


class BlockVisualizer(VisualizerPlugin):

    @property
    def plugin_id(self) -> str:
        return "block-visualizer"

    @property
    def display_name(self) -> str:
        return "Block Layered View"

    def render(self, graph: Graph, **options) -> str:
        """
        Main rendering entry point for the Block Visualizer.

        This visualizer organizes nodes into layered blocks instead of circles.
        Each connected component of the graph is rendered as a separate "island"
        to prevent unrelated nodes from mixing visually.

        The layout process consists of several stages:

        1. Detect connected components.
        2. Compute BFS levels within each component.
        3. Assign preliminary positions for nodes.
        4. Normalize and center the entire layout.
        5. Apply adaptive scaling depending on graph size.
        6. Render the result using a Jinja2 HTML template.
        """

        if not graph.nodes:
            return "<html><body>Empty Graph</body></html>"

        # --- FIND AND SORT CONNECTED COMPONENTS ---
        components = get_components(graph)

        # Larger components are rendered first to improve packing
        components.sort(key=len, reverse=True)

        positions = {}

        # Layout tracking variables
        current_x_offset = 0
        row_y_offset = 0
        max_row_height = 0

        # --- PHASE 1: GENERATE RELATIVE POSITIONS ---
        # Each connected component is laid out independently
        for comp_nodes in components:

            comp_edges = [e for e in graph.edges if e.source in comp_nodes]

            # Compute BFS levels inside this component
            comp_levels = self._get_levels_for_component(comp_nodes, comp_edges)

            # Group nodes by level
            lvl_dict = {}
            for nid, lvl in comp_levels.items():
                lvl_dict.setdefault(lvl, []).append(nid)

            max_lvl = max(comp_levels.values()) if comp_levels else 0

            # Estimate component dimensions
            comp_w = max_lvl * 250
            comp_h = (max(len(ids) for ids in lvl_dict.values()) - 1) * 120

            # Wrap component into next row if we exceed base width
            if current_x_offset + comp_w > WIDTH and current_x_offset > 0:
                current_x_offset = 0
                row_y_offset += max_row_height + 200
                max_row_height = 0

            # Assign coordinates to nodes inside this component
            for lvl, nids in lvl_dict.items():

                x = current_x_offset + (lvl * 250)

                for i, nid in enumerate(nids):

                    y = row_y_offset + (i * 120)

                    positions[nid] = {
                        "x": x,
                        "y": y
                    }

            # Update layout offsets
            max_row_height = max(max_row_height, comp_h)
            current_x_offset += comp_w + 250

        # --- PHASE 2: POSITION NORMALIZATION ---
        # Determine bounding box of the layout
        all_x = [p["x"] for p in positions.values()]
        all_y = [p["y"] for p in positions.values()]

        min_x, max_x = min(all_x), max(all_x)
        min_y, max_y = min(all_y), max(all_y)

        content_width = max_x - min_x
        content_height = max_y - min_y

        # Add margin so nodes do not touch canvas edges
        margin = 80

        for nid in positions:
            positions[nid]["x"] = positions[nid]["x"] - min_x + margin
            positions[nid]["y"] = positions[nid]["y"] - min_y + margin

        # --- ADAPTIVE SCALING ---
        # Larger graphs require smaller block sizes
        n_nodes = len(graph.nodes)

        scale = max(0.6, 1.0 - (n_nodes / 120))

        block_w = 160 * scale
        block_h = 100 * scale
        font_size = 11 * scale

        # Compute top-left positions for rectangles
        for nid in positions:
            x = positions[nid]["x"]
            y = positions[nid]["y"]

            positions[nid]["top_x"] = x - (block_w / 2)
            positions[nid]["top_y"] = y - (block_h / 2)

        # Final canvas size
        render_width = max(content_width + (2 * margin), WIDTH)
        render_height = max(content_height + (2 * margin), HEIGHT)

        # Decorate nodes to control how many attributes are visible
        decorated_nodes = [
            NodeVisualDecorator(n, max_visible=4)
            for n in graph.nodes
        ]

        # --- TEMPLATE RENDERING ---
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
            width=render_width,
            height=render_height,
            scale=scale
        )

    def _get_levels_for_component(self, node_ids, edges):
        """
        Computes BFS depth levels for nodes inside a single connected component.

        The function first attempts to detect root nodes (nodes with no incoming edges).
        If no such node exists (for example in cyclic graphs), an arbitrary node
        from the component is selected as the starting point.

        BFS traversal is then used to determine the level (depth) of each node.
        The level determines the horizontal placement of the node in the layout.

        Returns:
            dict[node_id -> level]
        """

        levels = {}
        visited = set()

        # Count incoming edges inside this component
        incoming_counts = {nid: 0 for nid in node_ids}

        for e in edges:
            if e.target in incoming_counts:
                incoming_counts[e.target] += 1

        # Detect root nodes
        roots = [nid for nid in node_ids if incoming_counts[nid] == 0]

        # If no root exists (cyclic graph), choose the first node
        if not roots:
            roots = [node_ids[0]]

        queue = [(r, 0) for r in roots]

        for r, _ in queue:
            visited.add(r)

        while queue:
            curr, d = queue.pop(0)
            levels[curr] = d

            for e in edges:
                if e.source == curr and e.target not in visited:
                    visited.add(e.target)
                    queue.append((e.target, d + 1))

        # Assign level 0 to any node not reached
        for nid in node_ids:
            if nid not in levels:
                levels[nid] = 0

        return levels