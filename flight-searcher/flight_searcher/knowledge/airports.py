"""Airport knowledge base: metro groups, budget hubs, and route hubs.

This encodes real-world expertise used by fare hunters:

* Metro-area airport groups — searching every airport in a metro area
  routinely uncovers fares 20-40% cheaper (e.g. flying into Milan Bergamo
  instead of Malpensa, or London Stansted instead of Heathrow).
* Budget-carrier hubs — airports where low-cost carriers concentrate,
  useful as connection/positioning points for split ticketing.
* Regional gateway hubs — the cheapest long-haul entry points per region,
  from which cheap regional flights fan out.
"""

from __future__ import annotations

# Metro/city code -> airports that serve the same catchment area.
# Includes "nearby city" groups within cheap ground-transport range.
METRO_GROUPS: dict[str, list[str]] = {
    # Europe
    "LON": ["LHR", "LGW", "STN", "LTN", "LCY", "SEN"],
    "PAR": ["CDG", "ORY", "BVA"],
    "MIL": ["MXP", "LIN", "BGY"],
    "ROM": ["FCO", "CIA"],
    "BCN": ["BCN", "GRO", "REU"],
    "BER": ["BER"],
    "OSL": ["OSL", "TRF"],
    "STO": ["ARN", "NYO", "BMA"],
    "BRU": ["BRU", "CRL"],
    "FRA": ["FRA", "HHN"],
    "LIS": ["LIS"],
    # North America
    "NYC": ["JFK", "EWR", "LGA"],
    "WAS": ["IAD", "DCA", "BWI"],
    "CHI": ["ORD", "MDW"],
    "LAX": ["LAX", "BUR", "LGB", "SNA", "ONT"],
    "SFO": ["SFO", "OAK", "SJC"],
    "MIA": ["MIA", "FLL", "PBI"],
    "YTO": ["YYZ", "YTZ", "YHM"],
    # South America
    "SAO": ["GRU", "CGH", "VCP"],
    "RIO": ["GIG", "SDU"],
    "BUE": ["EZE", "AEP"],
    # Asia / Middle East
    "TYO": ["NRT", "HND"],
    "SEL": ["ICN", "GMP"],
    "BKK": ["BKK", "DMK"],
    "DXB": ["DXB", "DWC", "SHJ"],
    "KUL": ["KUL", "SZB"],
    "JKT": ["CGK", "HLP"],
}

# Reverse index: airport -> metro code
AIRPORT_TO_METRO: dict[str, str] = {
    airport: metro for metro, airports in METRO_GROUPS.items() for airport in airports
}

# Region of each metro area above.
METRO_REGIONS: dict[str, str] = {
    "LON": "europe", "PAR": "europe", "MIL": "europe", "ROM": "europe",
    "BCN": "europe", "BER": "europe", "OSL": "europe", "STO": "europe",
    "BRU": "europe", "FRA": "europe", "LIS": "europe",
    "NYC": "north-america", "WAS": "north-america", "CHI": "north-america",
    "LAX": "north-america", "SFO": "north-america", "MIA": "north-america",
    "YTO": "north-america",
    "SAO": "south-america", "RIO": "south-america", "BUE": "south-america",
    "TYO": "east-asia", "SEL": "east-asia",
    "BKK": "southeast-asia", "KUL": "southeast-asia", "JKT": "southeast-asia",
    "DXB": "middle-east",
}

# Airports where low-cost carriers concentrate. Good split-ticket pivots.
BUDGET_HUBS: dict[str, list[str]] = {
    "europe": ["STN", "BGY", "CRL", "HHN", "BVA", "NYO", "TRF", "LTN"],
    "north-america": ["FLL", "MDW", "BWI", "LAS", "DEN", "OAK"],
    "south-america": ["CGH", "VCP", "AEP", "BOG", "LIM"],
    "southeast-asia": ["DMK", "KUL", "CGK", "SIN", "MNL", "SGN"],
    "middle-east": ["SHJ", "DWC", "KWI"],
}

# Cheapest long-haul gateways per region: flying long-haul into one of
# these and taking a separate cheap regional hop is often far cheaper
# than a through-ticket to a secondary city.
REGIONAL_GATEWAYS: dict[str, list[str]] = {
    "europe": ["LIS", "MAD", "DUB", "MXP", "CDG", "AMS", "FCO"],
    "north-america": ["JFK", "BOS", "MIA", "LAX", "ORD", "YYZ"],
    "south-america": ["GRU", "EZE", "BOG", "SCL", "LIM"],
    "east-asia": ["NRT", "ICN", "HKG", "TPE"],
    "southeast-asia": ["BKK", "KUL", "SIN"],
    "oceania": ["SYD", "MEL", "AKL"],
    "middle-east": ["DXB", "DOH", "IST"],
    "africa": ["CAI", "JNB", "ADD", "CMN"],
}

AIRPORT_TO_REGION: dict[str, str] = {
    airport: region
    for region, airports in REGIONAL_GATEWAYS.items()
    for airport in airports
}
# Budget hubs also carry region info.
for _region, _airports in BUDGET_HUBS.items():
    for _a in _airports:
        AIRPORT_TO_REGION.setdefault(_a, _region)


def expand_airports(code: str) -> list[str]:
    """Return every airport worth searching for a given airport/city code.

    ``expand_airports("LON")`` -> all six London airports;
    ``expand_airports("LHR")`` -> the same list (via its metro group);
    an unknown code returns itself.
    """
    code = code.upper()
    if code in METRO_GROUPS:
        return list(METRO_GROUPS[code])
    metro = AIRPORT_TO_METRO.get(code)
    if metro:
        return list(METRO_GROUPS[metro])
    return [code]


def region_of(code: str) -> str | None:
    """Best-effort region lookup for an airport/city code."""
    code = code.upper()
    if code in AIRPORT_TO_REGION:
        return AIRPORT_TO_REGION[code]
    for airport in expand_airports(code):
        if airport in AIRPORT_TO_REGION:
            return AIRPORT_TO_REGION[airport]
    metro = code if code in METRO_REGIONS else AIRPORT_TO_METRO.get(code)
    return METRO_REGIONS.get(metro) if metro else None


def gateway_candidates(code: str) -> list[str]:
    """Cheap long-haul gateways in the same region as ``code`` (excluding
    the searched airports themselves) — candidates for split ticketing."""
    region = region_of(code)
    if not region:
        return []
    searched = set(expand_airports(code))
    return [g for g in REGIONAL_GATEWAYS.get(region, []) if g not in searched]
