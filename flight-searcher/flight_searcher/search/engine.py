"""Search engine: runs every strategy, dedupes, rates, and ranks offers."""

from __future__ import annotations

from ..analysis import rate_offers
from ..models import FlightOffer, SearchQuery
from ..providers.base import FlightProvider
from .strategies import DEFAULT_STRATEGIES, SearchStrategy


class SearchEngine:
    def __init__(self, provider: FlightProvider,
                 strategies: list[SearchStrategy] | None = None):
        self.provider = provider
        self.strategies = strategies if strategies is not None else DEFAULT_STRATEGIES

    def search(self, query: SearchQuery, limit: int = 10) -> list[FlightOffer]:
        """Cheapest offers across all strategies, best deals first."""
        offers: list[FlightOffer] = []
        for strategy in self.strategies:
            offers.extend(strategy.find(query, self.provider))

        offers = self._filter(offers, query)
        offers = self._deduplicate(offers)
        offers = rate_offers(offers, query)
        offers.sort(key=lambda o: o.price)
        return offers[:limit]

    @staticmethod
    def _filter(offers: list[FlightOffer], query: SearchQuery) -> list[FlightOffer]:
        if query.max_stops is None:
            return offers
        return [o for o in offers if o.stops <= query.max_stops]

    @staticmethod
    def _deduplicate(offers: list[FlightOffer]) -> list[FlightOffer]:
        """Keep the cheapest offer per unique itinerary."""
        best: dict[tuple, FlightOffer] = {}
        for offer in offers:
            key = tuple(
                (s.origin, s.destination, s.departure, s.flight_number)
                for s in offer.segments
            )
            if key not in best or offer.price < best[key].price:
                best[key] = offer
        return list(best.values())
