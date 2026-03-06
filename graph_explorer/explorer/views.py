import os
import shlex
import time
import json
import logging
import datetime
import re
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

from core.graph_platform.registry import PluginRegistry
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
DATASOURCE_BY_EXTENSION = {
    ".json": "json",
    ".csv": "csv",
}
DATASOURCE_EXTENSIONS_BY_PLUGIN: dict[str, set[str]] = {}
for extension, plugin_name in DATASOURCE_BY_EXTENSION.items():
    DATASOURCE_EXTENSIONS_BY_PLUGIN.setdefault(plugin_name, set()).add(extension)
SUPPORTED_VISUALIZERS = {"simple", "block"}


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


def _format_available_plugins(plugin_names: list[str]) -> str:
    if not plugin_names:
        return " (no plugins discovered via registry)"
    return f" (available: {', '.join(sorted(plugin_names))})"


def _build_datasource_plugin_payloads() -> list[dict[str, object]]:
    # Build datasource plugin options directly from registry discovery.
    registry = PluginRegistry()
    payloads: list[dict[str, object]] = []
    for datasource_name in sorted(registry.list_datasources()):
        display_name = datasource_name
        datasource_cls = registry.get_datasource(datasource_name)
        if datasource_cls is not None:
            try:
                datasource = datasource_cls()
                resolved_display_name = getattr(datasource, "display_name", None)
                if isinstance(resolved_display_name, str) and resolved_display_name.strip():
                    display_name = resolved_display_name.strip()
            except Exception:
                pass

        payloads.append(
            {
                "id": datasource_name,
                "name": display_name,
                "extensions": sorted(DATASOURCE_EXTENSIONS_BY_PLUGIN.get(datasource_name, set())),
            }
        )
    return payloads


def _validate_datasource_file_match(datasource_name: str, extension: str) -> str | None:
    # Reject obvious extension mismatches for known datasource plugins.
    if not extension:
        return None

    expected_extensions = DATASOURCE_EXTENSIONS_BY_PLUGIN.get(datasource_name)
    if not expected_extensions:
        return None

    if extension in expected_extensions:
        return None

    expected_label = ", ".join(sorted(expected_extensions))
    return (
        f"Selected datasource plugin '{datasource_name}' does not match file extension '{extension}'. "
        f"Expected: {expected_label}."
    )


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


@require_GET
def datasource_plugins_api(request: HttpRequest) -> JsonResponse:
    return JsonResponse(
        {
            "ok": True,
            "datasources": _build_datasource_plugin_payloads(),
        }
    )


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


def _build_subgraph(graph: Graph, node_ids: set[str]) -> Graph:
    if Graph is None or Node is None or Edge is None:
        raise RuntimeError(f"Graph API classes are not importable: {GRAPH_IMPORT_ERROR}")

    subgraph = Graph(directed=getattr(graph, "directed", True))

    for node in graph.nodes:
        if node.node_id not in node_ids:
            continue
        subgraph.add_node(
            Node(
                node_id=str(node.node_id),
                label=getattr(node, "label", "") or str(node.node_id),
                attributes=deepcopy(getattr(node, "attributes", {}) or {}),
            )
        )

    for edge in graph.edges:
        if edge.source not in node_ids or edge.target not in node_ids:
            continue
        subgraph.add_edge(
            Edge(
                source=str(edge.source),
                target=str(edge.target),
                edge_id=getattr(edge, "edge_id", None),
                weight=getattr(edge, "weight", 1.0),
                directed=getattr(edge, "directed", getattr(graph, "directed", True)),
                attributes=deepcopy(getattr(edge, "attributes", {}) or {}),
            )
        )

    return subgraph


def _to_json_safe_value(value):
    if isinstance(value, datetime.datetime):
        return value.isoformat()
    if isinstance(value, datetime.date):
        return value.isoformat()
    if isinstance(value, dict):
        return {
            str(k): _to_json_safe_value(v)
            for k, v in value.items()
        }
    if isinstance(value, list):
        return [_to_json_safe_value(v) for v in value]
    if isinstance(value, tuple):
        return [_to_json_safe_value(v) for v in value]
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    return str(value)


