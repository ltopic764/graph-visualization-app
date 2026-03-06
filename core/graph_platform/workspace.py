import datetime
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

    # Method for creating a new Node for CLI implementation
    def create_node(self, node_id: str, properties: dict) -> None:
        # Create a new Node with id and attributes
        # If an id already exists throw error
        if not self._current_graph:
            raise ValueError("No active graph loaded")

        if self._current_graph.get_node(str(node_id)) is not None:
            raise ValueError(f"Node '{node_id}' already exists")

        node = Node(node_id=str(node_id), attributes=properties or {})
        self._current_graph.add_node(node)

    # Method for editing an existing Node for CLI implementation
    def edit_node(self, node_id: str, properties: dict) -> None:
        # Edit existing node attributes

        if not self._current_graph:
            raise ValueError("No active graph loaded")

        node = self._current_graph.get_node(str(node_id))
        if node is None:
            raise ValueError(f"Node '{node_id}' not found")

        for k, v in (properties or {}).items():
            node.attributes[k] = v # update

    # Method for deleting an existing Node for CLI implementation
    def delete_node(self, node_id: str) -> None:
        # Deleting a Node only if he is not connected to any edge
        if not self._current_graph:
            raise ValueError("No active graph loaded")

        node_id = str(node_id)
        node = self._current_graph.get_node(node_id)
        if node is None:
            raise ValueError(f"Node '{node_id}' not found")

        attached = [e for e in self._current_graph.edges if e.source == node_id or e.target == node_id]
        if attached:
            raise ValueError(
                f"Node '{node_id}' has {len(attached)} connected edge(s)"
                f"Delete edges first"
            )

        self._current_graph.nodes = [n for n in self._current_graph.nodes if n.node_id != node_id]

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

    def find_nodes_by_query_contains(
        self, query: str, allowed_node_ids: Optional[set[str]] = None
    ) -> List[Node]:
        if not self._current_graph:
            return []

        normalized_query = str(query).strip().casefold()
        if not normalized_query:
            return []

        def stringify(value) -> str:
            if isinstance(value, (datetime.date, datetime.datetime)):
                return value.isoformat()
            if value is None:
                return ""
            return str(value)

        matched_nodes: List[Node] = []
        for node in self._current_graph.nodes:
            if allowed_node_ids is not None and node.node_id not in allowed_node_ids:
                continue

            if normalized_query in stringify(node.label).casefold():
                matched_nodes.append(node)
                continue

            if normalized_query in stringify(node.node_id).casefold():
                matched_nodes.append(node)
                continue

            attributes = node.attributes if isinstance(node.attributes, dict) else {}
            for key, value in attributes.items():
                if normalized_query in stringify(key).casefold():
                    matched_nodes.append(node)
                    break
                if normalized_query in stringify(value).casefold():
                    matched_nodes.append(node)
                    break

        return matched_nodes

    @staticmethod
    def _resolve_node_filter_value(node: Node, attribute: str):
        raw = node.attributes.get(attribute)

        if raw is None:
            if attribute in ("label", "name"):
                raw = node.label
            elif attribute in ("id", "node_id"):
                raw = node.node_id

        return raw

    @staticmethod
    def _detect_filter_type(raw):
        if isinstance(raw, bool):
            return None
        if isinstance(raw, int):
            return int
        if isinstance(raw, float):
            return float
        if isinstance(raw, str):
            return str
        if isinstance(raw, datetime.datetime):
            return datetime.date
        if isinstance(raw, datetime.date):
            return datetime.date
        return None

    @staticmethod
    def _normalize_raw_for_type(raw, target_type):
        if target_type is int:
            if isinstance(raw, bool):
                return None
            if isinstance(raw, int):
                return raw
            return None

        if target_type is float:
            if isinstance(raw, bool):
                return None
            if isinstance(raw, (int, float)):
                return float(raw)
            return None

        if target_type is str:
            if isinstance(raw, str):
                return raw
            return None

        if target_type is datetime.date:
            if isinstance(raw, datetime.datetime):
                return raw.date()
            if isinstance(raw, datetime.date):
                return raw
            return None

        return None

    @staticmethod
    def _convert_filter_value(value, target_type, attribute: str):
        expected_name = "date (YYYY-MM-DD)" if target_type is datetime.date else target_type.__name__
        invalid_error = ValueError(
            f"Invalid filter value '{value}' for attribute '{attribute}'. Expected {expected_name}."
        )

        try:
            if target_type is int:
                if isinstance(value, bool):
                    raise invalid_error
                if isinstance(value, int):
                    return value
                if isinstance(value, float):
                    if value.is_integer():
                        return int(value)
                    raise invalid_error
                return int(str(value).strip())

            if target_type is float:
                if isinstance(value, bool):
                    raise invalid_error
                if isinstance(value, (int, float)):
                    return float(value)
                return float(str(value).strip())

            if target_type is str:
                return str(value)

            if target_type is datetime.date:
                if isinstance(value, datetime.datetime):
                    return value.date()
                if isinstance(value, datetime.date):
                    return value
                return datetime.date.fromisoformat(str(value).strip())
        except (TypeError, ValueError):
            raise invalid_error

        raise ValueError(f"Unsupported attribute type for '{attribute}'")

    def find_nodes_by_attribute(self, attribute: str, operator: str, value):
        ops = {
            "==": lambda a, b: a == b,
            "!=": lambda a, b: a != b,
            ">":  lambda a, b: a > b,
            ">=": lambda a, b: a >= b,
            "<":  lambda a, b: a < b,
            "<=": lambda a, b: a <= b,
        }

        op_fn = ops.get(operator)
        if op_fn is None:
            raise ValueError(f"Unsupported operator: {operator}")

        target_type = None
        for node in self.list_nodes():
            raw = self._resolve_node_filter_value(node, attribute)
            if raw is None:
                continue

            target_type = self._detect_filter_type(raw)
            if target_type is not None:
                break

        if target_type is None:
            return []

        allowed_operators_by_type = {
            str: {"==", "!="},
            int: {"==", "!=", ">", ">=", "<", "<="},
            float: {"==", "!=", ">", ">=", "<", "<="},
            datetime.date: {"==", "!=", ">", ">=", "<", "<="},
        }
        allowed_operators = allowed_operators_by_type.get(target_type, set())
        if operator not in allowed_operators:
            type_name = "date" if target_type is datetime.date else target_type.__name__
            allowed_text = ", ".join(sorted(allowed_operators))
            raise ValueError(
                f"Operator '{operator}' is not valid for attribute '{attribute}' of type {type_name}. "
                f"Allowed operators: {allowed_text}."
            )

        coerced_value = self._convert_filter_value(value, target_type, attribute)
        result = []

        for node in self.list_nodes():
            raw = self._resolve_node_filter_value(node, attribute)
            if raw is None:
                continue

            normalized_raw = self._normalize_raw_for_type(raw, target_type)
            if normalized_raw is None:
                continue

            if op_fn(normalized_raw, coerced_value):
                result.append(node)

        return result


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

    # ==========================================================
    # EDGE OPERATIONS
    # ==========================================================

    def create_edge(self, source_id: str, target_id: str, edge_id: Optional[str], properties: dict) -> None:
        if not self._current_graph:
            raise ValueError("No active graph loaded")

        # Check if nodes exist
        if not self._current_graph.get_node(source_id):
            raise ValueError(f"Source node '{source_id}' does not exist")
        if not self._current_graph.get_node(target_id):
            raise ValueError(f"Target node '{target_id}' does not exist")

        # ID check
        if edge_id and any(e.edge_id == edge_id for e in self._current_graph.edges):
            raise ValueError(f"Edge '{edge_id}' already exists")

        # Get weight if exist in properties
        weight = float(properties.pop("weight", 1.0))

        edge = Edge(
            source=source_id,
            target=target_id,
            edge_id=edge_id,
            weight=weight,
            attributes=properties
        )
        self._current_graph.add_edge(edge)

    def edit_edge(self, edge_id: str, properties: dict) -> None:
        if not self._current_graph:
            raise ValueError("No active graph loaded")

        # Find
        edge = next((e for e in self._current_graph.edges if e.edge_id == edge_id), None)
        if edge is None:
            raise ValueError(f"Edge '{edge_id}' not found")

        # Update weight if sent
        if "weight" in properties:
            edge.weight = float(properties.pop("weight"))

        # Update other properties
        for k, v in properties.items():
            edge.attributes[k] = v

    def delete_edge(self, edge_id: str) -> None:
        if not self._current_graph:
            raise ValueError("No active graph loaded")

        initial_count = len(self._current_graph.edges)
        self._current_graph.edges = [e for e in self._current_graph.edges if e.edge_id != edge_id]

        if len(self._current_graph.edges) == initial_count:
            raise ValueError(f"Edge '{edge_id}' not found")
