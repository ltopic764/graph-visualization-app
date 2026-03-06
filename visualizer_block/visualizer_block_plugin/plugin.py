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

        This method implements a sophisticated bottom-up layout algorithm.
        It calculates the 'weight' of each node based on the size of its subtree
        (number of leaf nodes it leads to). This ensures that parents are
        perfectly centered over their children and that vertical spacing is
        allocated proportionally to the complexity of each branch.

        The rendering process follows these stages:
        1. Component discovery and BFS level assignment.
        2. Bottom-up subtree weight calculation to determine required vertical space.
        3. Top-down coordinate assignment for perfect centering.
        4. Layout normalization and adaptive scaling for block dimensions.
        5. Decorating nodes with visual metadata for attribute display.
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

        # --- ADAPTIVE SCALING ---
        n_nodes = len(graph.nodes)
        scale = max(0.5, 1.0 - (n_nodes / 200))

        # Base dimensions for blocks and spacing
        BLOCK_W = 160 * scale
        BLOCK_H = 100 * scale
        MIN_SPACING_Y = BLOCK_H + (40 * scale)
        LEVEL_SPACING_X = BLOCK_W + (100 * scale)

        for comp_nodes in components:
            comp_edges = [e for e in graph.edges if e.source in comp_nodes]
            levels = self._get_levels_for_component(comp_nodes, comp_edges)

            lvl_dict = {}
            for nid, lvl in levels.items():
                lvl_dict.setdefault(lvl, []).append(nid)

            max_lvl = max(lvl_dict.keys()) if lvl_dict else 0

            # --- STEP 1: CALCULATE SUBTREE WEIGHTS (Bottom-Up) ---
            subtree_size = {}
            child_map = {nid: [] for nid in comp_nodes}
            for e in comp_edges:
                # We only consider children in the next hierarchical level
                if levels.get(e.target) == levels.get(e.source, 0) + 1:
                    child_map[e.source].append(e.target)

            for lvl in range(max_lvl, -1, -1):
                for nid in lvl_dict.get(lvl, []):
                    children = child_map[nid]
                    if not children:
                        subtree_size[nid] = 1  # Leaf node in hierarchy
                    else:
                        subtree_size[nid] = sum(subtree_size[c] for c in children)

            # --- STEP 2: ASSIGN POSITIONS (Top-Down Centering) ---
            roots = lvl_dict.get(0, [])
            total_comp_weight = sum(subtree_size[r] for r in roots)
            comp_actual_h = total_comp_weight * MIN_SPACING_Y

            node_y_range = {}  # Tracks the vertical slice allocated to a node
            current_y = row_y_offset

            # Position root nodes
            for r in roots:
                size = subtree_size[r] * MIN_SPACING_Y
                node_y_range[r] = (current_y, current_y + size)
                positions[r] = {
                    "x": current_x_offset + (BLOCK_W / 2),
                    "y": current_y + (size / 2)
                }
                current_y += size

            # Position descendants based on parent's allocated vertical space
            for lvl in range(1, max_lvl + 1):
                x_center = current_x_offset + (lvl * LEVEL_SPACING_X) + (BLOCK_W / 2)

                for parent_id in lvl_dict.get(lvl - 1, []):
                    if parent_id not in node_y_range: continue

                    p_y_start, p_y_end = node_y_range[parent_id]
                    children = child_map[parent_id]
                    if not children: continue

                    child_y_cursor = p_y_start
                    p_weight = subtree_size[parent_id]

                    for c_id in children:
                        c_weight = subtree_size[c_id]
                        c_space = (c_weight / p_weight) * (p_y_end - p_y_start)

                        node_y_range[c_id] = (child_y_cursor, child_y_cursor + c_space)
                        positions[c_id] = {
                            "x": x_center,
                            "y": child_y_cursor + (c_space / 2)
                        }
                        child_y_cursor += c_space

            # Update offsets for the next component/island
            comp_total_w = max_lvl * LEVEL_SPACING_X + BLOCK_W
            max_row_height = max(max_row_height, comp_actual_h)
            current_x_offset += comp_total_w + 200

            # Wrap row if canvas width is exceeded
            if current_x_offset > WIDTH + 400:
                current_x_offset = 0
                row_y_offset += max_row_height + 150
                max_row_height = 0

        # --- PHASE 2: NORMALIZATION AND BLOCK RECT CALCULATION ---
        all_x = [p["x"] for p in positions.values()]
        all_y = [p["y"] for p in positions.values()]
        min_x, max_x = min(all_x), max(all_x)
        min_y, max_y = min(all_y), max(all_y)

        margin = 80
        for nid in positions:
            # Normalize center coordinates
            norm_x = positions[nid]["x"] - min_x + margin
            norm_y = positions[nid]["y"] - min_y + margin
            positions[nid]["x"] = norm_x
            positions[nid]["y"] = norm_y

            # Calculate top-left for SVG rectangles
            positions[nid]["top_x"] = norm_x - (BLOCK_W / 2)
            positions[nid]["top_y"] = norm_y - (BLOCK_H / 2)

        render_width = max(max_x - min_x + (2 * margin), WIDTH)
        render_height = max(max_y - min_y + (2 * margin), HEIGHT)

        # Decorate nodes for attribute visibility control
        decorated_nodes = [NodeVisualDecorator(n, max_visible=4) for n in graph.nodes]

        # --- TEMPLATE RENDERING ---
        template_path = os.path.join(os.path.dirname(__file__), 'templates')
        env = Environment(loader=FileSystemLoader(template_path))
        template = env.get_template('block.html')

        return template.render(
            nodes=decorated_nodes,
            edges=graph.edges,
            directed=graph.directed,
            positions=positions,
            block_w=BLOCK_W,
            block_h=BLOCK_H,
            font_size=11 * scale,
            width=render_width,
            height=render_height,
            scale=scale
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

        # Assign level 0 to any orphan nodes that BFS might have missed
        for nid in node_ids:
            if nid not in levels:
                levels[nid] = 0
        return levels