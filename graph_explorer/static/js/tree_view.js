(function (global) {
    "use strict";

    const DEFAULT_TREE_VIEW_ELEMENT_ID = "tree-view-content";

    // Creates a Tree View controller with injected state access and callbacks.
    function createTreeViewController(config) {
        const options = config && typeof config === "object" ? config : {};
        const treeViewElementId = typeof options.treeViewElementId === "string" && options.treeViewElementId
            ? options.treeViewElementId
            : DEFAULT_TREE_VIEW_ELEMENT_ID;
        const getState = typeof options.getState === "function" ? options.getState : function () { return {}; };
        const hasLoadedGraph = typeof options.hasLoadedGraph === "function" ? options.hasLoadedGraph : function () { return false; };
        const getNodes = typeof options.getNodes === "function" ? options.getNodes : function () { return []; };
        const getEdges = typeof options.getEdges === "function" ? options.getEdges : function () { return []; };
        const escapeHtml = typeof options.escapeHtml === "function"
            ? options.escapeHtml
            : function (value) { return String(value); };
        const setSelectedNode = typeof options.setSelectedNode === "function"
            ? options.setSelectedNode
            : function () {};
        const postSelectedNodeToIframe = typeof options.postSelectedNodeToIframe === "function"
            ? options.postSelectedNodeToIframe
            : function () {};

        // Returns the Tree View root element.
        function getTreeViewElement() {
            return document.getElementById(treeViewElementId);
        }

        // Clears Tree View expansion and graph signature state.
        function resetTreeState() {
            const state = getState();
            if (!state.treeUI || typeof state.treeUI !== "object") {
                return;
            }

            state.treeUI.expanded = {};
            state.treeUI.lastGraphId = null;
            state.treeUI.lastGraphSignature = "";
            state.treeUI.autoExpandedOnce = false;
        }

        // Resolves a node id from graph node payload or fallback index.
        function getGraphNodeId(node, index) {
            if (node && node.id !== undefined && node.id !== null) {
                return String(node.id);
            }
            return `__node_${index}`;
        }

        // Builds the Tree View node label text.
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

        // Formats node attribute values for Tree View display.
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

        // Returns flat key/value entries for node attributes.
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

        // Normalizes edge source/target values into string node ids.
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

        // Extracts normalized source node id from an edge payload.
        function getEdgeSourceId(edge) {
            if (!edge || typeof edge !== "object") {
                return null;
            }
            return normalizeEdgeNodeId(edge.source);
        }

        // Extracts normalized target node id from an edge payload.
        function getEdgeTargetId(edge) {
            if (!edge || typeof edge !== "object") {
                return null;
            }
            return normalizeEdgeNodeId(edge.target);
        }

        // Collects unique node ids in Tree View sort order.
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

        // Detects whether a node id string is numeric.
        function isNumericNodeId(nodeId) {
            return /^-?\d+(\.\d+)?$/.test(String(nodeId));
        }

        // Sorts node ids with numeric-aware ordering.
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

        // Builds adjacency sets used by Tree View neighbor rendering.
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

        // Produces a graph signature so expansion state resets when graph changes.
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

        // Keeps saved Tree View UI state aligned with the active graph.
        function syncTreeUIState(nodeIds, signature) {
            const state = getState();
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

        // Renders one Tree View node row with optional details and neighbors.
        function renderTreeNodeHtml(nodeId, nodeById, adjacency) {
            const state = getState();
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

        // Builds a CSS selector for a node id in Tree View markup.
        function getTreeNodeSelector(nodeId) {
            if (!nodeId) {
                return null;
            }
            if (global.CSS && typeof global.CSS.escape === "function") {
                return `.tree-node[data-node-id="${global.CSS.escape(String(nodeId))}"]`;
            }
            return `.tree-node[data-node-id="${String(nodeId).replace(/"/g, '\\"')}"]`;
        }

        // Scrolls the selected Tree View row into view when needed.
        function scrollTreeSelectionIntoView(treeView) {
            const state = getState();
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

        // Renders Tree View HTML from current graph and selection state.
        function renderTreeView() {
            const state = getState();
            const treeView = getTreeViewElement();
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

        // Binds click interactions for expand/collapse and node selection.
        function bindTreeViewInteractions() {
            const treeView = getTreeViewElement();
            if (!treeView || treeView.dataset.treeBindings === "ready") {
                return;
            }
            treeView.dataset.treeBindings = "ready";

            treeView.addEventListener("click", function (event) {
                const state = getState();

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

        return {
            bindInteractions: bindTreeViewInteractions,
            render: renderTreeView,
            resetState: resetTreeState
        };
    }

    global.GraphExplorerTreeView = {
        createController: createTreeViewController
    };
})(window);
