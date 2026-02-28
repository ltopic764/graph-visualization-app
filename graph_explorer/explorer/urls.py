from django.urls import path

from . import views

app_name = "explorer"

urlpatterns = [
    path("", views.index, name="index"),
    path("api/mock-graph/", views.mock_graph_api, name="mock-graph-api"),
    path("api/graph/load/", views.load_graph_api, name="graph-load-api"),
    path("api/cli/execute/", views.cli_execute_api, name="cli-execute-api"),
    path("api/graph/search/", views.graph_search_api, name="graph-search-api"),
    path("api/graph/filter/", views.graph_filter_api, name="graph-filter-api"),
    path("api/workspace/reset/", views.workspace_reset_api, name="workspace-reset-api"),
    path("api/render/", views.render_visualizer_api, name="render-visualizer-api"),
]
