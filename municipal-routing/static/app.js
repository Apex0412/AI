const appState = window.__INITIAL_STATE__ || {};
appState.map_provider = appState.map_provider === "osm" ? "osm" : "google";
let map;
let mapProvider = appState.map_provider;
let mapLibrary = null;
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

const waitForLeaflet = () =>
  new Promise((resolve) => {
    if (window.L) {
      resolve(window.L);
      return;
    }
    const interval = setInterval(() => {
      if (window.L) {
        clearInterval(interval);
        resolve(window.L);
      }
    }, 100);
  });

const isGoogleProvider = () => mapProvider === "google";

const ensureMapLibrary = async () => {
  if (mapLibrary) return mapLibrary;
  mapLibrary = isGoogleProvider() ? await waitForGoogle() : await waitForLeaflet();
  return mapLibrary;
};

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
  qs("#night-mode").checked = Boolean(appState.night_mode);
  qs("#simplify-routes").checked = false;
  const providerSelect = qs("#map-provider");
  if (providerSelect) {
    providerSelect.value = appState.map_provider || "google";
  }
  updateGoogleStatus();
};

function computeGoogleStatus() {
  const metaStatus = appState.metadata?.google_key_status;
  if (metaStatus === "error") return "error";
  if (metaStatus === "ok" || appState.google_api_key) return "ok";
  return "pending";
}

function updateGoogleStatus() {
  const status = computeGoogleStatus();
  const googleStatusEl = qs("#google-status");
  if (googleStatusEl) {
    let text = "Не проверен";
    let colorClass = "text-amber-300";
    if (status === "ok") {
      text = "Google OK";
      colorClass = "text-emerald-300";
    } else if (status === "error") {
      text = "Ошибка доступа";
      colorClass = "text-red-400";
    }
    googleStatusEl.textContent = text;
    googleStatusEl.className = `font-semibold ${colorClass}`;
  }

  const indicator = qs("#api-status-indicator");
  const indicatorLabel = qs("#api-status-label");
  const indicatorCaption = qs("#api-status-caption");
  const detail = appState.metadata?.google_key_status_detail;
  if (indicator) {
    indicator.className = `status-indicator status-${status}`;
    indicator.textContent = "✓";
  }
  if (indicatorLabel) {
    if (status === "ok") {
      indicatorLabel.textContent = "Google API доступен";
      indicatorLabel.className = "text-xs font-semibold text-emerald-300";
      if (indicatorCaption)
        indicatorCaption.textContent = detail ? `Статус: ${detail}` : "Запросы к сервисам выполняются";
    } else if (status === "error") {
      indicatorLabel.textContent = "Google API недоступен";
      indicatorLabel.className = "text-xs font-semibold text-red-400";
      if (indicatorCaption)
        indicatorCaption.textContent = detail
          ? `Ошибка: ${detail}`
          : "Проверьте ключ в настройках";
    } else {
      indicatorLabel.textContent = "Google API не проверен";
      indicatorLabel.className = "text-xs font-semibold text-amber-300";
      if (indicatorCaption) indicatorCaption.textContent = "Нажмите \"Проверить\" для подтверждения";
    }
  }
}

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
  if (!legend) return;
  legend.textContent = "";
  (appState.tractors || []).forEach((tractor) => {
    const route = (appState.routes || []).find((item) => item.tractor?.id === tractor.id);
    const distanceValue = Number(route?.distance_km ?? 0);
    const wrapper = document.createElement("div");
    wrapper.className = "flex items-center justify-between rounded-2xl bg-slate-800/60 px-4 py-3";

    const left = document.createElement("div");
    left.className = "flex items-center gap-3";
    const colorDot = document.createElement("span");
    colorDot.className = "inline-flex h-4 w-4 rounded-full";
    colorDot.style.background = tractor.color;
    const name = document.createElement("span");
    name.className = "font-semibold text-slate-100";
    name.textContent = tractor.name;
    left.append(colorDot, name);

    const distance = document.createElement("span");
    distance.className = "text-xs text-slate-300";
    distance.textContent = `${distanceValue.toFixed(1)} км`;

    wrapper.append(left, distance);
    legend.appendChild(wrapper);
  });
};

