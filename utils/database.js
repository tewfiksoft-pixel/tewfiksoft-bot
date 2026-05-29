import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const CONFIG_PATH = path.join(ROOT_DIR, 'config.json');
const EXTERNAL_ADMINS_PATH = path.join(DATA_DIR, 'external_admins.json');
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
  let cfg = { authorized_users: [] };
  try { 
    if (fs.existsSync(CONFIG_PATH)) {
      cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); 
    }
  } catch (e) {}

  // Merge static external admins
  try {
    if (fs.existsSync(EXTERNAL_ADMINS_PATH)) {
      const extAdmins = JSON.parse(fs.readFileSync(EXTERNAL_ADMINS_PATH, 'utf8'));
      if (Array.isArray(extAdmins)) {
        if (!cfg.authorized_users) cfg.authorized_users = [];
        const cfgIds = new Set(cfg.authorized_users.map(u => String(u.id)));
        for (const admin of extAdmins) {
          if (!cfgIds.has(String(admin.id))) {
            cfg.authorized_users.push(admin);
          } else {
            const idx = cfg.authorized_users.findIndex(u => String(u.id) === String(admin.id));
            cfg.authorized_users[idx] = admin;
          }
        }
      }
    }
  } catch (e) {}

  // 🛡️ CRITICAL FALLBACK: Ensure email settings are NEVER missing (Render Persistent Safety)
  if (!cfg.email_settings || !cfg.email_settings.hr_notification_email) {
    cfg.email_settings = {
      hr_notification_email: "tewfik.nouar@alver.dz, tewfiksoft@gmail.com, nihel.dekiouk@alver.dz, MAMA.BENTAHAR@alver.dz, alverspa1980@gmail.com",
      smtp_port: 2525,
      smtp_host: "smtp-relay.brevo.com"
    };
  }
  return cfg;
};

export const saveDB = (db) => {
  try {
    const jsonStr = JSON.stringify(db);
    fs.writeFileSync(DB_PATH, jsonStr);
    log(`[DB] Saved successfully: ${db.hr_employees?.length || 0} employees.`);
    
    // Sync to Google Drive (Persistent Cloud Storage)
    const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxcj4K0p4FLgGGchC9oe4q95fLnHipbaUXN6hcQsCMDyR7ITH1ozIEF9Dk3SkEujt0njw/exec';
    fetch(GOOGLE_SCRIPT_URL, {
        method: 'POST',
        body: jsonStr,
        headers: { 'Content-Type': 'application/json' }
    }).then(res => log(`[DB] Cloud Sync: ${res.status}`))
      .catch(e => log(`[DB] Cloud Sync Error: ${e.message}`));

    return true;
  } catch (e) {
    log(`[DB] Save Error: ${e.message}`);
    return false;
  }
};

export const T = (s) => String(s || '').trim() || '—';
export const log = (m) => {
  const line = '[' + new Date().toISOString() + '] ' + m;
  console.log(line);
  try {
    fs.appendFileSync(path.join(ROOT_DIR, 'bot_debug.log'), line + '\n');
  } catch (e) {}
};
