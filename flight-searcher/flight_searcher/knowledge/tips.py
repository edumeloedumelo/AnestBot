"""Expert money-saving tips engine.

Given a search query, produces the advice a seasoned fare hunter would
give for that specific trip: booking-window timing, seasonal shifts,
metro-airport alternatives, split-ticket ideas, and general tactics.
"""

from __future__ import annotations

import calendar
from datetime import date

from ..models import SearchQuery
from . import airports, seasons

GENERAL_TACTICS = [
    "Compare prices in the airline's home currency; foreign points of sale sometimes price the same seat lower.",
    "Search one-ways separately on international routes - mixing two carriers can undercut every round-trip fare.",
    "Budget carriers often don't appear in big OTAs; check them directly (e.g. Ryanair, AirAsia, Azul, Flair).",
    "Tuesday/Wednesday departures are consistently the cheapest days to fly on most routes.",
    "Price the same itinerary with hand-luggage-only fares; checked-bag bundles can hide a cheaper base fare.",
    "Set price alerts instead of re-searching manually - fares on a route can swing 30%+ within a week.",
]


def tips_for(query: SearchQuery, today: date | None = None) -> list[str]:
    """Trip-specific saving tips, most impactful first."""
    today = today or date.today()
    tips: list[str] = []

    origin_region = airports.region_of(query.origin)
    dest_region = airports.region_of(query.destination)
    international = (
        origin_region != dest_region if origin_region and dest_region else True
    )

    # 1. Booking-window timing.
    lead = (query.departure_date - today).days
    tips.append(seasons.booking_window_advice(lead, international))

    # 2. Seasonality of the destination.
    if dest_region:
        factor = seasons.seasonal_factor(dest_region, query.departure_date)
        cheap = seasons.cheapest_months(dest_region)
        month_names = ", ".join(calendar.month_name[m] for m in cheap)
        if factor > 1.15:
            tips.append(
                f"You're flying in peak season for {dest_region} "
                f"(~{round((factor - 1) * 100)}% over typical). Cheapest months: {month_names}."
            )
        elif factor < 0.9:
            tips.append(
                f"Good timing - low season for {dest_region}, roughly "
                f"{round((1 - factor) * 100)}% below typical pricing."
            )
        else:
            tips.append(f"Shoulder-season dates. For rock-bottom fares to {dest_region} aim for: {month_names}.")

    # 3. Metro-airport alternatives.
    for code, label in ((query.origin, "departing from"), (query.destination, "arriving at")):
        group = airports.expand_airports(code)
        if len(group) > 1:
            others = [a for a in group if a != code.upper()]
            tips.append(
                f"Also compare {label} {', '.join(others)} - same metro area, "
                "often much cheaper (I search these automatically)."
            )

    # 4. Split-ticket gateways.
    gateways = airports.gateway_candidates(query.destination)
    if gateways:
        tips.append(
            f"Split-ticket idea: price a long-haul into {', '.join(gateways[:3])} "
            "plus a separate budget hop to your final stop. Leave 3h+ between "
            "separate tickets - self-transfer risk is on you."
        )

    # 5. Flexibility.
    if query.flexible_days == 0:
        tips.append("Enable flexible dates (+/-3 days) - shifting one day off a weekend regularly saves 15-30%.")

    tips.extend(GENERAL_TACTICS[:3])
    return tips
