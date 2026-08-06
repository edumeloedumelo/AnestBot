"""End-to-end and unit tests using the deterministic mock provider."""

from datetime import date, timedelta

import pytest

from flight_searcher import (
    CabinClass,
    DealRating,
    MockProvider,
    SearchEngine,
    SearchQuery,
)
from flight_searcher.knowledge import airports, seasons, tips
from flight_searcher.search.strategies import (
    FlexibleDatesStrategy,
    NearbyAirportsStrategy,
    SplitTicketStrategy,
)

QUERY = SearchQuery(
    origin="GRU",
    destination="LIS",
    departure_date=date(2026, 9, 15),
    return_date=date(2026, 9, 29),
    flexible_days=3,
)


def test_engine_returns_sorted_rated_offers():
    offers = SearchEngine(MockProvider()).search(QUERY, limit=10)
    assert offers, "engine should find offers"
    prices = [o.price for o in offers]
    assert prices == sorted(prices), "offers must be sorted cheapest-first"
    assert all(o.deal_rating in DealRating for o in offers)
    assert all(o.currency == "USD" for o in offers)


def test_mock_provider_is_deterministic():
    first = MockProvider().search(QUERY)
    second = MockProvider().search(QUERY)
    assert [o.price for o in first] == [o.price for o in second]


def test_flexible_dates_keeps_trip_length_and_skips_exact_date():
    offers = FlexibleDatesStrategy().find(QUERY, MockProvider())
    assert offers
    departures = {o.departure_date for o in offers}
    assert QUERY.departure_date not in departures
    assert departures <= {
        QUERY.departure_date + timedelta(days=d) for d in range(-3, 4)
    }


def test_flexible_dates_disabled_when_flex_zero():
    rigid = SearchQuery("GRU", "LIS", date(2026, 9, 15))
    assert FlexibleDatesStrategy().find(rigid, MockProvider()) == []


def test_nearby_airports_expands_metro_groups():
    query = SearchQuery("JFK", "LHR", date(2026, 10, 1))
    offers = NearbyAirportsStrategy().find(query, MockProvider())
    origins = {o.origin for o in offers}
    destinations = {o.destination for o in offers}
    assert origins <= {"JFK", "EWR", "LGA"}
    assert destinations <= {"LHR", "LGW", "STN", "LTN", "LCY", "SEN"}
    assert len(origins) > 1 or len(destinations) > 1


def test_split_ticket_combines_two_tickets_with_buffer():
    query = SearchQuery("GRU", "BER", date(2026, 9, 15))
    offers = SplitTicketStrategy().find(query, MockProvider())
    for offer in offers:
        assert offer.strategy == "split-ticket"
        assert len(offer.segments) >= 2
        assert any("Self-transfer" in note for note in offer.notes)


def test_max_stops_filter():
    query = SearchQuery("GRU", "LIS", date(2026, 9, 15), max_stops=0, flexible_days=2)
    offers = SearchEngine(MockProvider()).search(query)
    assert all(o.stops == 0 for o in offers)


def test_airport_expansion():
    assert set(airports.expand_airports("LON")) == {"LHR", "LGW", "STN", "LTN", "LCY", "SEN"}
    assert airports.expand_airports("lhr") == airports.expand_airports("LON")
    assert airports.expand_airports("XYZ") == ["XYZ"]


def test_region_lookup_and_gateways():
    assert airports.region_of("GRU") == "south-america"
    assert airports.region_of("STN") == "europe"
    gateways = airports.gateway_candidates("BER")
    assert gateways and "BER" not in gateways


def test_seasonality_bounds_and_cheapest_months():
    factor = seasons.seasonal_factor("europe", date(2026, 7, 18))
    assert factor > 1.2, "July weekend to Europe must price as peak"
    cheap = seasons.cheapest_months("europe")
    assert set(cheap) <= {1, 2, 11}


def test_tips_are_trip_specific():
    advice = tips.tips_for(QUERY, today=date(2026, 6, 1))  # 106 days out
    text = " ".join(advice)
    assert "sweet spot" in text
    assert any("LIS" not in t or "metro" in t.lower() for t in advice)
    rigid = SearchQuery("GRU", "LIS", date(2026, 9, 15))
    assert any("flexible dates" in t.lower()
               for t in tips.tips_for(rigid, today=date(2026, 8, 6)))


def test_cabin_class_raises_price():
    economy = SearchQuery("GRU", "LIS", date(2026, 9, 15))
    business = SearchQuery("GRU", "LIS", date(2026, 9, 15), cabin=CabinClass.BUSINESS)
    provider = MockProvider()
    cheapest = lambda q: min(o.price for o in provider.search(q))
    assert cheapest(business) > cheapest(economy) * 2


def test_cli_smoke(capsys):
    from flight_searcher.cli import main

    code = main(["GRU", "LIS", "2026-09-15", "--return", "2026-09-29",
                 "--provider", "mock", "--flex", "2"])
    assert code == 0
    out = capsys.readouterr().out
    assert "Cheapest fares GRU -> LIS" in out
    assert "Expert tips" in out


def test_cli_rejects_bad_date():
    from flight_searcher.cli import main

    with pytest.raises(SystemExit):
        main(["GRU", "LIS", "15-09-2026"])
