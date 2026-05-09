FROM node:20-bookworm

WORKDIR /app

# Install xvfb (X virtual framebuffer) to run headful Chromium on a headless server
RUN apt-get update && apt-get install -y xvfb && rm -rf /var/lib/apt/lists/*

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Install Playwright Chromium and all required OS dependencies
RUN npx playwright install --with-deps chromium

# Copy the rest of the code, including vietanh.m3u
COPY . .

EXPOSE 3000

# Override via `docker run -e` or docker-compose `environment`
ENV HOST=0.0.0.0
ENV PORT=3000
ENV CRON_SCHEDULE="*/30 * * * *"
ENV SERVE_SUBCOMMAND=list
ENV TARGET_URL=https://khandaia3.me
# Optional: set LIST_LIMIT=50 to cap listing scrape (omit for default 100)
ENV LIST_LIMIT=

# Headful mode often helps with bot checks; timeout for navigation / extract
ENV HEADLESS=false
ENV TIMEOUT_MS=45000

# Shell form so PORT / CRON_SCHEDULE / … expand from environment
CMD xvfb-run --auto-servernum "--server-args=-screen 0 1366x768x24" \
  node index.js serve "${PORT}" "${CRON_SCHEDULE}" "${SERVE_SUBCOMMAND}" "${TARGET_URL}" ${LIST_LIMIT}
