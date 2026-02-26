from html import escape as escape_html

from django.http import HttpRequest, HttpResponse, JsonResponse
from django.shortcuts import render
from django.views.decorators.http import require_GET

try:
    from graph_api.model.edge import Edge
    from graph_api.model.graph import Graph
    from graph_api.model.node import Node
except Exception as exc:  # pragma: no cover - import failure path is runtime/environment dependent
    Graph = None  # type: ignore[assignment]
    Node = None  # type: ignore[assignment]
    Edge = None  # type: ignore[assignment]
    GRAPH_IMPORT_ERROR = exc
else:
    GRAPH_IMPORT_ERROR = None

try:
    from visualizer_simple_plugin.plugin import SimpleVisualizer
except Exception as exc:  # pragma: no cover - import failure path is runtime/environment dependent
    SimpleVisualizer = None  # type: ignore[assignment]
    SIMPLE_VISUALIZER_IMPORT_ERROR = exc
else:
    SIMPLE_VISUALIZER_IMPORT_ERROR = None

try:
    from visualizer_block_plugin.plugin import BlockVisualizer
except Exception as exc:  # pragma: no cover - import failure path is runtime/environment dependent
    BlockVisualizer = None  # type: ignore[assignment]
    BLOCK_VISUALIZER_IMPORT_ERROR = exc
else:
    BLOCK_VISUALIZER_IMPORT_ERROR = None


MOCK_GRAPH_DATA = {
    "nodes": [
        {"id": "n1", "label": "Input", "type": "source"},
        {"id": "n2", "label": "Processor", "type": "compute"},
        {"id": "n3", "label": "Output", "type": "sink"},
    ],
    "edges": [
        {"id": "e1", "source": "n1", "target": "n2"},
        {"id": "e2", "source": "n2", "target": "n3"},
    ],
}


def index(request: HttpRequest) -> HttpResponse:
    context = {
        "page_title": "Graph Explorer",
        "placeholder_message": "Main graph rendering placeholder",
    }
    return render(request, "explorer/index.html", context)


def mock_graph_api(request: HttpRequest) -> JsonResponse:
    return JsonResponse(MOCK_GRAPH_DATA)


def _html_response(title: str, message: str, status: int = 200) -> HttpResponse:
    page = [
        "<!doctype html>",
        "<html lang=\"en\">",
        "<head><meta charset=\"utf-8\"><title>{}</title></head>".format(escape_html(title)),
        "<body>",
        "<h1 style=\"font-family:sans-serif;font-size:1.1rem;\">{}</h1>".format(escape_html(title)),
        "<p style=\"font-family:sans-serif;\">{}</p>".format(escape_html(message)),
        "</body>",
        "</html>",
    ]
    return HttpResponse("\n".join(page), status=status, content_type="text/html; charset=utf-8")


def _parse_directed_flag(request: HttpRequest) -> bool:
    raw_value = request.GET.get("directed")
    if raw_value is None:
        raw_value = request.GET.get("is_directed")

    if raw_value is None:
        return True

    normalized = str(raw_value).strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False

    raise ValueError("Invalid directed flag. Use directed=1 or directed=0.")


def _build_mock_graph(is_directed: bool) -> Graph:
    if Graph is None or Node is None or Edge is None:
        raise RuntimeError(f"Graph API classes are not importable: {GRAPH_IMPORT_ERROR}")

    graph = Graph(directed=is_directed)

    for node_data in MOCK_GRAPH_DATA.get("nodes", []):
        raw_id = node_data.get("id")
        node_id = str(raw_id) if raw_id is not None else ""
        label = str(node_data.get("label") or node_id)
        attributes = {key: value for key, value in node_data.items() if key not in {"id", "label"}}
        graph.add_node(Node(node_id=node_id, label=label, attributes=attributes))

    for edge_data in MOCK_GRAPH_DATA.get("edges", []):
        source = str(edge_data.get("source", ""))
        target = str(edge_data.get("target", ""))
        raw_edge_id = edge_data.get("id")
        edge_id = str(raw_edge_id) if raw_edge_id is not None else None
        attributes = {key: value for key, value in edge_data.items() if key not in {"id", "source", "target"}}
        graph.add_edge(
            Edge(
                source=source,
                target=target,
                edge_id=edge_id,
                directed=is_directed,
                attributes=attributes,
            )
        )

    return graph


def _build_visualizer_map() -> dict[str, object | None]:
    # TODO: replace direct import mapping with PluginRegistry/entry_points after registry contract is finalized.
    return {
        "simple": SimpleVisualizer() if SimpleVisualizer else None,
        "block": BlockVisualizer() if BlockVisualizer else None,
    }


@require_GET
def render_visualizer_api(request: HttpRequest) -> HttpResponse:
    visualizer_id = request.GET.get("visualizer_id", "").strip().lower()
    if not visualizer_id:
        return _html_response(
            "Missing visualizer_id",
            "Query parameter 'visualizer_id' is required (allowed: simple, block).",
            status=400,
        )

    if visualizer_id not in {"simple", "block"}:
        return _html_response(
            "Invalid visualizer_id",
            f"Unsupported visualizer_id '{visualizer_id}'. Allowed values are simple and block.",
            status=400,
        )

    try:
        is_directed = _parse_directed_flag(request)
    except ValueError as exc:
        return _html_response("Invalid directed flag", str(exc), status=400)

    if visualizer_id == "block" and BlockVisualizer is None:
        detail = f" ({BLOCK_VISUALIZER_IMPORT_ERROR})" if BLOCK_VISUALIZER_IMPORT_ERROR else ""
        return _html_response(
            "Block Visualizer Not Available",
            f"The block visualizer is not available yet in this environment{detail}",
        )

    if visualizer_id == "simple" and SimpleVisualizer is None:
        detail = f" ({SIMPLE_VISUALIZER_IMPORT_ERROR})" if SIMPLE_VISUALIZER_IMPORT_ERROR else ""
        return _html_response(
            "Simple Visualizer Failed To Load",
            f"The simple visualizer could not be loaded{detail}",
            status=500,
        )

    visualizers = _build_visualizer_map()
    visualizer = visualizers.get(visualizer_id)
    if visualizer is None:
        return _html_response(
            "Visualizer Not Available",
            f"Visualizer '{visualizer_id}' is not currently available.",
            status=500,
        )

    try:
        graph = _build_mock_graph(is_directed=is_directed)
        html = visualizer.render(graph)
    except Exception as exc:
        return _html_response(
            "Visualizer Render Error",
            f"Failed to render visualizer '{visualizer_id}': {exc}",
            status=500,
        )

    return HttpResponse(str(html), content_type="text/html; charset=utf-8")
