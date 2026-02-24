import json
from typing import Any

from api.graph_api.model import Graph, Node, Edge
from api.graph_api.services.datasource_plugin import DataSourcePlugin
from .base import BaseDatasourcePlugin

class JsonDatasourcePlugin(BaseDatasourcePlugin):
    # Adapter to read a JSON file and map it to a Graph object
    # It extends BaseDatasourcePlugin in which we define TemplateMethod
    # Both acyclic and cyclic graphs are supported
    # Acyclic graphs are just the basic JSON structure, while the cyclic is the JSON structure with an '@id' attribute
    # for mutual referencing

    @property
    def plugin_id(selfs) -> str:
        # Platform finds this plugin with this id
        return "json"
    
    @property
    def display_name(self) -> str:
        # UI dropdown name showcase
        return "JSON file"

    def parameters_schema(self) -> dict:
        # What parameters are needed for us to load a Graph object
        return {
            "file_path": {
                "type": "str",
                "label": "Path to JSON file",
                "required": True
            }
        }

    def parse_source(self, source, **kwargs) -> Graph:
        # This is the only step that the JSON plugin will be doing differently from the CSV plugin
        # Everything that is the same for both plugins, will be in the BaseDatasourcePlugin

        # Read JSON file
        with open(source, 'r', encoding='utf-8') as f:
            raw_json = json.load(f)

        # If the JSON has 'nodes' and 'edges' keys
        if "nodes" in raw_json and "edges" in raw_json:
            return raw_json

        # If not, then regular JSON hierarchy
        # Go through file and build the nodes/edges structure the base class expects
        return self._convert_hierarchical(raw_json)

    def _convert_hierarchical(self, raw_json: dict) -> dict:
        # Go through the file twice
        # Once for collecting all '@id' values for cycles if there are any, maybe there are not
        # The second time for building both the nodes and edges

        nodes = []
        edges = []

        # Collecting all '@id'
        id_registry = set()
        self._collect_ids(raw_json, id_registry)

        self._traverse(raw_json, nodes, edges, id_registry, parent_id=None)

        return {"nodes": nodes, "edges": edges}

    def _collect_ids(self, obj: Any, id_registry: set) -> None:

        if isinstance(obj, dict):
            # Has '@id'
            if "@id" in obj:
                id_registry.add(str(obj["@id"]))
            for value in obj.values():
                self._collect_ids(value, id_registry)

        elif isinstance(obj, list):
            for item in obj:
                self._collect_ids(item, id_registry)

    # Going through the JSON and bulding list of nodes and edges
    def _traverse(self, obj: Any, nodes: list, edges: list, id_registry: set, parent_id: str) -> str:

        if not isinstance(obj, dict):
            return None

        # Get the id of the current node
        node_id = str(obj.get("@id", "")) or None

        label = obj.get("name") or obj.get("label") or node_id

        # Get attributes, expect certain keys and nested obj
        attributes = {}
        children_to_process = {}

        for key, value in obj.items():
            # Skip these
            if key in ("@id", "name", "label"):
                continue

            if isinstance(value, (dict, list)):
                # Nested obj, these are children
                children_to_process[key] = value

            elif isinstance(value, str) and value in id_registry:
                # This is a reference to an existing node
                # Save as an edge
                edges.append({
                    "source": node_id,
                    "target": value,
                    "directed": True
                })

            else:
                attributes[key] = value

        # Create Node
        node = {"id": node_id, "label": label}
        node.update(attributes)
        nodes.append(node)

        # If has parent, create the edge from parent to the node
        if parent_id is not None:
            edges.append({
                "source": parent_id,
                "target": node_id,
                "directed": True
            })

        # Recursively traverse childern
        for key, value in children_to_process.items():
            if isinstance(value, list):
                for child in value:
                    self._traverse(child, nodes, edges, id_registry, parent_id=node_id)
            elif isinstance(value, dict):
                self._traverse(value, nodes, edges, id_registry, parent_id=node_id)

        return node_id



