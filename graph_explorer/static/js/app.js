(function () {
    "use strict";

    // TODO: add D3-based rendering for the active visualizer in Main View.
    // TODO: improve focus synchronization behavior across Main/Tree/Bird interactions.
    // TODO: replace mock data state with platform/API integration payloads.
    const DEFAULT_VISUALIZER = "simple";
    const DEFAULT_DIRECTED = true;
    const DEFAULT_FILTER_OPERATOR = "==";
    const GRAPH_LOAD_ENDPOINT = "/api/graph/load/";
    const CLI_EXECUTE_ENDPOINT = "/api/cli/execute/";
    const GRAPH_SEARCH_ENDPOINT = "/api/graph/search/";
    const GRAPH_FILTER_ENDPOINT = "/api/graph/filter/";
    const VISUALIZER_RENDER_ENDPOINT = "/api/render/";
    const SUCCESS_STATUS_AUTO_HIDE_MS = 5000;
    const FILTER_ERROR_AUTO_HIDE_MS = 3500;
    const SVG_NS = "http://www.w3.org/2000/svg";
    const BIRD_VIEW_ZOOM_OUT_FACTOR = 1.25;
    let graphFetchSuccessHideTimeoutId = null;
    let filterErrorHideTimeoutId = null;
    let visualizerRenderRequestSequence = 0;
    const birdViewSync = {
        boundScrollEl: null,
        boundScrollHandler: null,
        boundMainSvg: null,
        boundMainSvgObserver: null,
        viewportUpdatePending: false,
        viewportUpdateRafId: null
    };

    const state = {
        activeVisualizer: DEFAULT_VISUALIZER,
        activeGraphId: null,
        isDirected: DEFAULT_DIRECTED,
        selectedNodeId: null,
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

    function isValidGraphShape(graph) {
        return Boolean(graph) && Array.isArray(graph.nodes) && Array.isArray(graph.edges);
    }

    function toGraphState(graph) {
        if (!isValidGraphShape(graph)) {
            return null;
        }
        return {
            nodes: graph.nodes,
            edges: graph.edges
        };
    }

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

    function upsertWorkspace(workspace) {
        if (!workspace || !workspace.graphId) {
            return;
        }
        state.workspaces.byId[workspace.graphId] = workspace;
        if (state.workspaces.orderedIds.indexOf(workspace.graphId) === -1) {
            state.workspaces.orderedIds.push(workspace.graphId);
        }
    }

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
        clearFilterErrorHideTimeout();
        hideFilterErrorMessage();
        resetTreeState();
        resetVisualizerRenderState("idle", null);
    }

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

        clearFilterErrorHideTimeout();
        hideFilterErrorMessage();
        resetVisualizerRenderState("idle", null);
        renderAll();
        if (hasLoadedGraph()) {
            loadVisualizerOutput();
        }
    }

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

    function getGraphFetchErrorMessage(error) {
        if (error && typeof error.message === "string" && error.message.trim()) {
            return error.message.trim();
        }
        return "Unexpected error.";
    }

    function clearGraphFetchSuccessHideTimeout() {
        if (graphFetchSuccessHideTimeoutId !== null) {
            clearTimeout(graphFetchSuccessHideTimeoutId);
            graphFetchSuccessHideTimeoutId = null;
        }
    }

    function hasLoadedGraph() {
        return Boolean(state.activeGraphId) && isValidGraphShape(state.graph);
    }

    function resetVisualizerRenderState(status, errorMessage) {
        state.visualizerRender.status = status || "idle";
        state.visualizerRender.errorMessage = errorMessage || null;
        state.visualizerRender.html = "";
        state.visualizerRender.renderedGraphId = null;
        state.visualizerRender.renderedVisualizerId = null;
        state.visualizerRender.renderedIsDirected = null;
    }

    function resetTreeState() {
        state.treeUI.expanded = {};
        state.treeUI.lastGraphId = null;
        state.treeUI.lastGraphSignature = "";
        state.treeUI.autoExpandedOnce = false;
    }

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

        clearGraphFetchSuccessHideTimeout();
        syncActiveWorkspaceFromState();
        state.graphFetchStatus = "loading";
        state.graphFetchErrorMessage = null;
        state.graphFetchMeta = null;
        renderAll();

        try {
            const formData = new FormData();
            formData.append("file", file);

            const response = await fetch(GRAPH_LOAD_ENDPOINT, {
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
            const graphState = toGraphState(payload.graph);
            if (!graphState) {
                throw new Error("Invalid graph payload.");
            }

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
            console.warn(`Graph Explorer: unable to load ${GRAPH_LOAD_ENDPOINT}.`, error);

            state.graphFetchStatus = "error";
            state.graphFetchErrorMessage = `Failed to load graph (${getGraphFetchErrorMessage(error)})`;
            state.graphFetchLastLoadedAt = null;
            state.graphFetchMeta = null;
            renderAll();
        }
    }

    function escapeHtml(value) {
        return String(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function getNodes() {
        if (!state.graph || !Array.isArray(state.graph.nodes)) {
            return [];
        }
        return state.graph.nodes;
    }

    function getEdges() {
        if (!state.graph || !Array.isArray(state.graph.edges)) {
            return [];
        }
        return state.graph.edges;
    }

    function clearBirdScrollSync() {
        if (birdViewSync.boundScrollEl && birdViewSync.boundScrollHandler) {
            birdViewSync.boundScrollEl.removeEventListener("scroll", birdViewSync.boundScrollHandler);
        }
        birdViewSync.boundScrollEl = null;
        birdViewSync.boundScrollHandler = null;
        birdViewSync.boundMainSvg = null;
        if (birdViewSync.boundMainSvgObserver) {
            birdViewSync.boundMainSvgObserver.disconnect();
            birdViewSync.boundMainSvgObserver = null;
        }
    }

    function clearBirdViewportUpdateSchedule() {
        if (birdViewSync.viewportUpdateRafId !== null) {
            cancelAnimationFrame(birdViewSync.viewportUpdateRafId);
        }
        birdViewSync.viewportUpdatePending = false;
        birdViewSync.viewportUpdateRafId = null;
    }

    function getMainVisualizerContext() {
        const iframe = document.getElementById("main-view-visualizer-iframe");
        if (!iframe || !iframe.contentDocument) {
            return null;
        }

        const iframeDoc = iframe.contentDocument;
        const mainSvg = iframeDoc.getElementById("viz-svg");
        const scrollEl = iframeDoc.getElementById("viz-scroll");
        if (!mainSvg || !scrollEl) {
            return null;
        }

        const viewBox = mainSvg.viewBox && mainSvg.viewBox.baseVal ? mainSvg.viewBox.baseVal : null;
        let width = parseFloat(mainSvg.getAttribute("width") || "");
        let height = parseFloat(mainSvg.getAttribute("height") || "");

        if ((!Number.isFinite(width) || width <= 0) && viewBox) {
            width = Number(viewBox.width);
        }
        if ((!Number.isFinite(height) || height <= 0) && viewBox) {
            height = Number(viewBox.height);
        }

        if (!Number.isFinite(width) || width <= 0) {
            width = Number(scrollEl.scrollWidth);
        }
        if (!Number.isFinite(height) || height <= 0) {
            height = Number(scrollEl.scrollHeight);
        }

        if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
            return null;
        }

        return {
            iframe: iframe,
            iframeDoc: iframeDoc,
            mainSvg: mainSvg,
            scrollEl: scrollEl,
            width: width,
            height: height
        };
    }

    function getMainZoomScale(context) {
        const sourceContext = context || getMainVisualizerContext();
        if (!sourceContext || !sourceContext.mainSvg) {
            return 1;
        }

        const candidates = [
            sourceContext.mainSvg.getAttribute("data-zoom-scale"),
            sourceContext.mainSvg.dataset ? sourceContext.mainSvg.dataset.zoomScale : null,
            sourceContext.iframeDoc && sourceContext.iframeDoc.documentElement
                ? sourceContext.iframeDoc.documentElement.getAttribute("data-zoom-scale")
                : null,
            sourceContext.iframeDoc && sourceContext.iframeDoc.body
                ? sourceContext.iframeDoc.body.getAttribute("data-zoom-scale")
                : null
        ];

        for (let i = 0; i < candidates.length; i += 1) {
            const parsed = parseFloat(candidates[i] || "");
            if (Number.isFinite(parsed) && parsed > 0) {
                return parsed;
            }
        }

        const transformValue = sourceContext.mainSvg.style && sourceContext.mainSvg.style.transform
            ? sourceContext.mainSvg.style.transform
            : "";
        const match = transformValue.match(/scale\(([-\d.]+)(?:\s*,\s*[-\d.]+)?\)/);
        if (match) {
            const parsedScale = parseFloat(match[1] || "");
            if (Number.isFinite(parsedScale) && parsedScale > 0) {
                return parsedScale;
            }
        }

        return 1;
    }

    function getMainPanOffset(context, axis) {
        const sourceContext = context || getMainVisualizerContext();
        if (!sourceContext || !sourceContext.mainSvg) {
            return 0;
        }

        const attrName = axis === "y" ? "data-pan-y" : "data-pan-x";
        const datasetKey = axis === "y" ? "panY" : "panX";
        const candidates = [
            sourceContext.mainSvg.getAttribute(attrName),
            sourceContext.mainSvg.dataset ? sourceContext.mainSvg.dataset[datasetKey] : null,
            sourceContext.iframeDoc && sourceContext.iframeDoc.documentElement
                ? sourceContext.iframeDoc.documentElement.getAttribute(attrName)
                : null,
            sourceContext.iframeDoc && sourceContext.iframeDoc.body
                ? sourceContext.iframeDoc.body.getAttribute(attrName)
                : null
        ];

        for (let i = 0; i < candidates.length; i += 1) {
            const parsed = parseFloat(candidates[i] || "");
            if (Number.isFinite(parsed)) {
                return parsed;
            }
        }

        return 0;
    }

    function getMainVisibleGraphRect(context) {
        const sourceContext = context || getMainVisualizerContext();
        if (!sourceContext || !sourceContext.scrollEl) {
            return null;
        }

        const zoomScale = getMainZoomScale(sourceContext);
        if (!Number.isFinite(zoomScale) || zoomScale <= 0) {
            return null;
        }

        const panX = getMainPanOffset(sourceContext, "x");
        const panY = getMainPanOffset(sourceContext, "y");
        const visibleGraphW = sourceContext.scrollEl.clientWidth / zoomScale;
        const visibleGraphH = sourceContext.scrollEl.clientHeight / zoomScale;
        if (!Number.isFinite(visibleGraphW) || !Number.isFinite(visibleGraphH) || visibleGraphW <= 0 || visibleGraphH <= 0) {
            return null;
        }

        return {
            x: (sourceContext.scrollEl.scrollLeft - panX) / zoomScale,
            y: (sourceContext.scrollEl.scrollTop - panY) / zoomScale,
            width: visibleGraphW,
            height: visibleGraphH
        };
    }

    function getExpandedRect(rect, factor) {
        if (!rect || !Number.isFinite(rect.width) || !Number.isFinite(rect.height) || rect.width <= 0 || rect.height <= 0) {
            return null;
        }

        const zoomOutFactor = Number.isFinite(factor) && factor > 1 ? factor : 1;
        const expandedWidth = rect.width * zoomOutFactor;
        const expandedHeight = rect.height * zoomOutFactor;
        const deltaW = expandedWidth - rect.width;
        const deltaH = expandedHeight - rect.height;

        return {
            x: rect.x - (deltaW / 2),
            y: rect.y - (deltaH / 2),
            width: expandedWidth,
            height: expandedHeight
        };
    }

    function setSvgViewBox(svg, rect) {
        if (!svg || !rect) {
            return false;
        }
        if (!Number.isFinite(rect.x) || !Number.isFinite(rect.y) || !Number.isFinite(rect.width) || !Number.isFinite(rect.height)) {
            return false;
        }
        if (rect.width <= 0 || rect.height <= 0) {
            return false;
        }

        svg.setAttribute("viewBox", `${rect.x} ${rect.y} ${rect.width} ${rect.height}`);
        return true;
    }

    function syncBirdIframeToMain() {
        const mainIframe = document.getElementById("main-view-visualizer-iframe");
        const birdIframe = document.getElementById("bird-view-iframe");
        if (!mainIframe || !birdIframe) {
            return;
        }

        const srcdoc = mainIframe.getAttribute("srcdoc") || mainIframe.srcdoc;
        if (!srcdoc) {
            return;
        }

        if ((birdIframe.getAttribute("srcdoc") || "") === srcdoc) {
            return;
        }

        birdIframe.setAttribute("srcdoc", srcdoc);
    }

    function computeBirdGraphBounds(svg) {
        const viewportRect = svg.querySelector("#bird-viewport-rect");
        let viewportRectNextSibling = null;
        if (viewportRect && viewportRect.parentNode === svg) {
            viewportRectNextSibling = viewportRect.nextSibling;
            svg.removeChild(viewportRect);
        }

        try {
            const bb = svg.getBBox();
            if (bb && bb.width > 0 && bb.height > 0) {
                return {
                    x: bb.x,
                    y: bb.y,
                    width: bb.width,
                    height: bb.height
                };
            }
        } catch {
            // Fallback to manual bounds scan.
        } finally {
            if (viewportRect && viewportRect.parentNode !== svg) {
                if (viewportRectNextSibling) {
                    svg.insertBefore(viewportRect, viewportRectNextSibling);
                } else {
                    svg.appendChild(viewportRect);
                }
            }
        }

        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        const addPoint = function (x, y) {
            if (!Number.isFinite(x) || !Number.isFinite(y)) {
                return;
            }
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
        };

        const lines = svg.querySelectorAll("line");
        for (let i = 0; i < lines.length; i += 1) {
            const line = lines[i];
            addPoint(parseFloat(line.getAttribute("x1") || ""), parseFloat(line.getAttribute("y1") || ""));
            addPoint(parseFloat(line.getAttribute("x2") || ""), parseFloat(line.getAttribute("y2") || ""));
        }

        const circles = svg.querySelectorAll("circle");
        for (let i = 0; i < circles.length; i += 1) {
            const circle = circles[i];
            const cx = parseFloat(circle.getAttribute("cx") || "");
            const cy = parseFloat(circle.getAttribute("cy") || "");
            const r = parseFloat(circle.getAttribute("r") || "");
            if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(r)) {
                continue;
            }
            addPoint(cx - r, cy - r);
            addPoint(cx + r, cy + r);
        }

        const foreignObjects = svg.querySelectorAll("foreignObject");
        for (let i = 0; i < foreignObjects.length; i += 1) {
            const fo = foreignObjects[i];
            const x = parseFloat(fo.getAttribute("x") || "");
            const y = parseFloat(fo.getAttribute("y") || "");
            const width = parseFloat(fo.getAttribute("width") || "");
            const height = parseFloat(fo.getAttribute("height") || "");
            if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height)) {
                continue;
            }
            addPoint(x, y);
            addPoint(x + width, y + height);
        }

        if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
            return null;
        }

        return {
            x: minX,
            y: minY,
            width: maxX - minX,
            height: maxY - minY
        };
    }

    function ensureBirdViewportRect(birdDoc, svg) {
        let rect = birdDoc.getElementById("bird-viewport-rect");
        if (!rect) {
            rect = birdDoc.createElementNS(SVG_NS, "rect");
            rect.id = "bird-viewport-rect";
        }

        rect.setAttribute("fill", "none");
        rect.setAttribute("stroke", "#ff3b30");
        rect.style.vectorEffect = "non-scaling-stroke";
        rect.style.strokeWidth = "3px";
        rect.style.pointerEvents = "none";
        rect.setAttribute("x", rect.getAttribute("x") || "0");
        rect.setAttribute("y", rect.getAttribute("y") || "0");
        rect.setAttribute("width", rect.getAttribute("width") || "0");
        rect.setAttribute("height", rect.getAttribute("height") || "0");
        svg.appendChild(rect);
        return rect;
    }

    function syncBirdGraphGeometryFromMain(context) {
        const sourceContext = context || getMainVisualizerContext();
        const birdIframe = document.getElementById("bird-view-iframe");
        if (!sourceContext || !sourceContext.iframeDoc || !birdIframe || !birdIframe.contentDocument) {
            return;
        }

        const mainEdges = sourceContext.iframeDoc.getElementById("viz-edges");
        const mainNodes = sourceContext.iframeDoc.getElementById("viz-nodes");
        const birdDoc = birdIframe.contentDocument;
        const birdEdges = birdDoc.getElementById("viz-edges");
        const birdNodes = birdDoc.getElementById("viz-nodes");
        if (!mainEdges || !mainNodes || !birdEdges || !birdNodes) {
            return;
        }

        const mainEdgesHtml = mainEdges.innerHTML;
        const mainNodesHtml = mainNodes.innerHTML;
        if (birdEdges.innerHTML !== mainEdgesHtml) {
            birdEdges.innerHTML = mainEdgesHtml;
        }
        if (birdNodes.innerHTML !== mainNodesHtml) {
            birdNodes.innerHTML = mainNodesHtml;
        }
    }

    function syncBirdViewBoxToMain(context) {
        const sourceContext = context || getMainVisualizerContext();
        const birdIframe = document.getElementById("bird-view-iframe");
        if (!birdIframe || !birdIframe.contentDocument) {
            return;
        }

        const birdDoc = birdIframe.contentDocument;
        const svg = birdDoc.getElementById("viz-svg");
        if (!svg) {
            return;
        }

        const visibleRect = getMainVisibleGraphRect(sourceContext);
        const expandedRect = getExpandedRect(visibleRect, BIRD_VIEW_ZOOM_OUT_FACTOR);
        if (setSvgViewBox(svg, expandedRect)) {
            return;
        }

        const bounds = computeBirdGraphBounds(svg);
        if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
            return;
        }
        setSvgViewBox(svg, getExpandedRect(bounds, BIRD_VIEW_ZOOM_OUT_FACTOR));
    }

    function configureBirdIframeDocument() {
        const birdIframe = document.getElementById("bird-view-iframe");
        if (!birdIframe || !birdIframe.contentDocument) {
            return;
        }

        const birdDoc = birdIframe.contentDocument;
        const scrollEl = birdDoc.getElementById("viz-scroll");
        const svg = birdDoc.getElementById("viz-svg");
        if (!svg) {
            return;
        }

        if (scrollEl) {
            scrollEl.style.overflow = "hidden";
            scrollEl.style.width = "100%";
            scrollEl.style.height = "100%";
            scrollEl.scrollLeft = 0;
            scrollEl.scrollTop = 0;
        }
        if (birdDoc.documentElement) {
            birdDoc.documentElement.style.overflow = "hidden";
        }
        if (birdDoc.body) {
            birdDoc.body.style.overflow = "hidden";
            birdDoc.body.style.margin = "0";
            birdDoc.body.style.height = "100%";
        }

        svg.removeAttribute("width");
        svg.removeAttribute("height");
        svg.style.width = "100%";
        svg.style.height = "100%";
        svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

        ensureBirdViewportRect(birdDoc, svg);
        syncBirdGraphGeometryFromMain();
        syncBirdViewBoxToMain();
    }

    function getCssEscapedAttributeValue(value) {
        const str = String(value);
        if (window.CSS && typeof window.CSS.escape === "function") {
            return window.CSS.escape(str);
        }
        return str.replace(/["\\]/g, "\\$&");
    }

    function updateBirdSelectionHighlight() {
        const birdIframe = document.getElementById("bird-view-iframe");
        if (!birdIframe || !birdIframe.contentDocument) {
            return;
        }

        const birdDoc = birdIframe.contentDocument;
        const nodeEls = birdDoc.querySelectorAll("[data-node-id]");
        for (let i = 0; i < nodeEls.length; i += 1) {
            nodeEls[i].classList.remove("selected");
        }

        if (!state.selectedNodeId) {
            return;
        }

        const escapedId = getCssEscapedAttributeValue(state.selectedNodeId);
        const selectedNodeEl = birdDoc.querySelector(`[data-node-id="${escapedId}"]`);
        if (selectedNodeEl) {
            selectedNodeEl.classList.add("selected");
        }
    }

    function updateBirdViewportRect(context) {
        const sourceContext = context || getMainVisualizerContext();
        const birdIframe = document.getElementById("bird-view-iframe");
        if (!sourceContext || !birdIframe || !birdIframe.contentDocument) {
            return;
        }

        const birdDoc = birdIframe.contentDocument;
        const birdSvg = birdDoc.getElementById("viz-svg");
        if (!birdSvg) {
            return;
        }
        const birdRect = ensureBirdViewportRect(birdDoc, birdSvg);
        const visibleRect = getMainVisibleGraphRect(sourceContext);
        if (!visibleRect) {
            return;
        }

        birdRect.setAttribute("x", String(visibleRect.x));
        birdRect.setAttribute("y", String(visibleRect.y));
        birdRect.setAttribute("width", String(visibleRect.width));
        birdRect.setAttribute("height", String(visibleRect.height));
    }

    function refreshBirdViewportAndFocus(context) {
        syncBirdGraphGeometryFromMain(context);
        syncBirdViewBoxToMain(context);
        updateBirdViewportRect(context);
        updateBirdSelectionHighlight();
    }

    function scheduleBirdViewportAndFocusUpdate() {
        if (birdViewSync.viewportUpdatePending) {
            return;
        }
        birdViewSync.viewportUpdatePending = true;
        birdViewSync.viewportUpdateRafId = requestAnimationFrame(function () {
            birdViewSync.viewportUpdatePending = false;
            birdViewSync.viewportUpdateRafId = null;
            refreshBirdViewportAndFocus();
        });
    }

    function bindBirdViewportSync() {
        const context = getMainVisualizerContext();
        if (!context || !context.scrollEl) {
            clearBirdScrollSync();
            clearBirdViewportUpdateSchedule();
            return;
        }

        if (birdViewSync.boundScrollEl !== context.scrollEl || !birdViewSync.boundScrollHandler) {
            clearBirdScrollSync();
            const onScroll = function () {
                scheduleBirdViewportAndFocusUpdate();
            };
            context.scrollEl.addEventListener("scroll", onScroll, { passive: true });
            birdViewSync.boundScrollEl = context.scrollEl;
            birdViewSync.boundScrollHandler = onScroll;
        }

        if (birdViewSync.boundMainSvg !== context.mainSvg) {
            if (birdViewSync.boundMainSvgObserver) {
                birdViewSync.boundMainSvgObserver.disconnect();
            }
            birdViewSync.boundMainSvgObserver = new MutationObserver(function () {
                scheduleBirdViewportAndFocusUpdate();
            });
            birdViewSync.boundMainSvgObserver.observe(context.mainSvg, {
                attributes: true,
                childList: true,
                subtree: true,
                attributeFilter: [
                    "style",
                    "class",
                    "data-zoom-scale",
                    "data-pan-x",
                    "data-pan-y",
                    "viewBox",
                    "transform",
                    "x",
                    "y",
                    "x1",
                    "y1",
                    "x2",
                    "y2",
                    "width",
                    "height"
                ]
            });
            birdViewSync.boundMainSvg = context.mainSvg;
        }

        refreshBirdViewportAndFocus(context);
    }

    function bindBirdIframeLifecycle() {
        const birdIframe = document.getElementById("bird-view-iframe");
        if (!birdIframe || birdIframe.dataset.birdLifecycleBound === "true") {
            return;
        }

        birdIframe.dataset.birdLifecycleBound = "true";
        birdIframe.addEventListener("load", function () {
            configureBirdIframeDocument();
            updateBirdSelectionHighlight();
            scheduleBirdViewportAndFocusUpdate();
        });
    }

    function renderBirdMinimapFromIframe() {
        bindBirdIframeLifecycle();
        syncBirdIframeToMain();
        configureBirdIframeDocument();
        bindBirdViewportSync();
        updateBirdSelectionHighlight();
        scheduleBirdViewportAndFocusUpdate();
    }

    function getNodeById(nodeId) {
        const nodes = getNodes();
        for (let i = 0; i < nodes.length; i += 1) {
            if (nodes[i] && String(nodes[i].id) === String(nodeId)) {
                return nodes[i];
            }
        }
        return null;
    }

    function getNodeAttributes(node, maxCount) {
        const max = typeof maxCount === "number" ? maxCount : 3;
        const attrs = [];
        const preferredKeys = ["label", "name", "type", "status", "group"];
        const used = {};

        for (let i = 0; i < preferredKeys.length && attrs.length < max; i += 1) {
            const key = preferredKeys[i];
            if (node[key] !== undefined && node[key] !== null && key !== "id") {
                attrs.push({ key: key, value: node[key] });
                used[key] = true;
            }
        }

        const keys = Object.keys(node);
        for (let i = 0; i < keys.length && attrs.length < max; i += 1) {
            const key = keys[i];
            if (key === "id" || used[key]) {
                continue;
            }
            if (node[key] !== undefined && node[key] !== null) {
                attrs.push({ key: key, value: node[key] });
            }
        }

        return attrs;
    }

    function syncSelectedNode() {
        if (state.selectedNodeId && !getNodeById(state.selectedNodeId)) {
            state.selectedNodeId = null;
        }
    }

    function postMessageToIframe(message, withRetry) {
        const iframe = document.getElementById("main-view-visualizer-iframe");
        if (!iframe || !iframe.contentWindow) {
            return;
        }
        iframe.contentWindow.postMessage(message, "*");

        if (!withRetry) {
            return;
        }

        setTimeout(function () {
            const iframeRetry = document.getElementById("main-view-visualizer-iframe");
            if (!iframeRetry || !iframeRetry.contentWindow) {
                return;
            }
            iframeRetry.contentWindow.postMessage(message, "*");
        }, 120);
    }

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

    function setSelectedNode(nodeId) {
        const nextNodeId = nodeId ? String(nodeId) : null;
        if (state.selectedNodeId === nextNodeId) {
            return;
        }
        state.selectedNodeId = nextNodeId;
        renderAll();
        postSelectedNodeToIframe();
    }

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

    function getToolbarElements() {
        return {
            searchInput: document.getElementById("search-input"),
            searchQueryButton: document.getElementById("search-query-button"),
            filterAttributeInput: document.getElementById("filter-attribute-input"),
            filterOperatorSelect: document.getElementById("filter-operator-select"),
            filterValueInput: document.getElementById("filter-value-input"),
            applyQueryButton: document.getElementById("apply-query-button"),
            clearQueryButton: document.getElementById("clear-query-state-button"),
            appliedQueryTags: document.getElementById("applied-query-tags"),
            appliedQueryCount: document.getElementById("applied-query-count"),
            appliedQueryEmpty: document.getElementById("applied-query-empty"),
            searchPreview: document.getElementById("search-preview"),
            filterErrorMessage: document.getElementById("filter-error-message")
        };
    }

    function clearFilterErrorHideTimeout() {
        if (filterErrorHideTimeoutId !== null) {
            clearTimeout(filterErrorHideTimeoutId);
            filterErrorHideTimeoutId = null;
        }
    }

    function hideFilterErrorMessage() {
        const refs = getToolbarElements();
        if (!refs.filterErrorMessage) {
            return;
        }
        refs.filterErrorMessage.textContent = "";
        refs.filterErrorMessage.hidden = true;
    }

    function showFilterErrorMessage(message) {
        const refs = getToolbarElements();
        if (!refs.filterErrorMessage) {
            return;
        }

        clearFilterErrorHideTimeout();
        refs.filterErrorMessage.textContent = String(message || "Invalid filter input.");
        refs.filterErrorMessage.hidden = false;
        filterErrorHideTimeoutId = setTimeout(function () {
            hideFilterErrorMessage();
            filterErrorHideTimeoutId = null;
        }, FILTER_ERROR_AUTO_HIDE_MS);
    }

    function getFileInputElements() {
        return {
            fileInput: document.getElementById("graph-file-input"),
            loadButton: document.getElementById("load-graph-button"),
            selectedFileName: document.getElementById("selected-file-name"),
            status: document.getElementById("file-load-status")
        };
    }

    function getWorkspaceSelectorElements() {
        return {
            list: document.getElementById("workspace-selector-list"),
            empty: document.getElementById("workspace-selector-empty")
        };
    }

    function getConsoleElements() {
        return {
            commandInput: document.getElementById("console-command-input"),
            runButton: document.getElementById("console-run-button"),
            clearButton: document.getElementById("console-clear-button"),
            output: document.getElementById("console-output"),
            outputEmpty: document.getElementById("console-output-empty")
        };
    }

    function getConsoleDockElements() {
        return {
            dock: document.getElementById("console-dock"),
            toggleButton: document.getElementById("console-toggle-button")
        };
    }

    function getGraphFetchStatusElements() {
        return {
            banner: document.getElementById("graph-fetch-status"),
            message: document.getElementById("graph-fetch-status-message"),
            retryButton: document.getElementById("graph-fetch-retry-button")
        };
    }

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

    function getFileLoadStatusLabel() {
        if (!state.selectedUploadFile) {
            return "Select a JSON or CSV file to load.";
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

    function renderFileInputState() {
        const refs = getFileInputElements();
        if (refs.selectedFileName) {
            refs.selectedFileName.textContent = state.selectedUploadFile
                ? state.selectedUploadFilename
                : "No file selected";
        }

        if (refs.status) {
            refs.status.textContent = getFileLoadStatusLabel();
        }

        if (refs.loadButton) {
            refs.loadButton.disabled = state.graphFetchStatus === "loading" || !state.selectedUploadFile;
        }
    }

    function renderWorkspaceSelector() {
        const refs = getWorkspaceSelectorElements();
        if (!refs.list) {
            return;
        }

        refs.list.innerHTML = "";
        const workspaceIds = state.workspaces.orderedIds;
        if (!workspaceIds.length) {
            if (refs.empty) {
                refs.empty.hidden = false;
            }
            return;
        }

        if (refs.empty) {
            refs.empty.hidden = true;
        }

        workspaceIds.forEach(function (graphId, index) {
            const workspace = getWorkspaceById(graphId);
            if (!workspace) {
                return;
            }

            const item = document.createElement("div");
            item.className = "workspace-item";
            const isActiveWorkspace = graphId === state.activeGraphId;
            if (isActiveWorkspace) {
                item.classList.add("is-active");
            }

            const selectButton = document.createElement("button");
            selectButton.type = "button";
            selectButton.className = "workspace-button placeholder-button secondary-button";
            selectButton.setAttribute("data-graph-id", graphId);
            selectButton.textContent = workspace.label || `Workspace ${index + 1}`;
            selectButton.title = workspace.filename || graphId;
            selectButton.setAttribute("aria-pressed", String(isActiveWorkspace));
            if (isActiveWorkspace) {
                selectButton.classList.add("active");
            }

            const closeButton = document.createElement("button");
            closeButton.type = "button";
            closeButton.className = "workspace-close-button placeholder-button secondary-button";
            closeButton.setAttribute("data-close-graph-id", graphId);
            closeButton.setAttribute("aria-label", `Close ${workspace.label || `Workspace ${index + 1}`}`);
            closeButton.title = `Close ${workspace.label || `Workspace ${index + 1}`}`;
            closeButton.textContent = "x";

            item.appendChild(selectButton);
            item.appendChild(closeButton);
            refs.list.appendChild(item);
        });
    }

    function bindWorkspaceSelectorControls() {
        const refs = getWorkspaceSelectorElements();
        if (!refs.list || refs.list.dataset.workspaceBindings === "ready") {
            return;
        }

        refs.list.dataset.workspaceBindings = "ready";
        refs.list.addEventListener("click", function (event) {
            const closeTarget = event.target.closest(".workspace-close-button[data-close-graph-id]");
            if (closeTarget && refs.list.contains(closeTarget)) {
                const closeGraphId = closeTarget.getAttribute("data-close-graph-id");
                if (!closeGraphId) {
                    return;
                }
                event.preventDefault();
                event.stopPropagation();
                removeWorkspace(closeGraphId);
                return;
            }

            const target = event.target.closest(".workspace-button[data-graph-id]");
            if (!target || !refs.list.contains(target)) {
                return;
            }

            const graphId = target.getAttribute("data-graph-id");
            if (!graphId) {
                return;
            }

            setActiveWorkspace(graphId);
        });
    }

    function bindFileInputControls() {
        const refs = getFileInputElements();
        if (!refs.fileInput) {
            return;
        }

        refs.fileInput.addEventListener("change", function (event) {
            const nextFile = event.target.files && event.target.files[0] ? event.target.files[0] : null;
            state.selectedUploadFile = nextFile;
            state.selectedUploadFilename = nextFile ? nextFile.name : "";
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

    function getMainViewElements() {
        return {
            status: document.getElementById("main-view-render-status"),
            error: document.getElementById("main-view-render-error"),
            output: document.getElementById("main-view-visualizer-output")
        };
    }

    function getVisualizerRenderErrorMessage(error) {
        if (error && typeof error.message === "string" && error.message.trim()) {
            return error.message.trim();
        }
        return "Unexpected error.";
    }

    function getVisualizerRenderStatusLabel() {
        if (state.visualizerRender.status === "loading") {
            return "Rendering...";
        }
        return "";
    }

    function buildVisualizerRenderUrl(visualizerId, isDirected, graphId) {
        const params = new URLSearchParams({
            visualizer_id: visualizerId,
            directed: isDirected ? "1" : "0",
            graph_id: graphId
        });
        return `${VISUALIZER_RENDER_ENDPOINT}?${params.toString()}`;
    }

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
            const response = await fetch(buildVisualizerRenderUrl(visualizerId, isDirected, graphId), {
                headers: { Accept: "text/html" }
            });
            const html = await response.text();

            if (!response.ok) {
                const message = html && html.trim() ? html.trim().replace(/\s+/g, " ") : `HTTP ${response.status}`;
                throw new Error(message);
            }

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

    function pushConsoleHistory(command) {
        state.consoleUI.history.unshift(command);
        if (state.consoleUI.history.length > state.consoleUI.maxHistory) {
            state.consoleUI.history = state.consoleUI.history.slice(0, state.consoleUI.maxHistory);
        }
    }

    function pushConsoleOutputLine(line) {
        state.consoleUI.outputLines.unshift(line);
        if (state.consoleUI.outputLines.length > state.consoleUI.maxOutputLines) {
            state.consoleUI.outputLines = state.consoleUI.outputLines.slice(0, state.consoleUI.maxOutputLines);
        }
    }

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

    function renderConsoleDockState() {
        const refs = getConsoleDockElements();
        if (!refs.dock || !refs.toggleButton) {
            return;
        }
        refs.dock.classList.toggle("is-collapsed", state.consoleUI.isCollapsed);
        refs.toggleButton.textContent = state.consoleUI.isCollapsed ? "Open" : "Hide";
        refs.toggleButton.setAttribute("aria-expanded", String(!state.consoleUI.isCollapsed));
    }

    async function handleRunConsoleCommand() {
        const command = state.consoleUI.currentInput.trim();
        if (!command) {
            return;
        }

        pushConsoleHistory(command);
        pushConsoleOutputLine(`> ${command}`);
        state.consoleUI.currentInput = "";
        renderConsole();

        const result = await postJsonRequest(CLI_EXECUTE_ENDPOINT, {
            graph_id: state.activeGraphId || null,
            command: command
        });
        pushConsoleOutputLine(result.message);
        renderConsole();

        //Refresh
        if (result.ok && result.payload && result.payload.graph) {
            const newGraph = result.payload.graph;
            if (isValidGraphShape(newGraph)) {
                state.graph = toGraphState(newGraph); // Update graph in JS
                renderAll();                          // update tree/bird
                loadVisualizerOutput();               // new svg
            }
        }
    }

    function clearConsoleState() {
        state.consoleUI.currentInput = "";
        state.consoleUI.history = [];
        state.consoleUI.outputLines = [];
        renderConsole();
    }

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

    function createAppliedChip(label, type, payload) {
        const chip = {
            id: state.queryUI.nextChipId,
            label: label,
            type: type,
            payload: payload
        };
        state.queryUI.nextChipId += 1;
        return chip;
    }

    function renderAppliedChips() {
        const refs = getToolbarElements();
        const tags = refs.appliedQueryTags;
        if (!tags) {
            return;
        }

        tags.innerHTML = "";
        const chips = state.queryUI.appliedChips;

        if (!chips.length) {
            if (refs.appliedQueryEmpty) {
                refs.appliedQueryEmpty.style.display = "";
            }
            return;
        }

        if (refs.appliedQueryEmpty) {
            refs.appliedQueryEmpty.style.display = "none";
        }

        chips.forEach(function (chip) {
            const chipEl = document.createElement("span");
            chipEl.className = "query-tag";

            const labelEl = document.createElement("span");
            labelEl.className = "query-tag-label";
            labelEl.textContent = chip.label;

            chipEl.appendChild(labelEl);
            tags.appendChild(chipEl);
        });
    }

    function renderToolbarState() {
        const refs = getToolbarElements();
        const chipCount = state.queryUI.appliedChips.length;
        const searchText = state.queryUI.searchText.trim();

        if (refs.searchInput && refs.searchInput.value !== state.queryUI.searchText) {
            refs.searchInput.value = state.queryUI.searchText;
        }
        if (refs.filterAttributeInput && refs.filterAttributeInput.value !== state.queryUI.filterAttribute) {
            refs.filterAttributeInput.value = state.queryUI.filterAttribute;
        }
        if (refs.filterOperatorSelect && refs.filterOperatorSelect.value !== state.queryUI.filterOperator) {
            refs.filterOperatorSelect.value = state.queryUI.filterOperator;
        }
        if (refs.filterValueInput && refs.filterValueInput.value !== state.queryUI.filterValue) {
            refs.filterValueInput.value = state.queryUI.filterValue;
        }

        if (refs.appliedQueryCount) {
            refs.appliedQueryCount.textContent = `${chipCount} applied`;
        }
        if (refs.searchPreview) {
            refs.searchPreview.textContent = searchText ? `Current search: ${searchText}` : "Current search: none";
        }

        renderAppliedChips();
        syncActiveWorkspaceFromState();
    }

    async function sendSearchRequest(queryText) {
        const query = String(queryText ?? "").trim();

        if (!state.activeGraphId) {
            pushConsoleOutputLine("Load a graph first.");
            renderConsole();
            return false;
        }

        if (!query) {
            return false;
        }

        const result = await postJsonRequest(GRAPH_SEARCH_ENDPOINT, {
            graph_id: state.activeGraphId,
            query: query
        });

        pushConsoleOutputLine(result.message);
        renderConsole();

        if (result.ok && result.payload && result.payload.graph) {
            const newGraph = result.payload.graph;
            if (isValidGraphShape(newGraph)) {
                state.graph = toGraphState(newGraph);
                renderAll();
                loadVisualizerOutput();
                return true;
            }
        }

        return false;
    }

    async function sendFilterRequest(attributeText, operatorText, valueText) {
        const attribute = String(attributeText ?? "").trim();
        const operator = String(operatorText ?? "").trim();
        const value = String(valueText ?? "").trim();

        if (!state.activeGraphId) {
            pushConsoleOutputLine("Load a graph first.");
            renderConsole();
            return false;
        }

        if (!attribute || !operator || !value) {
            pushConsoleOutputLine("Please enter attribute, operator and value to filter.");
            renderConsole();
            return false;
        }

        const payload = {
            graph_id: state.activeGraphId,
            attribute: attribute,
            operator: operator,
            value: value
        };

        console.log("Filter payload being sent:", JSON.stringify(payload));
        const result = await postJsonRequest(GRAPH_FILTER_ENDPOINT, payload);

        pushConsoleOutputLine(result.message);
        renderConsole();

        if (!result.ok) {
            showFilterErrorMessage(result.message);
            return false;
        }

        if (result.ok && result.payload && result.payload.graph) {
            const newGraph = result.payload.graph;
            if (isValidGraphShape(newGraph)) {
                state.graph = toGraphState(newGraph);
                renderAll();
                loadVisualizerOutput();
                clearFilterErrorHideTimeout();
                hideFilterErrorMessage();
                return true;
            }
        }

        showFilterErrorMessage("Filter failed due to an invalid server response.");
        return false;
    }

    async function handleSearchQuery() {
        const refs = getToolbarElements();
        if (!refs.searchInput) {
            return;
        }

        state.queryUI.searchText = refs.searchInput.value;
        const searchText = state.queryUI.searchText.trim();
        if (!searchText) {
            renderToolbarState();
            return;
        }

        state.queryUI.appliedChips = state.queryUI.appliedChips.concat(
            createAppliedChip(`search: ${searchText}`, "search", { searchText: searchText })
        );
        renderToolbarState();
        const applied = await sendSearchRequest(searchText);
        if (!applied) {
            return;
        }

        state.queryUI.searchText = "";
        renderToolbarState();
    }

    async function handleFilterQuery() {
        const refs = getToolbarElements();
        if (!refs.filterAttributeInput || !refs.filterOperatorSelect || !refs.filterValueInput) {
            return;
        }

        state.queryUI.filterAttribute = refs.filterAttributeInput.value;
        state.queryUI.filterOperator = refs.filterOperatorSelect.value;
        state.queryUI.filterValue = refs.filterValueInput.value;

        const attribute = state.queryUI.filterAttribute.trim();
        const operator = state.queryUI.filterOperator.trim();
        const value = state.queryUI.filterValue.trim();

        if (!attribute || !operator || !value) {
            await sendFilterRequest(attribute, operator, value);
            return;
        }

        const applied = await sendFilterRequest(attribute, operator, value);
        if (!applied) {
            return;
        }

        state.queryUI.appliedChips = state.queryUI.appliedChips.concat(createAppliedChip(`${attribute} ${operator} ${value}`, "filter", {
            attribute: attribute,
            operator: operator,
            value: value
        }));
        state.queryUI.filterAttribute = "";
        state.queryUI.filterOperator = DEFAULT_FILTER_OPERATOR;
        state.queryUI.filterValue = "";
        renderToolbarState();
    }

    async function resetQueryFilterState() {
        state.queryUI.searchText = "";
        state.queryUI.filterAttribute = "";
        state.queryUI.filterOperator = DEFAULT_FILTER_OPERATOR;
        state.queryUI.filterValue = "";
        state.queryUI.appliedChips = [];
        state.queryUI.nextChipId = 1;
        clearFilterErrorHideTimeout();
        hideFilterErrorMessage();
        renderToolbarState();

        if (!state.activeGraphId) {
            console.log("No active graph id, skipping reset.");
            return;
        }

        console.log("Sending reset for graph_id:", state.activeGraphId);
        const result = await postJsonRequest("/api/workspace/reset/", {
            graph_id: state.activeGraphId
        });
        console.log("Reset result:", result);

        if (result.ok && result.payload && result.payload.graph) {
            const originalGraph = result.payload.graph;
            console.log("Original graph nodes:", originalGraph.nodes?.length);
            if (isValidGraphShape(originalGraph)) {
                state.graph = toGraphState(originalGraph);
                state.graphOriginal = toGraphState(originalGraph);
                renderAll();
                loadVisualizerOutput();
            }
        }
    }

    function bindToolbarControls() {
        const refs = getToolbarElements();
        if (!refs.searchInput || !refs.filterAttributeInput || !refs.filterOperatorSelect || !refs.filterValueInput) {
            return;
        }

        refs.searchInput.addEventListener("input", function (event) {
            state.queryUI.searchText = event.target.value;
            renderToolbarState();
        });

        refs.filterAttributeInput.addEventListener("input", function (event) {
            state.queryUI.filterAttribute = event.target.value;
            syncActiveWorkspaceFromState();
        });

        refs.filterOperatorSelect.addEventListener("change", function (event) {
            state.queryUI.filterOperator = event.target.value;
            syncActiveWorkspaceFromState();
        });

        refs.filterValueInput.addEventListener("input", function (event) {
            state.queryUI.filterValue = event.target.value;
            syncActiveWorkspaceFromState();
        });

        if (refs.searchQueryButton) {
            refs.searchQueryButton.addEventListener("click", function () {
                handleSearchQuery();
            });
        }

        if (refs.applyQueryButton) {
            refs.applyQueryButton.addEventListener("click", function () {
                handleFilterQuery();
            });
        }

        if (refs.clearQueryButton) {
            refs.clearQueryButton.addEventListener("click", function () {
                resetQueryFilterState();
            });
        }
    }

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
            const fromMain = Boolean(mainIframe && mainIframe.contentWindow && event.source === mainIframe.contentWindow);
            if (!fromMain) {
                return;
            }

            setSelectedNode(String(message.nodeId));
        });
    }

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

        if (refs.output) {
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
    }

    function getGraphNodeId(node, index) {
        if (node && node.id !== undefined && node.id !== null) {
            return String(node.id);
        }
        return `__node_${index}`;
    }

    function getTreeNodeLabel(node, nodeId) {
        if (!node || typeof node !== "object") {
            return String(nodeId);
        }

        const preferredLabel = node.label !== undefined && node.label !== null
            ? node.label
            : node.name !== undefined && node.name !== null
                ? node.name
                : null;

        if (preferredLabel === null || String(preferredLabel).trim() === "") {
            return String(nodeId);
        }
        return `${nodeId} - ${preferredLabel}`;
    }

    function formatTreeAttributeValue(value) {
        if (value === null) {
            return "null";
        }
        if (value === undefined) {
            return "undefined";
        }
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
            return String(value);
        }
        try {
            const serialized = JSON.stringify(value);
            if (serialized !== undefined) {
                return serialized;
            }
        } catch {
            // Ignore and fall back to String().
        }
        return String(value);
    }

    function getTreeNodeAttributeEntries(node) {
        if (!node || typeof node !== "object" || !node.attributes || typeof node.attributes !== "object" || Array.isArray(node.attributes)) {
            return [];
        }

        return Object.keys(node.attributes).map(function (key) {
            return {
                key: key,
                value: node.attributes[key]
            };
        });
    }

    function normalizeEdgeNodeId(value) {
        if (value === undefined || value === null) {
            return null;
        }
        if (typeof value === "object") {
            if (value.id !== undefined && value.id !== null) {
                return String(value.id);
            }
            if (value.node_id !== undefined && value.node_id !== null) {
                return String(value.node_id);
            }
            return null;
        }
        return String(value);
    }

    function getEdgeSourceId(edge) {
        if (!edge || typeof edge !== "object") {
            return null;
        }
        return normalizeEdgeNodeId(edge.source);
    }

    function getEdgeTargetId(edge) {
        if (!edge || typeof edge !== "object") {
            return null;
        }
        return normalizeEdgeNodeId(edge.target);
    }

    function getOrderedNodeIds(nodes) {
        const seen = {};
        const orderedIds = [];
        nodes.forEach(function (node, index) {
            const nodeId = getGraphNodeId(node, index);
            if (seen[nodeId]) {
                return;
            }
            seen[nodeId] = true;
            orderedIds.push(nodeId);
        });
        orderedIds.sort(compareTreeNodeIds);
        return orderedIds;
    }

    function isNumericNodeId(nodeId) {
        return /^-?\d+(\.\d+)?$/.test(String(nodeId));
    }

    function compareTreeNodeIds(a, b) {
        const left = String(a);
        const right = String(b);
        const leftNumeric = isNumericNodeId(left);
        const rightNumeric = isNumericNodeId(right);

        if (leftNumeric && rightNumeric) {
            return Number(left) - Number(right);
        }

        return left.localeCompare(right, undefined, {
            numeric: true,
            sensitivity: "base"
        });
    }

    function buildAdjacency(nodes, edges, isDirected) {
        const nodeIds = getOrderedNodeIds(nodes);
        const nodeIdSet = new Set(nodeIds);
        const adjacency = new Map();
        nodeIds.forEach(function (nodeId) {
            adjacency.set(nodeId, new Set());
        });

        edges.forEach(function (edge) {
            const sourceId = getEdgeSourceId(edge);
            const targetId = getEdgeTargetId(edge);
            if (!sourceId || !targetId || !nodeIdSet.has(sourceId) || !nodeIdSet.has(targetId)) {
                return;
            }

            adjacency.get(sourceId).add(targetId);
            if (!isDirected) {
                adjacency.get(targetId).add(sourceId);
            }
        });

        return adjacency;
    }

    function getTreeGraphSignature(nodes, edges) {
        const nodeIds = getOrderedNodeIds(nodes);
        const nodePart = nodeIds.join("|");
        const edgePart = edges.map(function (edge) {
            const sourceId = getEdgeSourceId(edge) || "";
            const targetId = getEdgeTargetId(edge) || "";
            return `${sourceId}->${targetId}`;
        }).sort().join("|");
        return `${nodePart}::${edgePart}`;
    }

    function syncTreeUIState(nodeIds, signature) {
        let shouldReset = state.treeUI.lastGraphId !== state.activeGraphId;
        if (!shouldReset && state.treeUI.lastGraphSignature && state.treeUI.lastGraphSignature !== signature) {
            shouldReset = true;
        }

        if (!shouldReset) {
            const nodeIdSet = new Set(nodeIds);
            const expandedIds = Object.keys(state.treeUI.expanded);
            for (let i = 0; i < expandedIds.length; i += 1) {
                if (!nodeIdSet.has(expandedIds[i])) {
                    shouldReset = true;
                    break;
                }
            }
        }

        if (shouldReset) {
            state.treeUI.expanded = {};
            state.treeUI.autoExpandedOnce = false;
        }

        state.treeUI.lastGraphId = state.activeGraphId;
        state.treeUI.lastGraphSignature = signature;
    }

    function renderTreeNodeHtml(nodeId, nodeById, adjacency) {
        const node = nodeById.get(nodeId) || {};
        const attributeEntries = getTreeNodeAttributeEntries(node);
        const neighborIds = Array.from(adjacency.get(nodeId) || []).sort(compareTreeNodeIds);
        const hasAttributes = attributeEntries.length > 0;
        const hasNeighbors = neighborIds.length > 0;
        const isExpandable = hasAttributes || hasNeighbors;
        const isExpanded = isExpandable && Boolean(state.treeUI.expanded[nodeId]);
        const isSelected = state.selectedNodeId === nodeId;
        const selectedClass = isSelected ? " is-selected" : "";

        let toggleHtml = '<span class="tree-toggle-placeholder" aria-hidden="true"></span>';
        if (isExpandable) {
            toggleHtml = [
                `<button class="tree-toggle" type="button" aria-expanded="${isExpanded ? "true" : "false"}"`,
                ` aria-label="${isExpanded ? "Collapse" : "Expand"}">${isExpanded ? "−" : "+"}</button>`
            ].join("");
        }

        const label = escapeHtml(getTreeNodeLabel(node, nodeId));
        let childrenHtml = "";
        if (isExpandable) {
            const attrItems = attributeEntries.map(function (attr) {
                return `<li class="tree-attr">${escapeHtml(attr.key)}: ${escapeHtml(formatTreeAttributeValue(attr.value))}</li>`;
            }).join("");

            const neighborSection = hasNeighbors ? '<li class="tree-section">Neighbors</li>' : "";
            const neighborItems = neighborIds.map(function (neighborId) {
                const neighborLabel = escapeHtml(getTreeNodeLabel(nodeById.get(neighborId), neighborId));
                return [
                    '<li class="tree-ref">',
                    `<button class="tree-ref-btn" type="button" data-node-id="${escapeHtml(neighborId)}">`,
                    `&rarr; ${neighborLabel}`,
                    "</button>",
                    "</li>"
                ].join("");
            }).join("");

            const hiddenAttr = isExpanded ? "" : " hidden";
            childrenHtml = `<ul class="tree-children"${hiddenAttr}>${attrItems}${neighborSection}${neighborItems}</ul>`;
        }

        return [
            `<li class="tree-node${selectedClass}" data-node-id="${escapeHtml(nodeId)}">`,
            '<div class="tree-row">',
            toggleHtml,
            `<button class="tree-label" type="button">${label}</button>`,
            "</div>",
            childrenHtml,
            "</li>"
        ].join("");
    }

    function getTreeNodeSelector(nodeId) {
        if (!nodeId) {
            return null;
        }
        if (window.CSS && typeof window.CSS.escape === "function") {
            return `.tree-node[data-node-id="${window.CSS.escape(String(nodeId))}"]`;
        }
        return `.tree-node[data-node-id="${String(nodeId).replace(/"/g, '\\"')}"]`;
    }

    function scrollTreeSelectionIntoView(treeView) {
        if (!treeView || !state.selectedNodeId) {
            return;
        }

        const selector = getTreeNodeSelector(state.selectedNodeId);
        if (!selector) {
            return;
        }

        const selectedNodeEl = treeView.querySelector(selector);
        if (!selectedNodeEl) {
            return;
        }

        const containerRect = treeView.getBoundingClientRect();
        const nodeRect = selectedNodeEl.getBoundingClientRect();
        const isVisible = nodeRect.top >= containerRect.top && nodeRect.bottom <= containerRect.bottom;
        if (isVisible) {
            return;
        }

        selectedNodeEl.scrollIntoView({
            block: "center",
            inline: "nearest",
            behavior: "smooth"
        });
    }

    function renderTreeView() {
        const treeView = document.getElementById("tree-view-content");
        if (!treeView) {
            return;
        }

        if (!hasLoadedGraph()) {
            treeView.innerHTML = "";
            resetTreeState();
            return;
        }

        const nodes = getNodes();
        const edges = getEdges();
        if (!nodes.length) {
            treeView.innerHTML = "";
            return;
        }

        const nodeById = new Map();
        const nodeIds = [];
        nodes.forEach(function (node, index) {
            const nodeId = getGraphNodeId(node, index);
            if (!nodeById.has(nodeId)) {
                nodeById.set(nodeId, node || {});
                nodeIds.push(nodeId);
            }
        });
        nodeIds.sort(compareTreeNodeIds);

        if (!nodeIds.length) {
            treeView.innerHTML = "";
            return;
        }

        syncTreeUIState(nodeIds, getTreeGraphSignature(nodes, edges));
        const adjacency = buildAdjacency(nodes, edges, state.isDirected);
        const rootHtml = nodeIds.map(function (nodeId) {
            return renderTreeNodeHtml(nodeId, nodeById, adjacency);
        }).join("");

        treeView.innerHTML = `<ul class="tree-explorer">${rootHtml}</ul>`;
        scrollTreeSelectionIntoView(treeView);
    }

    function bindTreeViewInteractions() {
        const treeView = document.getElementById("tree-view-content");
        if (!treeView || treeView.dataset.treeBindings === "ready") {
            return;
        }
        treeView.dataset.treeBindings = "ready";

        treeView.addEventListener("click", function (event) {
            const toggleButton = event.target.closest(".tree-toggle");
            if (toggleButton && treeView.contains(toggleButton)) {
                event.preventDefault();
                event.stopPropagation();

                const nodeEl = toggleButton.closest(".tree-node");
                if (!nodeEl) {
                    return;
                }

                const nodeId = nodeEl.getAttribute("data-node-id");
                if (!nodeId) {
                    return;
                }

                const isAlreadySelected = state.selectedNodeId === nodeId;
                state.treeUI.expanded[nodeId] = !Boolean(state.treeUI.expanded[nodeId]);

                if (isAlreadySelected) {
                    renderTreeView();
                    postSelectedNodeToIframe();
                    return;
                }

                setSelectedNode(nodeId);
                return;
            }

            const refButton = event.target.closest(".tree-ref-btn");
            if (refButton && treeView.contains(refButton)) {
                const refNodeId = refButton.getAttribute("data-node-id");
                if (!refNodeId) {
                    return;
                }

                const refAlreadySelected = state.selectedNodeId === refNodeId;
                setSelectedNode(refNodeId);
                if (refAlreadySelected) {
                    postSelectedNodeToIframe();
                }
                return;
            }

            const labelButton = event.target.closest(".tree-label");
            if (labelButton && treeView.contains(labelButton)) {
                const nodeEl = labelButton.closest(".tree-node");
                if (!nodeEl) {
                    return;
                }

                const nodeId = nodeEl.getAttribute("data-node-id");
                if (!nodeId) {
                    return;
                }

                const isAlreadySelected = state.selectedNodeId === nodeId;
                setSelectedNode(nodeId);
                if (isAlreadySelected) {
                    postSelectedNodeToIframe();
                }
            }
        });
    }

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

    function renderAll() {
        syncSelectedNode();
        syncActiveWorkspaceFromState();
        renderUIState();
        renderFileInputState();
        renderWorkspaceSelector();
        renderGraphFetchStatus();
        renderToolbarState();
        renderConsoleDockState();
        renderConsole();
        renderMainView();
        renderTreeView();
        renderBirdView();
    }

    document.addEventListener("DOMContentLoaded", function () {
        bindToolbarControls();
        bindConsoleControls();
        bindConsoleDockControls();
        bindFileInputControls();
        bindWorkspaceSelectorControls();
        bindVisualizerTabClicks();
        bindGraphFetchControls();
        bindTreeViewInteractions();
        bindIframeSelectionMessages();
        window.addEventListener("resize", function () {
            renderBirdView();
        });
        renderAll();
    });
})();
