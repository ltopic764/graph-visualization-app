from .registry import PluginRegistry
from .workspace import Workspace
from api.graph_api.services import DataSourcePlugin, VisualizerPlugin

class GraphEngine:
    """
    High-level orchestration layer.

    Responsibilities:
    - Plugin execution
    - Graph lifecycle management
    - Delegation to Workspace
    """

    def __init__(self):
        self.registry = PluginRegistry()
        self.workspace = Workspace()

    # ==========================================================
    # MAIN ORCHESTRATION
    # ==========================================================

    def process(
        self,
        datasource_name: str,
        visualizer_name: str,
        source: str,
        **options,
    ):
        datasource_cls = self.registry.get_datasource(datasource_name)
        visualizer_cls = self.registry.get_visualizer(visualizer_name)

        if not datasource_cls:
            raise ValueError(f"Datasource '{datasource_name}' not found.")

        if not visualizer_cls:
            raise ValueError(f"Visualizer '{visualizer_name}' not found.")

        datasource: DataSourcePlugin = datasource_cls()
        visualizer: VisualizerPlugin = visualizer_cls()

        graph = datasource.load_graph(source, **options)

        # Store graph inside workspace
        self.workspace.set_graph(graph)

        return visualizer.render(graph, **options)

    # ==========================================================
    # WORKSPACE DELEGATION API
    # ==========================================================

    def get_current_graph(self):
        return self.workspace.get_graph()

    def clear_workspace(self):
        self.workspace.clear()

    def undo(self):
        return self.workspace.undo()

    # Node helpers
    def list_nodes(self):
        return self.workspace.list_nodes()

    def find_node(self, node_id: str):
        return self.workspace.find_node_by_id(node_id)

    def filter_nodes(self, predicate):
        return self.workspace.filter_nodes(predicate)

    # Edge helpers
    def list_edges(self):
        return self.workspace.list_edges()

    def filter_edges(self, predicate):
        return self.workspace.filter_edges(predicate)
    
    # -----------------
    # SEARCH / FILTER DELEGATION
    # -----------------
    def search_nodes_by_label(self, label_substr: str):
        return self.workspace.find_nodes_by_label(label_substr)

    def search_nodes_by_attribute(self, key: str, value: str):
        return self.workspace.find_nodes_by_attribute(key, value)

    def search_edges_by_weight(self, min_weight: float = None, max_weight: float = None):
        return self.workspace.find_edges_by_weight(min_weight, max_weight)

    def search_edges_by_attribute(self, key: str, value: str):
        return self.workspace.find_edges_by_attribute(key, value)