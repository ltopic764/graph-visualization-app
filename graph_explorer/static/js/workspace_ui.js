(function () {
    "use strict";

    // Create a workspace selector controller that delegates state and actions to app callbacks.
    function createController(options) {
        const config = options && typeof options === "object" ? options : {};
        const getWorkspaceById = typeof config.getWorkspaceById === "function"
            ? config.getWorkspaceById
            : function () {
                return null;
            };
        const getWorkspaceIds = typeof config.getWorkspaceIds === "function"
            ? config.getWorkspaceIds
            : function () {
                return [];
            };
        const getActiveGraphId = typeof config.getActiveGraphId === "function"
            ? config.getActiveGraphId
            : function () {
                return null;
            };
        const setActiveWorkspace = typeof config.setActiveWorkspace === "function"
            ? config.setActiveWorkspace
            : function () {};
        const removeWorkspace = typeof config.removeWorkspace === "function"
            ? config.removeWorkspace
            : function () {};

        // Resolve workspace selector elements from the current document.
        function getWorkspaceSelectorElements() {
            return {
                list: document.getElementById("workspace-selector-list"),
                empty: document.getElementById("workspace-selector-empty")
            };
        }

        // Render workspace tabs and close buttons for the current workspace collection.
        function renderWorkspaceSelector() {
            const refs = getWorkspaceSelectorElements();
            if (!refs.list) {
                return;
            }

            refs.list.innerHTML = "";
            const workspaceIdsSource = getWorkspaceIds();
            const workspaceIds = Array.isArray(workspaceIdsSource) ? workspaceIdsSource : [];
            if (!workspaceIds.length) {
                if (refs.empty) {
                    refs.empty.hidden = false;
                }
                return;
            }

            if (refs.empty) {
                refs.empty.hidden = true;
            }

            const activeGraphId = getActiveGraphId();
            workspaceIds.forEach(function (graphId, index) {
                const workspace = getWorkspaceById(graphId);
                if (!workspace) {
                    return;
                }

                const item = document.createElement("div");
                item.className = "workspace-item";
                const isActiveWorkspace = graphId === activeGraphId;
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

        // Bind delegated click handling for selecting and closing workspaces.
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

        return {
            renderWorkspaceSelector: renderWorkspaceSelector,
            bindWorkspaceSelectorControls: bindWorkspaceSelectorControls
        };
    }

    window.GraphExplorerWorkspaceUI = {
        createController: createController
    };
})();
