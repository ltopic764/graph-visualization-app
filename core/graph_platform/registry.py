from importlib.metadata import entry_points
from api.graph_api.services import DataSourcePlugin
from api.graph_api.services import VisualizerPlugin
from typing import Dict, Type

# Registry responsible for discovering and storing available datasource and visualizer plugins.
# It loads plugins via Python entry points so they can be dynamically added without modifying the core system.
class PluginRegistry:
    DATASOURCE_ENTRYPOINT_GROUP = "graph_platform.datasource"
    VISUALIZER_ENTRYPOINT_GROUP = "graph_platform.visualizer"
    LEGACY_VISUALIZER_ENTRYPOINT_GROUP = "graph.visualizers"

    _instance = None
    _datasources: Dict[str, Type[DataSourcePlugin]]
    _visualizers: Dict[str, Type[VisualizerPlugin]]

    # Ensures that PluginRegistry behaves as a singleton so plugins are loaded only once.
    # When the first instance is created, it initializes plugin storage and loads available plugins.
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._datasources = {}
            cls._instance._visualizers = {}
            cls._instance._load_plugins()
        return cls._instance

    # Discovers plugins defined through Python entry points and stores them in internal dictionaries.
    # Datasource and visualizer plugins are grouped separately based on their entry-point group name.
    def _load_plugins(self):
        eps = entry_points()

        for ep in eps.select(group=self.DATASOURCE_ENTRYPOINT_GROUP):
            self._datasources[ep.name] = ep.load()

        for ep in eps.select(group=self.VISUALIZER_ENTRYPOINT_GROUP):
            self._visualizers[ep.name] = ep.load()

        # Keep compatibility with previously published visualizer entry-point group.
        for ep in eps.select(group=self.LEGACY_VISUALIZER_ENTRYPOINT_GROUP):
            self._visualizers.setdefault(ep.name, ep.load())

    def get_datasource(self, name: str) -> Type[DataSourcePlugin] | None:
        return self._datasources.get(name)

    def get_visualizer(self, name: str) -> Type[VisualizerPlugin] | None:
        return self._visualizers.get(name)

    def list_datasources(self) -> list[str]:
        return list(self._datasources.keys())

    def list_visualizers(self) -> list[str]:
        return list(self._visualizers.keys())
