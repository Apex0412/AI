# Municipal Routing Dashboard

Полноценная диспетчерская система для построения и анализа маршрутов тракторов по данным `GEO.kml` и `RoadCity.kml`. Интерфейс работает с Яндекс.Картами, OpenStreetMap (Leaflet) и маршрутными движками GraphHopper/OSRM/OpenRouteService. Google Maps и Google API можно подключить отдельно при необходимости.

---
## 1. Что делает проект
- Читает границы города (`GEO.kml`) и дорожную сеть (`RoadCity.kml`).
- Делит территорию на сетку, выполняет авто- и ручное распределение участков между тракторами.
- Строит оптимальные маршруты через GraphHopper → OSRM → OpenRouteService, используя метаданные Яндекса.
- Позволяет экспортировать маршруты в KML/GeoJSON/PDF и сохранять состояние работы.
- Отображает мониторинг тракторов и журнал событий в режиме реального времени.

---
## 2. Что понадобится пользователю
1. Компьютер с Windows, macOS или Linux и доступом в интернет.
2. Установленный **Python 3.10+**. Проверить можно командой `python --version`.
3. Установленный **Git** (по желанию) или возможность скачать ZIP-архив проекта.
4. (Опционально) **Docker Desktop** — если планируется запускать локальные копии GraphHopper, OSRM или OpenRouteService.
5. Свободный порт `5000` на компьютере (для веб-интерфейса).

---
## 3. Подготовка окружения
### Windows
1. Скачайте Python с https://www.python.org/downloads/ и установите, поставив галочку «Add Python to PATH».
2. (Опционально) установите Git с https://git-scm.com/download/win.
3. (Опционально) установите Docker Desktop с https://www.docker.com/products/docker-desktop/.

### macOS
1. Убедитесь, что Python установлен (`python3 --version`). При необходимости установите через https://www.python.org/downloads/macos/ или Homebrew (`brew install python`).
2. Git обычно уже есть. Если нет — установите через Xcode Command Line Tools (`xcode-select --install`).
3. Docker Desktop доступен на https://www.docker.com/products/docker-desktop/.

### Linux (Ubuntu/Debian)
```bash
sudo apt update
sudo apt install python3 python3-pip git
# Docker (опционально)
sudo apt install docker.io docker-compose
```
После установки Docker добавьте пользователя в группу `docker` (опционально):
```bash
sudo usermod -aG docker $USER
```
Затем выйдите и зайдите в систему.

---
## 4. Загрузка проекта
### Вариант A — через Git
```bash
git clone https://example.com/municipal-routing.git
cd municipal-routing
```

### Вариант B — через ZIP
1. Нажмите кнопку «Download ZIP» на странице проекта.
2. Распакуйте архив (например, в `C:\municipal-routing` или `~/municipal-routing`).
3. Откройте терминал/PowerShell и перейдите в папку проекта.

Все команды в инструкции ниже выполняются из каталога `municipal-routing/`.

---
## 5. Установка зависимостей
Рекомендуется создать виртуальное окружение Python, чтобы не смешивать библиотеки с системой.

```bash
python -m venv .venv
# Windows
.\.venv\Scripts\activate
# macOS/Linux
source .venv/bin/activate

pip install --upgrade pip
pip install -r requirements.txt
```

Если при установке возникли ошибки сети, перезапустите команду. После активации окружения в командной строке появится префикс `(.venv)`.

---
## 6. Настройка файла `.env`
В проекте уже лежит файл `.env`. Откройте его любым редактором и заполните нужные поля.

```ini
# Feature toggles
ENABLE_GOOGLE_SERVICES=false

# Google Maps Platform (опционально)
GOOGLE_API_KEY=
GOOGLE_MAPS_JS_API_KEY=
GOOGLE_DIRECTIONS_API_KEY=
GOOGLE_ROADS_API_KEY=
GOOGLE_DISTANCE_MATRIX_API_KEY=
GOOGLE_GEOCODING_API_KEY=
GOOGLE_GEOLOCATION_API_KEY=
GOOGLE_PLACES_API_KEY=
GOOGLE_ELEVATION_API_KEY=
GOOGLE_TIMEZONE_API_KEY=

# Yandex APIs
YANDEX_API_KEY=
YANDEX_MAPS_JS_API_KEY=
YANDEX_GEOSUGGEST_KEY=
YANDEX_LOCATOR_API_KEY=
YANDEX_STATIC_API_KEY=
YANDEX_MAPKIT_KEY=
YANDEX_TILES_API_KEY=

# Open routing providers
ORS_API_KEY=
ORS_BASE_URL=https://api.openrouteservice.org

OSRM_BASE_URL=https://router.project-osrm.org

GRAPHHOPPER_API_KEY=
GRAPHHOPPER_BASE_URL=https://graphhopper.com/api/1
```

