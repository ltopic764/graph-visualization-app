from .registry import PluginRegistry


class GraphEngine:

    def __init__(self):
        self.registry = PluginRegistry()

    def process(self, datasource_name: str, visualizer_name: str, file_path: str):
        datasource_cls = self.registry.get_datasource(datasource_name)
        visualizer_cls = self.registry.get_visualizer(visualizer_name)

        if not datasource_cls:
            raise ValueError(f"Datasource '{datasource_name}' not found.")

        if not visualizer_cls:
            raise ValueError(f"Visualizer '{visualizer_name}' not found.")

        datasource = datasource_cls()
        visualizer = visualizer_cls()

        graph = datasource.load(file_path)
        result = visualizer.render(graph)

        return result