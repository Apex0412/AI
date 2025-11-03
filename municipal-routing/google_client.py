from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from typing import Dict, List, Optional

import requests

logger = logging.getLogger(__name__)


@dataclass
class GoogleClient:
    api_keys: Dict[str, str]

    def _build_params(self, service: str, params: Dict) -> Dict:
        key = self.api_keys.get(service) or self.api_keys.get("default")
        if key:
            params = {**params, "key": key}
        return params

    def directions(
        self,
        origin: str,
        destination: str,
        waypoints: Optional[List[str]] = None,
        mode: str = "driving",
        max_waypoints: int = 25,
    ) -> Dict:
        params = {"origin": origin, "destination": destination, "mode": mode}
        if waypoints:
            if len(waypoints) > max_waypoints:
                waypoints = waypoints[:max_waypoints]
            params["waypoints"] = "|".join(waypoints)
        return self._request("https://maps.googleapis.com/maps/api/directions/json", params, "directions")

    def distance_matrix(self, origins: List[str], destinations: List[str], mode: str = "driving") -> Dict:
        params = {"origins": "|".join(origins), "destinations": "|".join(destinations), "mode": mode}
        return self._request(
            "https://maps.googleapis.com/maps/api/distancematrix/json", params, "distance_matrix"
        )

    def snap_to_roads(self, path: List[str]) -> Dict:
        params = {"path": "|".join(path)}
        return self._request("https://roads.googleapis.com/v1/snapToRoads", params, "roads")

    def geocode(self, latlng: str) -> Dict:
        params = {"latlng": latlng}
        return self._request("https://maps.googleapis.com/maps/api/geocode/json", params, "geocoding")

    def geolocate(self, cell_towers: Optional[List[Dict]] = None, wifi_access_points: Optional[List[Dict]] = None) -> Dict:
        payload = {"considerIp": True}
        if cell_towers:
            payload["cellTowers"] = cell_towers
        if wifi_access_points:
            payload["wifiAccessPoints"] = wifi_access_points
        return self._request(
            "https://www.googleapis.com/geolocation/v1/geolocate", payload, "geolocation", method="post"
        )

    def places_nearby(self, location: str, radius: int = 200) -> Dict:
        params = {"location": location, "radius": radius}
        return self._request("https://maps.googleapis.com/maps/api/place/nearbysearch/json", params, "places")

    def elevation(self, locations: List[str]) -> Dict:
        params = {"locations": "|".join(locations)}
        return self._request("https://maps.googleapis.com/maps/api/elevation/json", params, "elevation")

    def time_zone(self, location: str, timestamp: int) -> Dict:
        params = {"location": location, "timestamp": timestamp}
        return self._request("https://maps.googleapis.com/maps/api/timezone/json", params, "timezone")

    def validate_key(self, key: str, service: str = "directions") -> Dict:
        client = GoogleClient({**self.api_keys, service: key, "default": key})
        response = client.geocode("55.7522,37.6156")
        status = response.get("status")
        if status == "OK":
            return {"valid": True, "status": status}
        return {"valid": False, "status": status or response.get("error"), "details": response}

    def _request(self, url: str, params: Dict, service: str, method: str = "get") -> Dict:
        key = self.api_keys.get(service) or self.api_keys.get("default")
        if not key:
            logger.warning("API key missing for %s; returning stub", service)
            return {"status": "NO_KEY", "request": {"url": url, "params": params, "method": method}}

        try:
            if method.lower() == "post":
                response = requests.post(url, json=params, params={"key": key}, timeout=30)
            else:
                response = requests.get(url, params=self._build_params(service, params), timeout=30)
            response.raise_for_status()
            return response.json()
        except requests.RequestException as exc:
            logger.error("Google API request failed for %s: %s", service, exc)
            return {"status": "ERROR", "error": str(exc), "request": {"url": url, "params": params}}