def _build_visualizer_graph(graph: Graph, is_directed: bool) -> Graph:
    if Graph is None or Node is None or Edge is None:
        raise RuntimeError(f"Graph API classes are not importable: {GRAPH_IMPORT_ERROR}")

    render_graph = Graph(directed=is_directed)

    for node in getattr(graph, "nodes", []):
        safe_attributes = _to_json_safe_value(getattr(node, "attributes", {}) or {})
        if not isinstance(safe_attributes, dict):
            safe_attributes = {}
        render_graph.add_node(
            Node(
                node_id=str(getattr(node, "node_id", "")),
                label=getattr(node, "label", "") or str(getattr(node, "node_id", "")),
                attributes=safe_attributes,
            )
        )

    for edge in getattr(graph, "edges", []):
        safe_attributes = _to_json_safe_value(getattr(edge, "attributes", {}) or {})
        if not isinstance(safe_attributes, dict):
            safe_attributes = {}
        render_graph.add_edge(
            Edge(
                source=str(getattr(edge, "source", "")),
                target=str(getattr(edge, "target", "")),
                edge_id=getattr(edge, "edge_id", None),
                weight=getattr(edge, "weight", 1.0),
                directed=is_directed,
                attributes=safe_attributes,
            )
        )

    return render_graph

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

def _graph_to_payload(graph: Graph) -> dict:
    return {
        "nodes": [n.to_dict() for n in graph.nodes],
        "edges": [e.to_dict() for e in graph.edges],
    }


def _reset_graph_state(graph_id: str) -> Graph:
    original_graph = ORIGINAL_GRAPHS.get(graph_id)
    if not original_graph:
        raise ValueError("Graph not found")

    fresh_graph = _clone_graph(original_graph)
    ACTIVE_GRAPHS[graph_id] = fresh_graph

    workspace = WORKSPACES.get(graph_id)
    if workspace is None:
        workspace = Workspace()
        WORKSPACES[graph_id] = workspace

    workspace.clear()
    workspace.set_graph(fresh_graph)
    return fresh_graph

def _clear_graph_state(graph_id: str) -> Graph:
    workspace = WORKSPACES.get(graph_id)

    if workspace is None:
        workspace = Workspace()
        WORKSPACES[graph_id] = workspace

    current_graph = (
        ACTIVE_GRAPHS.get(graph_id)
        or workspace.get_graph()
        or ORIGINAL_GRAPHS.get(graph_id)
    )

    directed = getattr(current_graph, "directed", True) if current_graph else True
    empty_graph = Graph(directed=directed)

    ACTIVE_GRAPHS[graph_id] = empty_graph
    ORIGINAL_GRAPHS[graph_id] = _clone_graph(empty_graph)

    workspace.clear()
    workspace.set_graph(empty_graph)

    return empty_graph


def _apply_search_to_workspace(graph_id: str, workspace: Workspace, query: str) -> Graph:
    current_graph = ACTIVE_GRAPHS.get(graph_id) or workspace.get_graph() or ORIGINAL_GRAPHS.get(graph_id)
    if current_graph is None:
        raise ValueError("Graph not found")

    if workspace.get_graph() is not current_graph:
        workspace.set_graph(current_graph)

    query = query.strip()

    # Ako je query oblika Name=Tom, tretiraj kao precizan atributski search
    if "=" in query and "==" not in query and "!=" not in query and ">=" not in query and "<=" not in query:
        attribute, value = query.split("=", 1)
        matched_nodes = workspace.find_nodes_by_attribute(attribute.strip(), "==", value.strip())
    else:
        matched_nodes = workspace.find_nodes_by_query_contains(query)

    matched_ids = {str(n.node_id) for n in matched_nodes}
    filtered_graph = _build_subgraph(current_graph, matched_ids)

    ACTIVE_GRAPHS[graph_id] = filtered_graph
    workspace.set_graph(filtered_graph)
    return filtered_graph


def _parse_filter_condition(condition: str) -> tuple[str, str, str]:
    condition = condition.strip()

    match = re.match(r"^(.+?)(==|!=|>=|<=|>|<|=)(.+)$", condition)
    if not match:
        raise ValueError(f"Invalid filter condition: '{condition}'")

    attribute = match.group(1).strip()
    operator = match.group(2).strip()
    value = match.group(3).strip()

    if operator == "=":
        operator = "=="

    return attribute, operator, value


