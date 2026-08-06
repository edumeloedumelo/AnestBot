"""Deterministic offline provider.

Generates realistic offers priced from the knowledge base (route
distance class, seasonality, day-of-week) so the whole engine - every
strategy, the deal analyzer, the CLI - runs and can be tested without
API credentials. Prices are deterministic per (route, date).
"""

from __future__ import annotations

import hashlib
from datetime import datetime, time, timedelta

from ..knowledge import airports, seasons
from ..models import FlightOffer, FlightSegment, SearchQuery
from .base import FlightProvider

# Base one-way economy price (USD) by route type.
_BASE_PRICES = {
    "intra-region": 120.0,
    "inter-region": 520.0,
    "long-haul": 780.0,
}

_LONG_HAUL_PAIRS = {
    frozenset(p) for p in [
        ("south-america", "east-asia"),
        ("south-america", "southeast-asia"),
        ("south-america", "oceania"),
        ("north-america", "oceania"),
        ("europe", "oceania"),
        ("africa", "oceania"),
        ("north-america", "southeast-asia"),
    ]
}

_CARRIERS = ["TP", "IB", "AF", "LH", "LA", "AA", "DL", "EK", "QR", "TK", "FR", "U2"]

_CABIN_MULTIPLIER = {
    "ECONOMY": 1.0,
    "PREMIUM_ECONOMY": 1.9,
    "BUSINESS": 3.8,
    "FIRST": 6.5,
}


def _stable_hash(*parts: object) -> int:
    digest = hashlib.sha256("|".join(str(p) for p in parts).encode()).hexdigest()
    return int(digest[:8], 16)


def _route_type(origin: str, destination: str) -> str:
    a, b = airports.region_of(origin), airports.region_of(destination)
    if a and b and a == b:
        return "intra-region"
    if a and b and frozenset((a, b)) in _LONG_HAUL_PAIRS:
        return "long-haul"
    return "inter-region"


def _flight_hours(route_type: str) -> int:
    return {"intra-region": 2, "inter-region": 9, "long-haul": 15}[route_type]


class MockProvider(FlightProvider):
    name = "mock"

    def search(self, query: SearchQuery) -> list[FlightOffer]:
        offers = [
            self._build_offer(query, variant)
            for variant in range(3)  # a few carrier/price options per query
        ]
        if not query.one_way:
            for offer in offers:
                offer.notes.append(f"Return on {query.return_date.isoformat()} included in price.")
        return offers

    def _build_offer(self, query: SearchQuery, variant: int) -> FlightOffer:
        origin = query.origin.upper()
        destination = query.destination.upper()
        route_type = _route_type(origin, destination)
        seed = _stable_hash(origin, destination, query.departure_date, variant)

        base = _BASE_PRICES[route_type]
        season = seasons.seasonal_factor(airports.region_of(destination), query.departure_date)
        # Deterministic per-route/-variant spread of +/-20%.
        jitter = 0.8 + (seed % 41) / 100.0
        # Budget-hub airports carry a structural discount.
        budget_pool = {a for hub in airports.BUDGET_HUBS.values() for a in hub}
        hub_discount = 0.82 if (origin in budget_pool or destination in budget_pool) else 1.0
        cabin = _CABIN_MULTIPLIER[query.cabin.value]

        price = base * season * jitter * hub_discount * cabin
        if not query.one_way:
            price *= 1.85  # round trips price slightly under 2x one-way

        carrier = _CARRIERS[seed % len(_CARRIERS)]
        depart_hour = 6 + (seed % 14)
        departure = datetime.combine(query.departure_date, time(hour=depart_hour))
        hours = _flight_hours(route_type)

        direct = (seed % 3) != 0 or route_type == "intra-region"
        if direct:
            segments = [FlightSegment(
                origin=origin, destination=destination,
                departure=departure, arrival=departure + timedelta(hours=hours),
                carrier=carrier, flight_number=f"{carrier}{100 + seed % 900}",
            )]
        else:
            connection = airports.gateway_candidates(destination) or ["IST"]
            via = connection[seed % len(connection)]
            leg1_hours = max(hours // 2, 1)
            arrival1 = departure + timedelta(hours=leg1_hours)
            departure2 = arrival1 + timedelta(hours=2)
            segments = [
                FlightSegment(origin=origin, destination=via,
                              departure=departure, arrival=arrival1,
                              carrier=carrier, flight_number=f"{carrier}{100 + seed % 900}"),
                FlightSegment(origin=via, destination=destination,
                              departure=departure2,
                              arrival=departure2 + timedelta(hours=hours - leg1_hours),
                              carrier=carrier, flight_number=f"{carrier}{200 + seed % 700}"),
            ]
            price *= 0.88  # connections undercut nonstops

        return FlightOffer(
            segments=segments,
            price=round(price * query.adults, 2),
            currency=query.currency,
            provider=self.name,
        )
