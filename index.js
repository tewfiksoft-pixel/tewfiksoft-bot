import https from 'https';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import http from 'http';
import { google } from 'googleapis';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// -- Config ------------------------------------------------
const DATA_DIR = path.join(__dirname, 'data');
const CONFIG_PATH = path.join(__dirname, 'config.json');
const REQUESTS_PATH = path.join(DATA_DIR, 'requests.json');
const OFFSET_PATH = path.join(DATA_DIR, 'offset.json');
const GOOGLE_KEY_PATH = path.join(__dirname, 'google_drive_key.json');
const DB_LOCAL_PATH = path.join(DATA_DIR, 'database.json');

const BOT_TOKEN = process.env.BOT_TOKEN || '7434503714:AAFm0o7rNisG9tKOfYp37C1V9pC-m7q3vPk';
const DB_FILE_ID = process.env.DB_FILE_ID || '';
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'nouar2026';
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxcj4K0p4FLgGGchC9oe4q95fLnHipbaUXN6hcQsCMDyR7ITH1ozIEF9Dk3SkEujt0njw/exec';

const DB_SALT = Buffer.from('tewfiksoft_hr_salt_2026', 'utf8');
const PBKDF2_ITERATIONS = 100000;

// -- Constants ---------------------------------------------
const DOCS = [
  {id: 0, ar: '🌴 سند عطلة', fr: '🌴 Titre de congés', val: 'Titre de congés'},
  {id: 1, ar: '💼 شهادة عمل', fr: '💼 Attestation de travail', val: 'Attestation de travail'},
  {id: 2, ar: '💰 كشف الراتب', fr: '💰 Relevé des émoluments', val: 'Relevé des émoluments'},
  {id: 3, ar: '📄 قسيمة الراتب', fr: '📄 Fiche de paie', val: 'Fiche de paie'},
  {id: 4, ar: '💳 تفعيل بطاقة الشفاء', fr: '💳 Activation carte Chifa', val: 'Activation carte Chifa'},
  {id: 5, ar: '📊 تسوية الراتب', fr: '📊 Régularisation de paie', val: 'Régularisation de paie'},
  {id: 6, ar: '📝 تقييم فترة تجريبية', fr: '📝 Évaluation Période d\'Essai', val: 'Évaluation Période Essai'}
];

const FAUTES = [
  {id: 0, ar: 'تخلي عن المنصب', fr: 'Abandon de poste', val: 'Abandon de poste'},
  {id: 1, ar: 'تأخر متكرر', fr: 'Retard répété', val: 'Retard répété'},
  {id: 2, ar: 'عصيان / تمرد', fr: 'Insubordination', val: 'Insubordination'},
  {id: 3, ar: 'إهمال', fr: 'Négligence', val: 'Négligence'},
  {id: 4, ar: 'غياب غير مبرر', fr: 'Absence injustifiée', val: 'Absence injustifiée'},
  {id: 5, ar: 'مخالفة النظام', fr: 'Violation règlement', val: 'Violation règlement'},
  {id: 6, ar: 'سلوك غير لائق', fr: 'Comportement incorrect', val: 'Comportement incorrect'},
  {id: 7, ar: 'أخرى', fr: 'Autre', val: 'Autre'}
];

// -- Helpers -----------------------------------------------
const log = (msg) => console.log("[" + new Date().toISOString() + "] " + msg);

const ensureDataDir = () => {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
};

const clean = (s) => {
    let str = String(s||'').trim();
    if (!str.includes('Ã')) return str;
    try {
        let res = str;
        for (let i = 0; i < 3; i++) {
            let b = Buffer.from(res, 'binary');
            let s2 = b.toString('utf8');
            if (s2 === res || !s2.includes('Ã')) { res = s2; break; }
            res = s2;
        }
        return res;
    } catch { return str; }
};

