"""Core data models for flight search."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from enum import Enum
from typing import Optional


class CabinClass(str, Enum):
    ECONOMY = "ECONOMY"
    PREMIUM_ECONOMY = "PREMIUM_ECONOMY"
    BUSINESS = "BUSINESS"
    FIRST = "FIRST"


class DealRating(str, Enum):
    EXCEPTIONAL = "EXCEPTIONAL"   # error-fare territory, book immediately
    GREAT = "GREAT"               # well below typical price for the route
    GOOD = "GOOD"                 # somewhat below typical
    AVERAGE = "AVERAGE"           # in line with typical pricing
    POOR = "POOR"                 # above typical, wait or adjust dates


@dataclass(frozen=True)
class SearchQuery:
    origin: str                       # IATA airport or city code, e.g. "GRU"
    destination: str                  # IATA airport or city code, e.g. "LIS"
    departure_date: date
    return_date: Optional[date] = None
    adults: int = 1
    cabin: CabinClass = CabinClass.ECONOMY
    currency: str = "USD"
    max_stops: Optional[int] = None
    flexible_days: int = 0            # +/- days around departure/return to scan

    @property
    def one_way(self) -> bool:
        return self.return_date is None

    @property
    def trip_length(self) -> Optional[int]:
        if self.return_date is None:
            return None
        return (self.return_date - self.departure_date).days


@dataclass(frozen=True)
class FlightSegment:
    origin: str
    destination: str
    departure: datetime
    arrival: datetime
    carrier: str                      # airline IATA code, e.g. "TP"
    flight_number: str

    @property
    def duration(self) -> timedelta:
        return self.arrival - self.departure


@dataclass
class FlightOffer:
    segments: list[FlightSegment]
    price: float
    currency: str
    provider: str                     # which provider/strategy produced this offer
    strategy: str = "direct-search"   # e.g. "flexible-dates", "nearby-airports"
    notes: list[str] = field(default_factory=list)
    deal_rating: Optional[DealRating] = None

    @property
    def origin(self) -> str:
        return self.segments[0].origin

    @property
    def destination(self) -> str:
        return self.segments[-1].destination

    @property
    def departure_date(self) -> date:
        return self.segments[0].departure.date()

    @property
    def stops(self) -> int:
        return max(len(self.segments) - 1, 0)

    @property
    def total_duration(self) -> timedelta:
        return self.segments[-1].arrival - self.segments[0].departure

    @property
    def carriers(self) -> list[str]:
        seen: list[str] = []
        for seg in self.segments:
            if seg.carrier not in seen:
                seen.append(seg.carrier)
        return seen

    def describe_route(self) -> str:
        stops = [self.segments[0].origin] + [s.destination for s in self.segments]
        return " -> ".join(stops)
