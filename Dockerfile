FROM node:20-bookworm

WORKDIR /app

# Install xvfb (X virtual framebuffer) to run headful Chromium on a headless server
RUN apt-get update && apt-get install -y xvfb && rm -rf /var/lib/apt/lists/*

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Install Playwright Chromium and all required OS dependencies
RUN npx playwright install --with-deps chromium

# Copy the rest of the code, including vietanh.m3u and server_link/*.json
COPY . .

EXPOSE 3000

# Override via `docker run -e` or docker-compose `environment`
ENV HOST=0.0.0.0
ENV PORT=3000
ENV CRON_SCHEDULE="*/30 * * * *"

# Headful mode often helps with bot checks; timeout for navigation / extract
ENV HEADLESS=false
ENV TIMEOUT_MS=45000

# Crawl sources are auto-discovered from server_link/*.json
# No need to specify TARGET_URL — each JSON file in server_link/ is a source.
# To add more sources, just add more .json files to server_link/ directory.

CMD xvfb-run --auto-servernum "--server-args=-screen 0 1366x768x24" \
  node index.js serve "${PORT}" "${CRON_SCHEDULE}"
