# Municipal Routing Dashboard

Полноценная диспетчерская панель для построения и анализа маршрутов тракторов на основании KML-данных.

## Возможности

- Чтение `GEO.kml` (границы города) и `RoadCity.kml` (дорожные сегменты) с обрезкой линий по полигону.
- Деление территории на сетку, автораспределение и ручное назначение зон/линий трактору.
- Маршрутизация через стек GraphHopper → OSRM → OpenRouteService с геокодированием и метаданными от Яндекса.
- Возможность включить Google API (Directions/Roads/Matrix/и т.д.) для обратной совместимости.
- Переключаемые провайдеры карт: Yandex Maps (по умолчанию), OpenStreetMap (Leaflet), Google Maps.
- Онлайн-мониторинг, легенда, логи, экспорт маршрутов в KML/GeoJSON и сохранение сессий.

## Быстрый старт

```bash
pip install -r requirements.txt
python server.py
```

Приложение откроется на `http://localhost:5000`.

## Конфигурация

1. Скопируйте `.env` и заполните при необходимости ключи и базовые URL сервисов.
2. Запустите `python server.py` — Yandex/GraphHopper/OSRM/ORS готовы к работе без Google.
3. Для Google API включите переключатель «Разрешить использование Google API» и укажите ключ в расширенных настройках.

### Переменные окружения (`.env`)

```
# Google (опционально)
GOOGLE_API_KEY=
GOOGLE_MAPS_JS_API_KEY=
...

# Yandex
YANDEX_API_KEY=
YANDEX_MAPS_JS_API_KEY=

# OpenRouteService
ORS_API_KEY=
ORS_BASE_URL=https://api.openrouteservice.org

# OSRM
OSRM_BASE_URL=https://router.project-osrm.org

# GraphHopper
GRAPHHOPPER_API_KEY=
GRAPHHOPPER_BASE_URL=https://graphhopper.com/api/1
```

Все значения можно изменить из интерфейса (блок «Дополнительно»).

## Локальный стек маршрутизации

Приложение поддерживает подключение к собственным инстансам GraphHopper, OSRM и OpenRouteService. После запуска нужного сервиса укажите его URL в разделе «Дополнительно» и сохраните настройки.

### GraphHopper (Docker)

```bash
docker run -d --name graphhopper -p 8989:8989 \
  -e GH_WEB_OPTS="-Ddw.graphhopper.datareader.file=russia-latest.osm.pbf" \
  -v "$(pwd)/graphhopper":/data \
  graphhopper/graphhopper:latest
```

- Скачайте нужный `.osm.pbf` в папку `graphhopper` и перезапустите контейнер.
- В интерфейсе укажите `http://localhost:8989` как GraphHopper Base URL. API‑ключ не требуется.

### OSRM (Docker)

```bash
docker pull osrm/osrm-backend
docker run -t -v "$(pwd)/maps":/data osrm/osrm-backend osrm-extract -p /opt/car.lua /data/russia-latest.osm.pbf
docker run -t -v "$(pwd)/maps":/data osrm/osrm-backend osrm-partition /data/russia-latest.osrm
docker run -t -v "$(pwd)/maps":/data osrm/osrm-backend osrm-customize /data/russia-latest.osrm
docker run -d -p 5001:5000 -v "$(pwd)/maps":/data osrm/osrm-backend osrm-routed --algorithm mld /data/russia-latest.osrm
```

- В настройках укажите `http://localhost:5001` как OSRM Base URL.

### OpenRouteService (Docker)

```bash
docker run -d --name ors -p 8080:8080 \
  -e BUILD_GRAPHS=True \
  -v "$(pwd)/ors-data":/data \
  openrouteservice/openrouteservice:latest
```

- После первой инициализации загрузите карту в `ors-data` и перезапустите контейнер.
- Укажите `http://localhost:8080` как OpenRouteService Base URL и задайте API‑ключ (если включена авторизация).

## Работа с интерфейсом

- База по умолчанию: `54.90990, 37.36340`.
- В блоке «Рабочая зона» загружайте актуальные `GEO.kml` и `RoadCity.kml`, формируйте сетку и выполняйте автораспределение.
- В «Построение маршрутов» запуск маршрутизации использует цепочку GraphHopper → OSRM → OpenRouteService. При ошибках сервисов в логах появятся предупреждения.
- Правая панель отображает статус API: зелёный индикатор означает, что альтернативный стек активен, даже если Google отключён.

## Экспорт и сессии

- `Экспорт KML/GeoJSON` выгружает текущие маршруты в `data/exports/`.
- `Сохранить сессию` — сохраняет состояние в JSON (без API ключей).
- `Загрузить сессию` — восстанавливает назначения, сетку и маршруты.

## Дополнительно

- Чтобы включить Google Maps по умолчанию, измените `ENABLE_GOOGLE_SERVICES` в `static/app.js` на `true`.
- Интерфейс полностью на TailwindCSS; стили можно уточнять в `static/styles.css`.
