import json
from datetime import date

from django.test import Client, TestCase

from api.graph_api.model import Graph, Node
from core.graph_platform.workspace import Workspace
from explorer import views


class GraphFilterValidationTests(TestCase):
    def setUp(self):
        self.client = Client()
        self.graph_id = "filter-validation-graph"

        graph = Graph(directed=True)
        graph.add_node(
            Node(
                "n1",
                label="Alpha",
                attributes={
                    "age": 21,
                    "score": 1.25,
                    "birth_date": date(2023, 12, 20),
                    "name": "Alice",
                    "country": "Bosnia",
                },
            )
        )
        graph.add_node(
            Node(
                "n2",
                label="Beta",
                attributes={
                    "age": 30,
                    "score": 4.75,
                    "birth_date": date(2024, 3, 10),
                    "name": "Bob",
                    "country": "Serbia",
                },
            )
        )
        graph.add_node(
            Node(
                "n3",
                label="Gamma",
                attributes={
                    "age": 45,
                    "score": 2.5,
                    "birth_date": date(2025, 1, 5),
                    "name": "Carol",
                    "country": "Croatia",
                },
            )
        )

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

    def _post_filter(self, attribute: str, operator: str, value: str):
        return self.client.post(
            "/api/graph/filter/",
            data=json.dumps(
                {
                    "graph_id": self.graph_id,
                    "attribute": attribute,
                    "operator": operator,
                    "value": value,
                }
            ),
            content_type="application/json",
        )

    @staticmethod
    def _response_node_ids(response_json: dict) -> set[str]:
        return {node["id"] for node in response_json["graph"]["nodes"]}

    def test_valid_int_filter(self):
        response = self._post_filter("age", ">", "25")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["ok"])
        self.assertEqual(self._response_node_ids(payload), {"n2", "n3"})

    def test_invalid_int_filter(self):
        response = self._post_filter("age", ">", "abc")

        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertFalse(payload["ok"])
        self.assertIn("Expected int", payload["error"])

    def test_valid_float_filter(self):
        response = self._post_filter("score", ">=", "4.5")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["ok"])
        self.assertEqual(self._response_node_ids(payload), {"n2"})

    def test_invalid_float_filter(self):
        response = self._post_filter("score", "<", "test")

        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertFalse(payload["ok"])
        self.assertIn("Expected float", payload["error"])

    def test_valid_date_filter(self):
        response = self._post_filter("birth_date", ">=", "2024-01-01")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["ok"])
        self.assertEqual(self._response_node_ids(payload), {"n2", "n3"})

    def test_invalid_date_filter(self):
        response = self._post_filter("birth_date", ">=", "test")

        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertFalse(payload["ok"])
        self.assertIn("Expected date (YYYY-MM-DD)", payload["error"])

    def test_valid_string_equality_filter(self):
        response = self._post_filter("country", "==", "Bosnia")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["ok"])
        self.assertEqual(self._response_node_ids(payload), {"n1"})

    def test_valid_string_inequality_filter(self):
        response = self._post_filter("country", "!=", "Bosnia")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["ok"])
        self.assertEqual(self._response_node_ids(payload), {"n2", "n3"})

    def test_invalid_string_relational_operator(self):
        active_graph_before = views.ACTIVE_GRAPHS[self.graph_id]
        active_ids_before = {node.node_id for node in active_graph_before.nodes}

        response = self._post_filter("country", ">=", "Bosnia")

        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertFalse(payload["ok"])
        self.assertIn("not valid for attribute 'country' of type str", payload["error"])
        self.assertIn("Allowed operators: !=, ==", payload["error"])

        active_graph_after = views.ACTIVE_GRAPHS[self.graph_id]
        active_ids_after = {node.node_id for node in active_graph_after.nodes}
        self.assertEqual(active_ids_before, active_ids_after)