const T = (s, fallback='', len=100) => {
    let str = clean(s);
    if (!str || str.includes('Ã') || str.includes('\uFFFD')) return fallback || '—';
    if (str.length > len) return str.substring(0, len) + '...';
    return str || '—';
};

const deriveKey = (password) => crypto.pbkdf2Sync(password, DB_SALT, PBKDF2_ITERATIONS, 32, 'sha256');

function decryptDatabase(encryptedBase64, password) {
    try {
        const data = Buffer.from(encryptedBase64, 'base64');
        if (data.length < 12) return null;
        const nonce = data.slice(0, 12);
        const ciphertext = data.slice(12);
        const key = deriveKey(password);
        const authTag = ciphertext.slice(ciphertext.length - 16);
        const encrypted = ciphertext.slice(0, ciphertext.length - 16);
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
        decipher.setAuthTag(authTag);
        const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
        return decrypted.toString('utf8');
    } catch (e) { return null; }
}

// -- Telegram API ------------------------------------------
const tgCall = (method, body = {}) => new Promise((resolve) => {
    const payload = JSON.stringify(body);
    const req = https.request({
        hostname: 'api.telegram.org',
        path: `/bot${BOT_TOKEN}/${method}`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    }, (res) => {
        let d = '';
        res.on('data', (chunk) => d += chunk);
        res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({ ok: false }); } });
    });
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.write(payload);
    req.end();
});

const send = (chatId, text, kbd = null) => {
    const cloudTag = "☁️ <b>[CLOUD BOT]</b>\n";
    return tgCall('sendMessage', { chat_id: chatId, text: cloudTag + text, parse_mode: 'HTML', reply_markup: kbd });
};

// -- Core Logic --------------------------------------------
const syncFromDrive = async () => {
    let report = 'Sync Start...\n';
    try {
        ensureDataDir();
        let rawData = null;
        try {
            const response = await fetch(SCRIPT_URL);
            if (response.ok) {
                rawData = await response.text();
                report += `Script URL: ${rawData.length} bytes.\n`;
            }
        } catch (e) { report += `Script Error: ${e.message}\n`; }

        if (rawData) {
            if (rawData.charCodeAt(0) === 0xFEFF) rawData = rawData.slice(1);
            let parsedData = null;
            try {
                const parsed = JSON.parse(rawData);
                if (parsed && (parsed.hr_employees || parsed.employees)) {
                    fs.writeFileSync(DB_LOCAL_PATH, rawData);
                    report += 'Sync: Plain JSON Success\n';
                    parsedData = parsed;
                }
            } catch (e) {}
            
            if (!parsedData) {
                const decrypted = decryptDatabase(rawData.trim(), ENCRYPTION_KEY);
                if (decrypted) {
                    fs.writeFileSync(DB_LOCAL_PATH, decrypted);
                    report += 'Sync: Decryption Success\n';
                    parsedData = true;
                } else { report += 'Sync: Decryption Failed\n'; }
            }
        }
    } catch (e) { report += 'Error: ' + e.message + '\n'; }
    return report;
};

