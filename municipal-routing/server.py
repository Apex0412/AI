import io
import json
import os
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request, send_file
from werkzeug.utils import secure_filename

from google_client import GoogleClient
from kml_utils import KMLDataLoader
from routing_engine import RoutingEngine
from state import AppState, load_state, save_state

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
EXPORT_DIR = DATA_DIR / "exports"
EXPORT_DIR.mkdir(parents=True, exist_ok=True)

app = Flask(
    __name__,
    template_folder=str(BASE_DIR / "templates"),
    static_folder=str(BASE_DIR / "static"),
)
app.config["JSON_SORT_KEYS"] = False

state: AppState = load_state(DATA_DIR / "session.json")
loader = KMLDataLoader(DATA_DIR / "GEO.kml", DATA_DIR / "RoadCity.kml")
engine = RoutingEngine(loader, state)


def _append_log(message: str, level: str = "INFO", tractor: Optional[str] = None, **extra) -> None:
    entry = {
        "timestamp": datetime.utcnow().isoformat(),
        "message": message,
        "level": level,
    }
    if tractor:
        entry["tractor"] = tractor
    if extra:
        entry.update(extra)
    state.log.append(entry)
    save_state(state, DATA_DIR / "session.json")


def refresh_data() -> None:
    city, roads = loader.load()
    state.city_polygon = city
    state.road_segments = roads
    save_state(state, DATA_DIR / "session.json")


@app.route("/")
def index() -> str:
    refresh_data()
    google_maps_key = state.google_api_key or os.getenv("GOOGLE_MAPS_JS_API_KEY", "")
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
    options = {
        "tractors_count": body.get("tractors_count", state.tractors_count),
        "route_limit_km": body.get("route_limit_km", state.route_limit_km),
        "travel_mode": body.get("travel_mode", state.travel_mode),
        "max_waypoints": body.get("max_waypoints", state.max_waypoints),
        "base_location": body.get("base_location", state.base_location),
        "grid_size": body.get("grid_size", len(state.grid) or state.tractors_count * 4),
    }
    google_keys = {
        "directions": state.google_api_key or os.getenv("GOOGLE_DIRECTIONS_API_KEY", os.getenv("GOOGLE_API_KEY", "")),
        "roads": state.google_api_key or os.getenv("GOOGLE_ROADS_API_KEY", os.getenv("GOOGLE_API_KEY", "")),
        "distance_matrix": state.google_api_key or os.getenv("GOOGLE_DISTANCE_MATRIX_API_KEY", os.getenv("GOOGLE_API_KEY", "")),
        "geocoding": state.google_api_key or os.getenv("GOOGLE_GEOCODING_API_KEY", os.getenv("GOOGLE_API_KEY", "")),
        "geolocation": state.google_api_key or os.getenv("GOOGLE_GEOLOCATION_API_KEY", os.getenv("GOOGLE_API_KEY", "")),
        "places": state.google_api_key or os.getenv("GOOGLE_PLACES_API_KEY", os.getenv("GOOGLE_API_KEY", "")),
        "elevation": state.google_api_key or os.getenv("GOOGLE_ELEVATION_API_KEY", os.getenv("GOOGLE_API_KEY", "")),
        "timezone": state.google_api_key or os.getenv("GOOGLE_TIMEZONE_API_KEY", os.getenv("GOOGLE_API_KEY", "")),
    }
    result = engine.build_routes(options=options, google_keys=google_keys)
    timestamp = datetime.utcnow().isoformat()
    state.last_run = timestamp
    state.routes = result["routes"]
    state.log.extend(result.get("log", []))
    state.metadata = result.get("metadata", {})
    save_state(state, DATA_DIR / "session.json")
    _append_log("Маршруты пересчитаны")
    return jsonify({"timestamp": timestamp, **result})


@app.route("/api/config", methods=["POST"])
def update_config():
    payload = request.get_json(force=True)
    if "base_location" in payload:
        state.base_location = payload["base_location"]
    if "tractors_count" in payload:
        state.ensure_tractors(int(payload["tractors_count"]))
    if "route_limit_km" in payload:
        state.route_limit_km = float(payload["route_limit_km"])
    if "travel_mode" in payload:
        state.travel_mode = payload["travel_mode"]
    if "max_waypoints" in payload:
        state.max_waypoints = int(payload["max_waypoints"])
    if "night_mode" in payload:
        state.night_mode = bool(payload["night_mode"])
    save_state(state, DATA_DIR / "session.json")
    _append_log("Обновлены параметры маршрутизации")
    return jsonify({"status": "ok", "state": state.to_dict()})


@app.route("/api/google-key", methods=["POST"])
def set_google_key():
    payload = request.get_json(force=True)
    key = payload.get("key", "").strip()
    if not key:
        return jsonify({"valid": False, "status": "EMPTY"}), 400
    client = GoogleClient({})
    validation = client.validate_key(key)
    if validation.get("valid"):
        state.google_api_key = key
        os.environ["GOOGLE_MAPS_JS_API_KEY"] = key
        save_state(state, DATA_DIR / "session.json")
        _append_log("Google API ключ подтверждён")
    else:
        _append_log("Ошибка проверки Google API ключа", level="ERROR")
    return jsonify(validation)


@app.route("/api/grid", methods=["POST"])
def create_grid():
    payload = request.get_json(force=True)
    divisions = int(payload.get("divisions", 8))
    refresh_data()
    grid = engine.build_grid(divisions)
    state.grid_assignments.clear()
    save_state(state, DATA_DIR / "session.json")
    _append_log(f"Создана сетка {divisions}x{divisions}")
    return jsonify({"grid": grid, "divisions": divisions})


