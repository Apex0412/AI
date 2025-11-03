from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from typing import Dict, List, Optional, Sequence

import requests

logger = logging.getLogger(__name__)


def _format_coords(points: Sequence[Sequence[float]]) -> str:
    return ";".join(f"{lon},{lat}" for lon, lat in points)


def _travel_profile(mode: str) -> str:
    mapping = {"walking": "foot", "bicycling": "bike", "driving": "driving"}
    return mapping.get(mode, "driving")


@dataclass
class OSRMClient:
    base_url: str = os.getenv("OSRM_BASE_URL", "https://router.project-osrm.org")

    def route(self, coordinates: Sequence[Sequence[float]], profile: str = "driving") -> Dict:
        if len(coordinates) < 2:
            return {"code": "Invalid", "message": "At least two coordinates are required"}
        coord_str = _format_coords(coordinates)
        url = f"{self.base_url}/route/v1/{profile}/{coord_str}"
        params = {"overview": "full", "geometries": "geojson", "steps": "true"}
        return self._request(url, params)

    def nearest(self, coordinate: Sequence[float], profile: str = "driving") -> Dict:
        coord_str = _format_coords([coordinate])
        url = f"{self.base_url}/nearest/v1/{profile}/{coord_str}"
        return self._request(url, {})

    def match(self, coordinates: Sequence[Sequence[float]], profile: str = "driving") -> Dict:
        coord_str = _format_coords(coordinates)
        url = f"{self.base_url}/match/v1/{profile}/{coord_str}"
        params = {"geometries": "geojson"}
        return self._request(url, params)

    def _request(self, url: str, params: Dict) -> Dict:
        try:
            response = requests.get(url, params=params, timeout=30)
            response.raise_for_status()
            return response.json()
        except requests.RequestException as exc:
            logger.error("OSRM request failed: %s", exc)
            return {"code": "Error", "message": str(exc), "request": {"url": url, "params": params}}


@dataclass
class OpenRouteServiceClient:
    api_key: str = os.getenv("ORS_API_KEY", "")
    base_url: str = os.getenv("ORS_BASE_URL", "https://api.openrouteservice.org")

    def directions(
        self,
        coordinates: Sequence[Sequence[float]],
        profile: str = "driving-car",
        preference: str = "fastest",
    ) -> Dict:
        url = f"{self.base_url}/v2/directions/{profile}"
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = self.api_key
        payload = {"coordinates": [[lon, lat] for lon, lat in coordinates], "preference": preference}
        return self._request(url, payload, headers)

    def matrix(self, locations: Sequence[Sequence[float]], profile: str = "driving-car") -> Dict:
        url = f"{self.base_url}/v2/matrix/{profile}"
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = self.api_key
        payload = {"locations": [[lon, lat] for lon, lat in locations]}
        return self._request(url, payload, headers)

    def elevation_line(self, coordinates: Sequence[Sequence[float]]) -> Dict:
        url = f"{self.base_url}/elevation/line"
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = self.api_key
        payload = {
            "format_in": "geojson",
            "format_out": "geojson",
            "geometry": {"type": "LineString", "coordinates": [[lon, lat] for lon, lat in coordinates]},
        }
        return self._request(url, payload, headers)

    def _request(self, url: str, payload: Dict, headers: Dict) -> Dict:
        try:
            response = requests.post(url, json=payload, headers=headers, timeout=30)
            response.raise_for_status()
            return response.json()
        except requests.RequestException as exc:
            logger.error("OpenRouteService request failed: %s", exc)
            return {"error": str(exc), "request": {"url": url, "payload": payload}}


def compute_transition(
    start: Sequence[float],
    end: Sequence[float],
    mode: str,
    osrm: OSRMClient,
    ors: OpenRouteServiceClient,
) -> Dict:
    profile = _travel_profile(mode)
    if profile == "bike":
        ors_profile = "cycling-regular"
        osrm_profile = "bike"
    elif profile == "foot":
        ors_profile = "foot-walking"
        osrm_profile = "foot"
    else:
        ors_profile = "driving-car"
        osrm_profile = "driving"

    route = osrm.route([start, end], profile=osrm_profile)
    if route.get("code") != "Ok":
        fallback = ors.directions([start, end], profile=ors_profile)
        fallback["source"] = "ors"
        return fallback
    route["source"] = "osrm"
    return route


def decode_osrm_distance(route: Dict) -> float:
    try:
        legs = route.get("routes", [])[0].get("legs", [])
        return sum(leg.get("distance", 0) for leg in legs) / 1000
    except (IndexError, AttributeError, TypeError):
        return 0.0


def decode_osrm_duration(route: Dict) -> float:
    try:
        legs = route.get("routes", [])[0].get("legs", [])
        return sum(leg.get("duration", 0) for leg in legs) / 60
    except (IndexError, AttributeError, TypeError):
        return 0.0


def decode_ors_distance(route: Dict) -> float:
    try:
        summary = route.get("features", [])[0].get("properties", {}).get("summary", {})
        return float(summary.get("distance", 0)) / 1000
    except (IndexError, AttributeError, TypeError, ValueError):
        return 0.0


def decode_ors_duration(route: Dict) -> float:
    try:
        summary = route.get("features", [])[0].get("properties", {}).get("summary", {})
        return float(summary.get("duration", 0)) / 60
    except (IndexError, AttributeError, TypeError, ValueError):
        return 0.0
