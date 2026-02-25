from abc import abstractmethod
from typing import Any
from api.graph_api.model import Graph, Node, Edge
from api.graph_api.services.datasource_plugin import DataSourcePlugin
from .type_inference import  infer_type, infer_attributes

class BaseDatasourcePlugin(DataSourcePlugin):
    # Base class for defining the flow of creating a Graph object
    # The flow is always to first parse the source (this is different based on plugin)
    # Secondly, we build the nodes and the edges (which is the same for all)

    def load_graph(self, source: Any, **options: Any) -> Graph:
        # Parse data
        # This step is different based on each plugin implementation
        raw_data = self._parse_source(source, **options)

        # Create Graph object from file contents
        graph = Graph()

        # Create graph Nodes from raw data
        # This will be the same for all plugins
        self._build_nodes(raw_data, graph)

        # Create graph Edges from raw data
        #This will be the same for all plugins
        self._build_edges(raw_data, graph)

        return graph

    @abstractmethod
    def _parse_source(self, source: Any, **options: Any) -> Any:
        # Every subclass must also implement this method
        pass

    def _build_nodes(self, raw_data: Any, graph: Graph) -> None:
        # Create Nodes from data

        # Get nodes list from data, if not list use empty
        nodes_data = raw_data.get("nodes", [])

        for node_dict in nodes_data:
            # Get the node id
            node_id = node_dict.get("id") or node_dict.get("@id") or None

            # Get label if exists
            label = node_dict.get("label") or node_dict.get("name") or node_id

            # Everything else is the node attribute
            reserved_keys = {"id", "@id", "label", "name", "edges"}
            raw_attributes = {
                key: value
                for key, value in node_dict.items()
                if key not in reserved_keys
            }

            # Convert attributes to their true types
            typed_attributes = infer_attributes(raw_attributes)

            # Create the Node
            node = Node(
                node_id=node_id,
                label=label,
                attributes=typed_attributes
            )

            # Add Node to Graph
            graph.add_node(node)

    def _build_edges(self, raw_data: Any, graph: Graph) -> None:
        # Create Edge from data

        # Get edges
        edges_data = raw_data.get("edges", [])

        for edge_dict in edges_data:
            # Source and target are mandatory
            source = edge_dict.get("source")
            target = edge_dict.get("target")

            if not source or not target:
                # Skip invalid edges
                print(f"Warning: Edge skipped - missing source or target: {edge_dict}")
                continue

            edge_id = edge_dict.get("id") or None

            # weight is optional, default value is 1.00
            weight = infer_type(str(edge_dict.get("weight", 1.00)))

            # directed is optional, default True
            directed = edge_dict.get("directed", True)

            reserved_keys = {"id", "source", "target", "weight", "directed"}
            raw_attributes = {
                key: value
                for key, value in edge_dict.items()
                if key not in reserved_keys
            }
            typed_attributes = infer_attributes(raw_attributes)

            # Create Edge
            edge = Edge(
                source=source,
                target=target,
                edge_id=edge_id,
                weight=float(weight) if isinstance(weight, (int, float)) else 1.0,
                directed=directed,
                attributes=typed_attributes
            )

            graph.add_edge(edge)
