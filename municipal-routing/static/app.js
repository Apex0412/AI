const appState = window.__INITIAL_STATE__ || {};
let map;
const layers = {
  polygon: null,
  roads: [],
  roadMeta: new Map(),
  grid: [],
  gridMeta: new Map(),
  routes: [],
  routeMeta: [],
  base: null,
  monitoring: [],
  places: [],
};
let assignMode = "grid";
let selectedElement = null;
let monitoringTimer = null;

const tractorColors = () => appState.tractors?.map((t) => t.color) || [];

const waitForGoogle = () =>
  new Promise((resolve) => {
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

const formatLatLng = ({ lat, lng }) => `${lat.toFixed(5)}, ${lng.toFixed(5)}`;

const qs = (selector) => document.querySelector(selector);
const qsa = (selector) => Array.from(document.querySelectorAll(selector));

const setFieldValues = () => {
  qs("#tractors-count").value = appState.tractors_count || appState.tractors?.length || 4;
  qs("#route-limit").value = appState.route_limit_km || 30;
  qs("#travel-mode").value = appState.travel_mode || "driving";
  qs("#max-waypoints").value = appState.max_waypoints || 23;
  qs("#base-lat").value = appState.base_location?.lat?.toFixed(4) ?? "";
  qs("#base-lng").value = appState.base_location?.lng?.toFixed(4) ?? "";
  qs("#google-status").textContent = appState.google_api_key ? "Google OK" : "Не проверен";
  qs("#google-status").className = appState.google_api_key ? "font-semibold text-emerald-300" : "font-semibold text-amber-300";
  qs("#night-mode").checked = Boolean(appState.night_mode);
  qs("#simplify-routes").checked = false;
};

const updateBaseInfo = () => {
  if (appState.base_location) {
    qs("#base-location").textContent = formatLatLng(appState.base_location);
  }
  qs("#last-run").textContent = appState.last_run
    ? new Date(appState.last_run).toLocaleString()
    : "—";
};

const updateLegend = () => {
  const legend = qs("#legend");
  legend.innerHTML = "";
  (appState.tractors || []).forEach((tractor) => {
    const distance =
      appState.routes
        ?.find((route) => route.tractor?.id === tractor.id)?.distance_km?.toFixed(1) || "0.0";
    const item = document.createElement("div");
    item.className = "flex items-center justify-between rounded-2xl bg-slate-800/60 px-4 py-3";
    item.innerHTML = `
      <div class="flex items-center gap-3">
        <span class="inline-flex h-4 w-4 rounded-full" style="background:${tractor.color}"></span>
        <span class="font-semibold text-slate-100">${tractor.name}</span>
      </div>
      <span class="text-xs text-slate-300">${distance} км</span>
    `;
    legend.appendChild(item);
  });
};

const renderLogs = () => {
  const container = qs("#log-entries");
  container.innerHTML = "";
  (appState.log || [])
    .slice()
    .reverse()
    .forEach((entry) => {
      const severityClass =
        entry.level === "ERROR"
          ? "border-red-500/40 bg-red-500/10"
          : entry.level === "WARNING"
          ? "border-amber-400/40 bg-amber-400/10"
          : "border-slate-700 bg-slate-800/60";
      const item = document.createElement("div");
      item.className = `rounded-2xl border ${severityClass} p-4 text-sm`;
      item.innerHTML = `
        <div class="flex items-center justify-between text-xs uppercase tracking-widest">
          <span class="font-semibold text-slate-200">${entry.tractor || "Система"}</span>
          <span class="text-slate-400">${new Date(entry.timestamp).toLocaleTimeString()}</span>
        </div>
        <div class="mt-2 text-slate-200">${entry.message || ""}</div>
        <div class="mt-1 text-xs text-slate-400">
          Сегментов: ${entry.segments ?? "—"} · Дистанция: ${entry.distance_km ?? "—"} км
        </div>
      `;
      container.appendChild(item);
    });
};

const renderProgress = () => {
  const container = qs("#progress-container");
  container.innerHTML = "";
  const progress = appState.metadata?.progress || [];
  progress.forEach((item) => {
    const percent = Math.min(100, Math.round((item.distance_km / item.limit_km) * 100));
    const row = document.createElement("div");
    row.innerHTML = `
      <div class="flex items-center justify-between text-xs text-slate-400">
        <span>${item.tractor}</span>
        <span>${item.distance_km.toFixed(1)} / ${item.limit_km.toFixed(1)} км</span>
      </div>
      <div class="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-800">
        <div class="h-full rounded-full bg-emerald-400" style="width:${percent}%"></div>
      </div>
    `;
    container.appendChild(row);
  });
  const eta = appState.metadata?.eta;
  if (eta?.status === "running") {
    qs("#routing-status").textContent = "Построение выполняется";
    qs("#routing-eta").textContent = `${Math.round(eta.completion * 100)}%`;
  } else {
    qs("#routing-status").textContent = "Ожидание запуска";
    qs("#routing-eta").textContent = "—";
  }
};

const applyNightMode = () => {
  document.body.classList.toggle("night", Boolean(appState.night_mode));
};

const clearLayer = (list) => {
  list.forEach((item) => item.setMap && item.setMap(null));
  list.length = 0;
};

const drawPolygon = (maps) => {
  if (!appState.city_polygon?.geometry) return;
  if (layers.polygon) {
    layers.polygon.setMap(null);
  }
  const path = appState.city_polygon.geometry.coordinates[0].map(([lng, lat]) => ({ lat, lng }));
  layers.polygon = new maps.Polygon({
    paths: path,
    strokeColor: "#38BDF8",
    strokeOpacity: 0.7,
    strokeWeight: 2,
    fillColor: "#0EA5E9",
    fillOpacity: 0.08,
  });
  layers.polygon.setMap(qsMap());
};

const drawBaseMarker = (maps) => {
  if (!appState.base_location) return;
  if (layers.base) layers.base.setMap(null);
  layers.base = new maps.Marker({
    position: appState.base_location,
    icon: {
      path: maps.SymbolPath.CIRCLE,
      scale: 10,
      fillColor: "#FACC15",
      fillOpacity: 1,
      strokeColor: "#FDE68A",
      strokeWeight: 2,
    },
    title: "База",
  });
  layers.base.setMap(qsMap());
};

const drawRoads = (maps) => {
  clearLayer(layers.roads);
  layers.roadMeta.clear();
  const roadAssignments = new Map();
  Object.entries(appState.assignments || {}).forEach(([tractorId, segmentIds]) => {
    segmentIds.forEach((id) => roadAssignments.set(id, tractorId));
  });
  (appState.road_segments || []).forEach((segment) => {
    const coords = segment.geometry.coordinates.map(([lng, lat]) => ({ lat, lng }));
    const assignedTractor = roadAssignments.get(segment.id);
    const color = assignedTractor ? getTractorColor(assignedTractor) : "#94A3B8";
    const polyline = new maps.Polyline({
      path: coords,
      strokeColor: color,
      strokeOpacity: assignedTractor ? 0.85 : 0.5,
      strokeWeight: assignedTractor ? 3 : 2,
    });
    polyline.setMap(qsMap());
    layers.roads.push(polyline);
    layers.roadMeta.set(polyline, segment);
    maps.event.addListener(polyline, "click", (event) => handleMapClick("road", segment, event.latLng));
  });
};

const drawGrid = (maps) => {
  clearLayer(layers.grid);
  layers.gridMeta.clear();
  (appState.grid || []).forEach((cell) => {
    const coords = cell.geometry.coordinates[0].map(([lng, lat]) => ({ lat, lng }));
    const assignment = appState.grid_assignments?.[cell.id];
    const color = assignment ? getTractorColor(assignment) : "#22C55E";
    const polygon = new maps.Polygon({
      paths: coords,
      strokeColor: color,
      strokeOpacity: 0.4,
      strokeWeight: 1,
      fillColor: color,
      fillOpacity: assignment ? 0.18 : 0.05,
    });
    polygon.setMap(qsMap());
    layers.grid.push(polygon);
    layers.gridMeta.set(polygon, cell);
    maps.event.addListener(polygon, "click", (event) => handleMapClick("grid", cell, event.latLng));
  });
};

const drawRoutes = (maps) => {
  clearLayer(layers.routes);
  layers.routeMeta = [];
  (appState.routes || []).forEach((route) => {
    const color = route.tractor?.color || "#0EA5E9";
    route.segments?.forEach((segment) => {
      const coords = segment.geometry.coordinates.map(([lng, lat]) => ({ lat, lng }));
      const polyline = new maps.Polyline({
        path: coords,
        strokeColor: color,
        strokeOpacity: 0.9,
        strokeWeight: 4,
      });
      polyline.setMap(qsMap());
      layers.routes.push(polyline);
      layers.routeMeta.push({ polyline, route, segment });
    });
  });
};

const getTractorColor = (tractorId) => {
  const tractor = (appState.tractors || []).find((t) => t.id === tractorId);
  return tractor?.color || "#22C55E";
};

const handleMapClick = (type, feature, latLng) => {
  if ((type === "grid" && assignMode !== "grid") || (type === "road" && assignMode !== "road")) {
    return;
  }
  selectedElement = { type, feature };
  const dialog = qs("#assignment-dialog");
  dialog.classList.add("show");
  dialog.classList.remove("hidden");
  qs("#dialog-element-name").textContent = type === "grid" ? feature.id : feature.name || feature.id;
  const list = qs("#dialog-tractor-options");
  list.innerHTML = "";
  (appState.tractors || []).forEach((tractor) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ghost-btn";
    button.textContent = tractor.name;
    button.style.borderColor = "rgba(148,163,184,0.4)";
    button.style.color = tractor.color;
    button.dataset.tractorId = tractor.id;
    button.addEventListener("click", () => {
      list.querySelectorAll("button").forEach((btn) => btn.classList.remove("selected"));
      button.classList.add("selected");
    });
    list.appendChild(button);
  });
};

const closeDialog = () => {
  const dialog = qs("#assignment-dialog");
  dialog.classList.remove("show");
  dialog.classList.add("hidden");
  selectedElement = null;
};

const submitAssignment = async () => {
  const selectedBtn = qs("#dialog-tractor-options button.selected");
  if (!selectedBtn || !selectedElement) {
    closeDialog();
    return;
  }
  const tractorId = selectedBtn.dataset.tractorId;
  if (!tractorId) {
    alert("Выберите трактор");
    return;
  }
  if (selectedElement.type === "grid") {
    appState.grid_assignments = {
      ...(appState.grid_assignments || {}),
      [selectedElement.feature.id]: tractorId,
    };
  } else {
    const assignments = appState.assignments || {};
    Object.keys(assignments).forEach((key) => {
      assignments[key] = assignments[key].filter((id) => id !== selectedElement.feature.id);
    });
    assignments[tractorId] = assignments[tractorId] || [];
    assignments[tractorId].push(selectedElement.feature.id);
    appState.assignments = assignments;
  }
  await fetch("/api/reassign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ assignments: appState.assignments, grid_assignments: appState.grid_assignments }),
  });
  await refreshState();
  closeDialog();
};

