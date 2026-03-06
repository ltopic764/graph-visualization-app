import os
from jinja2 import Environment, FileSystemLoader
from api.graph_api.services.visualizer_plugin import VisualizerPlugin
from api.graph_api.model.graph import Graph

# Width and height of the base canvas for the graph visualization
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


class SimpleVisualizer(VisualizerPlugin):

    @property
    def plugin_id(self) -> str:
        return "simple-visualizer"

    @property
    def display_name(self) -> str:
        return "Simple Layered View"

    def render(self, graph: Graph, **options) -> str:
        """
        Main visualization entry point.

        This method arranges graph nodes into a layered layout while also
        separating disconnected components into independent "islands".

        The positions are first calculated relatively, then normalized and
        centered to ensure the graph doesn't appear stuck in a corner and
        that the canvas fits the content perfectly.
        """
        if not graph.nodes:
            return "<html><body>Empty Graph</body></html>"

        # --- FIND AND SORT CONNECTED COMPONENTS ---
        components = get_components(graph)
        components.sort(key=len, reverse=True)

        positions = {}

        # Layout tracking variables
        current_x_offset = 0
        row_y_offset = 0
        max_row_height = 0

        # --- PHASE 1: GENERATE RELATIVE POSITIONS ---
        # We calculate where nodes should be relative to each other
        for comp_nodes in components:
            comp_edges = [e for e in graph.edges if e.source in comp_nodes]
            comp_levels = self._get_levels_for_component(comp_nodes, comp_edges)

            lvl_dict = {}
            for nid, lvl in comp_levels.items():
                lvl_dict.setdefault(lvl, []).append(nid)

            max_lvl = max(comp_levels.values()) if comp_levels else 0

            # Calculate local dimensions of this component
            comp_w = max_lvl * 150
            comp_h = (max(len(ids) for ids in lvl_dict.values()) - 1) * 80

            # Wrap into a new row if we exceed the base WIDTH
            if current_x_offset + comp_w > WIDTH and current_x_offset > 0:
                current_x_offset = 0
                row_y_offset += max_row_height + 150
                max_row_height = 0

            # Assign preliminary coordinates
            for lvl, nids in lvl_dict.items():
                x = current_x_offset + (lvl * 150)
                for i, nid in enumerate(nids):
                    y = row_y_offset + (i * 80)
                    positions[nid] = {"x": x, "y": y}

            # Update offsets for the next component
            max_row_height = max(max_row_height, comp_h)
            current_x_offset += comp_w + 200

        # --- PHASE 2: POSITION NORMALIZATION ---
        # We find the bounding box of the calculated positions to remove
        # unnecessary empty space and center the graph.
        all_x = [p["x"] for p in positions.values()]
        all_y = [p["y"] for p in positions.values()]

        min_x, max_x = min(all_x), max(all_x)
        min_y, max_y = min(all_y), max(all_y)

        content_width = max_x - min_x
        content_height = max_y - min_y

        # Add a margin so nodes aren't touching the edge of the canvas
        margin = 60
        for nid in positions:
            positions[nid]["x"] = positions[nid]["x"] - min_x + margin
            positions[nid]["y"] = positions[nid]["y"] - min_y + margin

        # Final canvas size based on content dimensions
        render_width = max(content_width + (2 * margin), WIDTH)
        render_height = max(content_height + (2 * margin), HEIGHT)

        # --- ADAPTIVE SCALING ---
        n_nodes = len(graph.nodes)
        scale = max(0.6, 1.0 - (n_nodes / 200))
        radius = 25 * scale
        font_size = 12 * scale

        # --- TEMPLATE RENDERING ---
        template_path = os.path.join(os.path.dirname(__file__), 'templates')
        env = Environment(loader=FileSystemLoader(template_path))
        template = env.get_template('simple.html')

        return template.render(
            nodes=graph.nodes,
            edges=graph.edges,
            directed=graph.directed,
            positions=positions,
            radius=radius,
            font_size=font_size,
            scale=scale,
            width=render_width,
            height=render_height
        )

    def _get_levels_for_component(self, node_ids, edges):
        """
        Computes BFS depth levels for nodes inside a single connected component.

        The function first attempts to detect root nodes (nodes with no incoming edges).
        If no such node exists (e.g., in cyclic graphs), it selects an arbitrary node
        as the starting point.

        BFS traversal is then performed to assign each node a depth level which
        will later determine its horizontal position in the layout.

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

        # Detect roots
        roots = [nid for nid in node_ids if incoming_counts[nid] == 0]

        # If no roots exist (cyclic graph), select first node
        if not roots:
            roots = [node_ids[0]]

        # Initialize BFS queue
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

        # Assign level 0 to any node not reached (rare cases)
        for nid in node_ids:
            if nid not in levels:
                levels[nid] = 0

        return levels