from django.http import HttpRequest, HttpResponse, JsonResponse
from django.shortcuts import render


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
