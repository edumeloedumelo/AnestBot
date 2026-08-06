"""Provider interface: anything that can return flight offers for a query."""

from __future__ import annotations

from abc import ABC, abstractmethod

from ..models import FlightOffer, SearchQuery


class FlightProvider(ABC):
    """A source of flight offers (an API, a GDS, or mock data)."""

    name: str = "provider"

    @abstractmethod
    def search(self, query: SearchQuery) -> list[FlightOffer]:
        """Return offers for the exact query (no strategy expansion)."""
        raise NotImplementedError
