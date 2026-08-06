# ✈️ Flight Searcher

A flight search engine that finds **cheaper flight tickets around the world** by automating the strategies expert fare hunters use by hand — backed by a built-in knowledge base of seasonal pricing, metro-area airports, budget-carrier hubs, and booking windows.

## What makes it find cheaper fares

| Strategy | What it does | Typical savings |
|---|---|---|
| **Flexible dates** | Scans ±N days around your dates, keeping trip length constant | 15–30% |
| **Nearby airports** | Expands both ends to every airport in the metro area (e.g. LON → LHR/LGW/STN/LTN/LCY/SEN) | 20–40% |
| **Split ticketing** | Prices a long-haul into a cheap regional gateway (LIS, BKK, JFK…) plus a separate budget hop, with a safe self-transfer buffer | up to 50% on secondary cities |
| **Deal rating** | Rates every fare (EXCEPTIONAL → POOR) against the route's typical seasonal price, so you know *when to book* | — |

The knowledge base also powers an **expert tips engine** that gives trip-specific advice: booking-window sweet spots (1–3 months domestic, 2–8 months international), the cheapest months for your destination region, weekday-departure savings, currency/point-of-sale tricks, and more.

## Quick start

No dependencies beyond Python 3.10+. Works out of the box with a deterministic offline demo provider:

```bash
python -m flight_searcher GRU LIS 2026-09-15 --return 2026-09-29 --flex 3
```

Example output:

```
Cheapest fares GRU -> LIS (round trip, 14 nights, 1 adult(s), economy):

[++] #1  601.19 USD  GRU -> LIS  (nonstop, 9h00m)
      2026-09-12 · TK · via flexible-dates · deal: GREAT
      note: Departure shifted -3 day(s) to 2026-09-12.
...

Expert tips for this trip:
  * You are inside the international sweet spot (2-8 months out)...
  * Shoulder-season dates. For rock-bottom fares to europe aim for: January, February, November.
  * Split-ticket idea: price a long-haul into MAD, DUB, MXP plus a separate budget hop...
```

### Live fares (Amadeus)

Get free API keys at [developers.amadeus.com](https://developers.amadeus.com) and export them — the CLI switches to live data automatically:

```bash
export AMADEUS_CLIENT_ID=...
export AMADEUS_CLIENT_SECRET=...
python -m flight_searcher NYC LON 2026-10-10 --return 2026-10-20
```

### CLI options

```
positional: ORIGIN DESTINATION DEPARTURE(YYYY-MM-DD)
--return YYYY-MM-DD   return date (omit for one-way)
--flex DAYS           scan ±DAYS around the dates (default 3)
--adults N            number of passengers
--cabin CLASS         ECONOMY | PREMIUM_ECONOMY | BUSINESS | FIRST
--currency CODE       e.g. USD, EUR, BRL
--max-stops N         cap connections (0 = nonstop only)
--provider NAME       auto | amadeus | mock
--limit N             offers to display
--no-tips             hide the expert tips section
```

## Use as a library

```python
from datetime import date
from flight_searcher import SearchEngine, SearchQuery, MockProvider, AmadeusProvider

query = SearchQuery("GRU", "LIS", date(2026, 9, 15),
                    return_date=date(2026, 9, 29), flexible_days=3)
engine = SearchEngine(MockProvider())          # or AmadeusProvider()
for offer in engine.search(query, limit=5):
    print(offer.deal_rating, offer.price, offer.describe_route(), offer.strategy)
```

New data sources plug in by subclassing `FlightProvider` (one `search()` method); new tactics by subclassing `SearchStrategy`.

## Project layout

```
flight_searcher/
├── models.py              # SearchQuery, FlightOffer, DealRating...
├── analysis.py            # deal rating vs. typical seasonal route price
├── cli.py                 # command-line interface
├── providers/
│   ├── amadeus.py         # live fares (Amadeus Self-Service API, stdlib-only)
│   └── mock.py            # deterministic offline demo data
├── search/
│   ├── engine.py          # runs strategies, dedupes, rates, ranks
│   └── strategies.py      # flexible dates · nearby airports · split tickets
└── knowledge/
    ├── airports.py        # metro groups, budget hubs, regional gateways
    ├── seasons.py         # per-region monthly pricing + booking windows
    └── tips.py            # trip-specific expert advice engine
```

## Tests

```bash
python -m pytest
```

## Disclaimer

Fares from the demo provider are simulated. Live prices change constantly — always confirm the final price on the airline's site before booking. Split tickets are separate contracts: leave generous connection time and know that missed self-transfers aren't protected.

## License

MIT
