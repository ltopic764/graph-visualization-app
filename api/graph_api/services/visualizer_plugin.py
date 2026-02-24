"""Visualizer plugin interface definitions."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any
from ..model import Graph


class VisualizerPlugin(ABC):
    """Contract for plugins that render graph objects to HTML output."""

    @property
    @abstractmethod
    def plugin_id(self) -> str:
        """Return a unique, stable plugin identifier."""

    @property
    @abstractmethod
    def display_name(self) -> str:
        """Return a human-readable plugin name for UI and logs."""

    def render_options_schema(self) -> dict[str, Any] | None:
        """Return an optional render options schema for UI/platform integration."""
        # TODO: Replace generic dict schema with a shared typed schema contract.
        return None

    @abstractmethod
    def render(self, graph: "Graph", **options: Any) -> str:
        """Render the provided graph and return HTML output."""
