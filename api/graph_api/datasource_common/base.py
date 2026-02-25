# base.py
from __future__ import annotations

from abc import abstractmethod
from typing import Any, Optional

from api.graph_api.model import Graph, Node, Edge
from api.graph_api.services.datasource_plugin import DataSourcePlugin
from .type_inference import infer_attributes, infer_type


class BaseDatasourcePlugin(DataSourcePlugin):
    # Base class for defining the flow of creating a Graph object
    # The flow is always to first parse the source (this is different based on plugin)
    # Secondly, we build the nodes and the edges (which is the same for all)

    def load_graph(self, source: Any, **options: Any) -> Graph:
        # Parse the data
        # This step is different based on each plugin implementation
        raw_data = self._parse_source(source, **options)

        # Create Graph and generate graph Nodes and Edges
        graph_directed = options.get("directed", True)
        graph = Graph(directed=bool(graph_directed))
        self._build_nodes(raw_data, graph)
        self._build_edges(raw_data, graph)
        return graph

    @staticmethod
    def _resolve_path(source: Any, options: dict[str, Any]) -> str:
        if isinstance(source, str) and source.strip():
            return source
        fp = options.get("file_path")
        if isinstance(fp, str) and fp.strip():
            return fp
        raise ValueError("Missing file path. Provide it as 'source' or as option 'file_path'.")

    @abstractmethod
    def _parse_source(self, source: Any, **options: Any) -> Any:
        # This will be implemented by all classes that extends this .py
        pass

    # Create Node objects
    def _build_nodes(self, raw_data: Any, graph: Graph) -> None:
        nodes_data = (raw_data or {}).get("nodes", []) or []

        for node_dict in nodes_data:
            if not isinstance(node_dict, dict):
                continue

            # Get node id
            node_id = node_dict.get("id") or node_dict.get("@id")
            if not node_id:
                # If parse step didn't give an id, skip (or you can generate here)
                continue
            node_id = str(node_id)

            label = node_dict.get("label") or node_dict.get("name") or node_id

            # Everything else is the node attribute
            reserved_keys = {"id", "@id", "label", "name"}
            raw_attributes = {k: v for k, v in node_dict.items() if k not in reserved_keys}

            # Convert attributes to their true types
            typed_attributes = infer_attributes(raw_attributes)

            graph.add_node(Node(node_id=node_id, label=label, attributes=typed_attributes))

    # Create Edge objects
    def _build_edges(self, raw_data: Any, graph: Graph) -> None:
        edges_data = (raw_data or {}).get("edges", []) or []

        for edge_dict in edges_data:
            if not isinstance(edge_dict, dict):
                continue

            source = edge_dict.get("source")
            target = edge_dict.get("target")
            if not source or not target:
                # skip invalid
                continue

            edge_id = edge_dict.get("id")
            if edge_id is not None:
                edge_id = str(edge_id)

            # weight: accept int/float/str, default 1.0
            raw_w = edge_dict.get("weight", 1.0)
            w = infer_type(raw_w) if isinstance(raw_w, str) else raw_w
            try:
                weight = float(w)
            except (TypeError, ValueError):
                weight = 1.0

            directed = graph.directed

            # Everything else is the node attribute
            reserved_keys = {"id", "source", "target", "weight", "directed"}
            raw_attributes = {k: v for k, v in edge_dict.items() if k not in reserved_keys}
            typed_attributes = infer_attributes(raw_attributes)

            graph.add_edge(
                Edge(
                    source=str(source),
                    target=str(target),
                    edge_id=edge_id,
                    weight=weight,
                    directed=directed,
                    attributes=typed_attributes,
                )
            )
