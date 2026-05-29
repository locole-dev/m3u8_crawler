FROM node:20-bookworm

WORKDIR /app

# Install xvfb (X virtual framebuffer) to run headful Chromium on a headless server
RUN apt-get update && apt-get install -y xvfb && rm -rf /var/lib/apt/lists/*

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Install Playwright Chromium and all required OS dependencies
RUN npx playwright install --with-deps chromium

# Copy the rest of the code, including vietanh.m3u and server_link/{football,phim}/*.json
COPY . .

EXPOSE 3000

# Override via `docker run -e` or docker-compose `environment`
ENV HOST=0.0.0.0
ENV PORT=3000
ENV CRON_SCHEDULE="*/30 * * * *"
# Headful mode often helps with bot checks; timeout for navigation / extract
ENV HEADLESS=false
ENV TIMEOUT_MS=45000

# Bóng đá: node index.js serve  →  /playlist.m3u
# Phim:    node film-index.js serve  →  /film.m3u (port 3001, cron riêng)

CMD xvfb-run --auto-servernum "--server-args=-screen 0 1366x768x24" \
  node index.js serve "${PORT}" "${CRON_SCHEDULE}"
