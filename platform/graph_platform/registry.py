from importlib.metadata import entry_points


class PluginRegistry:

    _instance = None

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

    def get_datasource(self, name: str):
        return self._datasources.get(name)

    def get_visualizer(self, name: str):
        return self._visualizers.get(name)

    def list_datasources(self):
        return list(self._datasources.keys())

    def list_visualizers(self):
        return list(self._visualizers.keys())