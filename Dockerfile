FROM node:20-bookworm

WORKDIR /app

# xvfb optional for HEADLESS=false (local / debug)
RUN apt-get update && apt-get install -y xvfb && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install

RUN npx playwright install --with-deps chromium

COPY . .

EXPOSE 3000 3001

ENV HOST=0.0.0.0
ENV PORT=3000
ENV CRON_SCHEDULE="*/30 * * * *"
ENV HEADLESS=true
ENV FILM_HEADLESS=true
ENV TIMEOUT_MS=45000

# Production VPS: headless (no xvfb). Override HEADLESS=false + xvfb-run if needed.
CMD ["node", "index.js", "serve", "3000"]
