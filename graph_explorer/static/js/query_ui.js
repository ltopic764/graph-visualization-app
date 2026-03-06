(function () {
    "use strict";

    // Build a query UI controller that manages search/filter inputs, chips, and related actions.
    function createController(options) {
        const defaultFilterOperator = options.defaultFilterOperator;
        const filterErrorAutoHideMs = options.filterErrorAutoHideMs;
        const graphSearchEndpoint = options.graphSearchEndpoint;
        const graphFilterEndpoint = options.graphFilterEndpoint;
        const workspaceResetEndpoint = options.workspaceResetEndpoint;
        const getState = options.getState;
        const syncActiveWorkspaceFromState = options.syncActiveWorkspaceFromState;
        const renderAll = options.renderAll;
        const loadVisualizerOutput = options.loadVisualizerOutput;
        const pushConsoleOutputLine = options.pushConsoleOutputLine;
        const renderConsole = options.renderConsole;
        const postJsonRequest = options.postJsonRequest;
        const isValidGraphShape = options.isValidGraphShape;
        const toGraphState = options.toGraphState;
        let filterErrorHideTimeoutId = null;

        // Lookup all toolbar and query-related DOM elements.
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

        // Cancel the pending auto-hide timeout for filter errors.
        function clearFilterErrorHideTimeout() {
            if (filterErrorHideTimeoutId !== null) {
                clearTimeout(filterErrorHideTimeoutId);
                filterErrorHideTimeoutId = null;
            }
        }

        // Hide the filter error message area and clear its text.
        function hideFilterErrorMessage() {
            const refs = getToolbarElements();
            if (!refs.filterErrorMessage) {
                return;
            }
            refs.filterErrorMessage.textContent = "";
            refs.filterErrorMessage.hidden = true;
        }

        // Show a filter error message and auto-hide it after a short delay.
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
            }, filterErrorAutoHideMs);
        }

        // Create a new applied query chip and advance the chip id counter.
        function createAppliedChip(label, type, payload) {
            const state = getState();
            const chip = {
                id: state.queryUI.nextChipId,
                label: label,
                type: type,
                payload: payload
            };
            state.queryUI.nextChipId += 1;
            return chip;
        }

        // Render the list of applied query chips in the toolbar.
        function renderAppliedChips() {
            const state = getState();
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

        // Sync toolbar form values and summary labels from current query UI state.
        function renderToolbarState() {
            const state = getState();
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

        // Apply text search to the active workspace and refresh rendered graph data.
        async function sendSearchRequest(queryText) {
            const state = getState();
            const query = String(queryText ?? "").trim();

            if (!state.activeGraphId) {
                pushConsoleOutputLine("Load a graph first.");
                renderConsole();
                return false;
            }

            if (!query) {
                return false;
            }

            const result = await postJsonRequest(graphSearchEndpoint, {
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

        // Apply attribute filter to the active workspace and refresh rendered graph data.
        async function sendFilterRequest(attributeText, operatorText, valueText) {
            const state = getState();
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

            const result = await postJsonRequest(graphFilterEndpoint, payload);

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

        // Handle search submit while preserving input state on failures.
        async function handleSearchQuery() {
            const state = getState();
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

        // Handle filter submit while preserving input state on failures.
        async function handleFilterQuery() {
            const state = getState();
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
            state.queryUI.filterOperator = defaultFilterOperator;
            state.queryUI.filterValue = "";
            renderToolbarState();
        }

        // Clear applied query state and request backend workspace reset.
        async function resetQueryFilterState() {
            const state = getState();
            state.queryUI.searchText = "";
            state.queryUI.filterAttribute = "";
            state.queryUI.filterOperator = defaultFilterOperator;
            state.queryUI.filterValue = "";
            state.queryUI.appliedChips = [];
            state.queryUI.nextChipId = 1;
            clearFilterErrorHideTimeout();
            hideFilterErrorMessage();
            renderToolbarState();

            if (!state.activeGraphId) {
                return;
            }

            const result = await postJsonRequest(workspaceResetEndpoint, {
                graph_id: state.activeGraphId
            });

            if (result.ok && result.payload && result.payload.graph) {
                const originalGraph = result.payload.graph;
                if (isValidGraphShape(originalGraph)) {
                    state.graph = toGraphState(originalGraph);
                    state.graphOriginal = toGraphState(originalGraph);
                    renderAll();
                    loadVisualizerOutput();
                }
            }
        }

        // Bind search/filter toolbar events to query state and actions.
        function bindToolbarControls() {
            const state = getState();
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

        return {
            bindToolbarControls: bindToolbarControls,
            renderToolbarState: renderToolbarState,
            clearFilterErrorHideTimeout: clearFilterErrorHideTimeout,
            hideFilterErrorMessage: hideFilterErrorMessage
        };
    }

    window.GraphExplorerQueryUI = {
        createController: createController
    };
})();
