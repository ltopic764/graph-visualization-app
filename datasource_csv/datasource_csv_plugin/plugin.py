import csv
import os.path
from typing import Any, List, Dict
from api.graph_api.datasource_common.base import BaseDatasourcePlugin


class CsvDatasourcePlugin(BaseDatasourcePlugin):
    """
        Reads a CSV file from disk and converts it into a Graph object

        Supported formats:
            Edge list (each row describes one edge)
            Node list (each row describes one node)

        An Edge is created between two Nodes only if the value already exists as an ID
        and the attributes name is recognized as something used to describe a connection
        """

    @property
    def plugin_id(self) -> str:
        return "csv"

    @property
    def display_name(self) -> str:
        return "CSV File"

    def parameters_schema(self) -> dict:
        # Tells the platform which parameters to ask the user for
        return {
            "file_path": {
                "type": "str",
                "label": "Path to CSV file",
                "required": True
            },
            "delimiter": {
                "type": "str",
                "label": "Delimiter (leave empty for auto-detect)",
                "required": False
            },
            "directed": {
                "type": "bool",
                "label": "Directed graph",
                "required": False,
                "default": True
            }
        }

    def _is_reference_field(self, key: str) -> bool:
        # Determine whether a filed name should be treated as a reference to another node
        normalized = key.strip().lower()

        explicit_reference_fields = {
            "parent", "ref", "reference",
            "source", "target", "from", "to",
            "friend", "best_friend", "also_knows",
            "manager", "owner", "connects_to", "backup_to",
            "next_city", "next", "linked_to",
        }

        return (
            normalized in explicit_reference_fields
            or normalized.endswith("_id")
            or normalized.endswith("_ref")
        )

    def _parse_source(self, source: Any, **kwargs) -> dict:
        # Reads the CSV file and returns the expected dict

        delimiter = kwargs.get("delimiter")

        path = self._resolve_path(source, kwargs)

        if not os.path.exists(path):
            raise FileNotFoundError(f"CSV file not found: {path}")

        with open(path, 'r', encoding='utf-8') as f:
            if not delimiter:
                try:
                    # Read a sample and detect delimiter automatically
                    # Supports comma, semicolon, tab, pipe, etc.
                    sample = f.read(2048)
                    f.seek(0)
                    delimiter = csv.Sniffer().sniff(sample).delimiter
                except csv.Error:
                    delimiter = ','  # fallback to comma

            reader = csv.DictReader(f, delimiter=delimiter, skipinitialspace=True)
            rows = list(reader)

        if not rows:
            return {"nodes": [], "edges": []}

        # Detect format based on column names
        normalized = {name.lower() for name in rows[0].keys() if isinstance(name, str)}

        if "source" in normalized and "target" in normalized:
            # Each row describes an edge
            return self._parse_edge_list(rows)
        else:
            # Each row describes a node
            return self._parse_node_list(rows)

    def _parse_edge_list(self, rows: List[Dict]) -> dict:
        # Parses a CSV where each row describes one graph edge

        nodes = {}  # dict to avoid duplicate nodes
        edges = []

        for row in rows:
            # Normalize keys to lowercase to handle Source/SOURCE/source etc.
            row_lower = {k.lower(): v for k, v in row.items() if k is not None}

            src = str(row_lower.get("source", "")).strip()
            dst = str(row_lower.get("target", "")).strip()

            if not src or not dst:
                continue

            # Register nodes implicitly edge list has no node attributes
            if src not in nodes:
                nodes[src] = {"id": src, "label": src}
            if dst not in nodes:
                nodes[dst] = {"id": dst, "label": dst}

            # directed defaults to True if column missing or empty
            directed_raw = row_lower.get("directed", "")
            directed = directed_raw not in ("False", "false", "0")

            weight = row_lower.get("weight")

            edge_id = row_lower.get("id")

            # All other columns are edge attributes
            reserved = {"source", "target", "id", "weight", "directed"}
            attributes = {
                k: v for k, v in row_lower.items()
                if k not in reserved and v is not None
            }

            edge_dict = {
                "id":       str(edge_id).strip() if edge_id not in (None, "") else None,
                "source":   src,
                "target":   dst,
                "directed": directed,
            }

            if weight not in (None, ""):
                edge_dict["weight"] = weight

            edge_dict.update(attributes)
            edges.append(edge_dict)

        return {"nodes": list(nodes.values()), "edges": edges}

    def _parse_node_list(self, rows: List[Dict]) -> dict:
        # Parses a CSV where each row describes one graph node
        # Two passes here, one for collecting all ids and the other for building nodes and detecting edges

        nodes = []
        edges = []
        id_registry = set()

        # First pass collect all node IDs
        for i, row in enumerate(rows):
            node_id = self._get_row_id(row, i)
            id_registry.add(node_id)

        # Second pass build nodes and edges
        for i, row in enumerate(rows):
            node_id = self._get_row_id(row, i)
            label = row.get("label") or row.get("name") or row.get("title") or node_id

            attributes = {}
            reserved = {"id", "ID", "@id", "label", "name", "title"}

            for key, value in row.items():
                if key is None or key in reserved:
                    continue
                if value is None:
                    continue

                val_str = str(value).strip()

                if not val_str:
                    continue

                # Becomes an edge only if value is a known ID AND
                # column name explicitly suggests a reference
                if (val_str in id_registry
                        and val_str != node_id
                        and self._is_reference_field(key)):
                    edges.append({
                        "source":   node_id,
                        "target":   val_str,
                        "directed": True,
                    })
                else:
                    attributes[key] = value

            node_dict: Dict[str, Any] = {"id": node_id, "label": label}
            node_dict.update(attributes)
            nodes.append(node_dict)

        return {"nodes": nodes, "edges": edges}

    def _get_row_id(self, row: dict, index: int) -> str:
        if "id" in row and row["id"] not in (None, ""):
            return str(row["id"]).strip()
        if "ID" in row and row["ID"] not in (None, ""):
            return str(row["ID"]).strip()
        if "@id" in row and row["@id"] not in (None, ""):
            return str(row["@id"]).strip()

        # No ID column  generate based on row position
        return f"row_{index + 1}"