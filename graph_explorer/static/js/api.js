(function (global) {
    "use strict";

    const ENDPOINTS = Object.freeze({
        datasourcePlugins: "/api/datasources/",
        graphLoad: "/api/graph/load/",
        cliExecute: "/api/cli/execute/",
        graphSearch: "/api/graph/search/",
        graphFilter: "/api/graph/filter/",
        workspaceReset: "/api/workspace/reset/",
        visualizerRender: "/api/render/"
    });

    // Validate the minimal graph payload shape expected from backend API responses.
    function isValidGraphShape(graph) {
        return Boolean(graph) && Array.isArray(graph.nodes) && Array.isArray(graph.edges);
    }

    // Build a user-facing backend response message from payload and HTTP status.
    function normalizeBackendMessage(response, payload) {
        if (payload && typeof payload.message === "string" && payload.message.trim()) {
            return payload.message.trim();
        }
        if (payload && typeof payload.error === "string" && payload.error.trim()) {
            return payload.error.trim();
        }
        if (response && typeof response.status === "number") {
            return `Request failed (HTTP ${response.status}).`;
        }
        return "Request failed.";
    }

    // Send a JSON POST request and normalize the response shape for UI consumers.
    async function postJsonRequest(endpoint, body) {
        try {
            const response = await fetch(endpoint, {
                method: "POST",
                headers: {
                    Accept: "application/json",
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(body)
            });

            let payload = null;
            try {
                payload = await response.json();
            } catch {
                payload = null;
            }

            return {
                ok: response.ok,
                response: response,
                payload: payload,
                message: normalizeBackendMessage(response, payload)
            };
        } catch (error) {
            console.warn(`Graph Explorer: request to ${endpoint} failed.`, error);
            return {
                ok: false,
                response: null,
                payload: null,
                message: "Request failed."
            };
        }
    }

    // Upload a graph file and return a validated graph payload from the backend.
    async function loadGraphFile(file, datasourcePlugin) {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("datasource", datasourcePlugin);

        const response = await fetch(ENDPOINTS.graphLoad, {
            method: "POST",
            body: formData,
            headers: { Accept: "application/json" }
        });

        let payload = null;
        try {
            payload = await response.json();
        } catch {
            payload = null;
        }

        if (!response.ok) {
            const errorMessage = payload && payload.error ? payload.error : `HTTP ${response.status}`;
            throw new Error(errorMessage);
        }

        if (!payload || payload.ok !== true || !isValidGraphShape(payload.graph)) {
            throw new Error("Invalid graph response shape; expected { ok, graph_id, graph: {nodes, edges} }.");
        }

        const graphId = typeof payload.graph_id === "string" ? payload.graph_id : null;
        if (!graphId) {
            throw new Error("Missing graph_id in load response.");
        }

        return {
            graphId: graphId,
            graph: payload.graph,
            meta: payload.meta || null
        };
    }

    // Load datasource plugins discovered by backend plugin registry.
    async function loadDatasourcePlugins() {
        const response = await fetch(ENDPOINTS.datasourcePlugins, {
            method: "GET",
            headers: { Accept: "application/json" }
        });

        let payload = null;
        try {
            payload = await response.json();
        } catch {
            payload = null;
        }

        if (!response.ok) {
            const errorMessage = payload && payload.error ? payload.error : `HTTP ${response.status}`;
            throw new Error(errorMessage);
        }

        const rawDatasources = payload && Array.isArray(payload.datasources) ? payload.datasources : null;
        if (!payload || payload.ok !== true || !rawDatasources) {
            throw new Error("Invalid datasource plugin response shape; expected { ok, datasources }.");
        }

        return rawDatasources
            .map(function (item) {
                if (!item || typeof item !== "object") {
                    return null;
                }
                const id = typeof item.id === "string" ? item.id.trim() : "";
                const name = typeof item.name === "string" ? item.name.trim() : "";
                const extensions = Array.isArray(item.extensions)
                    ? item.extensions.filter(function (entry) {
                        return typeof entry === "string" && entry.trim().length > 0;
                    })
                    : [];
                if (!id) {
                    return null;
                }
                return {
                    id: id,
                    name: name || id,
                    extensions: extensions
                };
            })
            .filter(Boolean);
    }

    // Build a render endpoint URL for a specific graph, visualizer, and direction mode.
    function buildVisualizerRenderUrl(visualizerId, isDirected, graphId) {
        const params = new URLSearchParams({
            visualizer_id: visualizerId,
            directed: isDirected ? "1" : "0",
            graph_id: graphId
        });
        return `${ENDPOINTS.visualizerRender}?${params.toString()}`;
    }

    // Request rendered visualizer HTML for the current graph settings.
    async function loadVisualizerOutput(visualizerId, isDirected, graphId) {
        const response = await fetch(buildVisualizerRenderUrl(visualizerId, isDirected, graphId), {
            headers: { Accept: "text/html" }
        });
        const html = await response.text();

        if (!response.ok) {
            const message = html && html.trim() ? html.trim().replace(/\s+/g, " ") : `HTTP ${response.status}`;
            throw new Error(message);
        }

        return html;
    }

    global.GraphExplorerApi = {
        ENDPOINTS: ENDPOINTS,
        postJsonRequest: postJsonRequest,
        loadDatasourcePlugins: loadDatasourcePlugins,
        loadGraphFile: loadGraphFile,
        loadVisualizerOutput: loadVisualizerOutput
    };
})(window);
