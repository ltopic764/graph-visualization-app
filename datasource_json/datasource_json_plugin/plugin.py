import json
from typing import Any
from api.graph_api.datasource_common.base import BaseDatasourcePlugin

class JsonDatasourcePlugin(BaseDatasourcePlugin):
    """
    Reads a JSON file from disk and converts it into a Graph object

    Supported formats:
        Already structured (explicit nodes and edges)
        Flat list of objects (each object is a node)
        Nested hierarchy
        No ids at all

    An Edge is created between two Nodes only if the value already exists as an ID
    and the attributes name is recognized as something used to describe a connection
    """
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

    def _is_reference_field(self, key: str) -> bool:
        # Determine whether a filed name should be treated as a reference to another node
        normalized = key.strip().lower()

        explicit_reference_fields = {
            "parent",
            "@ref",
            "ref",
            "reference",
            "source",
            "target",
            "from",
            "to",
            "friend",
            "best_friend",
            "also_knows",
            "manager",
            "owner",
            "connects_to",
            "backup_to",
            "also_links",
        }

        return (
            normalized in explicit_reference_fields
            or normalized.endswith("_id")
            or normalized.endswith("_ref")
        )


    def _parse_source(self, source, **kwargs) -> dict:
        # This is the only step that the JSON plugin will be doing differently from the CSV plugin
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
        # We do two passes through the list one where we collect all ids, and the other where we call the _traverse method

        nodes = []
        edges = []

        # Collect all ids in the file
        id_registry = set()
        created_nodes = set()
        counter = [0] # for if an object has not id

        for obj in raw_list:
            self._collect_all_ids(obj, id_registry)

        # Create nodes and edges
        for obj in  raw_list:
            if isinstance(obj, dict):
                self._traverse(obj, nodes, edges, id_registry, created_nodes, parent_id=None, counter=counter)

        return {"nodes": nodes, "edges": edges}

    def _convert_nested(self, raw_json: dict) -> dict:
        # Converts a nested JSON into the expected dict

        nodes = []
        edges = []

        # Firstly we collect all ids
        id_registry = set()
        created_nodes = set()
        counter = [0] # for if an object has not id

        self._collect_all_ids(raw_json, id_registry)

        # Then we build the Graph object
        self._traverse(raw_json, nodes, edges, id_registry, created_nodes ,parent_id=None, counter=counter)

        return {"nodes": nodes, "edges": edges}

    # helper function
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

    # Generates a unique id for a node that has no id in the source file
    def _new_auto_id(self, counter: list[int], id_registry: set[str]) -> str:
        # Ensure no collision
        while True:
            counter[0] += 1
            nid = f"auto_{counter[0]}"
            if nid not in id_registry:
                id_registry.add(nid)
                return nid


    def _traverse(self, obj: Any, nodes: list, edges: list, id_registry: set, created_nodes: set, parent_id: str, counter: list) -> str:
        # Recursively visits every node in the JSON tree and populates
        # the nodes and edges lists.

        # Primitive values are not nodes
        if not isinstance(obj, dict):
            return None

        # Resolve node identifier
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

            # Nested object becomes a child node
            if isinstance(value, dict):
                # Nested object, child of the node
                children[key] = value
                continue

            # Lists of objects become child nodes
            if isinstance(value, list):
                if all(isinstance(item, dict) for item in value):
                    children[key] = value
                else:
                    # Keep primitive/mixed lists as node aatributes
                    attributes[key] = value
                continue

            # Only explicitly recognized reference fields create graph edges
            if (isinstance(value, str) and value in id_registry and self._is_reference_field(key)):
                edges.append({"source": node_id, "target": value})
                continue

            # Otherwise this is a regular attribute
            attributes[key] = value

        # Create node only once
        if node_id not in created_nodes:
            node_data = {"id": node_id, "label": label}
            node_data.update(attributes)
            nodes.append(node_data)
            created_nodes.add(node_id)

            if parent_id is not None:
                edges.append({"source": parent_id, "target": node_id})

        # Traverse nested child structures
        for value in children.values():
            if isinstance(value, list):
                for child in value:
                    # Each child in the list has the current node as its parent.
                    self._traverse(child, nodes, edges, id_registry, created_nodes, parent_id=node_id, counter=counter)
            elif isinstance(value, dict):
                self._traverse(value, nodes, edges, id_registry, created_nodes, parent_id=node_id, counter=counter)

        return node_id
