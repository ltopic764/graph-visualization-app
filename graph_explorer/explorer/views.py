from django.shortcuts import render
from django.http import HttpRequest, HttpResponse


def index(request: HttpRequest) -> HttpResponse:
    context = {
        "page_title": "Graph Explorer",
        "placeholder_message": "Main graph rendering placeholder",
    }
    return render(request, "explorer/index.html", context)