const refreshState = async () => {
  const response = await fetch("/api/state");
  const data = await response.json();
  Object.assign(appState, data);
  updateBaseInfo();
  updateLegend();
  updateFilterOptions();
  renderLogs();
  renderProgress();
  applyNightMode();
  setFieldValues();
  await redrawMap();
  applyFilter();
};

const redrawMap = async () => {
  const maps = await waitForGoogle();
  drawPolygon(maps);
  drawRoads(maps);
  drawGrid(maps);
  drawRoutes(maps);
  drawBaseMarker(maps);
};

const qsMap = () => map;

const initMap = async () => {
  const maps = await waitForGoogle();
  map = new maps.Map(document.getElementById("map"), {
    center: appState.base_location || { lat: 55.751244, lng: 37.618423 },
    zoom: 13,
    mapId: "municipal-routing",
    disableDefaultUI: true,
    zoomControl: true,
    styles: appState.night_mode
      ? [
          { elementType: "geometry", stylers: [{ color: "#0f172a" }] },
          { elementType: "labels.text.fill", stylers: [{ color: "#e2e8f0" }] },
          { featureType: "water", stylers: [{ color: "#0f172a" }] },
          { featureType: "road", stylers: [{ color: "#1e293b" }] },
        ]
      : undefined,
  });
  drawPolygon(maps);
  drawRoads(maps);
  drawGrid(maps);
  drawRoutes(maps);
  drawBaseMarker(maps);
  fitBoundsToData(maps);
};

