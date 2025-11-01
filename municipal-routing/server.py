import os
from datetime import datetime
from pathlib import Path
from typing import Dict

from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request, send_file

from kml_utils import KMLDataLoader
from routing_engine import RoutingEngine
from state import AppState, load_state, save_state

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
EXPORT_DIR = DATA_DIR / "exports"
EXPORT_DIR.mkdir(parents=True, exist_ok=True)

app = Flask(__name__, template_folder=str(BASE_DIR / "templates"), static_folder=str(BASE_DIR / "static"))
app.config["JSON_SORT_KEYS"] = False

state: AppState = load_state(DATA_DIR / "session.json")
loader = KMLDataLoader(DATA_DIR / "GEO.kml", DATA_DIR / "RoadCity.kml")
engine = RoutingEngine(loader, state)


def refresh_data() -> None:
    city, roads = loader.load()
    state.city_polygon = city
    state.road_segments = roads
    save_state(state, DATA_DIR / "session.json")


@app.route("/")
def index() -> str:
    refresh_data()
    google_maps_key = os.getenv("GOOGLE_MAPS_JS_API_KEY", "")
    return render_template(
        "index.html",
        google_maps_key=google_maps_key,
        state=state.to_dict(),
    )


@app.route("/api/state", methods=["GET"])
def get_state() -> Dict:
    refresh_data()
    return jsonify(state.to_dict())


@app.route("/api/routes", methods=["POST"])
def compute_routes():
    body = request.get_json(force=True) if request.data else {}
    options = body.get("options", {})
    google_keys = {
        "directions": os.getenv("GOOGLE_DIRECTIONS_API_KEY", os.getenv("GOOGLE_API_KEY", "")),
        "roads": os.getenv("GOOGLE_ROADS_API_KEY", os.getenv("GOOGLE_API_KEY", "")),
        "distance_matrix": os.getenv("GOOGLE_DISTANCE_MATRIX_API_KEY", os.getenv("GOOGLE_API_KEY", "")),
        "geocoding": os.getenv("GOOGLE_GEOCODING_API_KEY", os.getenv("GOOGLE_API_KEY", "")),
        "geolocation": os.getenv("GOOGLE_GEOLOCATION_API_KEY", os.getenv("GOOGLE_API_KEY", "")),
        "places": os.getenv("GOOGLE_PLACES_API_KEY", os.getenv("GOOGLE_API_KEY", "")),
        "elevation": os.getenv("GOOGLE_ELEVATION_API_KEY", os.getenv("GOOGLE_API_KEY", "")),
        "timezone": os.getenv("GOOGLE_TIMEZONE_API_KEY", os.getenv("GOOGLE_API_KEY", "")),
    }
    result = engine.build_routes(options=options, google_keys=google_keys)
    timestamp = datetime.utcnow().isoformat()
    state.last_run = timestamp
    state.routes = result["routes"]
    state.log.extend(result.get("log", []))
    state.metadata = result.get("metadata", {})
    save_state(state, DATA_DIR / "session.json")
    return jsonify({"timestamp": timestamp, **result})


@app.route("/api/export/kml", methods=["GET"])
def export_kml():
    refresh_data()
    export_path = EXPORT_DIR / "routes_export.kml"
    engine.export_kml(export_path)
    return send_file(export_path, mimetype="application/vnd.google-earth.kml+xml", as_attachment=True)


@app.route("/api/export/geojson", methods=["GET"])
def export_geojson():
    refresh_data()
    export_path = EXPORT_DIR / "routes_export.geojson"
    engine.export_geojson(export_path)
    return send_file(export_path, mimetype="application/geo+json", as_attachment=True)


@app.route("/api/reassign", methods=["POST"])
def reassign():
    payload = request.get_json(force=True)
    assignments = payload.get("assignments", {})
    state.assignments = assignments
    save_state(state, DATA_DIR / "session.json")
    return jsonify({"status": "ok", "assignments": assignments})


@app.route("/api/reset", methods=["POST"])
def reset_state():
    state.reset()
    save_state(state, DATA_DIR / "session.json")
    return jsonify({"status": "reset"})


@app.route("/api/log", methods=["GET"])
def get_log():
    return jsonify({"log": state.log})


if __name__ == "__main__":
    refresh_data()
    app.run(host="0.0.0.0", port=5000, debug=True)