const renderLogs = () => {
  const container = qs("#log-entries");
  if (!container) return;
  container.textContent = "";
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

      const header = document.createElement("div");
      header.className = "flex items-center justify-between text-xs uppercase tracking-widest";
      const actor = document.createElement("span");
      actor.className = "font-semibold text-slate-200";
      actor.textContent = entry.tractor || "Система";
      const timestamp = document.createElement("span");
      timestamp.className = "text-slate-400";
      timestamp.textContent = entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : "";
      header.append(actor, timestamp);

      const message = document.createElement("div");
      message.className = "mt-2 text-slate-200";
      message.textContent = entry.message || "";

      const meta = document.createElement("div");
      meta.className = "mt-1 text-xs text-slate-400";
      const segments = entry.segments ?? "—";
      const distanceValue =
        typeof entry.distance_km === "number"
          ? entry.distance_km.toFixed(1)
          : entry.distance_km ?? "—";
      meta.textContent = `Сегментов: ${segments} · Дистанция: ${distanceValue} км`;

      item.append(header, message, meta);
      container.appendChild(item);
    });
};

const renderProgress = () => {
  const container = qs("#progress-container");
  if (!container) return;
  container.textContent = "";
  const progress = appState.metadata?.progress || [];
  progress.forEach((item) => {
    const percent = Math.min(
      100,
      item.limit_km ? Math.round(((item.distance_km || 0) / item.limit_km) * 100) : 0,
    );
    const row = document.createElement("div");
    row.className = "space-y-1";

    const header = document.createElement("div");
    header.className = "flex items-center justify-between text-xs text-slate-400";
    const name = document.createElement("span");
    name.textContent = item.tractor || "—";
    const distance = document.createElement("span");
    const currentDistance = Number(item.distance_km || 0).toFixed(1);
    const limitDistance = Number(item.limit_km || 0).toFixed(1);
    distance.textContent = `${currentDistance} / ${limitDistance} км`;
    header.append(name, distance);

    const bar = document.createElement("div");
    bar.className = "mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-800";
    const barFill = document.createElement("div");
    barFill.className = "h-full rounded-full bg-emerald-400";
    barFill.style.width = `${percent}%`;
    bar.append(barFill);

    row.append(header, bar);
    container.appendChild(row);
  });

  const eta = appState.metadata?.eta;
  const statusEl = qs("#routing-status");
  const etaEl = qs("#routing-eta");
  if (statusEl && etaEl) {
    if (eta?.status === "running") {
      statusEl.textContent = "Построение выполняется";
      etaEl.textContent = `${Math.round((eta.completion || 0) * 100)}%`;
    } else {
      statusEl.textContent = "Ожидание запуска";
      etaEl.textContent = "—";
    }
  }
};

function updateMonitoringToggle() {
  const button = qs("#toggle-monitoring");
  if (!button) return;
  const enabled = Boolean(appState.monitoring_enabled);
  button.textContent = enabled ? "Отключить онлайн-мониторинг" : "Включить онлайн-мониторинг";
  if (enabled) {
    if (!monitoringTimer) {
      startMonitoringLoop();
    }
  } else {
    stopMonitoringLoop();
    updateMonitoringPanel([]);
  }
}

const applyNightMode = () => {
  document.body.classList.toggle("night", Boolean(appState.night_mode));
};

const removeOverlay = (overlay, provider = mapProvider) => {
  if (!overlay) return;
  if (provider === "google") {
    overlay.setMap?.(null);
  } else if (provider === "osm") {
    if (map?.hasLayer?.(overlay)) {
      map.removeLayer(overlay);
    }
    overlay.remove?.();
  }
};

const clearLayer = (list, provider = mapProvider) => {
  list.forEach((item) => removeOverlay(item, provider));
  list.length = 0;
};

const resetLayerState = (provider = mapProvider) => {
  if (layers.polygon) {
    removeOverlay(layers.polygon, provider);
    layers.polygon = null;
  }
  if (layers.base) {
    removeOverlay(layers.base, provider);
    layers.base = null;
  }
  clearLayer(layers.roads, provider);
  clearLayer(layers.grid, provider);
  clearLayer(layers.routes, provider);
  clearLayer(layers.monitoring, provider);
  clearLayer(layers.places, provider);
  layers.routeMeta = [];
  layers.roadMeta.clear();
  layers.gridMeta.clear();
};

