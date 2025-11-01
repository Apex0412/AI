from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Tuple
from xml.etree import ElementTree as ET

from shapely.geometry import LineString, Polygon, mapping

KML_20_NS = "{http://earth.google.com/kml/2.0}"
KML_22_NS = "{http://earth.google.com/kml/2.2}"


def _parse_coordinates(coord_text: str) -> List[Tuple[float, float]]:
    coords: List[Tuple[float, float]] = []
    for raw in coord_text.strip().split():
        parts = raw.split(",")
        if len(parts) < 2:
            continue
        lon, lat = float(parts[0]), float(parts[1])
        coords.append((lon, lat))
    return coords


@dataclass
class KMLData:
    city_polygon: Polygon
    road_segments: List[Dict]


class KMLDataLoader:
    def __init__(self, city_path: Path, road_path: Path):
        self.city_path = Path(city_path)
        self.road_path = Path(road_path)
        self._cache: Tuple[Polygon, List[Dict]] | None = None

    def load(self) -> Tuple[Dict, List[Dict]]:
        if self._cache is None:
            city_polygon = self._parse_city_polygon()
            road_segments = self._parse_road_segments(city_polygon)
            self._cache = (city_polygon, road_segments)
        return self._cache

    def _parse_city_polygon(self) -> Polygon:
        tree = ET.parse(self.city_path)
        root = tree.getroot()
        polygon_el = root.find(f".//{KML_20_NS}Polygon")
        if polygon_el is None:
            raise ValueError("City polygon not found in GEO.kml")
        coordinates = polygon_el.find(f".//{KML_20_NS}coordinates")
        if coordinates is None or not coordinates.text:
            raise ValueError("Polygon coordinates missing")
        pts = _parse_coordinates(coordinates.text)
        if pts[0] != pts[-1]:
            pts.append(pts[0])
        return Polygon(pts)

    def _parse_road_segments(self, city_polygon: Polygon) -> List[Dict]:
        tree = ET.parse(self.road_path)
        root = tree.getroot()
        segments: List[Dict] = []
        for placemark in root.findall(f".//{KML_22_NS}Placemark"):
            name_el = placemark.find(f"{KML_22_NS}name")
            coords_el = placemark.find(f".//{KML_22_NS}coordinates")
            if coords_el is None or not coords_el.text:
                continue
            coords = _parse_coordinates(coords_el.text)
            if len(coords) < 2:
                continue
            line = LineString(coords)
            clipped = line.intersection(city_polygon)
            if clipped.is_empty:
                continue
            if clipped.geom_type == "MultiLineString":
                pieces = list(clipped.geoms)
            else:
                pieces = [clipped]
            for idx, piece in enumerate(pieces):
                segments.append(
                    {
                        "id": f"{name_el.text if name_el is not None else 'Segment'}-{idx}",
                        "name": name_el.text if name_el is not None else "Unnamed Segment",
                        "geometry": mapping(piece),
                    }
                )
        return segments

    def to_geojson(self) -> Dict:
        city, roads = self.load()
        return {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "properties": {"type": "city_polygon"},
                    "geometry": mapping(city),
                }
            ]
            + [
                {
                    "type": "Feature",
                    "properties": {"type": "road_segment", "id": seg["id"], "name": seg["name"]},
                    "geometry": seg["geometry"],
                }
                for seg in roads
            ],
        }


def export_geojson(data: Dict, path: Path) -> None:
    path.write_text(json.dumps(data, indent=2))
