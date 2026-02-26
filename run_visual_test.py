import os
import webbrowser
from datasource_json.datasource_json_plugin.plugin import JsonDatasourcePlugin
from datasource_csv.datasource_csv_plugin.plugin import CsvDatasourcePlugin
from visualizer_simple.visualizer_simple_plugin.plugin import SimpleVisualizer
from visualizer_block.visualizer_block_plugin.plugin import BlockVisualizer


def load_graph(input_path: str, directed: bool = True):
    # Based on file extension load the correct plugin
    ext = os.path.splitext(input_path)[1].lower()

    if ext == ".json":
        plugin = JsonDatasourcePlugin()
    elif ext == ".csv":
        plugin = CsvDatasourcePlugin()
    else:
        raise ValueError(f"Unknown extension: {ext}")

    graph = plugin.load_graph(input_path, directed=directed)

    print(f"\nLoaded graph: {input_path}")
    print(f"  Nodes : {len(graph.nodes)}")
    print(f"  Edges   : {len(graph.edges)}")
    print(f"  Directed: {graph.directed}")

    return graph


def render_and_open(graph, visualizer, out_filename: str):
    print(f"\nRendering... {visualizer.display_name}...")

    html = visualizer.render(graph)

    os.makedirs("out", exist_ok=True)
    out_path = os.path.join("out", out_filename)

    with open(out_path, "w", encoding="utf-8") as f:
        f.write(html)

    # Open in browser
    abs_path = os.path.abspath(out_path)
    url = f"file:///{abs_path.replace(os.sep, '/')}"
    webbrowser.open(url)

TESTS = [
    {
        "naziv":     "JSON Aciklični + Simple",
        "fajl":      "test_data/company_acyclic.json",
        "directed":  False,
        "vizualizator": SimpleVisualizer(),
        "out":       "json_acyclic_simple.html",
    },
    {
        "naziv":     "JSON Ciklični + Simple",
        "fajl":      "test_data/social_cyclic.json",
        "directed":  True,
        "vizualizator": SimpleVisualizer(),
        "out":       "json_cyclic_simple.html",
    },
    {
        "naziv":     "JSON Aciklični + Block",
        "fajl":      "test_data/company_acyclic.json",
        "directed":  True,
        "vizualizator": BlockVisualizer(),
        "out":       "json_acyclic_block.html",
    },
    {
        "naziv":     "CSV Aciklični + Simple",
        "fajl":      "test_data/roads_acyclic.csv",
        "directed":  True,
        "vizualizator": BlockVisualizer(),
        "out":       "csv_acyclic_simple.html",
    },
    {
        "naziv":     "CSV Ciklični + Block",
        "fajl":      "test_data/network_cyclic.csv",
        "directed":  False,
        "vizualizator": BlockVisualizer(),
        "out":       "csv_cyclic_block.html",
    },
]

if __name__ == "__main__":
    print("=" * 60)
    print("  datasource + visualizer")
    print("=" * 60)

    for test in TESTS:
        print(f"\n--- {test['naziv']} ---")
        try:
            graph = load_graph(test["fajl"], directed=test["directed"])
            render_and_open(graph, test["vizualizator"], test["out"])
            print(f"  OK")
        except Exception as e:
            print(f"  Error: {e}")
            import traceback
            traceback.print_exc()

    print(f"\n{'=' * 60}")
    print("  Done.")
    print(f"{'=' * 60}\n")