import csv
import os.path
from dataclasses import field
from api.graph_api.model import Graph
from typing import Any, List, Dict, Set
from api.graph_api.datasource_common.base import BaseDatasourcePlugin

class CsvDatasourcePlugin(BaseDatasourcePlugin):
    # Adapter to read the CSV file and create Graph object
    # Acyclic and cyclic graphs are supported

    @property
    def plugin_id(self) -> str:
        return "csv"

    @property
    def display_name(self) -> str:
        return "CSV File"

    def parameters_schema(self) -> dict:
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

    def _parse_source(self, source, **kwargs) -> dict:
        # Here we are using the TemplateMethod
        # This is the only step that the CSV plugin will be doing differently from the JSON plugin
        # Everything that is the same for both plugins, will be in the BaseDatasourcePlugin

        # Reads CSV and returns standard dict with 'nodes' and 'edges' keys

        delimiter = kwargs.get("delimiter")

        if not os.path.exists(source):
            raise FileNotFoundError(f"CSV file not found: {source}")

        path = self._resolve_path(source, kwargs)
        with open(path, 'r', encoding='utf-8') as f:
            # Detect delimiter if not provided
            if not delimiter:
                try:
                    # Take a small portion of the text and sniff out the delimiter
                    sample = f.read(2048)
                    f.seek(0)
                    delimiter = csv.Sniffer().sniff(sample).delimiter
                except csv.Error:
                    delimiter = ',' #fallback
            else:
                f.seek(0)

            # Read CSV into list of dicts
            reader = csv.DictReader(f, delimiter=delimiter, skipinitialspace=True)
            rows = list(reader)

        if not rows:
            return {"nodes": [], "edges": []}

        fieldnames = set(rows[0].keys()) if rows[0].keys() else set()

        # Normalize all column names to lowercase
        normalized = {name.lower() for name in fieldnames if isinstance(name, str)}

        # If header contains specific words treat is as a certain file
        if "source" in normalized and "target" in normalized:
            return self._parse_edge_list(rows)
        else:
            return self._parse_node_list(rows)


    def _parse_edge_list(self, rows: List[Dict]) -> dict:
        # Parsing a CSV where every row is an edge
        nodes = {} # using dictionary is we have duplicates
        edges = []

        for i, row in enumerate(rows):
            src = row.get("source") or row.get("Source") or row.get("SOURCE")
            dst = row.get("target") or row.get("Target") or row.get("TARGET")

            src = str(src).strip()
            dst = str(dst).strip()

            if not src or not dst:
                continue

            # Add nodes if they have not been seen
            if src not in nodes:
                nodes[src] = {"id": src, "label": src}
            if dst not in nodes:
                nodes[dst] = {"id": dst, "label": dst}

            directed_raw = row.get("directed") or row.get("Directed") or row.get("DIRECTED")
            directed = True if directed_raw in (None, "", "True", "true", "1") else False

            weight = row.get("weight") or row.get("Weight") or row.get("WEIGHT")

            # Edge attributes are all other columns
            reserved = {"source", "Source", "SOURCE", "target", "Target", "TARGET", "id", "ID", "weight", "Weight",
                        "WEIGHT", "directed", "Directed", "DIRECTED"}

            # Create Edge
            attributes = {k: v for k, v in row.items() if k not in reserved and k is not None}

            edge_id = row.get("id")

            edge_dict = {
                "id": str(edge_id).strip() if edge_id not in (None, "") else None,
                "source": src,
                "target": dst,
                "directed": directed,
            }

            if weight not in (None, ""):
                edge_dict["weight"] = weight

            edge_dict.update(attributes)

            edges.append(edge_dict)

        return {"nodes": list(nodes.values()), "edges": edges}

    def _parse_node_list(self, rows: List[Dict]) -> dict:
        # Parsing a CSV file where every row is a node

        nodes = []
        edges = []
        id_registry = set()

        # Collect all ids
        for i, row in enumerate(rows):
            node_id = self._get_row_id(row, i)
            id_registry.add(node_id)

        # Create Nodes and Edges
        for i, row in enumerate(rows):
            node_id = self._get_row_id(row, i)

            label = row.get("label") or row.get("name") or row.get("title") or node_id

            attributes = {}
            reserved = {"id", "ID", "@id", "label", "name", "title"}

            for key, value in row.items():
                if key is None:
                    continue

                if key in reserved:
                    continue

                if value is None:
                    continue

                val_str = str(value).strip()

                # If a value is an existing id, it is an Edge
                if val_str in id_registry and val_str != node_id:
                    edges.append({
                        "source": node_id,
                        "target": val_str
                    })
                else:
                    attributes[key] = value

            node_dict: Dict[str, Any] = {
                "id": node_id,
                "label": label,
            }

            node_dict.update(attributes)

            nodes.append(node_dict)

        return {"nodes": nodes, "edges": edges}

    def _get_row_id(self, row: dict, index: int) -> str:
        # Get id from row, or generate it

        if "id" in row and row["id"] not in (None, ""):
            return str(row["id"]).strip()
        if "ID" in row and row["ID"] not in (None, ""):
            return str(row["ID"]).strip()
        if "@id" in row and row["@id"] not in (None, ""):
            return str(row["@id"]).strip()

        # Generate based on row
        return f"row_{index + 1}"
