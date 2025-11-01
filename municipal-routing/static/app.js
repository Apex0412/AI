const state = window.__INITIAL_STATE__ || {};
let map;
let layers = {
  polygon: null,
  roads: [],
  routes: [],
  grid: [],
};

const colors = state.tractors?.map((t) => t.color) || ["#EF4444", "#3B82F6", "#F59E0B", "#10B981"];

const waitForGoogle = () => {
  return new Promise((resolve) => {
    if (window.google && window.google.maps) {
      resolve(window.google.maps);
      return;
    }
    const interval = setInterval(() => {
      if (window.google && window.google.maps) {
        clearInterval(interval);
        resolve(window.google.maps);
      }
    }, 100);
  });
};

const formatLatLng = ({ lat, lng }) => `${lat.toFixed(5)}, ${lng.toFixed(5)}`;

const renderBaseInfo = () => {
  if (!state.base_location) return;
  const baseEl = document.querySelector("#base-location");
  baseEl.textContent = formatLatLng(state.base_location);
  const lastRun = document.querySelector("#last-run");
  lastRun.textContent = state.last_run ? new Date(state.last_run).toLocaleString() : "—";
};

const renderLogs = (logs) => {
  const container = document.querySelector("#log-entries");
  container.innerHTML = "";
  (logs || []).slice().reverse().forEach((entry) => {
    const item = document.createElement("div");
    item.className = "rounded-lg border border-slate-800 bg-slate-900/60 p-3";
    item.innerHTML = `
      <div class="flex items-center justify-between text-sm">
        <span class="font-semibold text-slate-100">${entry.tractor || "Сессия"}</span>
        <span class="text-xs text-slate-500">${new Date(entry.timestamp || Date.now()).toLocaleString()}</span>
      </div>
      <div class="mt-2 text-xs text-slate-400">
        Сегментов: ${entry.segments ?? "—"} · Дистанция: ${(entry.distance_km ?? 0).toFixed(2)} км
      </div>
    `;
    container.appendChild(item);
  });
};

const drawPolygon = (maps) => {
  if (!state.city_polygon?.geometry) return;
  const path = state.city_polygon.geometry.coordinates[0].map(([lng, lat]) => ({ lat, lng }));
  layers.polygon = new maps.Polygon({
    paths: path,
    strokeColor: "#38BDF8",
    strokeOpacity: 0.7,
    strokeWeight: 2,
    fillColor: "#38BDF8",
    fillOpacity: 0.08,
  });
  layers.polygon.setMap(map);
  const bounds = new maps.LatLngBounds();
  path.forEach((pt) => bounds.extend(pt));
  map.fitBounds(bounds);
};

const drawRoads = (maps) => {
  layers.roads.forEach((line) => line.setMap(null));
  layers.roads = [];
  (state.road_segments || []).forEach((segment) => {
    const coords = segment.geometry.coordinates.map(([lng, lat]) => ({ lat, lng }));
    const polyline = new maps.Polyline({
      path: coords,
      strokeColor: "#64748B",
      strokeOpacity: 0.6,
      strokeWeight: 2,
    });
    polyline.setMap(map);
    layers.roads.push(polyline);
  });
};

const drawGrid = (maps, grid) => {
  layers.grid.forEach((poly) => poly.setMap(null));
  layers.grid = [];
  (grid || []).forEach((cell) => {
    const coords = cell.geometry.coordinates[0].map(([lng, lat]) => ({ lat, lng }));
    const polygon = new maps.Polygon({
      paths: coords,
      strokeColor: "#22C55E",
      strokeOpacity: 0.4,
      strokeWeight: 1,
      fillColor: "#22C55E",
      fillOpacity: 0.05,
    });
    polygon.setMap(map);
    layers.grid.push(polygon);
  });
};

const drawRoutes = (maps, routes) => {
  layers.routes.forEach((item) => item.setMap && item.setMap(null));
  layers.routes = [];
  routes.forEach((route, idx) => {
    const color = route.tractor?.color || colors[idx % colors.length];
    route.segments.forEach((segment) => {
      const coords = segment.geometry.coordinates.map(([lng, lat]) => ({ lat, lng }));
      const polyline = new maps.Polyline({
        path: coords,
        strokeColor: color,
        strokeWeight: 4,
        strokeOpacity: 0.8,
      });
      polyline.setMap(map);
      layers.routes.push(polyline);
    });
  });
};

const toggleLayer = (layerName, visible) => {
  if (layerName === "polygon" && layers.polygon) {
    layers.polygon.setMap(visible ? map : null);
  }
  ["roads", "grid", "routes"].forEach((name) => {
    if (layerName === name) {
      layers[name].forEach((shape) => shape.setMap(visible ? map : null));
    }
  });
};

const attachLayerToggles = () => {
  document.querySelector("#toggle-zones").addEventListener("change", (ev) => {
    toggleLayer("grid", ev.target.checked);
  });
  document.querySelector("#toggle-roads").addEventListener("change", (ev) => {
    toggleLayer("roads", ev.target.checked);
  });
  document.querySelector("#toggle-routes").addEventListener("change", (ev) => {
    toggleLayer("routes", ev.target.checked);
  });
};

const attachExportButtons = () => {
  document.querySelectorAll("[data-export]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const type = btn.dataset.export;
      window.open(`/api/export/${type}`, "_blank");
    });
  });
};

const handleRouting = () => {
  const button = document.querySelector("#run-routing");
  button.addEventListener("click", async () => {
    button.disabled = true;
    button.textContent = "Выполняем...";
    try {
      const response = await fetch("/api/routes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ options: { grid_size: 6 } }),
      });
      const data = await response.json();
      state.routes = data.routes;
      state.log = [...(state.log || []), ...(data.log || [])];
      state.metadata = data.metadata;
      state.last_run = data.timestamp;
      renderLogs(state.log);
      const maps = await waitForGoogle();
      drawRoutes(maps, state.routes || []);
      drawGrid(maps, state.metadata?.grid || []);
      document.querySelector("#last-run").textContent = new Date(state.last_run).toLocaleString();
    } catch (error) {
      console.error(error);
      alert("Не удалось построить маршруты. Проверьте логи сервера.");
    } finally {
      button.disabled = false;
      button.textContent = "Построить маршруты";
    }
  });
};

const initMap = async () => {
  const maps = await waitForGoogle();
  map = new maps.Map(document.getElementById("map"), {
    center: state.base_location ? { lat: state.base_location.lat, lng: state.base_location.lng } : { lat: 0, lng: 0 },
    zoom: 12,
    mapId: "municipal-routing",
    styles: [
      { elementType: "geometry", stylers: [{ color: "#1E293B" }] },
      { elementType: "labels.text.fill", stylers: [{ color: "#E2E8F0" }] },
      { elementType: "labels.text.stroke", stylers: [{ color: "#0F172A" }] },
      { featureType: "water", stylers: [{ color: "#0F172A" }] },
      { featureType: "road", stylers: [{ color: "#334155" }] },
      { featureType: "poi", stylers: [{ visibility: "off" }] },
    ],
    disableDefaultUI: true,
    zoomControl: true,
  });

  drawPolygon(maps);
  drawRoads(maps);
  drawRoutes(maps, state.routes || []);
  drawGrid(maps, state.metadata?.grid || []);
};

const init = async () => {
  renderBaseInfo();
  renderLogs(state.log || []);
  attachLayerToggles();
  attachExportButtons();
  handleRouting();
  await initMap();
};

window.addEventListener("load", init);
