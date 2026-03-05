import os
import shlex
import time
import json
import logging
from copy import deepcopy
from pathlib import Path
from tempfile import NamedTemporaryFile
from uuid import uuid4
from html import escape as escape_html

from django.core.files.uploadedfile import UploadedFile
from django.http import HttpRequest, HttpResponse, JsonResponse
from django.shortcuts import render
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_POST

from core.graph_platform.workspace import Workspace
#from test_search_filter import workspace

WORKSPACES = {}

try:
    from api.graph_api.model.edge import Edge
    from api.graph_api.model.graph import Graph
    from api.graph_api.model.node import Node
except Exception as exc:  # pragma: no cover - import failure path is runtime/environment dependent
    Graph = None  # type: ignore[assignment]
    Node = None  # type: ignore[assignment]
    Edge = None  # type: ignore[assignment]
    GRAPH_IMPORT_ERROR = exc
else:
    GRAPH_IMPORT_ERROR = None

try:
    from visualizer_simple.visualizer_simple_plugin.plugin import SimpleVisualizer
except Exception as exc:  # pragma: no cover - import failure path is runtime/environment dependent
    SimpleVisualizer = None  # type: ignore[assignment]
    SIMPLE_VISUALIZER_IMPORT_ERROR = exc
else:
    SIMPLE_VISUALIZER_IMPORT_ERROR = None

try:
    from visualizer_block.visualizer_block_plugin.plugin import BlockVisualizer
except Exception as exc:  # pragma: no cover - import failure path is runtime/environment dependent
    BlockVisualizer = None  # type: ignore[assignment]
    BLOCK_VISUALIZER_IMPORT_ERROR = exc
else:
    BLOCK_VISUALIZER_IMPORT_ERROR = None

try:
    from datasource_json.datasource_json_plugin.plugin import JsonDatasourcePlugin
except Exception as exc:  # pragma: no cover - import failure path is runtime/environment dependent
    JsonDatasourcePlugin = None  # type: ignore[assignment]
    JSON_DATASOURCE_IMPORT_ERROR = exc
else:
    JSON_DATASOURCE_IMPORT_ERROR = None

try:
    from datasource_csv.datasource_csv_plugin.plugin import CsvDatasourcePlugin
except Exception as exc:  # pragma: no cover - import failure path is runtime/environment dependent
    CsvDatasourcePlugin = None  # type: ignore[assignment]
    CSV_DATASOURCE_IMPORT_ERROR = exc
else:
    CSV_DATASOURCE_IMPORT_ERROR = None


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
ACTIVE_GRAPHS: dict[str, object] = {}
ORIGINAL_GRAPHS: dict[str, object] = {}
LOGGER = logging.getLogger(__name__)


def _json_error(message: str, status: int) -> JsonResponse:
    return JsonResponse({"ok": False, "error": message}, status=status)


def json_error(
    status_code: int,
    error: str,
    message: str,
    expected: dict[str, object] | None = None,
    details: object | None = None,
) -> JsonResponse:
    payload: dict[str, object] = {
        "ok": False,
        "status": status_code,
        "error": error,
        "message": message,
    }
    if expected is not None:
        payload["expected"] = expected
    if details is not None:
        payload["details"] = details
    return JsonResponse(payload, status=status_code)


def _parse_json_body(request: HttpRequest) -> tuple[object | None, JsonResponse | None]:
    if not request.body:
        return None, json_error(400, "BadRequest", "Invalid JSON body.")

    try:
        body = request.body.decode("utf-8")
        return json.loads(body), None
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None, json_error(400, "BadRequest", "Invalid JSON body.")


def _require_post_json(request: HttpRequest) -> JsonResponse | None:
    if request.method != "POST":
        return json_error(
            405,
            "MethodNotAllowed",
            "Only POST is allowed.",
            details={"allowed_methods": ["POST"]},
        )
    return None


def _build_datasource_map() -> dict[str, tuple[str, object | None, Exception | None]]:
    return {
        ".json": ("json", JsonDatasourcePlugin, JSON_DATASOURCE_IMPORT_ERROR),
        ".csv": ("csv", CsvDatasourcePlugin, CSV_DATASOURCE_IMPORT_ERROR),
    }


def _load_graph_from_upload(uploaded_file: UploadedFile, suffix: str, datasource_cls: object) -> Graph:
    temp_path: str | None = None
    try:
        with NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
            temp_path = temp_file.name
            for chunk in uploaded_file.chunks():
                temp_file.write(chunk)

        datasource = datasource_cls()
        return datasource.load_graph(temp_path)
    finally:
        if temp_path and os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except OSError:
                pass


