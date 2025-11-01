from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Dict, List

from shapely.geometry import LineString, Polygon, box, mapping

from google_client import GoogleClient
from kml_utils import KMLDataLoader, export_geojson as export_geojson_file
from state import AppState


class RoutingEngine:
    def __init__(self, loader: KMLDataLoader, state: AppState):
        self.loader = loader
        self.state = state

    def build_routes(self, options: Dict, google_keys: Dict[str, str]) -> Dict:
        city_polygon, road_segments = self.loader.load()
        self.state.city_polygon = city_polygon
        self.state.road_segments = road_segments
        if not self.state.assignments:
            self.state.assignments = self._auto_assign(road_segments, self.state.tractors)

        google_client = GoogleClient({**google_keys, "default": google_keys.get("directions", "")})
        routes: List[Dict] = []
        log_entries: List[Dict] = []
        base = self.state.base_location
        base_str = f"{base['lat']},{base['lng']}"

        segment_lookup = {seg["id"]: seg for seg in road_segments}

        for tractor in self.state.tractors:
            assigned_ids = self.state.assignments.get(tractor["id"], [])
            if not assigned_ids:
                continue
            tractor_route = {
                "tractor": tractor,
                "segments": [],
                "transitions": [],
                "distance_km": 0.0,
                "duration_min": 0.0,
                "metadata": [],
            }
            previous_point = base_str
            for seg_id in assigned_ids:
                segment = segment_lookup.get(seg_id)
                if not segment:
                    continue
                geometry = segment["geometry"]
                coords = geometry.get("coordinates")
                if not coords:
                    continue
                start = coords[0]
                end = coords[-1]
                start_str = f"{start[1]},{start[0]}"
                end_str = f"{end[1]},{end[0]}"

                transition = google_client.directions(previous_point, start_str)
                snapped = google_client.snap_to_roads([f"{c[1]},{c[0]}" for c in coords])
                elevation = google_client.elevation([start_str, end_str])
                geocode = google_client.geocode(start_str)
                places = google_client.places_nearby(start_str)
                timezone = google_client.time_zone(start_str, int(datetime.utcnow().timestamp()))

                transition_distance = self._extract_distance(transition)
                transition_duration = self._extract_duration(transition)
                seg_distance = self._line_length_km(LineString([(c[0], c[1]) for c in coords]))

                tractor_route["segments"].append({
                    "id": seg_id,
                    "name": segment.get("name"),
                    "geometry": geometry,
                    "snap": snapped,
                    "elevation": elevation,
                    "geocode": geocode,
                    "places": places,
                    "timezone": timezone,
                    "segment_distance_km": seg_distance,
                })
                tractor_route["transitions"].append(
                    {
                        "from": previous_point,
                        "to": start_str,
                        "directions": transition,
                        "distance_km": transition_distance,
                        "duration_min": transition_duration,
                    }
                )
                tractor_route["distance_km"] += transition_distance + seg_distance
                tractor_route["duration_min"] += transition_duration
                previous_point = end_str

            routes.append(tractor_route)
            log_entries.append(
                {
                    "tractor": tractor["name"],
                    "distance_km": round(tractor_route["distance_km"], 2),
                    "segments": len(tractor_route["segments"]),
                    "timestamp": datetime.utcnow().isoformat(),
                }
            )

        metadata = {
            "assignments": self.state.assignments,
            "grid": self._build_grid(city_polygon, options.get("grid_size", 6)),
        }

        return {"routes": routes, "log": log_entries, "metadata": metadata}

    def _line_length_km(self, line: LineString) -> float:
        return line.length * 111

    def _extract_distance(self, directions: Dict) -> float:
        try:
            legs = directions.get("routes", [])[0].get("legs", [])
            meters = sum(leg.get("distance", {}).get("value", 0) for leg in legs)
            return meters / 1000
        except (IndexError, AttributeError):
            return 0.0

    def _extract_duration(self, directions: Dict) -> float:
        try:
            legs = directions.get("routes", [])[0].get("legs", [])
            seconds = sum(leg.get("duration", {}).get("value", 0) for leg in legs)
            return seconds / 60
        except (IndexError, AttributeError):
            return 0.0

    def _build_grid(self, polygon: Polygon, grid_size: int) -> List[Dict]:
        minx, miny, maxx, maxy = polygon.bounds
        dx = (maxx - minx) / grid_size
        dy = (maxy - miny) / grid_size
        cells: List[Dict] = []
        for i in range(grid_size):
            for j in range(grid_size):
                cell = box(minx + i * dx, miny + j * dy, minx + (i + 1) * dx, miny + (j + 1) * dy)
                intersection = polygon.intersection(cell)
                if intersection.is_empty:
                    continue
                cells.append({
                    "id": f"cell-{i}-{j}",
                    "geometry": mapping(intersection),
                })
        return cells

    def _auto_assign(self, road_segments: List[Dict], tractors: List[Dict]) -> Dict[str, List[str]]:
        assignments: Dict[str, List[str]] = {tractor["id"]: [] for tractor in tractors}
        for idx, segment in enumerate(road_segments):
            tractor = tractors[idx % len(tractors)]
            assignments[tractor["id"]].append(segment["id"])
        return assignments

    def export_kml(self, path: Path) -> None:
        from simplekml import Kml

        _, road_segments = self.loader.load()
        if not self.state.routes:
            # Build lightweight route representation from assignments
            self.state.routes = [
                {
                    "tractor": tractor,
                    "segments": [
                        {"geometry": seg["geometry"], "name": seg["name"], "id": seg["id"]}
                        for seg in road_segments
                        if seg["id"] in self.state.assignments.get(tractor["id"], [])
                    ],
                    "distance_km": 0,
                }
                for tractor in self.state.tractors
            ]
        kml = Kml()
        for route in self.state.routes:
            tractor = route["tractor"]
            folder = kml.newfolder(name=f"{tractor['name']}")
            color = tractor.get("color", "#FF0000").replace("#", "ff")
            for seg in route["segments"]:
                coords = seg["geometry"].get("coordinates", [])
                if not coords:
                    continue
                line = folder.newlinestring(name=seg.get("name", seg.get("id")))
                line.coords = [(c[0], c[1]) for c in coords]
                line.altitudemode = "clampToGround"
                line.style.linestyle.width = 4
                line.style.linestyle.color = color
        kml.save(str(path))

    def export_geojson(self, path: Path) -> None:
        export_geojson_file(self.loader.to_geojson(), path)