### Где взять ключи Яндекс
- **JavaScript API / HTTP Геокодер / Static API** — в кабинете разработчика: https://developer.tech.yandex.ru/.
- **API Геосаджеста** — там же (отдельный ключ, можно оставить пустым, чтобы использовать основной `YANDEX_API_KEY`).
- **API Яндекс Локатор** — отдельный ключ, если требуется онлайн-определение координат по Wi-Fi/GSM.
- **MapKit / Tiles** — используются при мобильных и офлайн-сценариях; можно оставить пустыми, пока не нужны.

### Ключи для альтернативных маршрутизаторов
- **OpenRouteService** — зарегистрируйте бесплатный аккаунт на https://openrouteservice.org/dev/ и получите `ORS_API_KEY`.
- **GraphHopper** — https://www.graphhopper.com/dashboard/ (для облачного API) или оставьте поле пустым при локальном запуске.
- **OSRM** не требует ключей, достаточно указать URL сервера.

### Включение Google API (опционально)
1. Поставьте `ENABLE_GOOGLE_SERVICES=true` в `.env` и перезапустите сервер.
2. Заполните нужные ключи Google (можно использовать один общий `GOOGLE_API_KEY`).
3. В интерфейсе появятся блоки с проверкой ключа и дополнительными слоями.

---
## 7. Подготовка KML-данных
По умолчанию проект читает файлы из папки `data/`:
- `data/GEO.kml` — внешний контур города (один полигон).
- `data/RoadCity.kml` — набор `Placemark` с `LineString` (дорожные сегменты).

Вы можете заменить эти файлы своими. Формат координат: `"долгота,широта,высота"`. После замены файлы автоматически перечитываются при открытии интерфейса.

---
## 8. Запуск сервера
```bash
python server.py
```

После запуска откройте браузер и перейдите на **http://localhost:5000**. База по умолчанию — **54.90990, 37.36340**.

Чтобы остановить сервер, нажмите `Ctrl + C` в терминале.

---
## 9. Работа в веб-интерфейсе
1. **Левая панель** — настройки и действия.
   - Укажите количество тракторов, лимит маршрута, базу (можно ввести координаты вручную).
   - В разделе «Рабочая зона» загрузите обновлённые `GEO.kml` и `RoadCity.kml`, сформируйте сетку и включите необходимые режимы распределения.
   - Нажмите «Автораспределение», чтобы система раскрасила зоны и линии в цвета тракторов.
   - При необходимости используйте «Ручное назначение» — кликните по зоне/линии на карте и назначьте трактор.
2. **Построение маршрутов** — кнопка «Построить маршруты» запускает цепочку GraphHopper → OSRM → OpenRouteService. Индикатор и лог справа покажут прогресс.
3. **Слои карты** — отметьте, какие элементы отображать (полигон, сетка, дороги, маршруты). Если Google отключён, слои Places/Elevation скрыты.
4. **Мониторинг** — кнопка «Включить онлайн-мониторинг» активирует Яндекс Локатор. Данные обновляются каждые 30 секунд.
5. **Экспорт** — сохраняйте маршруты в `data/exports/`, выгружайте PDF-отчёты и историю высот.
6. **Сессии** — кнопки «Сохранить сессию» и «Загрузить сессию» работают с JSON-файлами (API-ключи в них не сохраняются).

Правую панель занимает индикатор статуса API. Зелёный чек означает, что выбранные сервисы доступны; красный — требуется внимание.

---
## 10. Как включить Google API (если это необходимо)
1. Остановите сервер (`Ctrl + C`).
2. В `.env` установите `ENABLE_GOOGLE_SERVICES=true` и впишите ключи Google.
3. Запустите сервер снова (`python server.py`).
4. В разделе «Дополнительно» появятся поля для Google, кнопка «Проверить» и переключатель «Разрешить использование Google API».
5. После успешной проверки индикатор справа окрасится в зелёный, а на карте станут доступны Google Layers.

Чтобы скрыть Google снова, верните `ENABLE_GOOGLE_SERVICES=false` и перезапустите сервер.

