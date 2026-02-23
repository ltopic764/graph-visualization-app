(function () {
    "use strict";

    // TODO: replace this mock graph with graph data provided by platform/plugins.
    const mockGraph = {
        nodes: [
            { id: "n1", label: "Input" },
            { id: "n2", label: "Processor" },
            { id: "n3", label: "Output" }
        ],
        edges: [
            { id: "e1", source: "n1", target: "n2" },
            { id: "e2", source: "n2", target: "n3" }
        ]
    };

    window.GRAPH_EXPLORER_MOCK_GRAPH = mockGraph;
    console.log("Graph Explorer mock graph loaded:", mockGraph);
})();