const fitBoundsToData = (maps) => {
  const bounds = new maps.LatLngBounds();
  let hasData = false;
  if (layers.polygon) {
    layers.polygon.getPath().forEach((latLng) => {
      bounds.extend(latLng);
    });
    hasData = true;
  }
  if (!hasData && appState.base_location) {
    bounds.extend(appState.base_location);
  }
  if (hasData) {
    map.fitBounds(bounds);
  }
};

const handleBuildGrid = async () => {
  const divisions = Number(qs("#grid-divisions").value) || 8;
  const response = await fetch("/api/grid", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ divisions }),
  });
  const data = await response.json();
  appState.grid = data.grid;
  appState.grid_assignments = {};
  await redrawMap();
  applyFilter();
};

const handleAutoAssign = async () => {
  const modes = [];
  if (qs("#mode-combined").checked) modes.push("combined");
  else {
    if (qs("#mode-roads").checked) modes.push("roads");
    if (qs("#mode-grid").checked) modes.push("grid");
  }
  const response = await fetch("/api/assignments/auto", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: modes[0] || "combined" }),
  });
  const data = await response.json();
  if (data.roads) appState.assignments = data.roads;
  if (data.grid) appState.grid_assignments = data.grid;
  await redrawMap();
  applyFilter();
};

const handleConfigSave = async () => {
  const currentBase = appState.base_location || { lat: 0, lng: 0 };
  const payload = {
    tractors_count: Number(qs("#tractors-count").value),
    route_limit_km: Number(qs("#route-limit").value),
    travel_mode: qs("#travel-mode").value,
    max_waypoints: Number(qs("#max-waypoints").value),
    base_location: {
      lat: Number(qs("#base-lat").value) || currentBase.lat,
      lng: Number(qs("#base-lng").value) || currentBase.lng,
    },
    night_mode: qs("#night-mode").checked,
  };
  const response = await fetch("/api/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  Object.assign(appState, data.state);
  updateBaseInfo();
  updateFilterOptions();
  updateLegend();
  applyNightMode();
  setFieldValues();
  await redrawMap();
};

const handleKeyCheck = async () => {
  const key = qs("#google-key").value.trim();
  if (!key) return;
  const response = await fetch("/api/google-key", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key }),
  });
  const data = await response.json();
  if (data.valid) {
    qs("#google-status").textContent = "Google OK";
    qs("#google-status").className = "font-semibold text-emerald-300";
    appState.google_api_key = true;
  } else {
    qs("#google-status").textContent = `Ошибка: ${data.status || "неизвестно"}`;
    qs("#google-status").className = "font-semibold text-red-300";
  }
};

