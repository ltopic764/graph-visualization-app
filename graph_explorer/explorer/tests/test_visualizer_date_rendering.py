import json
from datetime import date, datetime

from django.test import Client, TestCase

from api.graph_api.model import Edge, Graph, Node
from core.graph_platform.workspace import Workspace
from explorer import views


class VisualizerDateRenderingTests(TestCase):
    def setUp(self):
        self.client = Client()
        self.graph_id = "visualizer-date-graph"

        graph = Graph(directed=True)
        graph.add_node(
            Node(
                "n1",
                label="Alpha",
                attributes={
                    "birth_date": date(2023, 12, 20),
                    "updated_at": datetime(2024, 1, 1, 9, 30, 0),
                    "name": "Alice",
                },
            )
        )
        graph.add_node(
            Node(
                "n2",
                label="Beta",
                attributes={
                    "birth_date": date(2024, 3, 10),
                    "updated_at": datetime(2024, 5, 3, 14, 45, 0),
                    "name": "Bob",
                },
            )
        )
        graph.add_edge(Edge(source="n1", target="n2", edge_id="e1", attributes={"kind": "link"}))

        workspace = Workspace()
        workspace.set_graph(graph)

        views.WORKSPACES.clear()
        views.ACTIVE_GRAPHS.clear()
        views.ORIGINAL_GRAPHS.clear()

        views.WORKSPACES[self.graph_id] = workspace
        views.ACTIVE_GRAPHS[self.graph_id] = graph
        views.ORIGINAL_GRAPHS[self.graph_id] = graph

    def tearDown(self):
        views.WORKSPACES.clear()
        views.ACTIVE_GRAPHS.clear()
        views.ORIGINAL_GRAPHS.clear()

    def _render_visualizer(self, visualizer_id: str):
        return self.client.get(
            "/api/render/",
            {
                "visualizer_id": visualizer_id,
                "graph_id": self.graph_id,
                "directed": "1",
            },
        )

    def test_simple_visualizer_renders_graph_with_date_attributes(self):
        if views.SimpleVisualizer is None:
            self.skipTest("Simple visualizer is not available in this environment.")

        response = self._render_visualizer("simple")

        self.assertEqual(response.status_code, 200)
        html = response.content.decode("utf-8")
        self.assertNotIn("not JSON serializable", html)
        self.assertIn("2023-12-20", html)
        self.assertIn("2024-01-01T09:30:00", html)

    def test_block_visualizer_renders_graph_with_date_attributes(self):
        if views.BlockVisualizer is None:
            self.skipTest("Block visualizer is not available in this environment.")

        response = self._render_visualizer("block")

        self.assertEqual(response.status_code, 200)
        html = response.content.decode("utf-8")
        self.assertNotIn("not JSON serializable", html)
        self.assertIn("2023-12-20", html)
        self.assertIn("2024-01-01T09:30:00", html)

    def test_date_filter_still_works_after_visualizer_render(self):
        if views.SimpleVisualizer is None:
            self.skipTest("Simple visualizer is not available in this environment.")

        render_response = self._render_visualizer("simple")
        self.assertEqual(render_response.status_code, 200)

        filter_response = self.client.post(
            "/api/graph/filter/",
            data=json.dumps(
                {
                    "graph_id": self.graph_id,
                    "attribute": "birth_date",
                    "operator": ">=",
                    "value": "2024-01-01",
                }
            ),
            content_type="application/json",
        )

        self.assertEqual(filter_response.status_code, 200)
        payload = filter_response.json()
        self.assertTrue(payload["ok"])
        self.assertEqual({node["id"] for node in payload["graph"]["nodes"]}, {"n2"})