def _store_active_graph_id_in_session(request: HttpRequest, graph_id: str) -> None:
    try:
        request.session["active_graph_id"] = graph_id
        request.session.save()
    except Exception:
        LOGGER.warning("Unable to persist active_graph_id in session.")
        try:
            request.session.modified = False
        except Exception:
            pass


def index(request: HttpRequest) -> HttpResponse:
    context = {
        "page_title": "Graph Explorer",
    }
    return render(request, "explorer/index.html", context)


def mock_graph_api(request: HttpRequest) -> JsonResponse:
    return JsonResponse(MOCK_GRAPH_DATA)

# Parse sent properties
def _parse_properties(tokens: list[str]) -> dict:
    props = {}
    i = 0
    while i < len(tokens):
        if tokens[i] == "--property":
            if i + 1 >= len(tokens):
                raise ValueError("Missing value after --property (expected key=value)")
            kv = tokens[i + 1]
            if "=" not in kv:
                raise ValueError(f"Invalid property '{kv}' (expected key=value)")
            k, v = kv.split("=", 1)
            props[k] = v
            i += 2
        else:
            i += 1
    return props

def _parse_flag(tokens: list[str], name: str) -> str | None:
    # Looking for --id=123
    for i, t in enumerate(tokens):
        if t.startswith(name + "="):
            return t.split("=", 1)[1]
        if t == name and i + 1 < len(tokens):
            return tokens[i + 1]
    return None

def _clone_graph(graph: Graph) -> Graph:
    # Create a DEEPCOPY of the original graph
    g2 = Graph(directed=getattr(graph, "directed", True))
    # Clone nodes
    for n in graph.nodes:
        g2.add_node(Node(node_id=str(n.node_id), label=getattr(n, "label", "") or str(n.node_id),
                         attributes=deepcopy(getattr(n, "attributes", {}) or {})))
    # Clone edges
    for e in graph.edges:
        g2.add_edge(Edge(source=str(e.source), target=str(e.target),
                         edge_id=getattr(e, "edge_id", None),
                         weight=getattr(e, "weight", 1.0),
                         directed=getattr(e, "directed", True),
                         attributes=deepcopy(getattr(e, "attributes", {}) or {})))
    return g2

# Parse sent properties
def _parse_properties(tokens: list[str]) -> dict:
    props = {}
    i = 0
    while i < len(tokens):
        if tokens[i] == "--property":
            i += 1
            while i < len(tokens) and not tokens[i].startswith("--"):
                kv = tokens[i]
                if "=" not in kv:
                    raise ValueError(f"Invalid property '{kv}' (expected key=value)")
                k, v = kv.split("=", 1)
                props[k] = v
                i += 1
        else:
            i += 1
    return props

def _parse_flag(tokens: list[str], name: str) -> str | None:
    # Looking for --id=123
    for i, t in enumerate(tokens):
        if t.startswith(name + "="):
            return t.split("=", 1)[1]
        if t == name and i + 1 < len(tokens):
            return tokens[i + 1]
    return None


@csrf_exempt
def cli_execute_api(request: HttpRequest) -> JsonResponse:
    method_error = _require_post_json(request)
    if method_error: return method_error

    body, error_response = _parse_json_body(request)
    if error_response: return error_response

    graph_id = body.get("graph_id")
    command = (body.get("command") or "").strip()

    if not graph_id or not command:
        return _json_error("graph_id and command are required", status=400)

    workspace = WORKSPACES.get(graph_id)
    if not workspace:
        return _json_error("Workspace not found", status=404)

    try:
        tokens = shlex.split(command)
        if len(tokens) < 2:
            raise ValueError("Invalid command. format: [action] [subject] --flags")

        action = tokens[0].lower()  # create / edit / delete
        subject = tokens[1].lower()  # node / edge

        # All flags extraction
        obj_id = _parse_flag(tokens, "--id")
        props = _parse_properties(tokens)

        if subject == "node":
            msg = _execute_node_command(workspace, tokens)
        
        elif subject == "edge":
            if action == "create":
                source = _parse_flag(tokens, "--source")
                target = _parse_flag(tokens, "--target")
                if not source or not target:
                    raise ValueError("Edge creation requires --source and --target")
                workspace.create_edge(source_id=source, target_id=target, edge_id=obj_id, properties=props)
                msg = f"OK: Created edge between {source} and {target}"
            elif action == "edit":
                if not obj_id: raise ValueError("Missing --id for edge edit")
                workspace.edit_edge(edge_id=obj_id, properties=props)
                msg = f"OK: Edited edge {obj_id}"
            elif action == "delete":
                if not obj_id: raise ValueError("Missing --id for edge deletion")
                workspace.delete_edge(edge_id=obj_id)
                msg = f"OK: Deleted edge {obj_id}"
            else:
                raise ValueError(f"Unknown action '{action}' for edge")

        else:
            raise ValueError(f"Unknown subject '{subject}'. Use 'node' or 'edge'.")

        # Update global map and save graph state
        updated_graph = workspace.get_graph()
        ACTIVE_GRAPHS[graph_id] = updated_graph

        return JsonResponse({
            "ok": True,
            "message": msg,
            "graph": updated_graph.to_dict()
        }, status=200)

    except Exception as exc:
        return JsonResponse({"ok": False, "message": f"ERROR: {str(exc)}"}, status=400)