const handleRouting = async () => {
  await handleConfigSave();
  const button = qs("#run-routing");
  button.disabled = true;
  button.textContent = "Построение...";
  try {
    const response = await fetch("/api/routes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tractors_count: appState.tractors_count,
        route_limit_km: appState.route_limit_km,
        travel_mode: appState.travel_mode,
        max_waypoints: appState.max_waypoints,
        base_location: appState.base_location,
        grid_size: Math.max(6, Math.round(Math.sqrt(appState.grid?.length || 36))),
      }),
    });
    const data = await response.json();
    appState.routes = data.routes;
    appState.metadata = data.metadata;
    appState.log = [...(appState.log || []), ...(data.log || [])];
    appState.last_run = data.timestamp;
    renderLogs();
    renderProgress();
    updateLegend();
    qs("#last-run").textContent = new Date(data.timestamp).toLocaleString();
    await redrawMap();
    applyFilter();
  } catch (error) {
    console.error(error);
    alert("Не удалось построить маршруты. Проверьте логи сервера.");
  } finally {
    button.disabled = false;
    button.textContent = "Построить маршруты";
  }
};

const toggleLayer = (layerName, visible) => {
  switch (layerName) {
    case "polygon":
      layers.polygon?.setMap(visible ? qsMap() : null);
      break;
    case "grid":
      layers.grid.forEach((poly) => poly.setMap(visible ? qsMap() : null));
      break;
    case "roads":
      layers.roads.forEach((poly) => poly.setMap(visible ? qsMap() : null));
      break;
    case "routes":
      layers.routes.forEach((poly) => poly.setMap(visible ? qsMap() : null));
      break;
    case "base":
      layers.base?.setMap(visible ? qsMap() : null);
      break;
  }
};

