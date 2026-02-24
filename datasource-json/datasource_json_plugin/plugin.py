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
        # Here we are using the TemplateMethod
        # This is the only step that the JSON plugin will be doing differently from the CSV plugin
        # Everything that is the same for both plugins, will be in the BaseDatasourcePlugin

        raise NotImplementedError("JSON parsing coming soon")