const setOverlayVisibility = (overlay, visible) => {
  if (!overlay) return;
  if (isGoogleProvider()) {
    overlay.setMap?.(visible ? map : null);
  } else if (map) {
    const hasLayer = map.hasLayer?.(overlay);
    if (visible && !hasLayer) {
      overlay.addTo?.(map);
    } else if (!visible && hasLayer) {
      map.removeLayer?.(overlay);
    }
  }
};

const drawPolygon = (lib) => {
  if (!appState.city_polygon?.geometry) {
    if (layers.polygon) {
      removeOverlay(layers.polygon);
      layers.polygon = null;
    }
    return;
  }
  const coords = appState.city_polygon.geometry.coordinates[0].map(([lng, lat]) => ({ lat, lng }));
  if (layers.polygon) {
    removeOverlay(layers.polygon);
  }
  if (isGoogleProvider()) {
    layers.polygon = new lib.Polygon({
      paths: coords,
      strokeColor: "#38BDF8",
      strokeOpacity: 0.7,
      strokeWeight: 2,
      fillColor: "#0EA5E9",
      fillOpacity: 0.08,
    });
    layers.polygon.setMap(map);
  } else {
    const latLngs = coords.map(({ lat, lng }) => [lat, lng]);
    layers.polygon = lib.polygon(latLngs, {
      color: "#38BDF8",
      weight: 2,
      opacity: 0.7,
      fillColor: "#0EA5E9",
      fillOpacity: 0.08,
    });
    layers.polygon.addTo(map);
  }
};

const drawBaseMarker = (lib) => {
  if (!appState.base_location) {
    if (layers.base) {
      removeOverlay(layers.base);
      layers.base = null;
    }
    return;
  }
  if (layers.base) removeOverlay(layers.base);
  if (isGoogleProvider()) {
    layers.base = new lib.Marker({
      position: appState.base_location,
      icon: {
        path: lib.SymbolPath.CIRCLE,
        scale: 10,
        fillColor: "#FACC15",
        fillOpacity: 1,
        strokeColor: "#FDE68A",
        strokeWeight: 2,
      },
      title: "База",
    });
    layers.base.setMap(map);
  } else {
    layers.base = lib.circleMarker([appState.base_location.lat, appState.base_location.lng], {
      radius: 8,
      weight: 2,
      color: "#FDE68A",
      fillColor: "#FACC15",
      fillOpacity: 1,
      pane: "markerPane",
    });
    layers.base.addTo(map);
  }
};

const drawRoads = (lib) => {
  clearLayer(layers.roads);
  layers.roadMeta.clear();
  const roadAssignments = new Map();
  Object.entries(appState.assignments || {}).forEach(([tractorId, segmentIds]) => {
    segmentIds.forEach((id) => roadAssignments.set(id, tractorId));
  });
  (appState.road_segments || []).forEach((segment) => {
    const assignedTractor = roadAssignments.get(segment.id);
    const color = assignedTractor ? getTractorColor(assignedTractor) : "#94A3B8";
    if (isGoogleProvider()) {
      const coords = segment.geometry.coordinates.map(([lng, lat]) => ({ lat, lng }));
      const polyline = new lib.Polyline({
        path: coords,
        strokeColor: color,
        strokeOpacity: assignedTractor ? 0.85 : 0.5,
        strokeWeight: assignedTractor ? 3 : 2,
      });
      polyline.setMap(map);
      layers.roads.push(polyline);
      layers.roadMeta.set(polyline, segment);
      lib.event.addListener(polyline, "click", (event) => handleMapClick("road", segment, event.latLng));
    } else {
      const coords = segment.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
      const polyline = lib.polyline(coords, {
        color,
        weight: assignedTractor ? 4 : 2,
        opacity: assignedTractor ? 0.85 : 0.5,
      });
      polyline.addTo(map);
      polyline.on("click", (event) => handleMapClick("road", segment, event.latlng));
      layers.roads.push(polyline);
      layers.roadMeta.set(polyline, segment);
    }
  });
};

