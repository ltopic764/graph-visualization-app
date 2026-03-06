import os
from jinja2 import Environment, FileSystemLoader
from api.graph_api.services.visualizer_plugin import VisualizerPlugin
from api.graph_api.model.graph import Graph

# Base canvas dimensions used as minimal size for the visualization
WIDTH = 800
HEIGHT = 600


def get_components(graph: Graph):
    """
    Detects connected components in the graph by performing a BFS traversal
    on an undirected version of the graph structure.

    This ensures that disconnected parts of the graph are identified as
    separate groups, allowing the visualizer to arrange them as independent
    "islands" rather than forcing them into a single global hierarchy.

    Returns:
        List[List[str]]: A list of components, where each component
        is represented as a list of node IDs belonging to that component.
    """
    adj = {n.node_id: set() for n in graph.nodes}
    for edge in graph.edges:
        adj[edge.source].add(edge.target)
        adj[edge.target].add(edge.source)

    visited = set()
    components = []
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
    """
    A lightweight layered visualizer that represents nodes as circles.

    It employs a hierarchical layout algorithm that organizes nodes into
    columns (levels) based on their distance from root nodes, ensuring
    that parents are centered relative to their entire subtree.
    """

    @property
    def plugin_id(self) -> str:
        return "simple-visualizer"

    @property
    def display_name(self) -> str:
        return "Simple Layered View"

    def render(self, graph: Graph, **options) -> str:
        """
        Main rendering entry point for the Simple Visualizer.

        The algorithm follows a multi-pass approach:
        1. Component discovery and BFS level assignment (Horizontal positioning).
        2. Bottom-up subtree weight calculation (Determining required vertical space).
        3. Top-down coordinate assignment (Vertical centering and recursive distribution).
        4. Normalization and adaptive scaling based on node density.
        """
        if not graph.nodes:
            return "<html><body>Empty Graph</body></html>"

        # --- FIND AND SORT CONNECTED COMPONENTS ---
        components = get_components(graph)
        components.sort(key=len, reverse=True)

        positions = {}
        current_x_offset = 0
        row_y_offset = 0
        max_row_height = 0

        # Constants for simple circular layout
        NODE_SPACING_Y = 60  # Minimum vertical space allocated for one leaf
        LEVEL_SPACING_X = 200  # Horizontal distance between layers

        for comp_nodes in components:
            comp_edges = [e for e in graph.edges if e.source in comp_nodes]
            levels = self._get_levels_for_component(comp_nodes, comp_edges)

            # Group node IDs by their BFS level
            lvl_dict = {}
            for nid, lvl in levels.items():
                lvl_dict.setdefault(lvl, []).append(nid)

            max_lvl = max(lvl_dict.keys()) if lvl_dict else 0

            # --- STEP 1: CALCULATE SUBTREE WEIGHTS (Bottom-Up) ---
            # subtree_size[nid] represents how many leaf nodes are under this node.
            # This determines how much vertical "slice" a node needs to accommodate its children.
            subtree_size = {}

            # Build child map based on hierarchy (only edges going to the next level)
            child_map = {nid: [] for nid in comp_nodes}
            for e in comp_edges:
                if levels.get(e.target) == levels.get(e.source, 0) + 1:
                    child_map[e.source].append(e.target)

            # Process levels from last to first to propagate leaf counts upwards
            for lvl in range(max_lvl, -1, -1):
                for nid in lvl_dict.get(lvl, []):
                    children = child_map[nid]
                    if not children:
                        subtree_size[nid] = 1  # Base case: node is a leaf in the hierarchy
                    else:
                        subtree_size[nid] = sum(subtree_size[c] for c in children)

            # --- STEP 2: ASSIGN POSITIONS (Top-Down Centering) ---
            # Roots define the initial vertical distribution for the entire component.
            roots = lvl_dict.get(0, [])
            total_comp_weight = sum(subtree_size[r] for r in roots)
            comp_actual_h = total_comp_weight * NODE_SPACING_Y

            # Tracks the vertical boundaries allocated to each node: node_y_range[nid] = (y_start, y_end)
            node_y_range = {}

            # Position root nodes in the first column
            current_y = row_y_offset
            for r in roots:
                size = subtree_size[r] * NODE_SPACING_Y
                node_y_range[r] = (current_y, current_y + size)
                positions[r] = {
                    "x": current_x_offset,
                    "y": current_y + (size / 2)
                }
                current_y += size

            # Recursively position subsequent levels based on parent's allocated vertical range
            for lvl in range(1, max_lvl + 1):
                x = current_x_offset + (lvl * LEVEL_SPACING_X)

                for parent_id in lvl_dict.get(lvl - 1, []):
                    if parent_id not in node_y_range: continue

                    p_y_start, p_y_end = node_y_range[parent_id]
                    children = child_map[parent_id]

                    if not children:
                        continue

                    # Divide parent's vertical space among children proportional to their weights
                    child_y_cursor = p_y_start
                    parent_weight = subtree_size[parent_id]

                    for c_id in children:
                        c_weight = subtree_size[c_id]
                        c_space = (c_weight / parent_weight) * (p_y_end - p_y_start)

                        node_y_range[c_id] = (child_y_cursor, child_y_cursor + c_space)
                        positions[c_id] = {
                            "x": x,
                            "y": child_y_cursor + (c_space / 2)
                        }
                        child_y_cursor += c_space

                # Safety check for nodes that might be isolated at this level
                for nid in lvl_dict[lvl]:
                    if nid not in positions:
                        positions[nid] = {"x": x, "y": row_y_offset}

            # Update offsets for the next component/island
            comp_w = max_lvl * LEVEL_SPACING_X
            max_row_height = max(max_row_height, comp_actual_h)
            current_x_offset += comp_w + 250

            # Wrap row if horizontal canvas space is exceeded
            if current_x_offset > WIDTH + 500:
                current_x_offset = 0
                row_y_offset += max_row_height + 100
                max_row_height = 0

        # --- PHASE 2: NORMALIZATION AND RENDERING ---
        # Recalculate coordinates to fit within a margin-protected bounding box
        all_x = [p["x"] for p in positions.values()]
        all_y = [p["y"] for p in positions.values()]
        min_x, max_x = (min(all_x), max(all_x)) if all_x else (0, 0)
        min_y, max_y = (min(all_y), max(all_y)) if all_y else (0, 0)

        margin = 80
        for nid in positions:
            positions[nid]["x"] = positions[nid]["x"] - min_x + margin
            positions[nid]["y"] = positions[nid]["y"] - min_y + margin

        render_width = max(max_x - min_x + (2 * margin), WIDTH)
        render_height = max(max_y - min_y + (2 * margin), HEIGHT)

        # Apply adaptive scaling for node radius and font size based on graph complexity
        scale = max(0.5, 1.0 - (len(graph.nodes) / 250))

        # --- TEMPLATE RENDERING ---
        template_path = os.path.join(os.path.dirname(__file__), 'templates')
        env = Environment(loader=FileSystemLoader(template_path))
        template = env.get_template('simple.html')

        return template.render(
            nodes=graph.nodes,
            edges=graph.edges,
            directed=graph.directed,
            positions=positions,
            radius=22 * scale,
            font_size=11 * scale,
            scale=scale,
            width=render_width,
            height=render_height
        )

    def _get_levels_for_component(self, node_ids, edges):
        """
        Computes BFS depth levels for nodes inside a single connected component.

        It determines the hierarchical depth (level) of each node starting from
        the roots. This level is used to establish the horizontal column for each node.
        If the component is cyclic, the first node in the list is used as a fallback root.

        Returns:
            dict[node_id -> level]: A mapping of node IDs to their depth level.
        """
        levels = {}
        visited = set()

        # Identify roots: nodes with no incoming edges within this component
        incoming = {e.target for e in edges if e.target in node_ids}
        roots = [nid for nid in node_ids if nid not in incoming]

        if not roots and node_ids:
            roots = [node_ids[0]]

        queue = [(r, 0) for r in roots]
        for r, _ in queue: visited.add(r)

        while queue:
            curr, d = queue.pop(0)
            levels[curr] = d
            for e in edges:
                if e.source == curr and e.target not in visited:
                    visited.add(e.target)
                    queue.append((e.target, d + 1))

        # Default level 0 for any node that escaped the traversal
        for nid in node_ids:
            if nid not in levels:
                levels[nid] = 0
        return levels