"""Amadeus Self-Service API provider (real fares).

Requires free API credentials from https://developers.amadeus.com set as
``AMADEUS_CLIENT_ID`` / ``AMADEUS_CLIENT_SECRET`` environment variables.
Uses only the standard library so the project has zero hard dependencies.
"""

from __future__ import annotations

import json
import os
import urllib.parse
import urllib.request
from datetime import datetime

from ..models import FlightOffer, FlightSegment, SearchQuery
from .base import FlightProvider

_TOKEN_URL = "https://test.api.amadeus.com/v1/security/oauth2/token"
_SEARCH_URL = "https://test.api.amadeus.com/v2/shopping/flight-offers"


class AmadeusError(RuntimeError):
    pass


class AmadeusProvider(FlightProvider):
    name = "amadeus"

    def __init__(self, client_id: str | None = None, client_secret: str | None = None):
        self.client_id = client_id or os.environ.get("AMADEUS_CLIENT_ID")
        self.client_secret = client_secret or os.environ.get("AMADEUS_CLIENT_SECRET")
        self._token: str | None = None

    @property
    def configured(self) -> bool:
        return bool(self.client_id and self.client_secret)

    def _authenticate(self) -> str:
        if not self.configured:
            raise AmadeusError(
                "Amadeus credentials missing: set AMADEUS_CLIENT_ID and "
                "AMADEUS_CLIENT_SECRET (free at developers.amadeus.com), "
                "or run with --provider mock."
            )
        body = urllib.parse.urlencode({
            "grant_type": "client_credentials",
            "client_id": self.client_id,
            "client_secret": self.client_secret,
        }).encode()
        request = urllib.request.Request(_TOKEN_URL, data=body, method="POST")
        request.add_header("Content-Type", "application/x-www-form-urlencoded")
        with urllib.request.urlopen(request, timeout=30) as response:
            payload = json.load(response)
        self._token = payload["access_token"]
        return self._token

    def search(self, query: SearchQuery) -> list[FlightOffer]:
        token = self._token or self._authenticate()
        params = {
            "originLocationCode": query.origin.upper(),
            "destinationLocationCode": query.destination.upper(),
            "departureDate": query.departure_date.isoformat(),
            "adults": str(query.adults),
            "travelClass": query.cabin.value,
            "currencyCode": query.currency,
            "max": "20",
        }
        if query.return_date:
            params["returnDate"] = query.return_date.isoformat()
        if query.max_stops == 0:
            params["nonStop"] = "true"

        request = urllib.request.Request(f"{_SEARCH_URL}?{urllib.parse.urlencode(params)}")
        request.add_header("Authorization", f"Bearer {token}")
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                payload = json.load(response)
        except urllib.error.HTTPError as error:
            if error.code == 401:  # token expired - re-auth once
                self._token = None
                return self.search(query)
            raise AmadeusError(f"Amadeus API error {error.code}: {error.read().decode(errors='replace')[:500]}")

        return [self._parse_offer(raw, query) for raw in payload.get("data", [])]

    def _parse_offer(self, raw: dict, query: SearchQuery) -> FlightOffer:
        segments = [
            FlightSegment(
                origin=seg["departure"]["iataCode"],
                destination=seg["arrival"]["iataCode"],
                departure=datetime.fromisoformat(seg["departure"]["at"]),
                arrival=datetime.fromisoformat(seg["arrival"]["at"]),
                carrier=seg["carrierCode"],
                flight_number=f"{seg['carrierCode']}{seg['number']}",
            )
            for itinerary in raw["itineraries"]
            for seg in itinerary["segments"]
        ]
        return FlightOffer(
            segments=segments,
            price=float(raw["price"]["grandTotal"]),
            currency=raw["price"]["currency"],
            provider=self.name,
        )
