"""Datasource plugin interface definitions."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any
from api.graph_api.model import Graph


class DataSourcePlugin(ABC):
    """Contract for plugins that load graph data from external sources."""

    @property
    @abstractmethod
    def plugin_id(self) -> str:
        """Return a unique, stable plugin identifier."""

    @property
    @abstractmethod
    def display_name(self) -> str:
        """Return a human-readable plugin name for UI and logs."""

    def parameters_schema(self) -> dict[str, Any] | None:
        """Return an optional parameter schema for UI/platform integration."""
        # TODO: Replace generic dict schema with a shared typed schema contract.
        return None

    @abstractmethod
    def load_graph(self, source: Any, **options: Any) -> Graph:
        """Load and return a graph object from the provided source."""