def _apply_filter_expression_to_workspace(graph_id: str, workspace: Workspace, expression: str) -> Graph:
    current_graph = ACTIVE_GRAPHS.get(graph_id) or workspace.get_graph() or ORIGINAL_GRAPHS.get(graph_id)
    if current_graph is None:
        raise ValueError("Graph not found")

    if workspace.get_graph() is not current_graph:
        workspace.set_graph(current_graph)

    expression = expression.strip()
    conditions = [c.strip() for c in expression.split("&&") if c.strip()]
    if not conditions:
        raise ValueError("Empty filter expression")

    temp_graph = current_graph

    for condition in conditions:
        attribute, operator, value = _parse_filter_condition(condition)
        workspace.set_graph(temp_graph)
        matched_nodes = workspace.find_nodes_by_attribute(attribute, operator, value)
        matched_ids = {str(n.node_id) for n in matched_nodes}
        temp_graph = _build_subgraph(temp_graph, matched_ids)

    ACTIVE_GRAPHS[graph_id] = temp_graph
    workspace.set_graph(temp_graph)
    return temp_graph

@csrf_exempt
def cli_execute_api(request: HttpRequest) -> JsonResponse:
    method_error = _require_post_json(request)
    if method_error:
        return method_error

    body, error_response = _parse_json_body(request)
    if error_response:
        return error_response

    graph_id = body.get("graph_id")
    command = (body.get("command") or "").strip()

    if not graph_id or not command:
        return _json_error("graph_id and command are required", status=400)

    workspace = WORKSPACES.get(graph_id)
    if not workspace:
        return _json_error("Workspace not found", status=404)

    try:
        tokens = shlex.split(command)
        if not tokens:
            raise ValueError("Empty command")

        action = tokens[0].lower()

        # SEARCH
        if action == "search":
            if len(tokens) < 2:
                raise ValueError("Invalid search command. Use: search 'Name=Tom'")

            query = " ".join(tokens[1:]).strip()
            updated_graph = _apply_search_to_workspace(graph_id, workspace, query)

            return JsonResponse({
                "ok": True,
                "message": f"OK: Search applied ({query})",
                "graph": _graph_to_payload(updated_graph)
            }, status=200)

        # FILTER
        if action == "filter":
            if len(tokens) < 2:
                raise ValueError("Invalid filter command. Use: filter 'Age>30 && Height>=150'")

            expression = " ".join(tokens[1:]).strip()
            updated_graph = _apply_filter_expression_to_workspace(graph_id, workspace, expression)

            return JsonResponse({
                "ok": True,
                "message": f"OK: Filter applied ({expression})",
                "graph": _graph_to_payload(updated_graph)
            }, status=200)

        # CLEAR / CLEAR GRAPH
        
        if action == "clear":
            if len(tokens) == 1 or (len(tokens) == 2 and tokens[1].lower() == "graph"):
                cleared_graph = _clear_graph_state(graph_id)

                return JsonResponse({
                    "ok": True,
                    "message": "OK: Graph canvas cleared",
                    "graph": cleared_graph.to_dict()
                }, status=200)

            raise ValueError("Invalid clear command. Use: clear or clear graph")

        # Existing NODE / EDGE commands
        # create/edit/delete node/edge ...

        if len(tokens) < 2:
            raise ValueError("Invalid command. format: [action] [subject] --flags")

        subject = tokens[1].lower()
        obj_id = _parse_flag(tokens, "--id")
        props = _parse_properties(tokens)

        # Command delegation by subject
        if subject == "node":
            msg = _execute_node_command(workspace, tokens)
        elif subject == "edge":
            msg = _execute_edge_command(workspace, tokens)
        else:
            raise ValueError(
                f"Unknown command '{action}' or subject '{subject}'. "
                f"Supported: create/edit/delete node|edge, search, filter, clear"
            )

        updated_graph = workspace.get_graph()
        ACTIVE_GRAPHS[graph_id] = updated_graph

        return JsonResponse({
            "ok": True,
            "message": msg,
            "graph": updated_graph.to_dict()
        }, status=200)

    except Exception as exc:
        return JsonResponse({"ok": False, "message": f"ERROR: {str(exc)}"}, status=400)
    
