(function () {
    "use strict";

    // TODO: add D3-based rendering for the active visualizer in Main View.
    // TODO: improve focus synchronization behavior across Main/Tree/Bird interactions.
    // TODO: replace mock data state with platform/API integration payloads.
    const EMPTY_GRAPH = { nodes: [], edges: [] };
    const DEFAULT_FILTER_OPERATOR = "==";
    const CONSOLE_PLACEHOLDER_OUTPUT = "Command execution is not implemented yet (frontend-only placeholder).";

    const state = {
        activeVisualizer: "simple",
        selectedNodeId: null,
        graph: EMPTY_GRAPH,
        queryUI: {
            searchText: "",
            filterAttribute: "",
            filterOperator: DEFAULT_FILTER_OPERATOR,
            filterValue: "",
            appliedChips: [],
            nextChipId: 1
        },
        consoleUI: {
            currentInput: "",
            history: [],
            outputLines: [],
            maxHistory: 20,
            maxOutputLines: 120
        }
    };

    function isValidGraphShape(graph) {
        return Boolean(graph) && Array.isArray(graph.nodes) && Array.isArray(graph.edges);
    }

    function toGraphState(graph) {
        if (!isValidGraphShape(graph)) {
            return EMPTY_GRAPH;
        }
        return {
            nodes: graph.nodes,
            edges: graph.edges
        };
    }

    function getWindowMockGraph() {
        if (!isValidGraphShape(window.GRAPH_EXPLORER_MOCK_GRAPH)) {
            return null;
        }
        return toGraphState(window.GRAPH_EXPLORER_MOCK_GRAPH);
    }

    async function loadGraphData() {
        try {
            const response = await fetch("/api/mock-graph/", {
                headers: { Accept: "application/json" }
            });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const payload = await response.json();
            if (!isValidGraphShape(payload)) {
                throw new Error("Invalid graph response shape; expected nodes[] and edges[].");
            }

            state.graph = toGraphState(payload);
            renderAll();
        } catch (error) {
            console.warn("Graph Explorer: unable to load /api/mock-graph/.", error);

            const fallbackGraph = getWindowMockGraph();
            if (fallbackGraph) {
                console.warn("Graph Explorer: falling back to window.GRAPH_EXPLORER_MOCK_GRAPH.");
                state.graph = fallbackGraph;
            } else {
                state.graph = EMPTY_GRAPH;
            }

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

    function setSelectedNode(nodeId) {
        state.selectedNodeId = nodeId ? String(nodeId) : null;
        renderAll();
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
    }

    function getToolbarElements() {
        return {
            searchInput: document.getElementById("search-input"),
            filterAttributeInput: document.getElementById("filter-attribute-input"),
            filterOperatorSelect: document.getElementById("filter-operator-select"),
            filterValueInput: document.getElementById("filter-value-input"),
            applyQueryButton: document.getElementById("apply-query-button"),
            clearQueryButton: document.getElementById("clear-query-state-button"),
            appliedQueryTags: document.getElementById("applied-query-tags"),
            appliedQueryCount: document.getElementById("applied-query-count"),
            appliedQueryEmpty: document.getElementById("applied-query-empty"),
            searchPreview: document.getElementById("search-preview")
        };
    }

    function getConsoleElements() {
        return {
            commandInput: document.getElementById("console-command-input"),
            runButton: document.getElementById("console-run-button"),
            clearButton: document.getElementById("console-clear-button"),
            output: document.getElementById("console-output"),
            outputEmpty: document.getElementById("console-output-empty"),
            historyList: document.getElementById("console-history-list"),
            historyEmpty: document.getElementById("console-history-empty")
        };
    }

    function pushConsoleHistory(command) {
        state.consoleUI.history.push(command);
        if (state.consoleUI.history.length > state.consoleUI.maxHistory) {
            state.consoleUI.history = state.consoleUI.history.slice(-state.consoleUI.maxHistory);
        }
    }

    function pushConsoleOutputLine(line) {
        state.consoleUI.outputLines.push(line);
        if (state.consoleUI.outputLines.length > state.consoleUI.maxOutputLines) {
            state.consoleUI.outputLines = state.consoleUI.outputLines.slice(-state.consoleUI.maxOutputLines);
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

        if (refs.historyList) {
            refs.historyList.innerHTML = "";
            state.consoleUI.history.slice().reverse().forEach(function (command) {
                const itemEl = document.createElement("li");
                itemEl.className = "console-history-item";
                itemEl.textContent = command;
                refs.historyList.appendChild(itemEl);
            });
        }

        if (refs.historyEmpty) {
            refs.historyEmpty.style.display = state.consoleUI.history.length ? "none" : "";
        }
    }

    function handleRunConsoleCommand() {
        const command = state.consoleUI.currentInput.trim();
        if (!command) {
            return;
        }

        pushConsoleHistory(command);
        pushConsoleOutputLine(`> ${command}`);
        pushConsoleOutputLine(CONSOLE_PLACEHOLDER_OUTPUT);

        // TODO: parse and validate supported console commands.
        // TODO: connect console commands to backend/platform endpoint.
        // TODO: map command responses to corresponding console UI updates.

        state.consoleUI.currentInput = "";
        renderConsole();
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

            const removeButton = document.createElement("button");
            removeButton.type = "button";
            removeButton.className = "query-tag-remove";
            removeButton.setAttribute("data-chip-id", String(chip.id));
            removeButton.setAttribute("aria-label", `Remove query: ${chip.label}`);
            removeButton.textContent = "x";

            chipEl.appendChild(labelEl);
            chipEl.appendChild(removeButton);
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
    }

    function removeAppliedChip(chipId) {
        const targetId = String(chipId);
        state.queryUI.appliedChips = state.queryUI.appliedChips.filter(function (chip) {
            return String(chip.id) !== targetId;
        });
        renderToolbarState();
    }

    function handleApplyQuery() {
        const searchText = state.queryUI.searchText.trim();
        const attribute = state.queryUI.filterAttribute.trim();
        const operator = state.queryUI.filterOperator.trim();
        const value = state.queryUI.filterValue.trim();
        const chipsToAdd = [];

        if (searchText) {
            chipsToAdd.push(createAppliedChip(`search: ${searchText}`, "search", { searchText: searchText }));
        }

        if (attribute && operator && value) {
            chipsToAdd.push(createAppliedChip(`${attribute} ${operator} ${value}`, "filter", {
                attribute: attribute,
                operator: operator,
                value: value
            }));
        }

        if (!chipsToAdd.length) {
            renderToolbarState();
            return;
        }

        state.queryUI.appliedChips = state.queryUI.appliedChips.concat(chipsToAdd);

        // TODO: send query/filter payload to backend and rerender filtered subgraph.
        renderToolbarState();
    }

    function resetQueryFilterState() {
        state.queryUI.searchText = "";
        state.queryUI.filterAttribute = "";
        state.queryUI.filterOperator = DEFAULT_FILTER_OPERATOR;
        state.queryUI.filterValue = "";
        state.queryUI.appliedChips = [];
        state.queryUI.nextChipId = 1;

        // TODO: when backend filtering is integrated, clear server-side query/filter state too.
        renderToolbarState();
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
        });

        refs.filterOperatorSelect.addEventListener("change", function (event) {
            state.queryUI.filterOperator = event.target.value;
        });

        refs.filterValueInput.addEventListener("input", function (event) {
            state.queryUI.filterValue = event.target.value;
        });

        if (refs.applyQueryButton) {
            refs.applyQueryButton.addEventListener("click", function () {
                handleApplyQuery();
            });
        }

        if (refs.clearQueryButton) {
            refs.clearQueryButton.addEventListener("click", function () {
                resetQueryFilterState();
            });
        }

        if (refs.appliedQueryTags) {
            refs.appliedQueryTags.addEventListener("click", function (event) {
                const target = event.target;
                if (!target || !target.matches("[data-chip-id]")) {
                    return;
                }
                removeAppliedChip(target.getAttribute("data-chip-id"));
            });
        }

        [refs.searchInput, refs.filterAttributeInput, refs.filterValueInput].forEach(function (input) {
            input.addEventListener("keydown", function (event) {
                if (event.key === "Enter") {
                    event.preventDefault();
                    handleApplyQuery();
                }
            });
        });
    }

    function bindMainNodeCardClicks(mainView) {
        const cards = mainView.querySelectorAll("[data-node-id]");
        cards.forEach(function (card) {
            card.addEventListener("click", function () {
                const encodedId = card.getAttribute("data-node-id");
                if (!encodedId) {
                    setSelectedNode(null);
                } else {
                    try {
                        setSelectedNode(decodeURIComponent(encodedId));
                    } catch (error) {
                        setSelectedNode(encodedId);
                    }
                }
            });
        });
    }

    function renderMainView() {
        const mainView = document.getElementById("main-view-content");
        if (!mainView) {
            return;
        }

        const nodes = getNodes();
        const edges = getEdges();

        const nodeCards = nodes.length
            ? nodes.map(function (node) {
                const rawNodeId = node.id !== undefined && node.id !== null ? String(node.id) : "unknown";
                const nodeIdLabel = escapeHtml(rawNodeId);
                const nodeIdAttr = encodeURIComponent(rawNodeId);
                const attrs = getNodeAttributes(node, 3)
                    .map(function (attr) {
                        return `<p class="node-card-meta">${escapeHtml(attr.key)}: ${escapeHtml(attr.value)}</p>`;
                    })
                    .join("");
                const selectedClass = rawNodeId === state.selectedNodeId ? " selected" : "";
                return [
                    `<button type="button" class="node-card${selectedClass}" data-node-id="${nodeIdAttr}">`,
                    `<p class="node-card-title">Node: ${nodeIdLabel}</p>`,
                    attrs || '<p class="node-card-meta">No extra attributes</p>',
                    "</button>"
                ].join("");
            }).join("")
            : '<p class="empty-note">No nodes available in mock graph.</p>';

        const edgeRows = edges.length
            ? edges.map(function (edge) {
                const edgeId = edge.id ? `${escapeHtml(edge.id)}: ` : "";
                const source = escapeHtml(edge.source || "?");
                const target = escapeHtml(edge.target || "?");
                return `<li>${edgeId}${source} -> ${target}</li>`;
            }).join("")
            : "<li>No edges available in mock graph.</li>";

        mainView.innerHTML = [
            '<p class="view-meta"><strong>Main View placeholder</strong></p>',
            `<p class="view-meta">Active visualizer: <span class="visualizer-pill">${escapeHtml(state.activeVisualizer)}</span></p>`,
            `<p class="view-meta">Nodes: ${nodes.length} | Edges: ${edges.length}</p>`,
            `<div class="node-cards">${nodeCards}</div>`,
            '<p class="view-meta"><strong>Edges</strong></p>',
            `<ul class="placeholder-list">${edgeRows}</ul>`
        ].join("");

        bindMainNodeCardClicks(mainView);
    }

    function renderTreeView() {
        const treeView = document.getElementById("tree-view-content");
        if (!treeView) {
            return;
        }

        const nodes = getNodes();
        if (!nodes.length) {
            treeView.innerHTML = '<p class="empty-note">Tree placeholder: no nodes to list.</p>';
            return;
        }

        const treeItems = nodes.map(function (node) {
            const rawNodeId = node.id !== undefined && node.id !== null ? String(node.id) : "unknown";
            const isSelected = rawNodeId === state.selectedNodeId;
            const selectedClass = isSelected ? " selected" : "";
            const marker = isSelected ? "●" : "○";
            const label = node.label ? ` - ${escapeHtml(node.label)}` : "";
            return [
                `<li class="tree-item${selectedClass}">`,
                `<span class="tree-marker">${marker}</span>`,
                `<span>${escapeHtml(rawNodeId)}${label}</span>`,
                "</li>"
            ].join("");
        }).join("");

        treeView.innerHTML = [
            '<p class="view-meta"><strong>Tree placeholder</strong></p>',
            `<ul class="tree-list">${treeItems}</ul>`
        ].join("");
    }

    function renderBirdView() {
        const birdView = document.getElementById("bird-view-content");
        if (!birdView) {
            return;
        }

        const nodes = getNodes();
        const edges = getEdges();
        const selectedNode = state.selectedNodeId ? getNodeById(state.selectedNodeId) : null;

        let selectedSummary = '<p class="empty-note">Selected node: none</p>';
        if (selectedNode) {
            const selectedAttrs = getNodeAttributes(selectedNode, 2)
                .map(function (attr) {
                    return `${escapeHtml(attr.key)}=${escapeHtml(attr.value)}`;
                })
                .join(", ");
            selectedSummary = [
                `<p class="view-meta">Selected node: <strong>${escapeHtml(selectedNode.id)}</strong></p>`,
                `<p class="view-meta">${selectedAttrs || "No additional attributes"}</p>`
            ].join("");
        }

        birdView.innerHTML = [
            '<p class="view-meta"><strong>Bird placeholder overview</strong></p>',
            `<p class="view-meta">Active visualizer: <span class="visualizer-pill">${escapeHtml(state.activeVisualizer)}</span></p>`,
            `<p class="view-meta">Nodes: ${nodes.length} | Edges: ${edges.length}</p>`,
            selectedSummary
        ].join("");
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
            panelNote.textContent = `Active visualizer: ${state.activeVisualizer}`;
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
    }

    function renderAll() {
        syncSelectedNode();
        renderUIState();
        renderToolbarState();
        renderConsole();
        renderMainView();
        renderTreeView();
        renderBirdView();
    }

    document.addEventListener("DOMContentLoaded", function () {
        bindToolbarControls();
        bindConsoleControls();
        bindVisualizerTabClicks();
        renderAll();
        loadGraphData();
    });
})();
