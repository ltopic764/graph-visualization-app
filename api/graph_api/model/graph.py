from typing import List
from .node import Node
from .edge import Edge


class Graph:
    def __init__(self, directed: bool = True):
        self.directed = directed
        self.nodes: List[Node] = []
        self.edges: List[Edge] = []
        self._edge_counter = 0
        self._node_counter = 0

    def add_node(self, node: Node):
        if not node.node_id:
            self._node_counter += 1
            node.node_id = str(self._node_counter)
        self.nodes.append(node)

    def add_edge(self, edge: Edge):
        if not edge.edge_id:
            self._edge_counter += 1
            edge.edge_id = str(self._edge_counter)
        self.edges.append(edge)

    def to_dict(self) -> dict:
        return {
            "nodes": [node.to_dict() for node in self.nodes],
            "edges": [edge.to_dict() for edge in self.edges],
        }