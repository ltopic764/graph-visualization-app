from api.graph_api.model import Graph
from .base import BaseDatasourcePlugin

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
            }
        }

    def parse_source(self, source, **options) -> list:
        # Here we are using the TemplateMethod
        # This is the only step that the CSV plugin will be doing differently from the JSON plugin
        # Everything that is the same for both plugins, will be in the BaseDatasourcePlugin

        raise NotImplementedError("CSV parsing coming soon")
