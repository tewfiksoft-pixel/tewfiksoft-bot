import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', 'data', 'database.json');
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
    } catch (e) { console.error(e); return null; }
};

const raw = fs.readFileSync(DB_PATH, 'utf8');
const plain = decryptDb(raw);
if (plain) {
    const db = JSON.parse(plain);
    if (db.hr_employees && db.hr_employees.length > 0) {
        console.log('Employee Keys:', Object.keys(db.hr_employees[0]));
        console.log('Sample Employee:', JSON.stringify(db.hr_employees[0], null, 2));
    } else {
        console.log('No employees found.');
    }
} else {
    console.log('Decryption failed.');
}
