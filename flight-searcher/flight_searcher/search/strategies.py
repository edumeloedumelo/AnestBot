"""Cheap-fare search strategies.

Each strategy expands one base query into the extra queries an expert
fare hunter would run by hand:

* ``FlexibleDatesStrategy``  - scan +/-N days around the requested dates.
* ``NearbyAirportsStrategy`` - try every airport in both metro areas.
* ``SplitTicketStrategy``    - long-haul to a cheap regional gateway plus
                               a separate budget hop to the destination.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import replace
from datetime import timedelta

from ..knowledge import airports
from ..models import FlightOffer, SearchQuery
from ..providers.base import FlightProvider

# Minimum safe connection when combining two separately-booked tickets.
SELF_TRANSFER_BUFFER = timedelta(hours=3)


class SearchStrategy(ABC):
    name: str = "strategy"

    @abstractmethod
    def find(self, query: SearchQuery, provider: FlightProvider) -> list[FlightOffer]:
        raise NotImplementedError

    @staticmethod
    def _tag(offers: list[FlightOffer], strategy: str, note: str | None = None) -> list[FlightOffer]:
        for offer in offers:
            offer.strategy = strategy
            if note:
                offer.notes.append(note)
        return offers


class DirectStrategy(SearchStrategy):
    """The query exactly as asked - the baseline every other strategy must beat."""

    name = "direct-search"

    def find(self, query: SearchQuery, provider: FlightProvider) -> list[FlightOffer]:
        return self._tag(provider.search(query), self.name)


class FlexibleDatesStrategy(SearchStrategy):
    name = "flexible-dates"

    def find(self, query: SearchQuery, provider: FlightProvider) -> list[FlightOffer]:
        if query.flexible_days <= 0:
            return []
        offers: list[FlightOffer] = []
        for shift in range(-query.flexible_days, query.flexible_days + 1):
            if shift == 0:
                continue  # the exact date is DirectStrategy's job
            departure = query.departure_date + timedelta(days=shift)
            shifted = replace(
                query,
                departure_date=departure,
                # keep trip length constant so alternatives stay comparable
                return_date=(departure + timedelta(days=query.trip_length)
                             if query.return_date else None),
            )
            offers += self._tag(
                provider.search(shifted), self.name,
                note=f"Departure shifted {shift:+d} day(s) to {departure.isoformat()}.",
            )
        return offers


class NearbyAirportsStrategy(SearchStrategy):
    name = "nearby-airports"

    def find(self, query: SearchQuery, provider: FlightProvider) -> list[FlightOffer]:
        origins = airports.expand_airports(query.origin)
        destinations = airports.expand_airports(query.destination)
        offers: list[FlightOffer] = []
        for origin in origins:
            for destination in destinations:
                if origin == query.origin.upper() and destination == query.destination.upper():
                    continue  # DirectStrategy covers the original pair
                alternative = replace(query, origin=origin, destination=destination)
                offers += self._tag(
                    provider.search(alternative), self.name,
                    note=f"Alternate metro-area airports: {origin} -> {destination}.",
                )
        return offers


class SplitTicketStrategy(SearchStrategy):
    """Two separate tickets via a cheap regional gateway.

    Long-haul fares to major gateways (LIS, BKK, JFK...) are often far
    cheaper than through-tickets to secondary cities; a budget carrier
    covers the final hop. The combined offer keeps both tickets' segments
    and flags the self-transfer risk.
    """

    name = "split-ticket"
    MAX_GATEWAYS = 3

    def find(self, query: SearchQuery, provider: FlightProvider) -> list[FlightOffer]:
        gateways = airports.gateway_candidates(query.destination)[: self.MAX_GATEWAYS]
        offers: list[FlightOffer] = []
        for gateway in gateways:
            long_haul = min(
                provider.search(replace(query, destination=gateway, return_date=None)),
                key=lambda o: o.price, default=None,
            )
            if long_haul is None:
                continue
            hop_date = long_haul.segments[-1].arrival.date()
            hop = min(
                provider.search(replace(
                    query, origin=gateway, departure_date=hop_date, return_date=None,
                )),
                key=lambda o: o.price, default=None,
            )
            if hop is None:
                continue
            if hop.segments[0].departure - long_haul.segments[-1].arrival < SELF_TRANSFER_BUFFER:
                continue  # too tight to self-transfer safely
            combined = FlightOffer(
                segments=long_haul.segments + hop.segments,
                price=round(long_haul.price + hop.price, 2),
                currency=long_haul.currency,
                provider=provider.name,
                strategy=self.name,
                notes=[
                    f"Two separate tickets via {gateway}: "
                    f"{long_haul.price:.2f} + {hop.price:.2f} {long_haul.currency}.",
                    "Self-transfer: you must re-check bags and clear "
                    "immigration; a missed connection is not protected.",
                ],
            )
            if not query.one_way:
                combined.notes.append(
                    "Priced as one-way legs - book the return the same way."
                )
            offers.append(combined)
        return offers


DEFAULT_STRATEGIES: list[SearchStrategy] = [
    DirectStrategy(),
    FlexibleDatesStrategy(),
    NearbyAirportsStrategy(),
    SplitTicketStrategy(),
]
