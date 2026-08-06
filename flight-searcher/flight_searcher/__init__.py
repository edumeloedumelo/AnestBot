"""Flight Searcher - find cheaper flight tickets around the world.

A search engine that layers expert fare-hunting strategies (flexible
dates, metro-area airports, split ticketing) and a knowledge base of
seasonal pricing, budget hubs, and booking windows on top of any flight
data provider.
"""

from .analysis import rate_offers
from .models import CabinClass, DealRating, FlightOffer, FlightSegment, SearchQuery
from .providers import AmadeusProvider, FlightProvider, MockProvider
from .search import SearchEngine

__version__ = "0.1.0"

__all__ = [
    "SearchQuery",
    "FlightOffer",
    "FlightSegment",
    "CabinClass",
    "DealRating",
    "SearchEngine",
    "FlightProvider",
    "AmadeusProvider",
    "MockProvider",
    "rate_offers",
]