@app.route("/api/assignments/auto", methods=["POST"])
def auto_assign():
    payload = request.get_json(force=True)
    mode = payload.get("mode", "combined")
    refresh_data()
    response: Dict[str, Dict] = {}
    if mode in ("combined", "roads"):
        state.assignments = engine.auto_assign_roads(state.road_segments)
        response["roads"] = state.assignments
    if mode in ("combined", "grid") and state.grid:
        state.grid_assignments = engine.auto_assign_grid(state.grid)
        response["grid"] = state.grid_assignments
    save_state(state, DATA_DIR / "session.json")
    _append_log("Автораспределение выполнено", mode=mode)
    return jsonify({"status": "ok", **response})


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
    assignments = payload.get("assignments")
    grid_assignments = payload.get("grid_assignments")
    if assignments is not None:
        state.assignments = assignments
    if grid_assignments is not None:
        state.grid_assignments = grid_assignments
    save_state(state, DATA_DIR / "session.json")
    _append_log("Обновлены назначения вручную")
    return jsonify(
        {
            "status": "ok",
            "assignments": state.assignments,
            "grid_assignments": state.grid_assignments,
        }
    )


@app.route("/api/assignments/reset", methods=["POST"])
def reset_assignments():
    state.assignments.clear()
    state.grid_assignments.clear()
    save_state(state, DATA_DIR / "session.json")
    _append_log("Назначения сброшены", level="WARNING")
    return jsonify({"status": "reset"})


@app.route("/api/reset", methods=["POST"])
def reset_state():
    state.reset()
    save_state(state, DATA_DIR / "session.json")
    _append_log("Состояние приложения сброшено", level="WARNING")
    return jsonify({"status": "reset"})


@app.route("/api/log", methods=["GET"])
def get_log():
    return jsonify({"log": state.log})


@app.route("/api/monitoring", methods=["GET", "POST"])
def monitoring():
    if request.method == "POST":
        payload = request.get_json(force=True)
        state.monitoring_enabled = bool(payload.get("enabled", True))
        save_state(state, DATA_DIR / "session.json")
        status = "включён" if state.monitoring_enabled else "отключён"
        _append_log(f"Онлайн-мониторинг {status}")
        return jsonify({"status": status, "enabled": state.monitoring_enabled})

    if not state.monitoring_enabled:
        return jsonify({"enabled": False, "tractors": []})

    tractors: List[Dict] = []
    for index, tractor in enumerate(state.tractors, start=1):
        tractors.append(
            {
                "id": tractor["id"],
                "name": tractor["name"],
                "color": tractor["color"],
                "lat": state.base_location["lat"] + 0.002 * index,
                "lng": state.base_location["lng"] + 0.002 * index,
                "status": "Двигается" if index % 2 == 1 else "Стоит",
            }
        )
    return jsonify({"enabled": True, "tractors": tractors})


@app.route("/api/session/save", methods=["GET"])
def download_session():
    save_state(state, DATA_DIR / "session.json")
    buffer = io.BytesIO(json.dumps(state.to_dict(), ensure_ascii=False, indent=2).encode("utf-8"))
    buffer.seek(0)
    filename = f"session-{datetime.utcnow().strftime('%Y%m%d-%H%M%S')}.json"
    return send_file(buffer, mimetype="application/json", as_attachment=True, download_name=filename)


@app.route("/api/session/load", methods=["POST"])
def load_session_endpoint():
    if "file" not in request.files:
        return jsonify({"error": "Файл не найден"}), 400
    file = request.files["file"]
    if not file.filename:
        return jsonify({"error": "Файл не выбран"}), 400
    content = json.load(file.stream)
    state.assignments = content.get("assignments", {})
    state.grid_assignments = content.get("grid_assignments", {})
    state.grid = content.get("grid", [])
    state.routes = content.get("routes", [])
    state.log = content.get("log", [])
    state.metadata = content.get("metadata", {})
    state.last_run = content.get("last_run")
    state.route_limit_km = content.get("route_limit_km", state.route_limit_km)
    state.travel_mode = content.get("travel_mode", state.travel_mode)
    state.max_waypoints = content.get("max_waypoints", state.max_waypoints)
    state.tractors_count = content.get("tractors_count", state.tractors_count)
    state.ensure_tractors(state.tractors_count)
    state.monitoring_enabled = content.get("monitoring_enabled", state.monitoring_enabled)
    state.night_mode = content.get("night_mode", state.night_mode)
    save_state(state, DATA_DIR / "session.json")
    _append_log("Сессия загружена из файла")
    return jsonify({"status": "ok", "state": state.to_dict()})


@app.route("/api/upload/<dataset>", methods=["POST"])
def upload_dataset(dataset: str):
    if "file" not in request.files:
        return jsonify({"error": "Файл не найден"}), 400
    file = request.files["file"]
    if not file.filename:
        return jsonify({"error": "Файл не выбран"}), 400
    filename = secure_filename(file.filename)
    if dataset == "geo":
        target = DATA_DIR / "GEO.kml"
    elif dataset == "roads":
        target = DATA_DIR / "RoadCity.kml"
    else:
        return jsonify({"error": "Неизвестный тип"}), 400
    file.save(target)
    loader.geo_path = DATA_DIR / "GEO.kml"
    loader.roads_path = DATA_DIR / "RoadCity.kml"
    refresh_data()
    _append_log(f"Файл {filename} загружен")
    return jsonify({"status": "ok", "state": state.to_dict()})


if __name__ == "__main__":
    refresh_data()
    app.run(host="0.0.0.0", port=5000, debug=True)
