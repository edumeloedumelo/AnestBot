"""Seasonal pricing knowledge: when routes are cheap or expensive.

Encodes the demand seasonality that drives airfare on the world's major
markets. Multipliers are relative to a route's typical (shoulder-season)
price: 1.0 = typical, below 1.0 = low season bargains, above = peak.
"""

from __future__ import annotations

from datetime import date

# month -> multiplier, per region of the *destination*.
SEASONALITY: dict[str, dict[int, float]] = {
    "europe": {
        1: 0.75, 2: 0.75, 3: 0.85, 4: 0.95, 5: 1.05, 6: 1.25,
        7: 1.35, 8: 1.30, 9: 1.05, 10: 0.90, 11: 0.80, 12: 1.10,
    },
    "north-america": {
        1: 0.85, 2: 0.85, 3: 1.00, 4: 0.95, 5: 1.00, 6: 1.20,
        7: 1.25, 8: 1.15, 9: 0.90, 10: 0.90, 11: 1.05, 12: 1.20,
    },
    "south-america": {
        1: 1.20, 2: 1.15, 3: 0.95, 4: 0.85, 5: 0.85, 6: 0.95,
        7: 1.10, 8: 0.95, 9: 0.85, 10: 0.90, 11: 0.95, 12: 1.25,
    },
    "east-asia": {
        1: 1.05, 2: 1.10, 3: 1.05, 4: 1.10, 5: 0.95, 6: 0.90,
        7: 1.10, 8: 1.15, 9: 0.95, 10: 1.05, 11: 0.90, 12: 1.05,
    },
    "southeast-asia": {
        1: 1.10, 2: 1.00, 3: 0.95, 4: 0.95, 5: 0.85, 6: 0.90,
        7: 1.05, 8: 1.05, 9: 0.85, 10: 0.90, 11: 0.95, 12: 1.20,
    },
    "oceania": {
        1: 1.20, 2: 1.05, 3: 0.95, 4: 0.90, 5: 0.85, 6: 0.90,
        7: 1.00, 8: 0.95, 9: 0.95, 10: 1.00, 11: 1.05, 12: 1.30,
    },
    "middle-east": {
        1: 0.95, 2: 0.95, 3: 1.00, 4: 1.05, 5: 0.90, 6: 0.85,
        7: 0.90, 8: 0.90, 9: 0.95, 10: 1.05, 11: 1.05, 12: 1.10,
    },
    "africa": {
        1: 1.05, 2: 0.95, 3: 0.90, 4: 0.90, 5: 0.85, 6: 1.00,
        7: 1.15, 8: 1.15, 9: 0.95, 10: 0.95, 11: 0.90, 12: 1.15,
    },
}

DEFAULT_SEASONALITY = {m: 1.0 for m in range(1, 13)}

# Day-of-week pricing: weekday departures undercut weekend ones.
# Monday=0 ... Sunday=6.
DAY_OF_WEEK_FACTOR: dict[int, float] = {
    0: 0.98, 1: 0.94, 2: 0.95, 3: 0.98, 4: 1.06, 5: 1.02, 6: 1.08,
}


def seasonal_factor(region: str | None, when: date) -> float:
    """Combined seasonal + day-of-week price multiplier for a date."""
    table = SEASONALITY.get(region or "", DEFAULT_SEASONALITY)
    return table.get(when.month, 1.0) * DAY_OF_WEEK_FACTOR[when.weekday()]


def cheapest_months(region: str | None, count: int = 3) -> list[int]:
    """The ``count`` cheapest months to fly to a region, cheapest first."""
    table = SEASONALITY.get(region or "", DEFAULT_SEASONALITY)
    return [m for m, _ in sorted(table.items(), key=lambda kv: kv[1])[:count]]


def booking_window_advice(days_until_departure: int, international: bool) -> str:
    """Advice on booking timing given lead time.

    Reflects the well-documented sweet spots: roughly 1-3 months out for
    domestic and 2-8 months out for international travel, with prices
    climbing steeply inside the final 2-3 weeks.
    """
    if international:
        if days_until_departure > 300:
            return ("Very early: schedules may not be finalized and fares often "
                    "start high. Track prices; the sweet spot is 2-8 months out.")
        if 60 <= days_until_departure <= 240:
            return "You are inside the international sweet spot (2-8 months out). Book when you see a fare rated GOOD or better."
        if 21 <= days_until_departure < 60:
            return "Getting close: international fares usually start climbing now. Book soon rather than waiting."
        return "Last-minute: expect elevated fares. Consider flexible dates or nearby airports to soften the premium."
    if days_until_departure > 150:
        return "Early for domestic travel; fares typically settle 1-3 months out. Set a price alert."
    if 28 <= days_until_departure <= 90:
        return "You are inside the domestic sweet spot (1-3 months out). Book when you see a fare rated GOOD or better."
    if 14 <= days_until_departure < 28:
        return "Domestic fares generally start rising inside 4 weeks. Book soon."
    return "Last-minute domestic: prices spike inside 2 weeks. Check nearby airports and connecting itineraries."
