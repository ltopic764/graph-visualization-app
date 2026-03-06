(function (global) {
    "use strict";

    // Encapsulates Bird View iframe synchronization with Main View.
    const DEFAULT_MAIN_IFRAME_ID = "main-view-visualizer-iframe";
    const DEFAULT_BIRD_IFRAME_ID = "bird-view-iframe";
    const DEFAULT_SVG_NS = "http://www.w3.org/2000/svg";
    const DEFAULT_ZOOM_OUT_FACTOR = 1.35;

    // Creates a Bird View controller with injected ids and state accessors.
    function createBirdViewController(config) {
        const options = config && typeof config === "object" ? config : {};
        const mainIframeId = typeof options.mainIframeId === "string" && options.mainIframeId
            ? options.mainIframeId
            : DEFAULT_MAIN_IFRAME_ID;
        const birdIframeId = typeof options.birdIframeId === "string" && options.birdIframeId
            ? options.birdIframeId
            : DEFAULT_BIRD_IFRAME_ID;
        const svgNs = typeof options.svgNs === "string" && options.svgNs
            ? options.svgNs
            : DEFAULT_SVG_NS;
        const zoomOutFactor = Number.isFinite(options.zoomOutFactor) && options.zoomOutFactor > 1
            ? Number(options.zoomOutFactor)
            : DEFAULT_ZOOM_OUT_FACTOR;
        const getSelectedNodeId = typeof options.getSelectedNodeId === "function"
            ? options.getSelectedNodeId
            : function () { return null; };

        const birdViewSync = {
            boundScrollEl: null,
            boundScrollHandler: null,
            boundMainSvg: null,
            boundMainSvgObserver: null,
            viewportUpdatePending: false,
            viewportUpdateRafId: null
        };

        // Returns the Main View visualizer iframe element.
        function getMainIframe() {
            return document.getElementById(mainIframeId);
        }

        // Returns the Bird View iframe element.
        function getBirdIframe() {
            return document.getElementById(birdIframeId);
        }

        // Removes active Bird View scroll and mutation bindings.
        function clearSyncBindings() {
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

        // Cancels any queued Bird View update frame.
        function clearScheduledUpdate() {
            if (birdViewSync.viewportUpdateRafId !== null) {
                cancelAnimationFrame(birdViewSync.viewportUpdateRafId);
            }
            birdViewSync.viewportUpdatePending = false;
            birdViewSync.viewportUpdateRafId = null;
        }

        // Collects Main View SVG and scroll context needed for sync.
        function getMainVisualizerContext() {
            const iframe = getMainIframe();
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

        // Resolves current Main View zoom scale from attributes or style.
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

        // Resolves current Main View pan offset for the given axis.
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

        // Calculates the currently visible graph rectangle in graph coordinates.
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

        // Expands a rectangle around its center by a zoom-out factor.
        function getExpandedRect(rect, factor) {
            if (!rect || !Number.isFinite(rect.width) || !Number.isFinite(rect.height) || rect.width <= 0 || rect.height <= 0) {
                return null;
            }

            const localZoomOutFactor = Number.isFinite(factor) && factor > 1 ? factor : 1;
            const expandedWidth = rect.width * localZoomOutFactor;
            const expandedHeight = rect.height * localZoomOutFactor;
            const deltaW = expandedWidth - rect.width;
            const deltaH = expandedHeight - rect.height;

            return {
                x: rect.x - (deltaW / 2),
                y: rect.y - (deltaH / 2),
                width: expandedWidth,
                height: expandedHeight
            };
        }

        // Applies a validated viewBox rectangle to an SVG element.
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

        // Copies Main View iframe content into Bird View iframe when changed.
        function syncBirdIframeToMain() {
            const mainIframe = getMainIframe();
            const birdIframe = getBirdIframe();
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

        // Computes graph bounds from Bird View SVG content.
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
            // Expands running min/max bounds with one point.
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

        // Ensures the orange viewport rectangle exists on Bird View SVG.
        function ensureBirdViewportRect(birdDoc, svg) {
            let rect = birdDoc.getElementById("bird-viewport-rect");
            if (!rect) {
                rect = birdDoc.createElementNS(svgNs, "rect");
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

        // Syncs node and edge markup from Main View into Bird View.
        function syncBirdGraphGeometryFromMain(context) {
            const sourceContext = context || getMainVisualizerContext();
            const birdIframe = getBirdIframe();
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

        // Applies Main View camera framing to Bird View SVG viewBox.
        function syncBirdViewBoxToMain(context) {
            const sourceContext = context || getMainVisualizerContext();
            const birdIframe = getBirdIframe();
            if (!birdIframe || !birdIframe.contentDocument) {
                return;
            }

            const birdDoc = birdIframe.contentDocument;
            const svg = birdDoc.getElementById("viz-svg");
            if (!svg) {
                return;
            }

            const visibleRect = getMainVisibleGraphRect(sourceContext);
            const expandedRect = getExpandedRect(visibleRect, zoomOutFactor);
            if (setSvgViewBox(svg, expandedRect)) {
                return;
            }

            const bounds = computeBirdGraphBounds(svg);
            if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
                return;
            }
            setSvgViewBox(svg, getExpandedRect(bounds, zoomOutFactor));
        }

        // Configures Bird View iframe document styles and SVG sizing.
        function configureBirdIframeDocument() {
            const birdIframe = getBirdIframe();
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

        // Escapes a value for use inside a CSS attribute selector.
        function getCssEscapedAttributeValue(value) {
            const str = String(value);
            if (global.CSS && typeof global.CSS.escape === "function") {
                return global.CSS.escape(str);
            }
            return str.replace(/["\\]/g, "\\$&");
        }

        // Highlights the currently selected node inside Bird View.
        function updateSelectionHighlight() {
            const birdIframe = getBirdIframe();
            if (!birdIframe || !birdIframe.contentDocument) {
                return;
            }

            const birdDoc = birdIframe.contentDocument;
            const nodeEls = birdDoc.querySelectorAll("[data-node-id]");
            for (let i = 0; i < nodeEls.length; i += 1) {
                nodeEls[i].classList.remove("selected");
            }

            const selectedNodeId = getSelectedNodeId();
            if (!selectedNodeId) {
                return;
            }

            const escapedId = getCssEscapedAttributeValue(selectedNodeId);
            const selectedNodeEl = birdDoc.querySelector(`[data-node-id="${escapedId}"]`);
            if (selectedNodeEl) {
                selectedNodeEl.classList.add("selected");
            }
        }

        // Updates the orange viewport rectangle to match Main View.
        function updateBirdViewportRect(context) {
            const sourceContext = context || getMainVisualizerContext();
            const birdIframe = getBirdIframe();
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

        // Refreshes Bird View geometry, viewport rectangle, and selection.
        function refreshViewportAndFocus(context) {
            syncBirdGraphGeometryFromMain(context);
            syncBirdViewBoxToMain(context);
            updateBirdViewportRect(context);
            updateSelectionHighlight();
        }

        // Schedules one animation-frame Bird View refresh.
        function scheduleViewportAndFocusUpdate() {
            if (birdViewSync.viewportUpdatePending) {
                return;
            }
            birdViewSync.viewportUpdatePending = true;
            birdViewSync.viewportUpdateRafId = requestAnimationFrame(function () {
                birdViewSync.viewportUpdatePending = false;
                birdViewSync.viewportUpdateRafId = null;
                refreshViewportAndFocus();
            });
        }

        // Binds scroll and SVG observers that drive Bird View sync.
        function bindViewportSync() {
            const context = getMainVisualizerContext();
            if (!context || !context.scrollEl) {
                clearSyncBindings();
                clearScheduledUpdate();
                return;
            }

            if (birdViewSync.boundScrollEl !== context.scrollEl || !birdViewSync.boundScrollHandler) {
                clearSyncBindings();
                const onScroll = function () {
                    scheduleViewportAndFocusUpdate();
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
                    scheduleViewportAndFocusUpdate();
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

            refreshViewportAndFocus(context);
        }

        // Binds Bird View iframe load lifecycle once.
        function bindIframeLifecycle() {
            const birdIframe = getBirdIframe();
            if (!birdIframe || birdIframe.dataset.birdLifecycleBound === "true") {
                return;
            }

            birdIframe.dataset.birdLifecycleBound = "true";
            birdIframe.addEventListener("load", function () {
                configureBirdIframeDocument();
                updateSelectionHighlight();
                scheduleViewportAndFocusUpdate();
            });
        }

        // Rebuilds Bird View from current Main View iframe output.
        function renderFromMainIframe() {
            bindIframeLifecycle();
            syncBirdIframeToMain();
            configureBirdIframeDocument();
            bindViewportSync();
            updateSelectionHighlight();
            scheduleViewportAndFocusUpdate();
        }

        // Clears all Bird View sync state and pending updates.
        function reset() {
            clearSyncBindings();
            clearScheduledUpdate();
        }

        return {
            bindIframeLifecycle: bindIframeLifecycle,
            bindViewportSync: bindViewportSync,
            clearScheduledUpdate: clearScheduledUpdate,
            clearSyncBindings: clearSyncBindings,
            refreshViewportAndFocus: refreshViewportAndFocus,
            renderFromMainIframe: renderFromMainIframe,
            reset: reset,
            scheduleViewportAndFocusUpdate: scheduleViewportAndFocusUpdate,
            updateSelectionHighlight: updateSelectionHighlight
        };
    }

    global.GraphExplorerBirdView = {
        createController: createBirdViewController
    };
})(window);
