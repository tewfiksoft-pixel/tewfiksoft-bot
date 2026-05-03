import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const CONFIG_PATH = path.join(ROOT_DIR, 'config.json');
const DB_PATH = path.join(DATA_DIR, 'database.json');

const DB_SALT     = 'tewfiksoft_hr_salt_2026';
const DB_PASSWORD = 'nouar2026';

const decryptDb = (ciphertext64) => {
    try {
        if (ciphertext64.trim().startsWith('{')) return ciphertext64; 
        const key  = crypto.pbkdf2Sync(DB_PASSWORD, DB_SALT, 100000, 32, 'sha256');
        const buf  = Buffer.from(ciphertext64, 'base64');
        const iv   = buf.slice(0, 12);
        const tag  = buf.slice(buf.length - 16);
        const enc  = buf.slice(12, buf.length - 16);
        const dec  = crypto.createDecipheriv('aes-256-gcm', key, iv);
        dec.setAuthTag(tag);
        return dec.update(enc, 'binary', 'utf8') + dec.final('utf8');
    } catch (e) { return null; }
};

export const loadDB = () => {
  try { 
    if (!fs.existsSync(DB_PATH)) {
        log(`[DB] File not found: ${DB_PATH}`);
        return { hr_employees: [], hr_leave_balances: [] };
    }
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    log(`[DB] Read file: ${raw.length} bytes`);
    const plain = decryptDb(raw);
    if (!plain) {
        log(`[DB] Decryption returned NULL!`);
        return JSON.parse(raw); // will likely fail if encrypted
    }
    log(`[DB] Decrypted successfully: ${plain.substring(0, 30)}...`);
    return JSON.parse(plain); 
  }
  catch (e) { 
    log(`[DB] Load Error: ${e.message}`);
    return { hr_employees: [], hr_leave_balances: [] }; 
  }
};

export const loadConfig = () => {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); }
  catch { return { authorized_users: [] }; }
};

export const T = (s) => String(s || '').trim() || '—';
export const log = (m) => console.log('[' + new Date().toISOString() + '] ' + m);
