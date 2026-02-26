from django.urls import path

from . import views

app_name = "explorer"

urlpatterns = [
    path("", views.index, name="index"),
    path("api/mock-graph/", views.mock_graph_api, name="mock-graph-api"),
    path("api/render/", views.render_visualizer_api, name="render-visualizer-api"),
]
