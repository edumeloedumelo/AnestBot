"""Deal analysis: rate each offer against the route's typical price."""

from __future__ import annotations

from .knowledge import airports, seasons
from .models import DealRating, FlightOffer, SearchQuery

# Typical one-way economy benchmarks (USD) by route type, matching the
# taxonomy in providers.mock but usable against any provider's results.
_BENCHMARKS = {
    "intra-region": 130.0,
    "inter-region": 550.0,
    "unknown": 400.0,
}


def _benchmark(query: SearchQuery) -> float:
    origin_region = airports.region_of(query.origin)
    destination_region = airports.region_of(query.destination)
    if origin_region and destination_region:
        route = "intra-region" if origin_region == destination_region else "inter-region"
    else:
        route = "unknown"
    typical = _BENCHMARKS[route] * query.adults
    typical *= seasons.seasonal_factor(destination_region, query.departure_date)
    if not query.one_way:
        typical *= 1.85
    return typical


def rate_offers(offers: list[FlightOffer], query: SearchQuery) -> list[FlightOffer]:
    """Attach a DealRating to each offer, comparing against the benchmark."""
    typical = _benchmark(query)
    for offer in offers:
        ratio = offer.price / typical if typical else 1.0
        if ratio < 0.5:
            offer.deal_rating = DealRating.EXCEPTIONAL
        elif ratio < 0.75:
            offer.deal_rating = DealRating.GREAT
        elif ratio < 0.95:
            offer.deal_rating = DealRating.GOOD
        elif ratio < 1.2:
            offer.deal_rating = DealRating.AVERAGE
        else:
            offer.deal_rating = DealRating.POOR
        if offer.deal_rating == DealRating.EXCEPTIONAL:
            offer.notes.append(
                "Error-fare territory - book now, but wait for ticketing "
                "confirmation before booking hotels."
            )
    return offers
