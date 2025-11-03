from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from typing import Dict, List, Optional

import requests

logger = logging.getLogger(__name__)


def _get_env(name: str, default: str = "") -> str:
    return os.getenv(name, default)


@dataclass
class YandexClient:
    """Lightweight wrapper around several Yandex Maps APIs."""

    api_key: str = ""
    suggest_key: Optional[str] = None
    locator_key: Optional[str] = None

    def __post_init__(self) -> None:
        if not self.api_key:
            self.api_key = _get_env("YANDEX_API_KEY", "")
        if not self.suggest_key:
            self.suggest_key = _get_env("YANDEX_GEOSUGGEST_KEY", "") or self.api_key
        if not self.locator_key:
            self.locator_key = _get_env("YANDEX_LOCATOR_API_KEY", "") or self.api_key

    def geocode(self, query: str, lang: str = "ru_RU") -> Dict:
        params: Dict[str, str] = {"format": "json", "geocode": query, "lang": lang}
        if self.api_key:
            params["apikey"] = self.api_key
        return self._request("https://geocode-maps.yandex.ru/1.x", params)

    def suggest(self, text: str, results: int = 5, lang: str = "ru_RU") -> Dict:
        params: Dict[str, str] = {
            "text": text,
            "lang": lang,
            "type": "geo",
            "results": str(results),
        }
        if self.suggest_key:
            params["apikey"] = self.suggest_key
        return self._request("https://suggest-maps.yandex.ru/v1/suggest", params)

    def locator(self, wifi_networks: Optional[List[Dict]] = None, gsm_cells: Optional[List[Dict]] = None) -> Dict:
        payload: Dict[str, object] = {}
        if wifi_networks:
            payload["wifi_networks"] = wifi_networks
        if gsm_cells:
            payload["gsm_cells"] = gsm_cells
        headers = {"Content-Type": "application/json"}
        params = {"json": 1}
        if self.locator_key:
            params["apikey"] = self.locator_key
        return self._request(
            "https://api.lbs.yandex.net/geolocation",
            params,
            payload=payload or None,
            headers=headers,
            method="post",
        )

    @staticmethod
    def static_map_url(center: Dict[str, float], zoom: int = 14, size: str = "600,400") -> str:
        lat = center.get("lat")
        lng = center.get("lng")
        return f"https://static-maps.yandex.ru/1.x/?ll={lng},{lat}&z={zoom}&size={size}&l=map"

    @staticmethod
    def tiles_url_template(layer: str = "map") -> str:
        return f"https://core-renderer-tiles.maps.yandex.net/tiles?l={layer}&v=21.03.11&x={{x}}&y={{y}}&z={{z}}&scale=1&lang=ru_RU"

    def _request(
        self,
        url: str,
        params: Dict,
        payload: Optional[Dict] = None,
        headers: Optional[Dict[str, str]] = None,
        method: str = "get",
    ) -> Dict:
        try:
            if method.lower() == "post":
                response = requests.post(url, params=params, json=payload, headers=headers, timeout=30)
            else:
                response = requests.get(url, params=params, headers=headers, timeout=30)
            response.raise_for_status()
            if "json" in response.headers.get("Content-Type", ""):
                return response.json()
            return {"status": "OK", "raw": response.text}
        except requests.RequestException as exc:
            logger.error("Yandex API request failed: %s", exc)
            return {"status": "ERROR", "error": str(exc), "request": {"url": url, "params": params}}