def _execute_node_command(workspace: Workspace, tokens: list[str]) -> str:
    # Execute only command for node objects
    if len(tokens) < 2:
        raise ValueError("Invalid command. Use: create/edit/delete node ...")

    action = tokens[0].lower() # create/edit/delete
    subject = tokens[1].lower() # node

    if subject != "node":
        raise ValueError("Only node commands are supported here")

    node_id = _parse_flag(tokens, "--id")
    if not node_id:
        raise ValueError("Missing --id from node command")

    props = _parse_properties(tokens)

    # Actions

    if action == "create":
        workspace.create_node(node_id=node_id, properties=props)
        return f"Ok: created node {node_id}"

    if action == "edit":
        workspace.edit_node(node_id=node_id, properties=props)
        return f"Ok: edited node {node_id}"

    if action == "delete":
        workspace.delete_node(node_id=node_id)
        return f"Ok: deleted node {node_id}"

    raise ValueError("Unknown action. Use create/edit/delete")

@csrf_exempt
def graph_search_api(request: HttpRequest) -> JsonResponse:
    method_error = _require_post_json(request)
    if method_error:
        return method_error

    body, error_response = _parse_json_body(request)
    if error_response:
        return error_response

    graph_id = body.get("graph_id")
    query = body.get("query")

    if not graph_id or not query:
        return _json_error("graph_id and query are required", 400)

    workspace = WORKSPACES.get(graph_id)
    if not workspace:
        return _json_error("Graph not found", 404)

    current_graph = (
        ACTIVE_GRAPHS.get(graph_id)
        or ORIGINAL_GRAPHS.get(graph_id)
        or workspace.get_graph()
    )
    allowed_node_ids = {n.node_id for n in current_graph.nodes} if current_graph else None

    if workspace.get_graph() is None or workspace.get_graph() is not current_graph:
        if current_graph is not None:
            workspace.set_graph(current_graph)

    matched_nodes = workspace.find_nodes_by_query_contains(query, allowed_node_ids=allowed_node_ids)
    matched_ids = {n.node_id for n in matched_nodes}

    edges_source = current_graph.edges if current_graph else workspace.list_edges()
    matched_edges = [
        e for e in edges_source
        if e.source in matched_ids and e.target in matched_ids
    ]

    if Graph is not None and Node is not None and Edge is not None:
        directed = getattr(current_graph, "directed", True)
        filtered_graph = Graph(directed=directed)
        for node in matched_nodes:
            filtered_graph.add_node(node)
        for edge in matched_edges:
            filtered_graph.add_edge(edge)
        ACTIVE_GRAPHS[graph_id] = filtered_graph
        workspace.set_graph(filtered_graph)

    subgraph = {
        "nodes": [n.to_dict() for n in matched_nodes],
        "edges": [e.to_dict() for e in matched_edges],
    }

    return JsonResponse({"ok": True, "matched_ids": list(matched_ids), "graph": subgraph})


@csrf_exempt
def graph_filter_api(request: HttpRequest) -> JsonResponse:
    method_error = _require_post_json(request)
    if method_error:
        return method_error

    body, error_response = _parse_json_body(request)
    if error_response:
        return error_response

    graph_id = body.get("graph_id")
    attribute = body.get("attribute")
    operator = body.get("operator")
    value = body.get("value")

    if not graph_id or not attribute or not operator or value is None:
        return _json_error("graph_id, attribute, operator and value are required", 400)

    workspace = WORKSPACES.get(graph_id)
    if not workspace:
        return _json_error("Graph not found", 404)

    current_graph = ACTIVE_GRAPHS.get(graph_id)
    current_node_ids = {n.node_id for n in current_graph.nodes} if current_graph else None

    all_matched = workspace.find_nodes_by_attribute(attribute, operator, value)

    if current_node_ids is not None:
        matched_nodes = [n for n in all_matched if n.node_id in current_node_ids]
    else:
        matched_nodes = all_matched

    matched_ids = {n.node_id for n in matched_nodes}

    matched_edges = [
        e for e in workspace.list_edges()
        if e.source in matched_ids and e.target in matched_ids
    ]

    # Napravi novi Graph objekat sa filtriranim nodovima i edges
    if Graph is not None and Node is not None and Edge is not None:
        original_graph = ACTIVE_GRAPHS.get(graph_id)
        directed = getattr(original_graph, "directed", True)
        filtered_graph = Graph(directed=directed)
        for node in matched_nodes:
            filtered_graph.add_node(node)
        for edge in matched_edges:
            filtered_graph.add_edge(edge)
        # Sacuvaj filtrirani graf pod istim graph_id da ga visualizer moze naci
        ACTIVE_GRAPHS[graph_id] = filtered_graph

    subgraph = {
        "nodes": [n.to_dict() for n in matched_nodes],
        "edges": [e.to_dict() for e in matched_edges],
    }

    return JsonResponse({"ok": True, "graph": subgraph})


