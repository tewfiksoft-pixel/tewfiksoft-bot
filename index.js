import https from 'https';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import http from 'http';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// -- Config ------------------------------------------------
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const CONFIG_PATH = path.join(__dirname, 'config.json');
const DB_LOCAL_PATH = path.join(DATA_DIR, 'database.json');
const OFFSET_PATH = path.join(DATA_DIR, 'offset.json');

const BOT_TOKEN = '7434503714:AAFm0o7rNisG9tKOfYp37C1V9pC-m7q3vPk';
const ADMIN_ID = '8626592284';
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxcj4K0p4FLgGGchC9oe4q95fLnHipbaUXN6hcQsCMDyR7ITH1ozIEF9Dk3SkEujt0njw/exec';
const ENCRYPTION_KEY = 'nouar2026';

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
const clean = (s) => String(s||'').trim().replace(/Ã/g, ''); // Simple cleanup
const T = (s, fallback='') => {
    let str = clean(s);
    return (str && !str.includes('\uFFFD')) ? str : (fallback || '—');
};

const deriveKey = (password) => crypto.pbkdf2Sync(password, Buffer.from('tewfiksoft_hr_salt_2026', 'utf8'), 100000, 32, 'sha256');

function decryptDatabase(encryptedBase64, password) {
    try {
        const data = Buffer.from(encryptedBase64, 'base64');
        const nonce = data.slice(0, 12);
        const ciphertext = data.slice(12);
        const key = deriveKey(password);
        const authTag = ciphertext.slice(ciphertext.length - 16);
        const encrypted = ciphertext.slice(0, ciphertext.length - 16);
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
        decipher.setAuthTag(authTag);
        return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
    } catch (e) { return null; }
}

// -- Network -----------------------------------------------
const request = (url, method = 'GET', body = null) => new Promise((resolve) => {
    const options = { method, headers: {} };
    if (body) {
        options.headers['Content-Type'] = 'application/json';
        options.headers['Content-Length'] = Buffer.byteLength(body);
    }
    const req = https.request(url, options, (res) => {
        let d = '';
        res.on('data', (chunk) => d += chunk);
        res.on('end', () => resolve(d));
    });
    req.on('error', () => resolve(null));
    if (body) req.write(body);
    req.end();
});

const tgCall = (method, body = {}) => request(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, 'POST', JSON.stringify(body)).then(d => JSON.parse(d || '{}'));
const send = (chatId, text, kbd = null) => tgCall('sendMessage', { chat_id: chatId, text: `☁️ <b>[CLOUD]</b>\n${text}`, parse_mode: 'HTML', reply_markup: kbd });

// -- Core --------------------------------------------------
const sync = async () => {
    const rawData = await request(SCRIPT_URL);
    if (!rawData) return "Error: No data";
    let data = rawData;
    if (data.charCodeAt(0) === 0xFEFF) data = data.slice(1);
    
    let ok = false;
    try { if (JSON.parse(data).hr_employees) { fs.writeFileSync(DB_LOCAL_PATH, data); ok = true; } } catch {}
    
    if (!ok) {
        const decrypted = decryptDatabase(data.trim(), ENCRYPTION_KEY);
        if (decrypted) { fs.writeFileSync(DB_LOCAL_PATH, decrypted); ok = true; }
    }
    return ok ? "Sync Success" : "Sync Failed";
};

const handleUpdate = async (u) => {
    const cbq = u.callback_query, msg = u.message || cbq?.message, from = u.message?.from || cbq?.from;
    if (!msg || !from) return;
    const chatId = msg.chat.id, fromId = String(from.id), txt = (msg.text || '').trim();
    
    let config = { authorized_users: [] };
    try { config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch {}
    const user = config.authorized_users?.find(x => String(x.id) === fromId);
    if (!user) return send(chatId, `Unauthorized: ${fromId}`);

    if (cbq) {
        const data = cbq.data;
        if (data.startsWith('lang:')) return send(chatId, "Language Set. Type /menu");
        if (data === 'menu') return send(chatId, "Menu: /sync or /search");
        if (data === 'sync_db') { const r = await sync(); return send(chatId, r); }
        if (data.startsWith('select:')) {
            const db = JSON.parse(fs.readFileSync(DB_LOCAL_PATH, 'utf8'));
            const e = db.hr_employees.find(x => String(x.id) === data.split(':')[1]);
            let res = `👤 ${T(e.lastName_fr)}\n🆔 ${e.clockingId}\n💼 ${T(e.jobTitle_fr)}`;
            const kbd = { inline_keyboard: [[{text:'🏖️ Congés', callback_data:'c'}, {text:'🚨 Absence', callback_data:'a'}], [{text:'📝 Docs', callback_data:'d'}, {text:'📊 Survey', callback_data:'s'}]] };
            return send(chatId, res, kbd);
        }
    }

    if (txt === '/start') return send(chatId, `Welcome ${user.name}! Cloud Bot Active.`);
    if (txt === '/sync') { const r = await sync(); return send(chatId, r); }
    if (txt === '/menu') return send(chatId, "Options:", { inline_keyboard: [[{text:'⚙️ Sync', callback_data:'sync_db'}]] });
    
    if (txt.length > 2) {
        let db = { hr_employees: [] };
        try { db = JSON.parse(fs.readFileSync(DB_LOCAL_PATH, 'utf8')); } catch {}
        const q = txt.toLowerCase();
        const res = db.hr_employees.filter(e => String(e.clockingId).includes(q) || T(e.lastName_fr).toLowerCase().includes(q));
        if (res.length === 0) return send(chatId, "No results.");
        if (res.length === 1) {
            const e = res[0];
            const kbd = { inline_keyboard: [[{text:'🏖️ Congés', callback_data:'c'}, {text:'🚨 Absence', callback_data:'a'}], [{text:'📝 Docs', callback_data:'d'}, {text:'📊 Survey', callback_data:'s'}]] };
            return send(chatId, `👤 ${T(e.lastName_fr)}\n🆔 ${e.clockingId}`, kbd);
        }
        const kbd = { inline_keyboard: res.slice(0, 5).map(e => [{text: `👤 ${T(e.lastName_fr)}`, callback_data: 'select:'+e.id}]) };
        return send(chatId, "Results:", kbd);
    }
};

// -- Main --------------------------------------------------
http.createServer((req, res) => { res.end('Active'); }).listen(process.env.PORT || 8080);

let offset = 0;
try { offset = JSON.parse(fs.readFileSync(OFFSET_PATH, 'utf8')).offset || 0; } catch {}

const poll = async () => {
    const res = await tgCall('getUpdates', { offset, timeout: 30 });
    if (res.ok && res.result) {
        for (const u of res.result) {
            offset = u.update_id + 1;
            fs.writeFileSync(OFFSET_PATH, JSON.stringify({ offset }));
            await handleUpdate(u);
        }
    }
    setTimeout(poll, 1000);
};

(async () => {
    console.log("Cloud Bot Booting...");
    await sync();
    await send(ADMIN_ID, "✅ <b>البوت السحابي متصل الآن!</b>\nهذه الرسالة تم إرسالها تلقائياً من خادم Render.\nيمكنك الآن إرسال أي اسم للبحث.");
    poll();
})();