const drawGrid = (lib) => {
  clearLayer(layers.grid);
  layers.gridMeta.clear();
  (appState.grid || []).forEach((cell) => {
    const assignment = appState.grid_assignments?.[cell.id];
    const color = assignment ? getTractorColor(assignment) : "#22C55E";
    if (isGoogleProvider()) {
      const coords = cell.geometry.coordinates[0].map(([lng, lat]) => ({ lat, lng }));
      const polygon = new lib.Polygon({
        paths: coords,
        strokeColor: color,
        strokeOpacity: 0.4,
        strokeWeight: 1,
        fillColor: color,
        fillOpacity: assignment ? 0.18 : 0.05,
      });
      polygon.setMap(map);
      layers.grid.push(polygon);
      layers.gridMeta.set(polygon, cell);
      lib.event.addListener(polygon, "click", (event) => handleMapClick("grid", cell, event.latLng));
    } else {
      const coords = cell.geometry.coordinates[0].map(([lng, lat]) => [lat, lng]);
      const polygon = lib.polygon(coords, {
        color,
        weight: 1,
        opacity: 0.4,
        fillColor: color,
        fillOpacity: assignment ? 0.18 : 0.05,
      });
      polygon.addTo(map);
      polygon.on("click", (event) => handleMapClick("grid", cell, event.latlng));
      layers.grid.push(polygon);
      layers.gridMeta.set(polygon, cell);
    }
  });
};