def _build_empty_graph_like(graph: Graph | None = None) -> Graph:
    if Graph is None:
        raise RuntimeError(f"Graph API classes are not importable: {GRAPH_IMPORT_ERROR}")

    is_directed = True
    if graph is not None:
        is_directed = getattr(graph, "directed", True)

    return Graph(directed=is_directed)


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


def _execute_edge_command(workspace: Workspace, tokens: list[str]) -> str:
    """Execute command for edge objects: [action] edge --id --source --target --props"""
    if len(tokens) < 2:
        raise ValueError("Invalid command format. Use: [action] edge --flags")

    action = tokens[0].lower()
    subject = tokens[1].lower()

    if subject != "edge":
        raise ValueError("Only edge commands are supported here")

    # Flag extraction
    edge_id = _parse_flag(tokens, "--id")
    props = _parse_properties(tokens)


    graph = workspace.get_graph()

    if action == "create":
        if not edge_id:
            raise ValueError("Edge creation requires --id")

        # Check if id already exists
        if any(e.get('id') == edge_id for e in graph.to_dict().get('edges', [])):
            raise ValueError(f"Edge with id '{edge_id}' already exists.")

        source = _parse_flag(tokens, "--source")
        target = _parse_flag(tokens, "--target")

        if not source or not target:
            raise ValueError("Edge creation requires --source and --target")

        workspace.create_edge(source_id=source, target_id=target, edge_id=edge_id, properties=props)
        return f"OK: Created edge {edge_id} between {source} and {target}"

    if action == "edit":
        if not edge_id:
            raise ValueError("Missing --id for edge edit")

        if not any(e.get('id') == edge_id for e in graph.to_dict().get('edges', [])):
            raise ValueError(f"Edge with id '{edge_id}' does not exist.")

        workspace.edit_edge(edge_id=edge_id, properties=props)
        return f"OK: Edited edge {edge_id}"

    if action == "delete":
        if not edge_id:
            raise ValueError("Missing --id for edge deletion")

        if not any(e.get('id') == edge_id for e in graph.to_dict().get('edges', [])):
            raise ValueError(f"Edge with id '{edge_id}' does not exist.")

        workspace.delete_edge(edge_id=edge_id)
        return f"OK: Deleted edge {edge_id}"

    raise ValueError(f"Unknown action '{action}' for edge. Use create/edit/delete.")

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

    current_graph = ACTIVE_GRAPHS.get(graph_id) or workspace.get_graph() or ORIGINAL_GRAPHS.get(graph_id)
    if current_graph is None:
        return _json_error("Graph not found", 404)

    if workspace.get_graph() is not current_graph:
        workspace.set_graph(current_graph)

    matched_nodes = workspace.find_nodes_by_query_contains(query)
    matched_ids = {n.node_id for n in matched_nodes}

    if Graph is not None and Node is not None and Edge is not None:
        filtered_graph = _build_subgraph(current_graph, matched_ids)
        ACTIVE_GRAPHS[graph_id] = filtered_graph
        workspace.set_graph(filtered_graph)
        subgraph = {
            "nodes": [n.to_dict() for n in filtered_graph.nodes],
            "edges": [e.to_dict() for e in filtered_graph.edges],
        }
    else:
        matched_edges = [
            e for e in current_graph.edges
            if e.source in matched_ids and e.target in matched_ids
        ]
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

    current_graph = ACTIVE_GRAPHS.get(graph_id) or workspace.get_graph() or ORIGINAL_GRAPHS.get(graph_id)
    if current_graph is None:
        return _json_error("Graph not found", 404)

    if workspace.get_graph() is not current_graph:
        workspace.set_graph(current_graph)

    try:
        matched_nodes = workspace.find_nodes_by_attribute(attribute, operator, value)
    except ValueError as exc:
        return _json_error(str(exc), 400)

    matched_ids = {n.node_id for n in matched_nodes}

    if Graph is not None and Node is not None and Edge is not None:
        filtered_graph = _build_subgraph(current_graph, matched_ids)
        ACTIVE_GRAPHS[graph_id] = filtered_graph
        workspace.set_graph(filtered_graph)
        subgraph = {
            "nodes": [n.to_dict() for n in filtered_graph.nodes],
            "edges": [e.to_dict() for e in filtered_graph.edges],
        }
    else:
        matched_edges = [
            e for e in current_graph.edges
            if e.source in matched_ids and e.target in matched_ids
        ]
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

    fresh_graph = _clone_graph(original_graph)
    ACTIVE_GRAPHS[graph_id] = fresh_graph

    workspace = WORKSPACES.get(graph_id)
    if workspace is None:
        workspace = Workspace()
        WORKSPACES[graph_id] = workspace
    workspace.clear()
    workspace.set_graph(fresh_graph)

    return JsonResponse({
        "ok": True,
        "graph": fresh_graph.to_dict()
    })


