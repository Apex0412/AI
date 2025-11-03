from __future__ import annotations

import os
from datetime import datetime
from pathlib import Path
from typing import Dict, List

from shapely.geometry import LineString, Polygon, box, mapping, shape

from google_client import GoogleClient  # noqa: F401  # сохраняем возможность вернуть Google при необходимости
from kml_utils import KMLDataLoader, export_geojson as export_geojson_file
from routing_providers import (
    OSRMClient,
    OpenRouteServiceClient,
    compute_transition,
    decode_ors_distance,
    decode_ors_duration,
    decode_osrm_distance,
    decode_osrm_duration,
)
from state import AppState
from yandex_client import YandexClient

ENABLE_GOOGLE_SERVICES = os.getenv("ENABLE_GOOGLE_SERVICES", "false").lower() == "true"


class RoutingEngine:
    def __init__(self, loader: KMLDataLoader, state: AppState):
        self.loader = loader
        self.state = state

    def build_routes(self, options: Dict, google_keys: Dict[str, str]) -> Dict:
        city_polygon, road_segments = self.loader.load()
        self.state.city_polygon = city_polygon
        self.state.road_segments = road_segments

        tractors_count = int(options.get("tractors_count", self.state.tractors_count or len(self.state.tractors)))
        self.state.ensure_tractors(tractors_count)

        if options.get("base_location"):
            self.state.base_location = options["base_location"]

        self.state.route_limit_km = float(options.get("route_limit_km", self.state.route_limit_km))
        self.state.travel_mode = options.get("travel_mode", self.state.travel_mode)
        self.state.max_waypoints = int(options.get("max_waypoints", self.state.max_waypoints))

        if not self.state.assignments:
            self.state.assignments = self.auto_assign_roads(road_segments)

        if not self.state.grid:
            grid_size = int(options.get("grid_size", max(6, self.state.tractors_count * 4)))
            self.state.grid = self.generate_grid(city_polygon, grid_size)

        if not self.state.grid_assignments and self.state.grid:
            self.state.grid_assignments = self.auto_assign_grid(self.state.grid)

        enable_google = bool(options.get("enable_google_services", self.state.enable_google_services))
        enable_google = enable_google and ENABLE_GOOGLE_SERVICES
        self.state.enable_google_services = enable_google

        ors_key = options.get("ors_api_key") or self.state.ors_api_key or os.getenv("ORS_API_KEY", "")
        yandex_key = options.get("yandex_api_key") or self.state.yandex_api_key or os.getenv("YANDEX_API_KEY", "")

        osrm_client = OSRMClient()
        ors_client = OpenRouteServiceClient(api_key=ors_key)
        yandex_client = YandexClient(api_key=yandex_key)

        # Для повторного подключения Google API достаточно установить ENABLE_GOOGLE_SERVICES = True
        # и передавать ключи. Прежняя интеграция сохранена ниже в комментариях.
        # google_client = GoogleClient({**google_keys, "default": google_keys.get("directions", "")})
        routes: List[Dict] = []
        log_entries: List[Dict] = []
        progress: List[Dict] = []
        base = self.state.base_location
        base_coords = [base["lng"], base["lat"]]
        base_str = f"{base['lat']},{base['lng']}"

        segment_lookup = {seg["id"]: seg for seg in road_segments}

        for tractor in self.state.tractors:
            assigned_ids = self.state.assignments.get(tractor["id"], [])
            if not assigned_ids:
                progress.append(
                    {
                        "tractor": tractor["name"],
                        "distance_km": 0.0,
                        "limit_km": self.state.route_limit_km,
                        "segments": 0,
                    }
                )
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
            previous_point_coords = base_coords[:]
            for seg_id in assigned_ids:
                segment = segment_lookup.get(seg_id)
                if not segment:
                    continue
                geometry = segment["geometry"]
                coords = [[c[0], c[1]] for c in geometry.get("coordinates", [])]
                if not coords:
                    continue
                start = coords[0]
                end = coords[-1]
                start_str = f"{start[1]},{start[0]}"
                end_str = f"{end[1]},{end[0]}"

                # Переходы строятся через OSRM / OpenRouteService. Прежний вызов Google Directions оставлен ниже
                # в комментариях.
                start_coord = [start[0], start[1]]
                end_coord = [end[0], end[1]]

                transition = compute_transition(
                    previous_point_coords,
                    start_coord,
                    self.state.travel_mode,
                    osrm_client,
                    ors_client,
                )

                if transition.get("source") == "osrm":
                    transition_distance = decode_osrm_distance(transition)
                    transition_duration = decode_osrm_duration(transition)
                else:
                    transition_distance = decode_ors_distance(transition)
                    transition_duration = decode_ors_duration(transition)

                profile_map = {
                    "walking": ("foot", "foot-walking"),
                    "bicycling": ("bike", "cycling-regular"),
                }
                osrm_profile, _ = profile_map.get(self.state.travel_mode, ("driving", "driving-car"))

                snapped = osrm_client.match(coords, profile=osrm_profile)
                elevation = ors_client.elevation_line(coords) if ors_key else {"status": "SKIPPED"}
                geocode = yandex_client.geocode(f"{start[0]},{start[1]}") if yandex_client.api_key else {}
                places = yandex_client.suggest(segment.get("name", start_str)) if yandex_client.api_key else {}
                timezone = {
                    "service": "yandex_time_zone",
                    "note": "Используйте Time Zone API для детальных данных",
                }

                # if enable_google:
                #     google_transition = google_client.directions(
                #         previous_point,
                #         start_str,
                #         mode=self.state.travel_mode,
                #         max_waypoints=self.state.max_waypoints,
                #     )
                #     transition.setdefault("google_directions", google_transition)
                seg_distance = self._line_length_km(LineString([(c[0], c[1]) for c in coords]))

                tractor_route["segments"].append(
                    {
                        "id": seg_id,
                        "name": segment.get("name"),
                        "geometry": geometry,
                        "snap": snapped,
                        "elevation": elevation,
                        "geocode": geocode,
                        "places": places,
                        "timezone": timezone,
                        "routing_engine": transition.get("source", "ors"),
                        "segment_distance_km": seg_distance,
                    }
                )
                tractor_route["transitions"].append(
                    {
                        "from": previous_point,
                        "to": start_str,
                        "directions": transition,
                        "provider": transition.get("source", "ors"),
                        "distance_km": transition_distance,
                        "duration_min": transition_duration,
                    }
                )
                tractor_route["distance_km"] += transition_distance + seg_distance
                tractor_route["duration_min"] += transition_duration
                previous_point = end_str
                previous_point_coords = end_coord

                if tractor_route["distance_km"] >= self.state.route_limit_km:
                    log_entries.append(
                        {
                            "tractor": tractor["name"],
                            "distance_km": round(tractor_route["distance_km"], 2),
                            "segments": len(tractor_route["segments"]),
                            "timestamp": datetime.utcnow().isoformat(),
                            "level": "WARNING",
                            "message": "Достигнут лимит маршрута",
                        }
                    )
                    break

            routes.append(tractor_route)
            log_entries.append(
                {
                    "tractor": tractor["name"],
                    "distance_km": round(tractor_route["distance_km"], 2),
                    "segments": len(tractor_route["segments"]),
                    "timestamp": datetime.utcnow().isoformat(),
                    "level": "INFO",
                    "message": "Маршрут построен",
                }
            )
            progress.append(
                {
                    "tractor": tractor["name"],
                    "distance_km": round(tractor_route["distance_km"], 2),
                    "limit_km": self.state.route_limit_km,
                    "segments": len(tractor_route["segments"]),
                }
            )

        metadata = {
            "assignments": self.state.assignments,
            "grid": self.state.grid,
            "progress": progress,
            "eta": self._estimate_eta(progress),
        }

        return {"routes": routes, "log": log_entries, "metadata": metadata}

    def build_grid(self, grid_size: int) -> List[Dict]:
        city_polygon, _ = self.loader.load()
        self.state.city_polygon = city_polygon
        grid = self.generate_grid(city_polygon, grid_size)
        self.state.grid = grid
        return grid

    def auto_assign_roads(self, road_segments: List[Dict]) -> Dict[str, List[str]]:
        tractors = self.state.tractors
        assignments: Dict[str, List[str]] = {tractor["id"]: [] for tractor in tractors}
        for idx, segment in enumerate(road_segments):
            tractor = tractors[idx % len(tractors)]
            assignments[tractor["id"]].append(segment["id"])
        return assignments

    def auto_assign_grid(self, grid: List[Dict]) -> Dict[str, str]:
        tractors = self.state.tractors
        if not tractors:
            return {}
        shapes: Dict[str, Polygon] = {cell["id"]: shape(cell["geometry"]) for cell in grid}
        adjacency: Dict[str, List[str]] = {cell_id: [] for cell_id in shapes.keys()}
        cell_ids = list(shapes.keys())
        for i, cell_id in enumerate(cell_ids):
            for j in range(i + 1, len(cell_ids)):
                other_id = cell_ids[j]
                if shapes[cell_id].touches(shapes[other_id]) or shapes[cell_id].intersects(shapes[other_id]):
                    adjacency[cell_id].append(other_id)
                    adjacency[other_id].append(cell_id)

        total_cells = len(grid)
        target_per_tractor = max(1, total_cells // len(tractors))
        assigned: Dict[str, str] = {}
        counts: Dict[str, int] = {tractor["id"]: 0 for tractor in tractors}
        tractor_cycle = list(tractors)
        tractor_index = 0

        for seed in cell_ids:
            if seed in assigned:
                continue
            tractor = tractor_cycle[tractor_index % len(tractor_cycle)]
            tractor_index += 1
            queue = [seed]
            while queue:
                current = queue.pop(0)
                if current in assigned:
                    continue
                assigned[current] = tractor["id"]
                counts[tractor["id"]] += 1
                if counts[tractor["id"]] >= target_per_tractor and len(assigned) < total_cells:
                    break
                for neighbor in adjacency[current]:
                    if neighbor not in assigned:
                        queue.append(neighbor)

        for cell_id in cell_ids:
            if cell_id in assigned:
                continue
            tractor = min(tractor_cycle, key=lambda t: counts[t["id"]])
            assigned[cell_id] = tractor["id"]
            counts[tractor["id"]] += 1

        return assigned

    def generate_grid(self, polygon: Polygon, divisions: int) -> List[Dict]:
        if divisions < 1:
            divisions = 1
        minx, miny, maxx, maxy = polygon.bounds
        dx = (maxx - minx) / divisions
        dy = (maxy - miny) / divisions
        cells: List[Dict] = []
        for i in range(divisions):
            for j in range(divisions):
                cell = box(minx + i * dx, miny + j * dy, minx + (i + 1) * dx, miny + (j + 1) * dy)
                intersection = polygon.intersection(cell)
                if intersection.is_empty:
                    continue
                cells.append({"id": f"cell-{i}-{j}", "geometry": mapping(intersection)})
        return cells

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

    def _estimate_eta(self, progress: List[Dict]) -> Dict:
        if not progress:
            return {"status": "idle"}
        total_limit = sum(item["limit_km"] for item in progress)
        total_distance = sum(item["distance_km"] for item in progress)
        completion = min(1.0, total_distance / total_limit) if total_limit else 0.0
        return {"status": "running", "completion": round(completion, 2)}

    def export_kml(self, path: Path) -> None:
        from simplekml import Kml

        _, road_segments = self.loader.load()
        if not self.state.routes:
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
