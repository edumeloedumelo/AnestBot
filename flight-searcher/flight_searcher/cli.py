"""Command-line interface.

    python -m flight_searcher GRU LIS 2026-09-15 --return 2026-09-29 --flex 3
"""

from __future__ import annotations

import argparse
import sys
from datetime import date, datetime

from .knowledge import tips
from .models import CabinClass, FlightOffer, SearchQuery
from .providers import AmadeusProvider, MockProvider
from .search import SearchEngine

_RATING_ICONS = {
    "EXCEPTIONAL": "[!!] ",
    "GREAT": "[++] ",
    "GOOD": "[+]  ",
    "AVERAGE": "[=]  ",
    "POOR": "[-]  ",
}


def _parse_date(value: str) -> date:
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError:
        raise argparse.ArgumentTypeError(f"invalid date {value!r}, expected YYYY-MM-DD")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="flight-searcher",
        description="Find cheaper flight tickets around the world.",
    )
    parser.add_argument("origin", help="origin airport/city IATA code, e.g. GRU or SAO")
    parser.add_argument("destination", help="destination airport/city IATA code, e.g. LIS")
    parser.add_argument("departure", type=_parse_date, help="departure date YYYY-MM-DD")
    parser.add_argument("--return", dest="return_date", type=_parse_date, default=None,
                        help="return date YYYY-MM-DD (omit for one-way)")
    parser.add_argument("--adults", type=int, default=1)
    parser.add_argument("--cabin", choices=[c.value for c in CabinClass],
                        default=CabinClass.ECONOMY.value)
    parser.add_argument("--currency", default="USD")
    parser.add_argument("--flex", type=int, default=3, metavar="DAYS",
                        help="also scan +/-DAYS around the dates (default 3, 0 to disable)")
    parser.add_argument("--max-stops", type=int, default=None)
    parser.add_argument("--limit", type=int, default=10, help="number of offers to show")
    parser.add_argument("--provider", choices=["auto", "amadeus", "mock"], default="auto",
                        help="'auto' uses Amadeus when credentials are set, else mock demo data")
    parser.add_argument("--no-tips", action="store_true", help="skip the expert tips section")
    return parser


def _pick_provider(choice: str):
    if choice == "mock":
        return MockProvider()
    amadeus = AmadeusProvider()
    if choice == "amadeus":
        return amadeus
    if amadeus.configured:
        return amadeus
    print("(no Amadeus credentials found - using offline demo data; "
          "set AMADEUS_CLIENT_ID/AMADEUS_CLIENT_SECRET for live fares)\n")
    return MockProvider()


def _format_offer(rank: int, offer: FlightOffer) -> str:
    icon = _RATING_ICONS.get(offer.deal_rating.value if offer.deal_rating else "", "     ")
    hours, remainder = divmod(int(offer.total_duration.total_seconds()), 3600)
    stops = "nonstop" if offer.stops == 0 else f"{offer.stops} stop(s)"
    lines = [
        f"{icon}#{rank}  {offer.price:,.2f} {offer.currency}  "
        f"{offer.describe_route()}  ({stops}, {hours}h{remainder // 60:02d}m)",
        f"      {offer.departure_date.isoformat()} · {'/'.join(offer.carriers)} · "
        f"via {offer.strategy}"
        + (f" · deal: {offer.deal_rating.value}" if offer.deal_rating else ""),
    ]
    lines.extend(f"      note: {note}" for note in offer.notes)
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    query = SearchQuery(
        origin=args.origin.upper(),
        destination=args.destination.upper(),
        departure_date=args.departure,
        return_date=args.return_date,
        adults=args.adults,
        cabin=CabinClass(args.cabin),
        currency=args.currency,
        max_stops=args.max_stops,
        flexible_days=max(args.flex, 0),
    )

    engine = SearchEngine(_pick_provider(args.provider))
    try:
        offers = engine.search(query, limit=args.limit)
    except Exception as error:  # surface provider errors cleanly
        print(f"Search failed: {error}", file=sys.stderr)
        return 1

    trip = "one-way" if query.one_way else f"round trip, {query.trip_length} nights"
    print(f"Cheapest fares {query.origin} -> {query.destination} "
          f"({trip}, {query.adults} adult(s), {query.cabin.value.lower()}):\n")
    if not offers:
        print("No offers found. Try widening --flex or removing --max-stops.")
    for rank, offer in enumerate(offers, start=1):
        print(_format_offer(rank, offer))
        print()

    if not args.no_tips:
        print("Expert tips for this trip:")
        for tip in tips.tips_for(query):
            print(f"  * {tip}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