const handleUpload = (type) => {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".kml";
  input.addEventListener("change", async () => {
    if (!input.files?.length) return;
    const formData = new FormData();
    formData.append("file", input.files[0]);
    const response = await fetch(`/api/upload/${type}`, {
      method: "POST",
      body: formData,
    });
    const data = await response.json();
    Object.assign(appState, data.state);
    await redrawMap();
    applyFilter();
  });
  input.click();
};

const handleResetAssignments = async () => {
  await fetch("/api/assignments/reset", { method: "POST" });
  await refreshState();
};

const handleMonitoringToggle = async () => {
  const enabled = !appState.monitoring_enabled;
  const response = await fetch("/api/monitoring", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
  const data = await response.json();
  appState.monitoring_enabled = data.enabled;
  qs("#toggle-monitoring").textContent = enabled
    ? "Отключить онлайн-мониторинг"
    : "Включить онлайн-мониторинг";
  if (enabled) {
    startMonitoringLoop();
  } else {
    stopMonitoringLoop();
    updateMonitoringPanel([]);
  }
};

const fetchMonitoring = async () => {
  const response = await fetch("/api/monitoring");
  const data = await response.json();
  updateMonitoringPanel(data.tractors || []);
};

const startMonitoringLoop = () => {
  fetchMonitoring();
  stopMonitoringLoop();
  monitoringTimer = setInterval(fetchMonitoring, 30000);
};

const stopMonitoringLoop = () => {
  if (monitoringTimer) {
    clearInterval(monitoringTimer);
    monitoringTimer = null;
  }
};

const updateMonitoringPanel = (tractors) => {
  const container = qs("#monitoring-panel");
  const listPanel = qs("#monitoring-list");
  const historyPanel = qs("#tracking-history");

  clearLayer(layers.monitoring);

  if (!tractors.length) {
    container.innerHTML = '<p class="text-slate-400">Мониторинг выключен.</p>';
    listPanel.innerHTML = '<p class="text-slate-400">Нет данных GPS.</p>';
    historyPanel.innerHTML = "";
    return;
  }

  const maps = map && google?.maps;
  container.innerHTML = tractors
    .map(
      (tractor) => `
      <div class="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3">
        <div>
          <p class="font-semibold text-slate-100">${tractor.name}</p>
          <p class="text-xs text-slate-400">${tractor.lat.toFixed(4)}, ${tractor.lng.toFixed(4)}</p>
        </div>
        <span class="text-xs font-semibold" style="color:${tractor.color}">${tractor.status}</span>
      </div>`
    )
    .join("\n");

  listPanel.innerHTML = tractors
    .map(
      (tractor) => `
        <div class="rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3">
          <div class="flex items-center justify-between">
            <span class="font-semibold text-slate-200">${tractor.name}</span>
            <span class="text-xs" style="color:${tractor.color}">${tractor.status}</span>
          </div>
          <p class="mt-1 text-xs text-slate-400">${tractor.lat.toFixed(4)}, ${tractor.lng.toFixed(4)}</p>
        </div>`
    )
    .join("\n");

  historyPanel.innerHTML = tractors
    .map(
      (tractor) => `
        <div class="flex items-center justify-between text-xs text-slate-400">
          <span>${tractor.name}</span>
          <span>${new Date().toLocaleTimeString()} · ${tractor.lat.toFixed(3)}, ${tractor.lng.toFixed(3)}</span>
        </div>`
    )
    .join("\n");

  if (maps) {
    tractors.forEach((tractor) => {
      const marker = new maps.Marker({
        position: { lat: tractor.lat, lng: tractor.lng },
        map,
        icon: {
          path: maps.SymbolPath.FORWARD_CLOSED_ARROW,
          scale: 5,
          fillColor: tractor.color,
          fillOpacity: 0.9,
          strokeColor: "#0f172a",
          strokeWeight: 1,
        },
        title: `${tractor.name} (${tractor.status})`,
      });
      layers.monitoring.push(marker);
    });
  }
};

const handleSessionSave = () => {
  window.open("/api/session/save", "_blank");
};

const handleSessionLoad = () => {
  const input = qs("#load-session");
  input.addEventListener("change", async () => {
    if (!input.files?.length) return;
    const formData = new FormData();
    formData.append("file", input.files[0]);
    const response = await fetch("/api/session/load", {
      method: "POST",
      body: formData,
    });
    const data = await response.json();
    Object.assign(appState, data.state);
    await redrawMap();
    renderLogs();
    renderProgress();
    updateLegend();
    updateFilterOptions();
    setFieldValues();
    input.value = "";
  });
};

const initTabs = () => {
  const logsBtn = qs("#tab-logs");
  const monitoringBtn = qs("#tab-monitoring");
  const logsPanel = qs("#panel-logs");
  const monitoringPanel = qs("#panel-monitoring");
  logsBtn.addEventListener("click", () => {
    logsBtn.classList.add("active");
    monitoringBtn.classList.remove("active");
    logsPanel.classList.remove("hidden");
    monitoringPanel.classList.add("hidden");
  });
  monitoringBtn.addEventListener("click", () => {
    monitoringBtn.classList.add("active");
    logsBtn.classList.remove("active");
    monitoringPanel.classList.remove("hidden");
    logsPanel.classList.add("hidden");
    if (appState.monitoring_enabled) {
      fetchMonitoring();
    }
  });
};

const initHelpDrawer = () => {
  qs("#help-button").addEventListener("click", () => {
    const drawer = qs("#help-drawer");
    drawer.classList.add("show");
    drawer.classList.remove("hidden");
  });
  qs("#close-help").addEventListener("click", () => {
    const drawer = qs("#help-drawer");
    drawer.classList.remove("show");
    drawer.classList.add("hidden");
  });
};

const initAssignmentDialog = () => {
  qs("#dialog-cancel").addEventListener("click", closeDialog);
  qs("#dialog-confirm").addEventListener("click", submitAssignment);
};

const initLayerToggles = () => {
  qs("#layer-polygon").addEventListener("change", (ev) => toggleLayer("polygon", ev.target.checked));
  qs("#layer-grid").addEventListener("change", (ev) => toggleLayer("grid", ev.target.checked));
  qs("#layer-roads").addEventListener("change", (ev) => toggleLayer("roads", ev.target.checked));
  qs("#layer-routes").addEventListener("change", (ev) => toggleLayer("routes", ev.target.checked));
  qs("#layer-base").addEventListener("change", (ev) => toggleLayer("base", ev.target.checked));
  qs("#layer-places").addEventListener("change", (ev) => {
    if (ev.target.checked) {
      alert("Просмотр объектов Places будет добавлен после получения реальных данных.");
    }
  });
  qs("#layer-elevation").addEventListener("change", (ev) => {
    if (ev.target.checked) {
      alert("График высот формируется после построения маршрутов.");
    }
  });
  qs("#toggle-grid-visibility").addEventListener("change", (ev) => {
    const checked = ev.target.checked;
    qs("#layer-grid").checked = checked;
    toggleLayer("grid", checked);
  });
};

function applyFilter() {
  const enabled = qs("#filter-tractor").checked;
  const selected = qs("#filter-tractor-select").value;
  if (!enabled || selected === "all") {
    layers.routes.forEach((poly) => poly.setMap(qsMap()));
    return;
  }
  layers.routeMeta.forEach(({ polyline, route }) => {
    const visible = route.tractor?.id === selected;
    polyline.setMap(visible ? qsMap() : null);
  });
}

const updateFilterOptions = () => {
  const select = qs("#filter-tractor-select");
  select.innerHTML = '<option value="all">Все</option>';
  (appState.tractors || []).forEach((tractor) => {
    const option = document.createElement("option");
    option.value = tractor.id;
    option.textContent = tractor.name;
    select.appendChild(option);
  });
  applyFilter();
};

const initFilter = () => {
  updateFilterOptions();
  qs("#filter-tractor").addEventListener("change", () => applyFilter());
  qs("#filter-tractor-select").addEventListener("change", () => applyFilter());
};

const initAssignMode = () => {
  qsa('input[name="assign-mode"]').forEach((radio) => {
    radio.addEventListener("change", (event) => {
      assignMode = event.target.value;
    });
  });
};

const initAdvancedToggle = () => {
  qs("#toggle-advanced").addEventListener("click", () => {
    const block = qs("#advanced-block");
    block.classList.toggle("hidden");
  });
};

const initUploads = () => {
  qsa("[data-upload]").forEach((btn) => {
    btn.addEventListener("click", () => handleUpload(btn.dataset.upload));
  });
};

const initExports = () => {
  qsa("[data-export]").forEach((btn) => {
    btn.addEventListener("click", () => window.open(`/api/export/${btn.dataset.export}`, "_blank"));
  });
  qs("#export-pdf").addEventListener("click", () => alert("Генерация PDF пока доступна из отчётного модуля."));
  qs("#export-elevation").addEventListener("click", () => alert("Отчёт по высотам будет доступен позже."));
};

const init = async () => {
  setFieldValues();
  updateBaseInfo();
  updateLegend();
  renderLogs();
  renderProgress();
  applyNightMode();
  initMap();
  initTabs();
  initHelpDrawer();
  initAssignmentDialog();
  initLayerToggles();
  initFilter();
  initAssignMode();
  initAdvancedToggle();
  initUploads();
  initExports();
  handleSessionLoad();

  qs("#build-grid").addEventListener("click", handleBuildGrid);
  qs("#auto-assign").addEventListener("click", handleAutoAssign);
  qs("#run-routing").addEventListener("click", handleRouting);
  qs("#check-key").addEventListener("click", handleKeyCheck);
  qs("#reset-assignments").addEventListener("click", handleResetAssignments);
  qs("#toggle-monitoring").addEventListener("click", handleMonitoringToggle);
  qs("#save-session").addEventListener("click", handleSessionSave);

  qsa("#tractors-count, #route-limit, #travel-mode, #max-waypoints, #base-lat, #base-lng, #night-mode").forEach((el) => {
    el.addEventListener("change", () => {
      handleConfigSave();
    });
  });

  qs("#toggle-monitoring").textContent = appState.monitoring_enabled
    ? "Отключить онлайн-мониторинг"
    : "Включить онлайн-мониторинг";

  if (appState.monitoring_enabled) {
    startMonitoringLoop();
  }
};

window.addEventListener("load", init);