@csrf_exempt
def workspace_reset_api(request: HttpRequest) -> JsonResponse:
    method_error = _require_post_json(request)
    if method_error:
        return method_error

    body, error_response = _parse_json_body(request)
    if error_response:
        return error_response

    graph_id = body.get("graph_id")
    if not graph_id:
        return _json_error("graph_id is required", 400)

    original_graph = ORIGINAL_GRAPHS.get(graph_id)
    if not original_graph:
        return _json_error("Graph not found", 404)

    #Vrati originalni graf
    ACTIVE_GRAPHS[graph_id] = original_graph

    return JsonResponse({
        "ok": True,
        "graph": original_graph.to_dict()
    })

    # original_graph = ORIGINAL_GRAPHS.get(graph_id)
    # if not original_graph:
    #     return _json_error("Graph not found", 404)
    #
    # fresh = _clone_graph(original_graph)
    # ACTIVE_GRAPHS[graph_id] = fresh
    #
    # workspace = WORKSPACES.get(graph_id)
    # if workspace:
    #     workspace.set_graph(fresh)
    #
    # return JsonResponse({"ok": True, "graph": fresh.to_dict()})


@csrf_exempt
@require_POST
def load_graph_api(request: HttpRequest) -> JsonResponse:
    uploaded_file = request.FILES.get("file")
    if uploaded_file is None:
        return _json_error("missing file", status=400)

    filename = str(uploaded_file.name or "uploaded-file")
    extension = Path(filename).suffix.lower()
    datasource_map = _build_datasource_map()

    if extension not in datasource_map:
        return _json_error("Unsupported file extension. Allowed extensions are .json and .csv.", status=400)

    source_name, datasource_cls, import_error = datasource_map[extension]
    if datasource_cls is None:
        detail = f" ({import_error})" if import_error else ""
        return _json_error(f"The '{source_name}' datasource plugin is not available{detail}", status=501)

    try:
        try:
            graph = _load_graph_from_upload(uploaded_file=uploaded_file, suffix=extension, datasource_cls=datasource_cls)
        except Exception as exc:
            return _json_error(f"Failed to parse '{filename}' as {source_name}: {exc}", status=400)

        graph_id = str(uuid4())
        ACTIVE_GRAPHS[graph_id] = graph
        ORIGINAL_GRAPHS[graph_id] = graph
        #ORIGINAL_GRAPHS[graph_id] = _clone_graph(graph)
        workspace = Workspace()
        workspace.set_graph(graph)
        WORKSPACES[graph_id] = workspace
        _store_active_graph_id_in_session(request, graph_id)

        graph_payload = graph.to_dict()
        nodes = graph_payload.get("nodes", [])
        edges = graph_payload.get("edges", [])
        return JsonResponse(
            {
                "ok": True,
                "graph_id": graph_id,
                "meta": {
                    "node_count": len(nodes) if isinstance(nodes, list) else 0,
                    "edge_count": len(edges) if isinstance(edges, list) else 0,
                    "filename": filename,
                    "source": source_name,
                },
                "graph": graph_payload,
            },
            status=200,
        )
    except Exception as exc:
        LOGGER.exception("Unexpected graph load failure.")
        return _json_error(f"Unexpected graph load failure: {exc}", status=500)


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

    graph_id = request.GET.get("graph_id", "").strip()
    if not graph_id:
        return _html_response(
            "Missing graph_id",
            "Query parameter 'graph_id' is required.",
            status=400,
        )

    graph = ACTIVE_GRAPHS.get(graph_id)
    if graph is None:
        return _html_response(
            "Graph Not Found",
            f"Graph '{graph_id}' was not found in the active graph store.",
            status=404,
        )

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
        if hasattr(graph, "directed"):
            graph.directed = is_directed
        for edge in getattr(graph, "edges", []):
            if hasattr(edge, "directed"):
                edge.directed = is_directed
        html = visualizer.render(graph)
    except Exception as exc:
        return _html_response(
            "Visualizer Render Error",
            f"Failed to render visualizer '{visualizer_id}': {exc}",
            status=500,
        )

    return HttpResponse(str(html), content_type="text/html; charset=utf-8")