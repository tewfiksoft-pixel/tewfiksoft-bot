import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const CONFIG_PATH = path.join(ROOT_DIR, 'config.json');
const DB_PATH = path.join(DATA_DIR, 'database.json');

export const loadDB = () => {
  try { return JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); }
  catch { return { hr_employees: [], hr_leave_balances: [] }; }
};

export const loadConfig = () => {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); }
  catch { return { authorized_users: [] }; }
};

export const T = (s) => String(s || '').trim() || '—';
export const log = (m) => console.log('[' + new Date().toISOString() + '] ' + m);
