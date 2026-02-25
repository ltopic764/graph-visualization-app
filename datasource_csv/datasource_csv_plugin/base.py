# This will later be moved, since both the datasource json and csv are using it
from abc import abstractmethod
from typing import Any
from api.graph_api.model import Graph
from api.graph_api.services.datasource_plugin import DataSourcePlugin

class BaseDatasourcePlugin(DataSourcePlugin):
    # Base class for defining the flow of creating a Graph object
    # The flow is always to first parse the source (this is different based on plugin)
    # Secondly, we build the nodes and the edges (which is the same for all)

    def load_graph(self, source: Any, **options: Any) -> Graph:
        # Parse data
        raw_data = self._parse_source(source, **options)

        # Create Graph object from file contents
        graph = Graph()
        self._build_nodes(raw_data, graph)
        self._build_edges(raw_data, graph)

        return graph

    @abstractmethod
    def _parse_source(self, source: Any, **options: Any) -> Any:
        # Every subclass must also implement this method
        pass

    def _build_nodes(self, raw_data: Any, graph: Graph) -> None:
        # Create Nodes from data
        pass

    def _build_edges(self, raw_data: Any, graph: Graph) -> None:
        # Create Edge from data
        pass