@csrf_exempt
@require_POST
def load_graph_api(request: HttpRequest) -> JsonResponse:
    uploaded_file = request.FILES.get("file")
    if uploaded_file is None:
        return _json_error("missing file", status=400)

    datasource_name = str(request.POST.get("datasource") or "").strip()
    if not datasource_name:
        return _json_error("Missing datasource plugin selection.", status=400)

    registry = PluginRegistry()
    datasource_cls = registry.get_datasource(datasource_name)
    if datasource_cls is None:
        available_detail = _format_available_plugins(registry.list_datasources())
        return _json_error(f"Datasource plugin '{datasource_name}' is not available{available_detail}", status=400)

    filename = str(uploaded_file.name or "uploaded-file")
    extension = Path(filename).suffix.lower()
    mismatch_error = _validate_datasource_file_match(datasource_name, extension)
    if mismatch_error:
        return _json_error(mismatch_error, status=400)

    try:
        try:
            graph = _load_graph_from_upload(uploaded_file=uploaded_file, suffix=extension, datasource_cls=datasource_cls)
        except Exception as exc:
            return _json_error(f"Failed to parse '{filename}' as {datasource_name}: {exc}", status=400)

        graph_id = str(uuid4())
        original_graph = _clone_graph(graph)
        active_graph = _clone_graph(graph)
        ACTIVE_GRAPHS[graph_id] = active_graph
        ORIGINAL_GRAPHS[graph_id] = original_graph
        workspace = Workspace()
        workspace.set_graph(active_graph)
        WORKSPACES[graph_id] = workspace
        _store_active_graph_id_in_session(request, graph_id)

        graph_payload = active_graph.to_dict()
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
                    "source": datasource_name,
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
    registry = PluginRegistry()
    visualizers: dict[str, object | None] = {}
    for visualizer_name in SUPPORTED_VISUALIZERS:
        visualizer_cls = registry.get_visualizer(visualizer_name)
        visualizers[visualizer_name] = visualizer_cls() if visualizer_cls else None
    return visualizers


@require_GET
def render_visualizer_api(request: HttpRequest) -> HttpResponse:
    visualizer_id = request.GET.get("visualizer_id", "").strip().lower()
    if not visualizer_id:
        return _html_response(
            "Missing visualizer_id",
            "Query parameter 'visualizer_id' is required (allowed: simple, block).",
            status=400,
        )

    if visualizer_id not in SUPPORTED_VISUALIZERS:
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

    visualizers = _build_visualizer_map()
    visualizer = visualizers.get(visualizer_id)
    if visualizer is None:
        available_detail = _format_available_plugins(PluginRegistry().list_visualizers())
        return _html_response(
            "Visualizer Not Available",
            f"Visualizer '{visualizer_id}' is not currently available{available_detail}.",
            status=500,
        )

    try:
        graph_for_render = _build_visualizer_graph(graph, is_directed=is_directed)
        html = visualizer.render(graph_for_render)
    except Exception as exc:
        return _html_response(
            "Visualizer Render Error",
            f"Failed to render visualizer '{visualizer_id}': {exc}",
            status=500,
        )

    return HttpResponse(str(html), content_type="text/html; charset=utf-8")
