import fs from 'fs/promises';
import path from 'path';

const outputDir = process.env.FILM_OUTPUT_DIR
  ? path.resolve(process.env.FILM_OUTPUT_DIR)
  : process.cwd();

export const FILM_M3U_PATH = path.join(outputDir, 'film.m3u');
export const FILM_JSON_PATH = path.join(outputDir, 'film.json');
export const FILM_CRAWL_LOCK_PATH = path.join(outputDir, 'film.crawl.lock');

export async function ensureFilmOutputDir() {
  if (process.env.FILM_OUTPUT_DIR) {
    await fs.mkdir(outputDir, { recursive: true });
  }
}

export function filmOutputDir() {
  return outputDir;
}
