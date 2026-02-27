from typing import Optional, List, Callable
from api.graph_api.model import Graph, Node, Edge


class Workspace:
    """
    Central application state container.

    Responsibilities:
    - Manage current graph state
    - Maintain history (undo support)
    - Provide backend search/filter capabilities
    - Act as stable integration layer for CLI and Web
    """

    def __init__(self):
        self._current_graph: Optional[Graph] = None
        self._history: List[Graph] = []

    # ==========================================================
    # GRAPH STATE MANAGEMENT
    # ==========================================================

    def set_graph(self, graph: Graph) -> None:
        if self._current_graph is not None:
            self._history.append(self._current_graph)
        self._current_graph = graph

    def get_graph(self) -> Optional[Graph]:
        return self._current_graph

    def has_graph(self) -> bool:
        return self._current_graph is not None

    def clear(self) -> None:
        self._current_graph = None
        self._history.clear()

    def undo(self) -> Optional[Graph]:
        if not self._history:
            return None
        self._current_graph = self._history.pop()
        return self._current_graph

    def history_size(self) -> int:
        return len(self._history)

    # ==========================================================
    # NODE OPERATIONS
    # ==========================================================

    def list_nodes(self) -> List[Node]:
        if not self._current_graph:
            return []
        return self._current_graph.nodes

    def find_node_by_id(self, node_id: str) -> Optional[Node]:
        if not self._current_graph:
            return None
        return self._current_graph.get_node(node_id)

    def filter_nodes(self, predicate: Callable[[Node], bool]) -> List[Node]:
        if not self._current_graph:
            return []
        return [node for node in self._current_graph.nodes if predicate(node)]

    # ==========================================================
    # EDGE OPERATIONS
    # ==========================================================

    def list_edges(self) -> List[Edge]:
        if not self._current_graph:
            return []
        return self._current_graph.edges

    def filter_edges(self, predicate: Callable[[Edge], bool]) -> List[Edge]:
        if not self._current_graph:
            return []
        return [edge for edge in self._current_graph.edges if predicate(edge)]
    
    # -----------------
    # PREDEFINED NODE FILTERS / SEARCH
    # -----------------
    def find_nodes_by_label(self, label_substr: str) -> List[Node]:
        """Return nodes whose label contains the given substring."""
        return self.filter_nodes(lambda n: label_substr.lower() in n.label.lower())

    def find_nodes_by_attribute(self, key: str, value: str) -> List[Node]:
        """Return nodes where attribute[key] == value."""
        return self.filter_nodes(lambda n: n.attributes.get(key) == value)


    # -----------------
    # PREDEFINED EDGE FILTERS / SEARCH
    # -----------------
    def find_edges_by_weight(self, min_weight: float = None, max_weight: float = None) -> List[Edge]:
        """Return edges whose weight is within the given range."""
        def predicate(e: Edge):
            if min_weight is not None and e.weight < min_weight:
                return False
            if max_weight is not None and e.weight > max_weight:
                return False
            return True
        return self.filter_edges(predicate)

    def find_edges_by_attribute(self, key: str, value: str) -> List[Edge]:
        """Return edges where attribute[key] == value."""
        return self.filter_edges(lambda e: e.attributes.get(key) == value)