(function () {
    "use strict";

    // TODO: add D3-based rendering for the active visualizer in Main View.
    // TODO: improve focus synchronization behavior across Main/Tree/Bird interactions.
    // TODO: replace mock data state with platform/API integration payloads.
    const state = {
        activeVisualizer: "simple",
        selectedNodeId: null,
        graph: window.GRAPH_EXPLORER_MOCK_GRAPH || { nodes: [], edges: [] }
    };

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
        renderMainView();
        renderTreeView();
        renderBirdView();
    }

    document.addEventListener("DOMContentLoaded", function () {
        bindVisualizerTabClicks();
        renderAll();
    });
})();
