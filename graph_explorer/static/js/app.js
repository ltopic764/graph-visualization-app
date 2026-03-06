(function () {
    "use strict";

    const DEFAULT_VISUALIZER = "simple";
    const DEFAULT_DIRECTED = true;
    const DEFAULT_FILTER_OPERATOR = "==";
    const SUCCESS_STATUS_AUTO_HIDE_MS = 5000;
    const FILTER_ERROR_AUTO_HIDE_MS = 3500;
    const SVG_NS = "http://www.w3.org/2000/svg";
    const BIRD_VIEW_ZOOM_OUT_FACTOR = 1.25;
    let graphFetchSuccessHideTimeoutId = null;
    let visualizerRenderRequestSequence = 0;

    // Shared UI state for the current session and all open workspaces.
    const state = {
        activeVisualizer: DEFAULT_VISUALIZER,
        activeGraphId: null,
        isDirected: DEFAULT_DIRECTED,
        selectedNodeId: null,
        datasourcePlugins: [],
        datasourcePluginsStatus: "loading",
        datasourcePluginsErrorMessage: null,
        selectedDatasourcePlugin: "",
        selectedUploadFile: null,
        selectedUploadFilename: "",
        graph: null,
        graphOriginal: null,
        workspaces: {
            byId: {},
            orderedIds: [],
            nextUntitledLabelIndex: 1
        },
        graphFetchStatus: "idle",
        graphFetchErrorMessage: null,
        graphFetchLastLoadedAt: null,
        graphFetchMeta: null,
        visualizerRender: {
            status: "idle",
            errorMessage: null,
            html: "",
            renderedGraphId: null,
            renderedVisualizerId: null,
            renderedIsDirected: null
        },
        queryUI: createDefaultQueryUI(),
        consoleUI: {
            currentInput: "",
            history: [],
            outputLines: [],
            isCollapsed: true,
            maxHistory: 20,
            maxOutputLines: 120
        },
        treeUI: {
            expanded: {},
            lastGraphId: null,
            lastGraphSignature: "",
            autoExpandedOnce: false
        }
    };

    // Validate the API module contract before wiring the app.
    function getApiClient() {
        if (!window.GraphExplorerApi || typeof window.GraphExplorerApi !== "object") {
            throw new Error("GraphExplorerApi module is not available.");
        }
        if (typeof window.GraphExplorerApi.postJsonRequest !== "function") {
            throw new Error("GraphExplorerApi.postJsonRequest is not available.");
        }
        if (typeof window.GraphExplorerApi.loadDatasourcePlugins !== "function") {
            throw new Error("GraphExplorerApi.loadDatasourcePlugins is not available.");
        }
        if (typeof window.GraphExplorerApi.loadGraphFile !== "function") {
            throw new Error("GraphExplorerApi.loadGraphFile is not available.");
        }
        if (typeof window.GraphExplorerApi.loadVisualizerOutput !== "function") {
            throw new Error("GraphExplorerApi.loadVisualizerOutput is not available.");
        }
        if (!window.GraphExplorerApi.ENDPOINTS || typeof window.GraphExplorerApi.ENDPOINTS !== "object") {
            throw new Error("GraphExplorerApi.ENDPOINTS is not available.");
        }
        return window.GraphExplorerApi;
    }

    const apiClient = getApiClient();
    const apiEndpoints = apiClient.ENDPOINTS;

    // Create the Bird View controller that mirrors Main View focus/viewport.
    function createBirdViewController() {
        if (!window.GraphExplorerBirdView || typeof window.GraphExplorerBirdView.createController !== "function") {
            throw new Error("GraphExplorerBirdView controller is not available.");
        }

        return window.GraphExplorerBirdView.createController({
            mainIframeId: "main-view-visualizer-iframe",
            birdIframeId: "bird-view-iframe",
            svgNs: SVG_NS,
            zoomOutFactor: BIRD_VIEW_ZOOM_OUT_FACTOR,
            getSelectedNodeId: function () {
                return state.selectedNodeId;
            }
        });
    }

    const birdViewController = createBirdViewController();

    // Create the Tree View controller and provide shared app callbacks.
    function createTreeViewController() {
        if (!window.GraphExplorerTreeView || typeof window.GraphExplorerTreeView.createController !== "function") {
            throw new Error("GraphExplorerTreeView controller is not available.");
        }

        return window.GraphExplorerTreeView.createController({
            treeViewElementId: "tree-view-content",
            getState: function () {
                return state;
            },
            hasLoadedGraph: hasLoadedGraph,
            getNodes: getNodes,
            getEdges: getEdges,
            escapeHtml: escapeHtml,
            setSelectedNode: setSelectedNode,
            postSelectedNodeToIframe: postSelectedNodeToIframe
        });
    }

    const treeViewController = createTreeViewController();

    // Create workspace tab UI controller for activate/remove interactions.
    function createWorkspaceUIController() {
        if (!window.GraphExplorerWorkspaceUI || typeof window.GraphExplorerWorkspaceUI.createController !== "function") {
            throw new Error("GraphExplorerWorkspaceUI controller is not available.");
        }

        return window.GraphExplorerWorkspaceUI.createController({
            getWorkspaceById: getWorkspaceById,
            getWorkspaceIds: function () {
                return state.workspaces.orderedIds;
            },
            getActiveGraphId: function () {
                return state.activeGraphId;
            },
            setActiveWorkspace: setActiveWorkspace,
            removeWorkspace: removeWorkspace
        });
    }

    const workspaceUIController = createWorkspaceUIController();

    // Create query/search/filter controller backed by API endpoints.
    function createQueryUIController() {
        if (!window.GraphExplorerQueryUI || typeof window.GraphExplorerQueryUI.createController !== "function") {
            throw new Error("GraphExplorerQueryUI controller is not available.");
        }

        return window.GraphExplorerQueryUI.createController({
            defaultFilterOperator: DEFAULT_FILTER_OPERATOR,
            filterErrorAutoHideMs: FILTER_ERROR_AUTO_HIDE_MS,
            graphSearchEndpoint: apiEndpoints.graphSearch,
            graphFilterEndpoint: apiEndpoints.graphFilter,
            workspaceResetEndpoint: apiEndpoints.workspaceReset,
            getState: function () {
                return state;
            },
            syncActiveWorkspaceFromState: syncActiveWorkspaceFromState,
            renderAll: renderAll,
            loadVisualizerOutput: loadVisualizerOutput,
            pushConsoleOutputLine: pushConsoleOutputLine,
            renderConsole: renderConsole,
            postJsonRequest: apiClient.postJsonRequest,
            isValidGraphShape: isValidGraphShape,
            toGraphState: toGraphState
        });
    }

    const queryUIController = createQueryUIController();

    // Guard API/workspace payloads before storing them as graph state.
    function isValidGraphShape(graph) {
        return Boolean(graph) && Array.isArray(graph.nodes) && Array.isArray(graph.edges);
    }

    // Normalize graph payloads to the minimal nodes/edges shape used in UI.
    function toGraphState(graph) {
        if (!isValidGraphShape(graph)) {
            return null;
        }
        return {
            nodes: graph.nodes,
            edges: graph.edges
        };
    }

    // Build a fresh query toolbar state for a new or reset workspace.
    function createDefaultQueryUI() {
        return {
            searchText: "",
            filterAttribute: "",
            filterOperator: DEFAULT_FILTER_OPERATOR,
            filterValue: "",
            appliedChips: [],
            nextChipId: 1
        };
    }

    function normalizeVisualizer(value) {
        return value === "block" ? "block" : DEFAULT_VISUALIZER;
    }

    function normalizeDirected(value) {
        if (typeof value === "boolean") {
            return value;
        }
        return DEFAULT_DIRECTED;
    }

    // Deep-copy query state so workspaces do not share mutable references.
    function cloneQueryUI(queryUI) {
        const source = queryUI && typeof queryUI === "object" ? queryUI : createDefaultQueryUI();
        const sourceChips = Array.isArray(source.appliedChips) ? source.appliedChips : [];
        return {
            searchText: String(source.searchText || ""),
            filterAttribute: String(source.filterAttribute || ""),
            filterOperator: String(source.filterOperator || DEFAULT_FILTER_OPERATOR),
            filterValue: String(source.filterValue || ""),
            appliedChips: sourceChips.map(function (chip, index) {
                const chipPayload = chip && typeof chip.payload === "object" && chip.payload !== null
                    ? Object.assign({}, chip.payload)
                    : chip ? chip.payload : null;
                return {
                    id: chip && chip.id !== undefined && chip.id !== null ? chip.id : index + 1,
                    label: chip && chip.label !== undefined ? String(chip.label) : "",
                    type: chip && chip.type !== undefined ? String(chip.type) : "",
                    payload: chipPayload
                };
            }),
            nextChipId: Number.isFinite(source.nextChipId) && source.nextChipId > 0
                ? Number(source.nextChipId)
                : sourceChips.length + 1
        };
    }

    function getWorkspaceById(graphId) {
        if (!graphId) {
            return null;
        }
        return state.workspaces.byId[graphId] || null;
    }

    function getActiveWorkspace() {
        return getWorkspaceById(state.activeGraphId);
    }

    function getWorkspaceLabel(filename) {
        const cleanFilename = typeof filename === "string" ? filename.trim() : "";
        if (cleanFilename) {
            return cleanFilename;
        }
        const label = `Workspace ${state.workspaces.nextUntitledLabelIndex}`;
        state.workspaces.nextUntitledLabelIndex += 1;
        return label;
    }

    // Insert/update a workspace and keep tab ordering stable.
    function upsertWorkspace(workspace) {
        if (!workspace || !workspace.graphId) {
            return;
        }
        state.workspaces.byId[workspace.graphId] = workspace;
        if (state.workspaces.orderedIds.indexOf(workspace.graphId) === -1) {
            state.workspaces.orderedIds.push(workspace.graphId);
        }
    }

    // Persist in-memory view state back into the active workspace entry.
    function syncActiveWorkspaceFromState() {
        const workspace = getActiveWorkspace();
        if (!workspace) {
            return;
        }
        workspace.graph = toGraphState(state.graph);
        workspace.graphOriginal = toGraphState(state.graphOriginal) || workspace.graphOriginal || null;
        workspace.selectedNodeId = state.selectedNodeId ? String(state.selectedNodeId) : null;
        workspace.queryUI = cloneQueryUI(state.queryUI);
        workspace.activeVisualizer = normalizeVisualizer(state.activeVisualizer);
        workspace.isDirected = normalizeDirected(state.isDirected);
    }

    // Restore app state when switching to a different workspace tab.
    function hydrateStateFromWorkspace(workspace) {
        if (!workspace) {
            return;
        }
        state.activeGraphId = workspace.graphId;
        state.graph = toGraphState(workspace.graph);
        state.graphOriginal = toGraphState(workspace.graphOriginal) || toGraphState(workspace.graph);
        state.selectedNodeId = workspace.selectedNodeId ? String(workspace.selectedNodeId) : null;
        state.queryUI = cloneQueryUI(workspace.queryUI);
        state.activeVisualizer = normalizeVisualizer(workspace.activeVisualizer);
        state.isDirected = normalizeDirected(workspace.isDirected);
    }

    // Reset app state when no workspace is active.
    function clearActiveWorkspaceState() {
        state.activeGraphId = null;
        state.graph = null;
        state.graphOriginal = null;
        state.selectedNodeId = null;
        state.queryUI = createDefaultQueryUI();
        state.activeVisualizer = DEFAULT_VISUALIZER;
        state.isDirected = DEFAULT_DIRECTED;
        state.graphFetchStatus = "idle";
        state.graphFetchErrorMessage = null;
        state.graphFetchLastLoadedAt = null;
        state.graphFetchMeta = null;
        queryUIController.clearFilterErrorHideTimeout();
        queryUIController.hideFilterErrorMessage();
        resetTreeState();
        resetVisualizerRenderState("idle", null);
    }

    // Switch active workspace and trigger a fresh visualizer render.
    function setActiveWorkspace(graphId) {
        const nextWorkspace = getWorkspaceById(graphId);
        if (!nextWorkspace) {
            return;
        }

        const isSameWorkspace = state.activeGraphId === graphId;
        if (!isSameWorkspace) {
            syncActiveWorkspaceFromState();
            hydrateStateFromWorkspace(nextWorkspace);
            resetTreeState();
        }

        queryUIController.clearFilterErrorHideTimeout();
        queryUIController.hideFilterErrorMessage();
        resetVisualizerRenderState("idle", null);
        renderAll();
        if (hasLoadedGraph()) {
            loadVisualizerOutput();
        }
    }

    // Close a workspace and activate a nearby fallback workspace if available.
    function removeWorkspace(graphId) {
        if (!graphId || state.workspaces.orderedIds.indexOf(graphId) === -1) {
            return;
        }

        syncActiveWorkspaceFromState();

        const workspaceIndex = state.workspaces.orderedIds.indexOf(graphId);
        const fallbackGraphId =
            state.workspaces.orderedIds[workspaceIndex + 1] ||
            state.workspaces.orderedIds[workspaceIndex - 1] ||
            null;

        delete state.workspaces.byId[graphId];
        state.workspaces.orderedIds.splice(workspaceIndex, 1);

        if (state.activeGraphId !== graphId) {
            renderAll();
            return;
        }

        if (fallbackGraphId && getWorkspaceById(fallbackGraphId)) {
            setActiveWorkspace(fallbackGraphId);
            return;
        }

        clearActiveWorkspaceState();
        renderAll();
    }

    // Map fetch errors to a safe, user-facing message fragment.
    function getGraphFetchErrorMessage(error) {
        if (error && typeof error.message === "string" && error.message.trim()) {
            return error.message.trim();
        }
        return "Unexpected error.";
    }

    // Cancel pending auto-hide for success banner when status changes early.
    function clearGraphFetchSuccessHideTimeout() {
        if (graphFetchSuccessHideTimeoutId !== null) {
            clearTimeout(graphFetchSuccessHideTimeoutId);
            graphFetchSuccessHideTimeoutId = null;
        }
    }

    // True when a workspace graph is available for rendering/query actions.
    function hasLoadedGraph() {
        return Boolean(state.activeGraphId) && isValidGraphShape(state.graph);
    }

    // Clear visualizer render cache/status before a new render cycle.
    function resetVisualizerRenderState(status, errorMessage) {
        state.visualizerRender.status = status || "idle";
        state.visualizerRender.errorMessage = errorMessage || null;
        state.visualizerRender.html = "";
        state.visualizerRender.renderedGraphId = null;
        state.visualizerRender.renderedVisualizerId = null;
        state.visualizerRender.renderedIsDirected = null;
    }

    // Reset Tree View expansion cache when graph/workspace changes.
    function resetTreeState() {
        treeViewController.resetState();
    }

    // Load datasource plugin options from backend registry discovery.
    async function loadDatasourcePlugins() {
        state.datasourcePluginsStatus = "loading";
        state.datasourcePluginsErrorMessage = null;
        renderAll();

        try {
            const datasourcePlugins = await apiClient.loadDatasourcePlugins();
            state.datasourcePlugins = Array.isArray(datasourcePlugins) ? datasourcePlugins : [];
            const hasSelectedDatasource = state.datasourcePlugins.some(function (plugin) {
                return plugin && plugin.id === state.selectedDatasourcePlugin;
            });
            if (!hasSelectedDatasource) {
                state.selectedDatasourcePlugin = "";
            }
            state.datasourcePluginsStatus = "success";
            state.datasourcePluginsErrorMessage = null;
        } catch (error) {
            console.warn(`Graph Explorer: unable to load ${apiEndpoints.datasourcePlugins}.`, error);
            state.datasourcePlugins = [];
            state.selectedDatasourcePlugin = "";
            state.datasourcePluginsStatus = "error";
            state.datasourcePluginsErrorMessage =
                `Failed to load datasource plugins (${getDatasourcePluginFetchErrorMessage(error)})`;
        }

        renderAll();
    }

    // Upload a graph file, create/update workspace state, and activate it.
    async function loadGraphData(file) {
        if (file && file.name) {
            state.selectedUploadFilename = file.name;
        }

        if (!file) {
            state.graphFetchStatus = "error";
            state.graphFetchErrorMessage = "Please choose a JSON or CSV file before loading.";
            state.graphFetchLastLoadedAt = null;
            state.graphFetchMeta = null;
            renderAll();
            return;
        }

        const selectedDatasourcePlugin = state.selectedDatasourcePlugin
            ? String(state.selectedDatasourcePlugin).trim()
            : "";
        if (!selectedDatasourcePlugin) {
            state.graphFetchStatus = "error";
            state.graphFetchErrorMessage = "Please choose a datasource plugin before loading.";
            state.graphFetchLastLoadedAt = null;
            state.graphFetchMeta = null;
            renderAll();
            return;
        }

        clearGraphFetchSuccessHideTimeout();
        syncActiveWorkspaceFromState();
        state.graphFetchStatus = "loading";
        state.graphFetchErrorMessage = null;
        state.graphFetchMeta = null;
        renderAll();

        try {
            const payload = await apiClient.loadGraphFile(file, selectedDatasourcePlugin);
            const graphState = toGraphState(payload.graph);
            if (!graphState) {
                throw new Error("Invalid graph payload.");
            }
            const graphId = payload.graphId;

            const metadata = payload.meta && typeof payload.meta === "object" ? payload.meta : {};
            const filenameFromMeta = typeof metadata.filename === "string" ? metadata.filename.trim() : "";
            const filename = filenameFromMeta || (file && file.name ? String(file.name).trim() : "");
            const existingWorkspace = getWorkspaceById(graphId);
            const workspace = {
                graphId: graphId,
                label: existingWorkspace && existingWorkspace.label ? existingWorkspace.label : getWorkspaceLabel(filename),
                filename: filename || null,
                graph: graphState,
                graphOriginal: graphState,
                selectedNodeId: null,
                queryUI: createDefaultQueryUI(),
                activeVisualizer: existingWorkspace
                    ? normalizeVisualizer(existingWorkspace.activeVisualizer)
                    : normalizeVisualizer(state.activeVisualizer),
                isDirected: existingWorkspace
                    ? normalizeDirected(existingWorkspace.isDirected)
                    : normalizeDirected(state.isDirected)
            };
            upsertWorkspace(workspace);

            state.graphFetchStatus = "success";
            state.graphFetchErrorMessage = null;
            state.graphFetchLastLoadedAt = Date.now();
            state.graphFetchMeta = payload.meta || null;
            setActiveWorkspace(graphId);

            graphFetchSuccessHideTimeoutId = setTimeout(function () {
                if (state.graphFetchStatus === "success") {
                    state.graphFetchStatus = "idle";
                    renderAll();
                }
                graphFetchSuccessHideTimeoutId = null;
            }, SUCCESS_STATUS_AUTO_HIDE_MS);
        } catch (error) {
            console.warn(`Graph Explorer: unable to load ${apiEndpoints.graphLoad}.`, error);

            state.graphFetchStatus = "error";
            state.graphFetchErrorMessage = `Failed to load graph (${getGraphFetchErrorMessage(error)})`;
            state.graphFetchLastLoadedAt = null;
            state.graphFetchMeta = null;
            renderAll();
        }
    }

    // Escape text values before injecting labels into Tree View markup.
    function escapeHtml(value) {
        return String(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    // Return current graph nodes, or an empty list when graph is unavailable.
    function getNodes() {
        if (!state.graph || !Array.isArray(state.graph.nodes)) {
            return [];
        }
        return state.graph.nodes;
    }

    // Return current graph edges, or an empty list when graph is unavailable.
    function getEdges() {
        if (!state.graph || !Array.isArray(state.graph.edges)) {
            return [];
        }
        return state.graph.edges;
    }

    // Remove Bird View listeners/observers tied to the previous iframe output.
    function clearBirdScrollSync() {
        birdViewController.clearSyncBindings();
    }

    // Cancel any queued Bird View viewport update callback.
    function clearBirdViewportUpdateSchedule() {
        birdViewController.clearScheduledUpdate();
    }

    // Keep Bird View geometry, viewport frame, and selected node in sync with Main View.
    function refreshBirdViewportAndFocus(context) {
        birdViewController.refreshViewportAndFocus(context);
    }

    // Attach one scroll listener and one SVG observer for efficient Bird View updates.
    function bindBirdViewportSync() {
        birdViewController.bindViewportSync();
    }

    // Ensure Bird iframe listeners are installed once.
    function bindBirdIframeLifecycle() {
        birdViewController.bindIframeLifecycle();
    }

    // Rebuild Bird View iframe content from current Main View iframe output.
    function renderBirdMinimapFromIframe() {
        birdViewController.renderFromMainIframe();
    }

    // Find a node by id in the currently loaded graph.
    function getNodeById(nodeId) {
        const nodes = getNodes();
        for (let i = 0; i < nodes.length; i += 1) {
            if (nodes[i] && String(nodes[i].id) === String(nodeId)) {
                return nodes[i];
            }
        }
        return null;
    }

    // Drop stale selection when the selected node is no longer in graph data.
    function syncSelectedNode() {
        if (state.selectedNodeId && !getNodeById(state.selectedNodeId)) {
            state.selectedNodeId = null;
        }
    }

    // Send a command message to the Main View iframe, optionally with one retry.
    function postMessageToIframe(message, withRetry) {
        const iframe = document.getElementById("main-view-visualizer-iframe");
        if (!iframe || !iframe.contentWindow) {
            return;
        }
        iframe.contentWindow.postMessage(message, "*");

        if (!withRetry) {
            return;
        }

        // Retry once so selection/focus survives iframe reload timing.
        setTimeout(function () {
            const iframeRetry = document.getElementById("main-view-visualizer-iframe");
            if (!iframeRetry || !iframeRetry.contentWindow) {
                return;
            }
            iframeRetry.contentWindow.postMessage(message, "*");
        }, 120);
    }

    // Sync selected node (and optional focus) into the visualizer iframe.
    function postSelectedNodeToIframe() {
        postMessageToIframe(
            {
                type: "selectNode",
                nodeId: state.selectedNodeId
            },
            true
        );

        if (state.selectedNodeId) {
            postMessageToIframe(
                {
                    type: "focusNode",
                    nodeId: state.selectedNodeId
                },
                true
            );
        }
    }

    // Update selected node in shared state and notify visualizer iframe.
    function setSelectedNode(nodeId) {
        const nextNodeId = nodeId ? String(nodeId) : null;
        if (state.selectedNodeId === nextNodeId) {
            return;
        }
        state.selectedNodeId = nextNodeId;
        renderAll();
        postSelectedNodeToIframe();
    }

    // Change visualizer mode and re-render current graph with selected plugin.
    function setActiveVisualizer(mode) {
        if (mode !== "simple" && mode !== "block") {
            return;
        }
        if (state.activeVisualizer === mode) {
            return;
        }
        state.activeVisualizer = mode;
        renderAll();
        if (hasLoadedGraph()) {
            loadVisualizerOutput();
        }
    }

    // Toggle directed/undirected mode and refresh current visualizer output.
    function setDirectedMode(isDirected) {
        const normalized = Boolean(isDirected);
        if (state.isDirected === normalized) {
            return;
        }
        state.isDirected = normalized;
        renderAll();
        if (hasLoadedGraph()) {
            loadVisualizerOutput();
        }
    }

    function getDatasourcePluginFetchErrorMessage(error) {
        if (error && typeof error.message === "string" && error.message.trim()) {
            return error.message.trim();
        }
        return "Unexpected error.";
    }

    // Build datasource plugin dropdown option labels.
    function getDatasourcePluginOptionLabel(plugin) {
        if (!plugin || typeof plugin !== "object") {
            return "";
        }

        const pluginId = typeof plugin.id === "string" ? plugin.id.trim() : "";
        const pluginName = typeof plugin.name === "string" ? plugin.name.trim() : "";
        const extensions = Array.isArray(plugin.extensions) ? plugin.extensions : [];
        const extensionLabel = extensions.length ? ` [${extensions.join(", ")}]` : "";
        if (pluginName && pluginName !== pluginId) {
            return `${pluginName} (${pluginId})${extensionLabel}`;
        }
        return `${pluginId}${extensionLabel}`;
    }

    function getDatasourcePluginStatusLabel() {
        if (state.datasourcePluginsStatus === "loading") {
            return "Loading datasource plugins...";
        }
        if (state.datasourcePluginsStatus === "error") {
            return state.datasourcePluginsErrorMessage || "Failed to load datasource plugins.";
        }
        if (!state.datasourcePlugins.length) {
            return "No datasource plugins discovered.";
        }
        if (!state.selectedDatasourcePlugin) {
            return "";
        }

        const selectedPlugin = state.datasourcePlugins.find(function (plugin) {
            return plugin && plugin.id === state.selectedDatasourcePlugin;
        });
        if (!selectedPlugin) {
            return `Datasource plugin: ${state.selectedDatasourcePlugin}`;
        }
        return `Datasource plugin: ${getDatasourcePluginOptionLabel(selectedPlugin)}`;
    }

    function renderDatasourcePluginSelect(selectElement) {
        if (!selectElement) {
            return;
        }

        const selectedDatasourcePlugin = state.selectedDatasourcePlugin || "";
        const placeholderLabel = state.datasourcePluginsStatus === "loading"
            ? "Loading datasource plugins..."
            : "Select datasource plugin";

        selectElement.innerHTML = "";

        const placeholderOption = document.createElement("option");
        placeholderOption.value = "";
        placeholderOption.textContent = placeholderLabel;
        selectElement.appendChild(placeholderOption);

        state.datasourcePlugins.forEach(function (plugin) {
            const option = document.createElement("option");
            option.value = plugin.id;
            option.textContent = getDatasourcePluginOptionLabel(plugin);
            selectElement.appendChild(option);
        });

        selectElement.value = selectedDatasourcePlugin;
        if (selectElement.value !== selectedDatasourcePlugin) {
            state.selectedDatasourcePlugin = "";
        }

        selectElement.disabled =
            state.graphFetchStatus === "loading" ||
            state.datasourcePluginsStatus === "loading" ||
            state.datasourcePlugins.length === 0;
    }

    // Resolve file upload controls used by load/render workflow.
    function getFileInputElements() {
        return {
            fileInput: document.getElementById("graph-file-input"),
            loadButton: document.getElementById("load-graph-button"),
            datasourceSelect: document.getElementById("datasource-plugin-select"),
            datasourceStatus: document.getElementById("datasource-plugin-status"),
            selectedFileName: document.getElementById("selected-file-name"),
            status: document.getElementById("file-load-status")
        };
    }

    // Resolve console input/output controls for query CLI panel.
    function getConsoleElements() {
        return {
            commandInput: document.getElementById("console-command-input"),
            runButton: document.getElementById("console-run-button"),
            clearButton: document.getElementById("console-clear-button"),
            output: document.getElementById("console-output"),
            outputEmpty: document.getElementById("console-output-empty")
        };
    }

    // Resolve console dock container/toggle controls.
    function getConsoleDockElements() {
        return {
            dock: document.getElementById("console-dock"),
            toggleButton: document.getElementById("console-toggle-button")
        };
    }

    // Resolve upload/render status banner controls.
    function getGraphFetchStatusElements() {
        return {
            banner: document.getElementById("graph-fetch-status"),
            message: document.getElementById("graph-fetch-status-message"),
            retryButton: document.getElementById("graph-fetch-retry-button")
        };
    }

    // Build the status banner label from graph fetch/render state.
    function getGraphFetchStatusLabel() {
        if (state.graphFetchStatus === "loading") {
            return "Uploading and parsing graph...";
        }
        if (state.graphFetchStatus === "error") {
            return state.graphFetchErrorMessage || "Failed to load graph.";
        }
        if (hasLoadedGraph() && state.visualizerRender.status === "loading") {
            return "Rendering graph...";
        }
        if (hasLoadedGraph() && state.visualizerRender.status === "error") {
            return state.visualizerRender.errorMessage || "Failed to render graph.";
        }
        if (state.graphFetchStatus === "success") {
            const meta = state.graphFetchMeta || {};
            const nodeCount = Number.isFinite(meta.node_count) ? meta.node_count : getNodes().length;
            const edgeCount = Number.isFinite(meta.edge_count) ? meta.edge_count : getEdges().length;
            const filenamePart = meta.filename ? ` from ${meta.filename}` : "";
            if (state.graphFetchLastLoadedAt) {
                const loadedAt = new Date(state.graphFetchLastLoadedAt);
                if (!Number.isNaN(loadedAt.getTime())) {
                    return `Graph loaded${filenamePart} (${nodeCount} nodes, ${edgeCount} edges at ${loadedAt.toLocaleTimeString()}).`;
                }
            }
            return `Graph loaded${filenamePart} (${nodeCount} nodes, ${edgeCount} edges).`;
        }
        return "";
    }

    // Pick status banner tone class from current fetch/render state.
    function getGraphFetchStatusTone() {
        if (state.graphFetchStatus === "loading") {
            return "loading";
        }
        if (state.graphFetchStatus === "error") {
            return "error";
        }
        if (hasLoadedGraph() && state.visualizerRender.status === "loading") {
            return "loading";
        }
        if (hasLoadedGraph() && state.visualizerRender.status === "error") {
            return "error";
        }
        if (state.graphFetchStatus === "success") {
            return "success";
        }
        return "idle";
    }

    // Render graph fetch/render banner and retry button availability.
    function renderGraphFetchStatus() {
        const refs = getGraphFetchStatusElements();
        if (!refs.banner || !refs.message) {
            return;
        }

        const statusLabel = getGraphFetchStatusLabel();
        const statusTone = getGraphFetchStatusTone();
        const isVisible = Boolean(statusLabel);
        refs.banner.classList.toggle("is-hidden", !isVisible);
        refs.banner.classList.remove("is-idle", "is-loading", "is-success", "is-error");
        if (isVisible) {
            refs.banner.classList.add(`is-${statusTone}`);
        }
        refs.message.textContent = statusLabel;

        if (refs.retryButton) {
            const canRetryLoad = state.graphFetchStatus === "error" && Boolean(state.selectedUploadFile);
            const canRetryRender = state.graphFetchStatus !== "loading" && state.visualizerRender.status === "error" && hasLoadedGraph();
            const canRetry = canRetryLoad || canRetryRender;
            refs.retryButton.hidden = !canRetry;
            refs.retryButton.disabled = state.graphFetchStatus === "loading";
        }
    }

    // Wire retry button to either graph upload retry or render retry.
    function bindGraphFetchControls() {
        const refs = getGraphFetchStatusElements();
        if (!refs.retryButton) {
            return;
        }
        refs.retryButton.addEventListener("click", function () {
            if (state.graphFetchStatus === "error") {
                loadGraphData(state.selectedUploadFile);
                return;
            }
            if (state.visualizerRender.status === "error" && hasLoadedGraph()) {
                loadVisualizerOutput();
            }
        });
    }

    // Build the file-upload helper/status line under the file picker.
    function getFileLoadStatusLabel() {
        if (!state.selectedDatasourcePlugin) {
            return "";
        }
        if (!state.selectedUploadFile) {
            return "";
        }
        if (state.graphFetchStatus === "loading") {
            return `Uploading ${state.selectedUploadFilename}...`;
        }
        if (state.graphFetchStatus === "success") {
            const graphIdLabel = state.activeGraphId ? `graph_id ${state.activeGraphId}` : "graph loaded";
            return `Loaded ${state.selectedUploadFilename} (${graphIdLabel}).`;
        }
        if (state.graphFetchStatus === "error") {
            return state.graphFetchErrorMessage || "Failed to load graph.";
        }
        return `Selected file: ${state.selectedUploadFilename}`;
    }

    // Render file picker labels/buttons from current upload state.
    function renderFileInputState() {
        const refs = getFileInputElements();
        renderDatasourcePluginSelect(refs.datasourceSelect);

        if (refs.datasourceStatus) {
            const datasourceStatusLabel = getDatasourcePluginStatusLabel();
            refs.datasourceStatus.textContent = datasourceStatusLabel;
            refs.datasourceStatus.hidden = !datasourceStatusLabel;
            const hasDatasourceError =
                state.datasourcePluginsStatus === "error" ||
                (state.datasourcePluginsStatus === "success" && state.datasourcePlugins.length === 0);
            refs.datasourceStatus.classList.toggle("is-error", hasDatasourceError);
        }

        if (refs.selectedFileName) {
            const selectedFileNameLabel = state.selectedUploadFile
                ? state.selectedUploadFilename
                : "";
            refs.selectedFileName.textContent = selectedFileNameLabel;
            refs.selectedFileName.hidden = !selectedFileNameLabel;
        }

        if (refs.status) {
            const fileLoadStatusLabel = getFileLoadStatusLabel();
            refs.status.textContent = fileLoadStatusLabel;
            refs.status.hidden = !fileLoadStatusLabel;
        }

        if (refs.loadButton) {
            refs.loadButton.disabled =
                state.graphFetchStatus === "loading" ||
                !state.selectedUploadFile ||
                !state.selectedDatasourcePlugin;
        }
    }

    // Bind file picker change/enter/load events to graph loading flow.
    function bindFileInputControls() {
        const refs = getFileInputElements();
        if (!refs.fileInput) {
            return;
        }

        if (refs.datasourceSelect) {
            refs.datasourceSelect.addEventListener("change", function (event) {
                const selectedValue = event.target && typeof event.target.value === "string"
                    ? event.target.value.trim()
                    : "";
                state.selectedDatasourcePlugin = selectedValue;
                clearGraphFetchSuccessHideTimeout();
                if (state.graphFetchStatus === "success") {
                    state.graphFetchStatus = "idle";
                }
                renderAll();
            });
        }

        refs.fileInput.addEventListener("change", function (event) {
            const selectedFile = event.target.files && event.target.files[0] ? event.target.files[0] : null;
            state.selectedUploadFile = selectedFile;
            state.selectedUploadFilename = selectedFile ? selectedFile.name : "";
            clearGraphFetchSuccessHideTimeout();
            state.graphFetchStatus = "idle";
            state.graphFetchErrorMessage = null;
            state.graphFetchLastLoadedAt = null;
            state.graphFetchMeta = null;
            renderAll();
        });

        if (refs.loadButton) {
            refs.loadButton.addEventListener("click", function () {
                loadGraphData(state.selectedUploadFile);
            });
        }

        refs.fileInput.addEventListener("keydown", function (event) {
            if (event.key === "Enter") {
                event.preventDefault();
                loadGraphData(state.selectedUploadFile);
            }
        });
    }

    // Resolve Main View status/error/output container elements.
    function getMainViewElements() {
        return {
            status: document.getElementById("main-view-render-status"),
            error: document.getElementById("main-view-render-error"),
            output: document.getElementById("main-view-visualizer-output")
        };
    }

    // Map visualizer render errors to a concise UI-safe message.
    function getVisualizerRenderErrorMessage(error) {
        if (error && typeof error.message === "string" && error.message.trim()) {
            return error.message.trim();
        }
        return "Unexpected error.";
    }

    // Return transient render status text shown above Main View.
    function getVisualizerRenderStatusLabel() {
        if (state.visualizerRender.status === "loading") {
            return "Rendering...";
        }
        return "";
    }

    // Request HTML output for current graph/visualizer settings.
    async function loadVisualizerOutput() {
        if (!hasLoadedGraph()) {
            resetVisualizerRenderState("idle", null);
            renderAll();
            return;
        }

        const visualizerId = state.activeVisualizer;
        const isDirected = state.isDirected;
        const graphId = state.activeGraphId;
        const requestId = visualizerRenderRequestSequence + 1;
        visualizerRenderRequestSequence = requestId;

        state.visualizerRender.status = "loading";
        state.visualizerRender.errorMessage = null;
        state.visualizerRender.html = "";
        state.visualizerRender.renderedGraphId = null;
        state.visualizerRender.renderedVisualizerId = null;
        state.visualizerRender.renderedIsDirected = null;
        renderAll();

        try {
            const html = await apiClient.loadVisualizerOutput(visualizerId, isDirected, graphId);

            if (requestId !== visualizerRenderRequestSequence) {
                return;
            }

            state.visualizerRender.status = "success";
            state.visualizerRender.errorMessage = null;
            state.visualizerRender.html = html;
            state.visualizerRender.renderedGraphId = graphId;
            state.visualizerRender.renderedVisualizerId = visualizerId;
            state.visualizerRender.renderedIsDirected = isDirected;
            renderAll();
        } catch (error) {
            if (requestId !== visualizerRenderRequestSequence) {
                return;
            }

            state.visualizerRender.status = "error";
            state.visualizerRender.errorMessage =
                `Failed to render ${visualizerId} visualizer (${getVisualizerRenderErrorMessage(error)})`;
            state.visualizerRender.html = "";
            state.visualizerRender.renderedGraphId = null;
            state.visualizerRender.renderedVisualizerId = null;
            state.visualizerRender.renderedIsDirected = null;
            renderAll();
        }
    }

    // Keep bounded console command history.
    function pushConsoleHistory(command) {
        state.consoleUI.history.unshift(command);
        if (state.consoleUI.history.length > state.consoleUI.maxHistory) {
            state.consoleUI.history = state.consoleUI.history.slice(0, state.consoleUI.maxHistory);
        }
    }

    // Keep bounded console output lines, newest first.
    function pushConsoleOutputLine(line) {
        state.consoleUI.outputLines.unshift(line);
        if (state.consoleUI.outputLines.length > state.consoleUI.maxOutputLines) {
            state.consoleUI.outputLines = state.consoleUI.outputLines.slice(0, state.consoleUI.maxOutputLines);
        }
    }

    // Render console input and output panel from `state.consoleUI`.
    function renderConsole() {
        const refs = getConsoleElements();

        if (refs.commandInput && refs.commandInput.value !== state.consoleUI.currentInput) {
            refs.commandInput.value = state.consoleUI.currentInput;
        }

        if (refs.output) {
            refs.output.innerHTML = "";
            state.consoleUI.outputLines.forEach(function (line) {
                const lineEl = document.createElement("p");
                lineEl.className = "console-output-line";
                lineEl.textContent = line;
                refs.output.appendChild(lineEl);
            });
        }

        if (refs.outputEmpty) {
            refs.outputEmpty.style.display = state.consoleUI.outputLines.length ? "none" : "";
        }
    }

    // Render dock collapsed/expanded state and toggle accessibility attrs.
    function renderConsoleDockState() {
        const refs = getConsoleDockElements();
        if (!refs.dock || !refs.toggleButton) {
            return;
        }
        refs.dock.classList.toggle("is-collapsed", state.consoleUI.isCollapsed);
        refs.toggleButton.textContent = state.consoleUI.isCollapsed ? "Open" : "Hide";
        refs.toggleButton.setAttribute("aria-expanded", String(!state.consoleUI.isCollapsed));
    }

    // Execute a CLI command through API and refresh graph-dependent views.
    async function handleRunConsoleCommand() {
        const command = state.consoleUI.currentInput.trim();
        if (!command) {
            return;
        }

        pushConsoleHistory(command);
        pushConsoleOutputLine(`> ${command}`);
        state.consoleUI.currentInput = "";
        renderConsole();

        const result = await apiClient.postJsonRequest(apiEndpoints.cliExecute, {
            graph_id: state.activeGraphId || null,
            command: command
        });
        pushConsoleOutputLine(result.message);
        renderConsole();

        // Refresh all graph-dependent UI panels after successful CLI command.
        if (result.ok && result.payload && result.payload.graph) {
            const newGraph = result.payload.graph;
            if (isValidGraphShape(newGraph)) {
                state.graph = toGraphState(newGraph);
                renderAll();
                loadVisualizerOutput();
            }
        }
    }

    // Clear interactive console input/history/output.
    function clearConsoleState() {
        state.consoleUI.currentInput = "";
        state.consoleUI.history = [];
        state.consoleUI.outputLines = [];
        renderConsole();
    }

    // Bind console input/run/clear controls.
    function bindConsoleControls() {
        const refs = getConsoleElements();
        if (!refs.commandInput) {
            return;
        }

        refs.commandInput.addEventListener("input", function (event) {
            state.consoleUI.currentInput = event.target.value;
        });

        refs.commandInput.addEventListener("keydown", function (event) {
            if (event.key === "Enter") {
                event.preventDefault();
                handleRunConsoleCommand();
            }
        });

        if (refs.runButton) {
            refs.runButton.addEventListener("click", function () {
                handleRunConsoleCommand();
            });
        }

        if (refs.clearButton) {
            refs.clearButton.addEventListener("click", function () {
                clearConsoleState();
            });
        }
    }

    // Bind dock toggle button for the console panel.
    function bindConsoleDockControls() {
        const refs = getConsoleDockElements();
        if (!refs.toggleButton) {
            return;
        }
        refs.toggleButton.addEventListener("click", function () {
            state.consoleUI.isCollapsed = !state.consoleUI.isCollapsed;
            renderConsoleDockState();
        });
    }

    // Create/update Main View iframe and attach Bird View sync hooks.
    function renderVisualizerIframe(container, html) {
        if (!container) {
            return;
        }

        let iframe = container.querySelector("#main-view-visualizer-iframe");
        if (!iframe) {
            iframe = document.createElement("iframe");
            iframe.id = "main-view-visualizer-iframe";
            iframe.title = "Main visualizer output";
            iframe.setAttribute("loading", "lazy");
            iframe.style.width = "100%";
            iframe.style.height = "100%";
            iframe.style.border = "0";
            iframe.addEventListener("load", function () {
                bindBirdViewportSync();
                renderBirdMinimapFromIframe();
                refreshBirdViewportAndFocus();
                postSelectedNodeToIframe();
            });
            container.appendChild(iframe);
        }

        if (iframe.srcdoc !== html) {
            iframe.srcdoc = html;
        }
    }

    // Accept node selection messages from Main View iframe and sync state.
    function bindIframeSelectionMessages() {
        window.addEventListener("message", function (event) {
            const message = event.data;
            if (!message || typeof message !== "object") {
                return;
            }

            if (message.type !== "nodeSelected" && message.type !== "selectNode") {
                return;
            }

            if (message.nodeId === undefined || message.nodeId === null) {
                return;
            }

            const mainIframe = document.getElementById("main-view-visualizer-iframe");
            const isFromMainIframe = Boolean(mainIframe && mainIframe.contentWindow && event.source === mainIframe.contentWindow);
            if (!isFromMainIframe) {
                return;
            }

            setSelectedNode(String(message.nodeId));
        });
    }

    // Render Main View status/error and inject latest visualizer iframe output.
    function renderMainView() {
        const refs = getMainViewElements();
        if (!refs.output) {
            return;
        }

        if (refs.status) {
            const statusLabel = getVisualizerRenderStatusLabel();
            refs.status.textContent = statusLabel;
            refs.status.hidden = !statusLabel;
        }

        if (refs.error) {
            const showError = state.visualizerRender.status === "error" && Boolean(state.visualizerRender.errorMessage);
            refs.error.textContent = showError ? state.visualizerRender.errorMessage : "";
            refs.error.hidden = !showError;
        }

        const canRenderVisualizer =
            hasLoadedGraph() &&
            state.visualizerRender.status === "success" &&
            state.visualizerRender.renderedGraphId === state.activeGraphId &&
            state.visualizerRender.renderedVisualizerId === state.activeVisualizer &&
            state.visualizerRender.renderedIsDirected === state.isDirected &&
            Boolean(state.visualizerRender.html);

        if (!canRenderVisualizer) {
            refs.output.innerHTML = "";
        } else {
            renderVisualizerIframe(refs.output, state.visualizerRender.html);
        }
    }

    // Delegate Tree View rendering to its controller.
    function renderTreeView() {
        treeViewController.render();
    }

    // Bind Tree View event handlers once at startup.
    function bindTreeViewInteractions() {
        treeViewController.bindInteractions();
    }

    // Keep Bird View iframe synchronized with current Main View output/state.
    function renderBirdView() {
        bindBirdIframeLifecycle();
        if (!hasLoadedGraph()) {
            clearBirdScrollSync();
            clearBirdViewportUpdateSchedule();
            const birdIframe = document.getElementById("bird-view-iframe");
            if (birdIframe) {
                birdIframe.setAttribute("srcdoc", "");
            }
            return;
        }

        renderBirdMinimapFromIframe();
        refreshBirdViewportAndFocus();
    }

    // Render visualizer tab/toggle controls from top-level app state.
    function renderUIState() {
        const buttons = document.querySelectorAll("#visualizer-controls .tab-button[data-visualizer]");
        buttons.forEach(function (button) {
            const visualizerId = button.getAttribute("data-visualizer");
            const isActive = visualizerId === state.activeVisualizer;
            button.classList.toggle("active", isActive);
            button.setAttribute("aria-selected", String(isActive));
        });

        const panelNote = document.getElementById("visualizer-panel-note");
        if (panelNote) {
            panelNote.textContent = `Active visualizer: ${state.activeVisualizer} (${state.isDirected ? "directed" : "undirected"})`;
        }

        const directedToggle = document.getElementById("directed-toggle");
        if (directedToggle && directedToggle.checked !== state.isDirected) {
            directedToggle.checked = state.isDirected;
        }
    }

    // Bind visualizer mode and directed toggle controls.
    function bindVisualizerTabClicks() {
        const buttons = document.querySelectorAll("#visualizer-controls .tab-button[data-visualizer]");
        buttons.forEach(function (button) {
            button.addEventListener("click", function () {
                const visualizerId = button.getAttribute("data-visualizer");
                setActiveVisualizer(visualizerId);
            });
        });

        const directedToggle = document.getElementById("directed-toggle");
        if (directedToggle) {
            directedToggle.addEventListener("change", function (event) {
                setDirectedMode(Boolean(event.target.checked));
            });
        }
    }

    // Single render entry point; updates all UI sections from current state.
    function renderAll() {
        syncSelectedNode();
        syncActiveWorkspaceFromState();
        renderUIState();
        renderFileInputState();
        workspaceUIController.renderWorkspaceSelector();
        renderGraphFetchStatus();
        queryUIController.renderToolbarState();
        renderConsoleDockState();
        renderConsole();
        renderMainView();
        renderTreeView();
        renderBirdView();
    }

    // Wire event handlers once and render initial empty state.
    function initializeApp() {
        queryUIController.bindToolbarControls();
        bindConsoleControls();
        bindConsoleDockControls();
        bindFileInputControls();
        workspaceUIController.bindWorkspaceSelectorControls();
        bindVisualizerTabClicks();
        bindGraphFetchControls();
        bindTreeViewInteractions();
        bindIframeSelectionMessages();
        window.addEventListener("resize", function () {
            renderBirdView();
        });
        renderAll();
        loadDatasourcePlugins();
    }

    document.addEventListener("DOMContentLoaded", initializeApp);
})();
