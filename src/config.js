/**
 * Config management for AI Exodus
 * Stores portal URL, credentials, and settings in ~/.exodus/config.json
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const HOME = process.env.USERPROFILE || process.env.HOME || '';
const CONFIG_DIR = join(HOME, '.exodus');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

export async function loadConfig() {
  try {
    if (!existsSync(CONFIG_FILE)) return {};
    const raw = await readFile(CONFIG_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export async function saveConfig(config) {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

export async function getConfig(key) {
  const config = await loadConfig();
  return config[key];
}

export async function setConfig(key, value) {
  const config = await loadConfig();
  config[key] = value;
  await saveConfig(config);
}

export { CONFIG_DIR, CONFIG_FILE };