const handleUpdate = async (u) => {
    const cbq = u.callback_query, msg = u.message || cbq?.message, from = u.message?.from || cbq?.from;
    if (!msg || !from) return;
    const chatId = msg.chat.id, fromId = String(from.id), txt = (msg.text || '').trim();
    if (cbq) await tgCall('answerCallbackQuery', { callback_query_id: cbq.id });

    let config = { authorized_users: [] };
    try { config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch {}
    
    const user = config.authorized_users?.find(x => String(x.id) === fromId);
    if (!user) return send(chatId, `❌ Unauthorized ID: <code>${fromId}</code>`);

    const lang = langs.get(chatId) || 'ar';
    const ar = lang === 'ar';
    const state = states.get(chatId);

    if (cbq) {
        const data = cbq.data;
        if (data.startsWith('lang:')) { langs.set(chatId, data.split(':')[1]); return showMenu(chatId, user, data.split(':')[1]); }
        if (data === 'menu') return showMenu(chatId, user, lang);
        if (data === 'sync_db') { const r = await syncFromDrive(); return send(chatId, r); }
        if (data === 'emp_search') { states.set(chatId, { step: 'search_query' }); return send(chatId, ar ? '🔍 أدخل اسم الموظف أو رقمه:' : '🔍 Entrez nom ou matricule :'); }
        if (data.startsWith('select:')) return showEmpCard(chatId, data.split(':')[1], lang, user);
    }

    if (txt === '/start') {
        const msgStart = ar ? `🌟 مرحباً بك، ${user.name}\nيرجى اختيار اللغة:` : `🌟 Bienvenue, ${user.name}\nLangue :`;
        return send(chatId, msgStart, { inline_keyboard: [[{ text: 'العربية', callback_data: 'lang:ar' }, { text: 'Français', callback_data: 'lang:fr' }]] });
    }
    if (txt === '/menu') return showMenu(chatId, user, lang);
    if (txt === '/sync') { const r = await syncFromDrive(); return send(chatId, r); }

    if (state?.step === 'search_query') {
        states.delete(chatId);
        let db = { hr_employees: [] };
        try { db = JSON.parse(fs.readFileSync(DB_LOCAL_PATH, 'utf8')); } catch {}
        const q = txt.toLowerCase();
        const results = (db.hr_employees || []).filter(e => e.status === 'active' && (String(e.clockingId).includes(q) || T(e.lastName_fr).toLowerCase().includes(q) || T(e.lastName_ar).includes(q)));
        if (results.length === 0) return send(chatId, '❌ No results.');
        if (results.length === 1) return showEmpCard(chatId, results[0].id, lang, user);
        return send(chatId, '📂 Results:', { inline_keyboard: results.slice(0, 8).map(e => [{ text: `👤 ${T(e.lastName_fr)}`, callback_data: 'select:' + e.id }]) });
    }
};

const showMenu = (chatId, user, lang) => {
    const ar = lang === 'ar';
    return send(chatId, ar ? '📋 القائمة الرئيسية' : '📋 Menu', { inline_keyboard: [[{ text: ar ? '🔍 بحث' : '🔍 Chercher', callback_data: 'emp_search' }], [{ text: '⚙️ Sync', callback_data: 'sync_db' }]] });
};

const showEmpCard = (chatId, empId, lang, user) => {
    let db = { hr_employees: [] };
    try { db = JSON.parse(fs.readFileSync(DB_LOCAL_PATH, 'utf8')); } catch {}
    const e = db.hr_employees?.find(x => String(x.id) === String(empId));
    if (!e) return;
    const ar = lang === 'ar';
    const msg = ar ? `👤 الموظف: ${T(e.lastName_ar)}\n🆔 ID: ${e.clockingId}\n💼 الوظيفة: ${T(e.jobTitle_ar)}` : `👤 Employé: ${T(e.lastName_fr)}\n🆔 ID: ${e.clockingId}\n💼 Poste: ${T(e.jobTitle_fr)}`;
    return send(chatId, msg, { inline_keyboard: [[{ text: '🏠 Menu', callback_data: 'menu' }]] });
};

// -- Server & Polling --------------------------------------
http.createServer((req, res) => { res.writeHead(200); res.end('Cloud Bot Active'); }).listen(process.env.PORT || 8080);

let offset = 0;
try { offset = JSON.parse(fs.readFileSync(OFFSET_PATH, 'utf8')).offset || 0; } catch {}

const poll = async () => {
    try {
        const res = await tgCall('getUpdates', { offset, timeout: 30 });
        if (res.ok && res.result) {
            for (const u of res.result) {
                offset = u.update_id + 1;
                fs.writeFileSync(OFFSET_PATH, JSON.stringify({ offset }));
                await handleUpdate(u);
            }
        }
    } catch (e) { log("Poll Error: " + e.message); }
    setTimeout(poll, 1000);
};

ensureDataDir();
poll();
log("Cloud Bot Started.");
