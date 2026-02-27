from typing import List
from .node import Node
from .edge import Edge
from typing import Optional


class Graph:
    def __init__(self, directed: bool = True):
        self.directed = directed
        self.nodes: List[Node] = []
        self.edges: List[Edge] = []
        self._edge_counter = 0
        self._node_counter = 0

    # -----------------
    # NODE OPERATIONS
    # -----------------

    def add_node(self, node: Node):
        if node.node_id and any(n.node_id == node.node_id for n in self.nodes):
            raise ValueError(f"Node '{node.node_id}' already exists.")

        if not node.node_id:
            self._node_counter += 1
            node.node_id = str(self._node_counter)

        self.nodes.append(node)

    def get_node(self, node_id: str) -> Optional[Node]:
        for node in self.nodes:
            if node.node_id == node_id:
                return node
        return None

    # -----------------
    # EDGE OPERATIONS
    # -----------------

    def add_edge(self, edge: Edge):
        if not any(n.node_id == edge.source for n in self.nodes):
            raise ValueError(f"Source node '{edge.source}' does not exist.")

        if not any(n.node_id == edge.target for n in self.nodes):
            raise ValueError(f"Target node '{edge.target}' does not exist.")

        if edge.edge_id and any(e.edge_id == edge.edge_id for e in self.edges):
            raise ValueError(f"Edge '{edge.edge_id}' already exists.")

        if not edge.edge_id:
            self._edge_counter += 1
            edge.edge_id = str(self._edge_counter)

        self.edges.append(edge)

    def get_edges(self) -> List[Edge]:
        return self.edges

    def to_dict(self) -> dict:
        return {
            "directed": self.directed,
            "nodes": [node.to_dict() for node in self.nodes],
            "edges": [edge.to_dict() for edge in self.edges],
        }