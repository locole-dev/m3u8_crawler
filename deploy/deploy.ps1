$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

if (-not (Test-Path ".env")) {
  Write-Error "Missing .env — copy deploy\.env.production.example to .env and edit."
}

$legacyNames = @("m3u8_scraper_football", "m3u8_scraper_film")
foreach ($name in $legacyNames) {
    $existing = docker ps -a --format "{{.Names}}" | Where-Object { $_ -eq $name }
    if ($existing) {
        Write-Host "[deploy] stop legacy container: $name"
        docker stop $name 2>$null | Out-Null
        docker rm $name 2>$null | Out-Null
    }
}

Write-Host "[deploy] stop existing stack..."
if ($env:REMOVE_VOLUMES -eq "1") {
    Write-Host "[deploy] REMOVE_VOLUMES=1 -> docker compose down -v"
    docker compose down -v --remove-orphans
} else {
    docker compose down --remove-orphans
}

Write-Host "[deploy] build containers..."
docker compose build

Write-Host "[deploy] start football + film services..."
docker compose up -d

$port = if ($env:PORT) { $env:PORT } else { "3000" }
$filmPort = if ($env:FILM_PORT) { $env:FILM_PORT } else { "3001" }

Write-Host ""
Write-Host "Football: http://127.0.0.1:$port/playlist.m3u"
Write-Host "Film:     http://127.0.0.1:$filmPort/film.m3u"
Write-Host "Film API: http://127.0.0.1:$filmPort/api/playlist.json"
Write-Host ""
docker compose ps
