# m3u8_scraper

Extract m3u8 URLs from football and RoPhim film pages, serve IPTV playlists over HTTP.

## Services

| Service | Port | Entry | M3U | JSON |
|---------|------|-------|-----|------|
| Football | 3000 | `node index.js serve` | `/playlist.m3u` | `/api/playlist.json` |
| Film | 3001 | `node film-index.js serve` | `/film.m3u` | `/api/playlist.json` |

Cả hai service dùng **cùng pattern API**:

```
GET /health
GET /api/playlist          → M3U
GET /api/playlist.json     → JSON crawl
```

Film thêm alias `/film.m3u` (tương đương `/playlist.m3u` bên bóng đá).

## Local dev

```bash
npm install
npm run install:browsers

npm run start:football   # port 3000
npm run start:film       # port 3001
npm run crawl:film       # crawl thủ công
```

Config phim: `server_link/phim/*.json` (RoPhim).

## Docker deploy

Script tự **tắt container cũ** (`docker compose down`) rồi build + start lại. Giữ volume `film_data` (data crawl không mất). Xóa luôn volume: `REMOVE_VOLUMES=1 bash deploy/deploy.sh`.

```bash
cp deploy/.env.production.example .env

# Linux/macOS
bash deploy/deploy.sh

# Windows
powershell -ExecutionPolicy Bypass -File deploy/deploy.ps1
```

Containers:

- `scraper-football` — `:3000`, cron 30 phút
- `scraper-film` — `:3001`, crawl 1 lần lúc startup

Volume phim: `film_data` → `/data/film` (`film.m3u`, `film.json`).

## Nginx (optional)

[`deploy/nginx/m3u8-scraper.conf`](deploy/nginx/m3u8-scraper.conf)

- `example.com` → football `:3000`
- `film.example.com` → film `:3001`

## Env

Xem [`.env.example`](.env.example). Quan trọng:

```env
FILM_PORT=3001
FILM_OUTPUT_DIR=/data/film
FILM_SKIP_STARTUP_CRAWL=false
```
