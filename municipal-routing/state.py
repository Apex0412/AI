from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional

from shapely.geometry import Polygon

TRACTOR_PALETTE = [
    "#EF4444",
    "#10B981",
    "#3B82F6",
    "#F59E0B",
    "#A855F7",
    "#06B6D4",
    "#F97316",
    "#6366F1",
]


def _load_json(path: Path, default):
    if path.exists():
        return json.loads(path.read_text())
    return default


@dataclass
class AppState:
    base_location: Dict[str, float]
    tractors: List[Dict]
    city_polygon: Optional[Polygon] = None
    road_segments: List[Dict] = field(default_factory=list)
    assignments: Dict[str, List[str]] = field(default_factory=dict)
    grid_assignments: Dict[str, str] = field(default_factory=dict)
    grid: List[Dict] = field(default_factory=list)
    routes: List[Dict] = field(default_factory=list)
    log: List[Dict] = field(default_factory=list)
    metadata: Dict = field(default_factory=dict)
    last_run: Optional[str] = None
    route_limit_km: float = 30.0
    travel_mode: str = "driving"
    max_waypoints: int = 23
    tractors_count: int = 4
    google_api_key: str = ""
    monitoring_enabled: bool = False
    night_mode: bool = False
    map_provider: str = "google"

    def ensure_tractors(self, count: int) -> None:
        if count < 1:
            count = 1
        if count == len(self.tractors):
            return
        tractors: List[Dict] = []
        for idx in range(count):
            palette_color = TRACTOR_PALETTE[idx % len(TRACTOR_PALETTE)]
            tractors.append(
                {
                    "id": f"tractor-{idx + 1}",
                    "name": f"Трактор {idx + 1}",
                    "color": palette_color,
                }
            )
        self.tractors = tractors
        self.tractors_count = count
        # Rebuild assignments to keep only existing tractor identifiers
        if self.assignments:
            updated_assignments: Dict[str, List[str]] = {}
            for tractor in tractors:
                updated_assignments[tractor["id"]] = self.assignments.get(tractor["id"], [])
            self.assignments = updated_assignments
        if self.grid_assignments:
            valid_ids = {tractor["id"] for tractor in tractors}
            self.grid_assignments = {
                cell_id: tractor_id for cell_id, tractor_id in self.grid_assignments.items() if tractor_id in valid_ids
            }

    def reset(self) -> None:
        self.assignments.clear()
        self.grid_assignments.clear()
        self.routes.clear()
        self.log.clear()
        self.metadata.clear()
        self.last_run = None

    def to_dict(self) -> Dict:
        polygon_geojson = None
        if self.city_polygon is not None:
            polygon_geojson = {
                "type": "Feature",
                "properties": {"type": "city_polygon"},
                "geometry": self.city_polygon.__geo_interface__,
            }
        return {
            "base_location": self.base_location,
            "tractors": self.tractors,
            "assignments": self.assignments,
            "grid_assignments": self.grid_assignments,
            "grid": self.grid,
            "routes": self.routes,
            "log": self.log[-200:],
            "metadata": self.metadata,
            "last_run": self.last_run,
            "road_segments": self.road_segments,
            "city_polygon": polygon_geojson,
            "route_limit_km": self.route_limit_km,
            "travel_mode": self.travel_mode,
            "max_waypoints": self.max_waypoints,
            "tractors_count": self.tractors_count,
            "google_api_key": bool(self.google_api_key),
            "monitoring_enabled": self.monitoring_enabled,
            "night_mode": self.night_mode,
            "map_provider": self.map_provider,
        }


def load_state(path: Path) -> AppState:
    base_path = path.parent / "BASE.json"
    base_config = _load_json(
        base_path,
        {
            "base_location": {"lat": 54.9099, "lng": 37.3634},
            "tractors": [
                {"id": "tractor-1", "name": "Трактор 1", "color": TRACTOR_PALETTE[0]},
                {"id": "tractor-2", "name": "Трактор 2", "color": TRACTOR_PALETTE[1]},
                {"id": "tractor-3", "name": "Трактор 3", "color": TRACTOR_PALETTE[2]},
                {"id": "tractor-4", "name": "Трактор 4", "color": TRACTOR_PALETTE[3]},
            ],
        },
    )
    session_data = _load_json(path, {})
    state = AppState(
        base_location=session_data.get("base_location", base_config["base_location"]),
        tractors=base_config.get("tractors", []),
    )
    state.ensure_tractors(session_data.get("tractors_count") or len(state.tractors))
    state.assignments = session_data.get("assignments", {})
    state.grid_assignments = session_data.get("grid_assignments", {})
    state.grid = session_data.get("grid", [])
    state.routes = session_data.get("routes", [])
    state.log = session_data.get("log", [])
    state.metadata = session_data.get("metadata", {})
    state.last_run = session_data.get("last_run")
    state.route_limit_km = session_data.get("route_limit_km", 30.0)
    state.travel_mode = session_data.get("travel_mode", "driving")
    state.max_waypoints = session_data.get("max_waypoints", 23)
    state.tractors_count = session_data.get("tractors_count", len(state.tractors))
    state.google_api_key = session_data.get("google_api_key", "")
    state.monitoring_enabled = session_data.get("monitoring_enabled", False)
    state.night_mode = session_data.get("night_mode", False)
    state.map_provider = session_data.get("map_provider", "google")
    return state


def save_state(state: AppState, path: Path) -> None:
    payload = {
        "base_location": state.base_location,
        "assignments": state.assignments,
        "grid_assignments": state.grid_assignments,
        "grid": state.grid,
        "routes": state.routes,
        "log": state.log,
        "metadata": state.metadata,
        "last_run": state.last_run,
        "route_limit_km": state.route_limit_km,
        "travel_mode": state.travel_mode,
        "max_waypoints": state.max_waypoints,
        "tractors_count": state.tractors_count,
        "google_api_key": state.google_api_key,
        "monitoring_enabled": state.monitoring_enabled,
        "night_mode": state.night_mode,
        "map_provider": state.map_provider,
    }
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False))
