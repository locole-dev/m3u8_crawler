#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  echo "Missing .env — copy deploy/.env.production.example to .env and edit."
  exit 1
fi

# Load PORT/FILM_PORT for health checks
set -a
# shellcheck disable=SC1091
source .env
set +a

stop_legacy_containers() {
  local names=(m3u8_scraper_football m3u8_scraper_film)
  for name in "${names[@]}"; do
    if docker ps -a --format '{{.Names}}' | grep -qx "$name"; then
      echo "[deploy] stop legacy container: $name"
      docker stop "$name" >/dev/null 2>&1 || true
      docker rm "$name" >/dev/null 2>&1 || true
    fi
  done
}

echo "[deploy] stop existing stack..."
if [[ "${REMOVE_VOLUMES:-0}" == "1" ]]; then
  echo "[deploy] REMOVE_VOLUMES=1 → docker compose down -v"
  docker compose down -v --remove-orphans || true
else
  docker compose down --remove-orphans || true
fi
stop_legacy_containers

echo "[deploy] build containers..."
docker compose pull 2>/dev/null || true
docker compose build --pull

echo "[deploy] start football + film services..."
docker compose up -d

echo "[deploy] wait for health..."
football_ok=0
film_ok=0
for _ in $(seq 1 30); do
  football_ok=0
  film_ok=0
  curl -fsS "http://127.0.0.1:${PORT:-3000}/health" >/dev/null 2>&1 && football_ok=1 || true
  curl -fsS "http://127.0.0.1:${FILM_PORT:-3001}/health" >/dev/null 2>&1 && film_ok=1 || true
  if [[ "$football_ok" -eq 1 && "$film_ok" -eq 1 ]]; then
    echo "[deploy] both services healthy"
    break
  fi
  sleep 5
done

if [[ "$football_ok" -ne 1 || "$film_ok" -ne 1 ]]; then
  echo "[deploy] warning: health check timeout (football=$football_ok film=$film_ok)"
  echo "[deploy] film crawl có thể vẫn đang chạy — thử lại sau vài phút"
fi

echo
echo "Football: http://127.0.0.1:${PORT:-3000}/playlist.m3u"
echo "Film:     http://127.0.0.1:${FILM_PORT:-3001}/film.m3u"
echo "Film API: http://127.0.0.1:${FILM_PORT:-3001}/api/playlist.json"
echo
docker compose ps