const drawRoutes = (lib) => {
  clearLayer(layers.routes);
  layers.routeMeta = [];
  (appState.routes || []).forEach((route) => {
    const color = route.tractor?.color || "#0EA5E9";
    route.segments?.forEach((segment) => {
      if (isGoogleProvider()) {
        const coords = segment.geometry.coordinates.map(([lng, lat]) => ({ lat, lng }));
        const polyline = new lib.Polyline({
          path: coords,
          strokeColor: color,
          strokeOpacity: 0.9,
          strokeWeight: 4,
        });
        polyline.setMap(map);
        layers.routes.push(polyline);
        layers.routeMeta.push({ polyline, route, segment });
      } else {
        const coords = segment.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
        const polyline = lib.polyline(coords, {
          color,
          weight: 4,
          opacity: 0.9,
        });
        polyline.addTo(map);
        layers.routes.push(polyline);
        layers.routeMeta.push({ polyline, route, segment });
      }
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

const destroyMapInstance = (provider = mapProvider) => {
  resetLayerState(provider);
  if (!map) {
    mapLibrary = null;
    return;
  }
  if (provider === "osm" && typeof map.remove === "function") {
    map.remove();
  }
  if (provider === "google") {
    const mapEl = document.getElementById("map");
    if (mapEl) {
      while (mapEl.firstChild) {
        mapEl.removeChild(mapEl.firstChild);
      }
    }
  }
  map = null;
  mapLibrary = null;
};

const fitBoundsToData = (lib) => {
  if (!map) return;
  const polygonCoords = appState.city_polygon?.geometry?.coordinates?.[0] || [];
  if (polygonCoords.length) {
    if (isGoogleProvider()) {
      const bounds = new lib.LatLngBounds();
      polygonCoords.forEach(([lng, lat]) => bounds.extend({ lat, lng }));
      map.fitBounds(bounds);
    } else {
      const latLngs = polygonCoords.map(([lng, lat]) => [lat, lng]);
      if (latLngs.length === 1) {
        map.setView(latLngs[0], map.getZoom() || 13);
      } else {
        map.fitBounds(lib.latLngBounds(latLngs));
      }
    }
    return;
  }
  if (appState.base_location) {
    if (isGoogleProvider()) {
      map.setCenter(appState.base_location);
      map.setZoom(13);
    } else {
      map.setView([appState.base_location.lat, appState.base_location.lng], map.getZoom() || 13);
    }
  }
};

const redrawMap = async () => {
  if (!map) return;
  const lib = await ensureMapLibrary();
  drawPolygon(lib);
  drawRoads(lib);
  drawGrid(lib);
  drawRoutes(lib);
  drawBaseMarker(lib);
  fitBoundsToData(lib);
  if (!isGoogleProvider()) {
    map.invalidateSize?.();
  }
};

const initMap = async () => {
  const mapElement = document.getElementById("map");
  if (!mapElement) return;
  const center = appState.base_location || { lat: 54.9099, lng: 37.3634 };
  const lib = await ensureMapLibrary();
  if (isGoogleProvider()) {
    map = new lib.Map(mapElement, {
      center,
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
  } else {
    if (map && typeof map.remove === "function") {
      map.remove();
    }
    map = lib.map(mapElement, {
      center: [center.lat, center.lng],
      zoom: 13,
      zoomControl: true,
      attributionControl: true,
    });
    lib
      .tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap contributors",
        maxZoom: 19,
      })
      .addTo(map);
  }
  await redrawMap();
};

const ensureMapProvider = async () => {
  const desired = appState.map_provider === "osm" ? "osm" : "google";
  appState.map_provider = desired;
  if (mapProvider !== desired) {
    destroyMapInstance(mapProvider);
    mapProvider = desired;
  }
  if (!map) {
    await initMap();
  } else {
    await redrawMap();
  }
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
  await ensureMapProvider();
  updateMonitoringToggle();
  applyFilter();
};

const handleBuildGrid = async () => {
  const divisions = Number(qs("#grid-divisions").value) || 8;
  const response = await fetch("/api/grid", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ divisions }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    alert(error.error || "Не удалось построить сетку. Проверьте данные GEO.kml.");
    return;
  }
  await refreshState();
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
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    alert(error.error || "Не удалось выполнить автораспределение.");
    return;
  }
  await refreshState();
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
    map_provider: qs("#map-provider")?.value || appState.map_provider || "google",
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
  await ensureMapProvider();
};

const handleKeyCheck = async () => {
  const key = qs("#google-key").value.trim();
  if (!key) return;
  const response = await fetch("/api/google-key", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key }),
  });
  if (!response.ok) {
    alert("Не удалось проверить ключ. Попробуйте позже.");
    return;
  }
  const data = await response.json();
  appState.metadata = appState.metadata || {};
  if (data.valid) {
    appState.google_api_key = true;
    appState.metadata.google_key_status = "ok";
    appState.metadata.google_key_status_detail = data.status;
  } else {
    appState.google_api_key = false;
    appState.metadata.google_key_status = "error";
    appState.metadata.google_key_status_detail = data.status || "Ошибка";
  }
  updateGoogleStatus();
  await refreshState();
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
    appState.metadata = { ...(appState.metadata || {}), ...(data.metadata || {}) };
    appState.log = [...(appState.log || []), ...(data.log || [])];
    appState.last_run = data.timestamp;
    renderLogs();
    renderProgress();
    updateLegend();
    updateGoogleStatus();
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
      setOverlayVisibility(layers.polygon, visible);
      break;
    case "grid":
      layers.grid.forEach((poly) => setOverlayVisibility(poly, visible));
      break;
    case "roads":
      layers.roads.forEach((poly) => setOverlayVisibility(poly, visible));
      break;
    case "routes":
      layers.routes.forEach((poly) => setOverlayVisibility(poly, visible));
      break;
    case "base":
      setOverlayVisibility(layers.base, visible);
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
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      alert(error.error || "Не удалось загрузить файл KML.");
      return;
    }
    await refreshState();
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
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    alert(error.error || "Не удалось изменить состояние мониторинга.");
    return;
  }
  await refreshState();
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

  const maps = map && isGoogleProvider() ? mapLibrary : null;
  const leafletLib = map && !isGoogleProvider() ? mapLibrary : null;
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
  } else if (leafletLib) {
    tractors.forEach((tractor) => {
      const marker = leafletLib.circleMarker([tractor.lat, tractor.lng], {
        radius: 6,
        weight: 2,
        color: tractor.color,
        fillColor: tractor.color,
        fillOpacity: 0.9,
      });
      marker.addTo(map);
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
    await ensureMapProvider();
    renderLogs();
    renderProgress();
    updateLegend();
    updateFilterOptions();
    setFieldValues();
    updateMonitoringToggle();
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
    layers.routes.forEach((poly) => setOverlayVisibility(poly, true));
    return;
  }
  layers.routeMeta.forEach(({ polyline, route }) => {
    const visible = route.tractor?.id === selected;
    setOverlayVisibility(polyline, visible);
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
  await ensureMapProvider();
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

  qsa(
    "#tractors-count, #route-limit, #travel-mode, #max-waypoints, #base-lat, #base-lng, #night-mode, #map-provider",
  ).forEach((el) => {
    el.addEventListener("change", () => {
      handleConfigSave();
    });
  });

  updateMonitoringToggle();
};

window.addEventListener("load", init);
