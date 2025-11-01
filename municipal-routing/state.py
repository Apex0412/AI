from __future__ import annotations

import json
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Dict, List, Optional

from shapely.geometry import Polygon


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
    routes: List[Dict] = field(default_factory=list)
    log: List[Dict] = field(default_factory=list)
    metadata: Dict = field(default_factory=dict)
    last_run: Optional[str] = None

    def reset(self) -> None:
        self.assignments.clear()
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
            "routes": self.routes,
            "log": self.log[-200:],
            "metadata": self.metadata,
            "last_run": self.last_run,
            "road_segments": self.road_segments,
            "city_polygon": polygon_geojson,
        }


def load_state(path: Path) -> AppState:
    base_path = path.parent / "BASE.json"
    base_config = _load_json(
        base_path,
        {
            "base_location": {"lat": 0.0, "lng": 0.0},
            "tractors": [
                {"id": "tractor-1", "name": "Трактор 1", "color": "#EF4444"},
                {"id": "tractor-2", "name": "Трактор 2", "color": "#3B82F6"},
            ],
        },
    )
    session_data = _load_json(path, {})
    state = AppState(
        base_location=base_config["base_location"],
        tractors=base_config["tractors"],
    )
    state.assignments = session_data.get("assignments", {})
    state.routes = session_data.get("routes", [])
    state.log = session_data.get("log", [])
    state.metadata = session_data.get("metadata", {})
    state.last_run = session_data.get("last_run")
    return state


def save_state(state: AppState, path: Path) -> None:
    payload = {
        "assignments": state.assignments,
        "routes": state.routes,
        "log": state.log,
        "metadata": state.metadata,
        "last_run": state.last_run,
    }
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False))
