import json
from typing import Any
from api.graph_api.model import Graph, Node, Edge
from api.graph_api.services.datasource_plugin import DataSourcePlugin
from api.graph_api.datasource_common.base import BaseDatasourcePlugin

class JsonDatasourcePlugin(BaseDatasourcePlugin):
    # Adapter to read a JSON file and map it to a Graph object
    # It extends BaseDatasourcePlugin in which we define TemplateMethod
    # Both acyclic and cyclic graphs are supported
    # Acyclic graphs are just the basic JSON structure, while the cyclic is the JSON structure with an '@id' attribute
    # for mutual referencing

    @property
    def plugin_id(self) -> str:
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
            },
            "directed": {
                "type": "bool",
                "label": "Directed graph",
                "required": False,
                "default": True
            }
        }

    def _parse_source(self, source, **kwargs) -> dict:
        # This is the only step that the JSON plugin will be doing differently from the CSV plugin
        # Everything that is the same for both plugins, will be in the BaseDatasourcePlugin

        # The idea is to read a JSON file and return a dictionary that will have keys 'nodes' and 'edges' with data

        # Read JSON file
        path = self._resolve_path(source, kwargs)
        with open(path, 'r', encoding='utf-8') as f:
            raw_json = json.load(f)

        # If the JSON already has 'nodes' and 'edges' keys
        if isinstance(raw_json, dict) and "nodes" in raw_json and "edges" in raw_json:
            return raw_json

        # JSON file is a list of nodes
        # We will convert this format straight into expected dict
        if isinstance(raw_json, list):
            return self._convert_flat_list(raw_json)

        # If not, then regular JSON hierarchy
        # Go through file and build the nodes/edges structure the base class expects
        return self._convert_nested(raw_json)


    def _convert_flat_list(self, raw_list: list) -> dict:
        # Every object in a list is a node
        # If a string attribute is the same as an id of a node then this is a cycle

        nodes = []
        edges = []

        # Collect all ids in the file
        id_registry = set()
        counter = [0] # for if an object has not id
        for obj in raw_list:
            self._collect_all_ids(obj, id_registry)

        # Create nodes and edges
        for obj in  raw_list:
            if isinstance(obj, dict):
                self._traverse(obj, nodes, edges, id_registry, parent_id=None, counter=counter)

        return {"nodes": nodes, "edges": edges}

    def _convert_nested(self, raw_json: dict) -> dict:

        nodes = []
        edges = []

        # Firstly we collect all ids
        id_registry = set()
        self._collect_all_ids(raw_json, id_registry)

        counter = [0] # for if an object has not id

        # Then we build the Graph object
        self._traverse(raw_json, nodes, edges, id_registry, parent_id=None, counter=counter)

        return {"nodes": nodes, "edges": edges}

    def _collect_all_ids(self, obj:Any, id_registry: set) -> None:
        if isinstance(obj, dict):
            # Collect all ids
            if "id" in obj:
                id_registry.add(str(obj["id"]))
            if "@id" in obj:
                id_registry.add(str(obj["@id"]))

            # Recursively for every value
            for value in obj.values():
                self._collect_all_ids(value, id_registry)

        elif isinstance(obj, list):
            # Recursively for every list el
            for item in obj:
                self._collect_all_ids(item, id_registry)

    def _new_auto_id(self, counter: list[int], id_registry: set[str]) -> str:
        # Ensure no collision
        while True:
            counter[0] += 1
            nid = f"auto_{counter[0]}"
            if nid not in id_registry:
                id_registry.add(nid)
                return nid


    # Going through the JSON and bulding list of nodes and edges
    def _traverse(self, obj: Any, nodes: list, edges: list, id_registry: set, parent_id: str, counter: list) -> str:

        # Primitive values are not nodes
        if not isinstance(obj, dict):
            return None

        # Find id
        if "id" in obj and obj["id"] is not None:
            node_id = str(obj["id"])
        elif "@id" in obj and obj["@id"] is not None:
            node_id = str(obj["@id"])
        else :
            # No id
            node_id = self._new_auto_id(counter, id_registry)

        label = obj.get("label") or obj.get("name") or node_id

        # Node summary
        reserved = {"id", "@id", "label", "name"}
        attributes = {} # regular attributes
        children = {} # nested objects

        for key, value in obj.items():
            if key in reserved:
                continue

            if isinstance(value, (dict, list)):
                # Nested object, child of the node
                children[key] = value
                continue

            elif isinstance(value, str) and value in id_registry:
                # String attribute the same as an existing id, cycle
                edges.append({
                    "source": node_id,
                    "target": value
                })

            else:
                # Regular attribute
                attributes[key] = value

            # if isinstance(value, str) and value in id_registry and key.lower().endswith(("id", "_id", "ref", "_ref")):
            #     edges.append({"source": node_id, "target": value, "directed": True})
            # else:
            #     # Regular attribute
            #     attributes[key] = value

        # Create Node
        node_data = {"id": node_id, "label": label}
        node_data.update(attributes)
        nodes.append(node_data)

        # Create the Edge to parent
        if parent_id is not None:
            edges.append({
                "source": parent_id,
                "target": node_id
            })

        for key, value in children.items():
            if isinstance(value, list):
                for child in value:
                    # Every child in a list has its parent as the current node
                    self._traverse(child, nodes, edges, id_registry,
                                   parent_id=node_id, counter=counter)
            elif isinstance(value, dict):
                self._traverse(value, nodes, edges, id_registry,
                               parent_id=node_id, counter=counter)

        return node_id