---
## 11. Использование локальных маршрутизаторов
Все три сервиса можно поднять в Docker. Перед началом убедитесь, что Docker установлен и запущен.

### 11.1 GraphHopper
1. Скачайте нужный OSM-файл (например, `russia-latest.osm.pbf`) с https://download.geofabrik.de/.
2. Создайте папку `graphhopper` рядом с проектом и поместите туда файл.
3. Запустите контейнер:
   ```bash
   docker run -d --name graphhopper -p 8989:8989 \
     -v "$(pwd)/graphhopper":/data \
     graphhopper/graphhopper:latest
   ```
   Первый запуск может занять до 30 минут (идёт построение графа).
4. В интерфейсе проекта откройте «Дополнительно» и укажите `http://localhost:8989` в поле **GraphHopper Base URL**. Ключ можно оставить пустым.

### 11.2 OSRM
1. Скачайте OSM-файл в папку `maps/`.
2. Выполните команды (замените `russia-latest.osm.pbf` на ваш файл):
   ```bash
   docker pull osrm/osrm-backend
   docker run -t -v "$(pwd)/maps":/data osrm/osrm-backend osrm-extract -p /opt/car.lua /data/russia-latest.osm.pbf
   docker run -t -v "$(pwd)/maps":/data osrm/osrm-backend osrm-partition /data/russia-latest.osrm
   docker run -t -v "$(pwd)/maps":/data osrm/osrm-backend osrm-customize /data/russia-latest.osrm
   docker run -d -p 5001:5000 -v "$(pwd)/maps":/data osrm/osrm-backend osrm-routed --algorithm mld /data/russia-latest.osrm
   ```
3. В интерфейсе введите `http://localhost:5001` в поле **OSRM Base URL**.

### 11.3 OpenRouteService
1. Скачайте OSM-файл в папку `ors-data/`.
2. Запустите контейнер:
   ```bash
   docker run -d --name ors -p 8080:8080 \
     -e BUILD_GRAPHS=True \
     -v "$(pwd)/ors-data":/data \
     openrouteservice/openrouteservice:latest
   ```
3. Первый запуск тоже генерирует граф и может занять время. После готовности интерфейс будет доступен на `http://localhost:8080`.
4. Укажите URL `http://localhost:8080` в поле **OpenRouteService Base URL** и добавьте `ORS_API_KEY`, если включена авторизация (по умолчанию локальный контейнер работает без ключа).

### 11.4 Проверка работы
- В правой панели статус станет зелёным, когда хотя бы один из сервисов отвечает.
- Если индикатор красный, откройте лог — там появится сообщение об ошибке подключения (например, «Не удалось связаться с GraphHopper»).

---
## 12. Экспорт данных и отчёты
- `Экспорт KML` и `Экспорт GeoJSON` сохраняют файлы в `data/exports/` с названиями `routes_export.kml` и `routes_export.geojson`.
- PDF-отчёт содержит таблицу с длиной, временем, уклоном и адресами сегментов.
- Отчёт по высотам создаёт график Elevation для каждого маршрута (данные берутся из OpenRouteService/GraphHopper). Если сервис высот недоступен, в логе появится предупреждение.

---
## 13. Частые вопросы и решения
| Проблема | Что проверить |
| --- | --- |
| Лог пустой | Убедитесь, что загружены KML-файлы и нажата кнопка «Построить маршруты». |
| Индикатор красный | Проверьте, что локальные сервисы запущены (`docker ps`). Посмотрите деталь в логе. |
| Карта не загружается | Проверьте соединение с интернетом. Для Яндекс.Карт требуется доступ к `api-maps.yandex.ru`. |
| Не отображаются Google-блоки | Это нормально, если `ENABLE_GOOGLE_SERVICES=false`. Поставьте `true` и перезапустите сервер. |
| Маршруты пустые | Убедитесь, что дороги пересекают полигон и лимит маршрута достаточно велик. |

---
## 14. Полезные ссылки
- Документация Яндекс.Карт: https://yandex.ru/dev/maps/
- GraphHopper: https://docs.graphhopper.com/
- OSRM: http://project-osrm.org/docs/v5.24.0/api/#general-options
- OpenRouteService: https://openrouteservice.org/dev/#/api-docs
- Google Maps Platform: https://developers.google.com/maps

Готово! Теперь вы можете запустить `python server.py`, загрузить свои `GEO.kml` и `RoadCity.kml` и получить готовые маршруты тракторов в удобном веб-интерфейсе.
