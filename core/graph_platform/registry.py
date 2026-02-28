from importlib.metadata import entry_points
from api.graph_api.services import DataSourcePlugin
from api.graph_api.services import VisualizerPlugin
from typing import Dict, Type


class PluginRegistry:

    _instance = None
    _datasources: Dict[str, Type[DataSourcePlugin]]
    _visualizers: Dict[str, Type[VisualizerPlugin]]

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._datasources = {}
            cls._instance._visualizers = {}
            cls._instance._load_plugins()
        return cls._instance

    def _load_plugins(self):
        eps = entry_points()

        for ep in eps.select(group="graph_platform.datasource"):
            self._datasources[ep.name] = ep.load()

        for ep in eps.select(group="graph_platform.visualizer"):
            self._visualizers[ep.name] = ep.load()

    def get_datasource(self, name: str) -> Type[DataSourcePlugin] | None:
        return self._datasources.get(name)

    def get_visualizer(self, name: str) -> Type[VisualizerPlugin] | None:
        return self._visualizers.get(name)

    def list_datasources(self) -> list[str]:
        return list(self._datasources.keys())

    def list_visualizers(self) -> list[str]:
        return list(self._visualizers.keys())