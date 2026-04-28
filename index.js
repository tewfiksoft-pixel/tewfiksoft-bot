// TewfikSoft Cloud Bot v6.5 - Cloud Express Edition
import express from 'express';
import https from 'https';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const CONFIG_PATH = path.join(__dirname, 'config.json');
const DB_PATH = path.join(DATA_DIR, 'database.json');

const BOT_TOKEN = process.env.BOT_TOKEN;
const SYNC_PASSWORD = "nouar2026";
const SALT = "tewfiksoft_hr_salt_2026";

const log = (m) => console.log('[' + new Date().toISOString() + '] ' + m);
const T = (s) => { try { return String(s||'').trim() || '—'; } catch { return '—'; } };

function decrypt(ciphertext64, password) {
  try {
    const key = crypto.pbkdf2Sync(password, SALT, 100000, 32, 'sha256');
    const data = Buffer.from(ciphertext64, 'base64');
    const iv = data.slice(0, 12);
    const encryptedAndTag = data.slice(12);
    const encrypted = encryptedAndTag.slice(0, encryptedAndTag.length - 16);
    const tag = encryptedAndTag.slice(encryptedAndTag.length - 16);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(encrypted, 'binary', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (e) { return null; }
}

function loadDB() {
  try {
    if (!fs.existsSync(DB_PATH)) return {hr_employees:[], _status:'Missing'};
    const content = fs.readFileSync(DB_PATH, 'utf8');
    if (content.trim().startsWith('{')) return JSON.parse(content);
    const decrypted = decrypt(content, SYNC_PASSWORD);
    if (!decrypted) return {hr_employees:[], _status:'DecryptFail'};
    const db = JSON.parse(decrypted);
    db._status = 'OK';
    return db;
  } catch { return {hr_employees:[], _status:'Error'}; }
}

function loadConfig() { try { return JSON.parse(fs.readFileSync(CONFIG_PATH,'utf8')); } catch { return {authorized_users:[]}; } }

const tg = (method, body) => new Promise((res) => {
  const p = JSON.stringify(body);
  const req = https.request({hostname:'api.telegram.org',path:`/bot${BOT_TOKEN}/${method}`,method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(p)}}, (r) => {
    let d=''; r.on('data',c=>d+=c); r.on('end',()=>{ try{res(JSON.parse(d));}catch{res({ok:false});} });
  });
  req.on('error',()=>res({ok:false}));
  req.write(p); req.end();
});

const send = (chatId, text, kbd=null) => tg('sendMessage', {chat_id:chatId, text:'💎 '+text, parse_mode:'HTML', ...(kbd?{reply_markup:kbd}:{})});

const app = express();
app.use(express.json({limit: '50mb'}));

const langs = new Map();
const states = new Map();

function showMenu(chatId, user, ar) {
  let kbd = {inline_keyboard: [
    [{text: ar?'🔍 البحث':'🔍 Recherche', callback_data:'search'}],
    [{text: ar?'👤 ملفي':'👤 Mon Profil', callback_data:'my_profile'}],
    [{text: ar?'🌐 اللغة':'🌐 Langue', callback_data:'choose_lang'}]
  ]};
  return send(chatId, ar ? `💎 <b>لوحة التحكم: ${user.name}</b>` : `💎 <b>PANNEAU: ${user.name}</b>`, kbd);
}

async function handle(u) {
  const cbq = u.callback_query, msg = u.message || cbq?.message, from = u.message?.from || cbq?.from;
  if (!msg||!from) return;
  const chatId = msg.chat.id, fromId = String(from.id), cfg = loadConfig();
  const user = cfg.authorized_users?.find(u => String(u.id || '').replace('@','').toLowerCase() === fromId || (from.username && String(u.id).toLowerCase() === from.username.toLowerCase()));
  if (!user) return;

  if (cbq) {
      const d = cbq.data;
      if (d.startsWith('lang:')) { langs.set(chatId, d.split(':')[1]); return showMenu(chatId, user, d.split(':')[1]==='ar'); }
      if (d === 'search') { states.set(chatId, {step:'search'}); return send(chatId, (langs.get(chatId)||'ar')==='ar' ? '🔍 أرسل رقم الموظف:' : '🔍 Entrez ID :'); }
      if (d === 'menu') return showMenu(chatId, user, (langs.get(chatId)||'ar')==='ar');
  }

  const txt = (msg.text||'').trim();
  if (txt === '/start' || txt === 'check') {
      const db = loadDB();
      if (txt === 'check') return send(chatId, `📊 Status: ${db._status} | Count: ${db.hr_employees?.length}`);
      return send(chatId, '🌐 Language?', {inline_keyboard: [[{text:'العربية',callback_data:'lang:ar'},{text:'Français',callback_data:'lang:fr'}]]});
  }

  if (states.get(chatId)?.step === 'search' && txt) {
      const db = loadDB();
      const q = txt.toLowerCase().trim();
      const res = (db.hr_employees || []).find(e => String(e.clockingId).trim() === q);
      if (!res) return send(chatId, `❌ Not found: ${txt}`);
      states.delete(chatId);
      return send(chatId, `👤 <b>${res.lastName_fr} ${res.firstName_fr}</b>\n🆔 ID: ${res.clockingId}\n💼 ${res.jobTitle_fr}`);
  }
}

app.post('/api/webhook', async (req, res) => { try { await handle(req.body); } catch(e) {} res.sendStatus(200); });
app.post('/api/config', (req, res) => { fs.writeFileSync(CONFIG_PATH, JSON.stringify(req.body)); res.sendStatus(200); });
app.post('/api/database', (req, res) => { fs.writeFileSync(DB_PATH, JSON.stringify(req.body)); res.sendStatus(200); });
app.get('/', (req, res) => res.send('TewfikSoft HR Bot v6.5 Active'));

const port = process.env.PORT || 10000;
app.listen(port, () => {
  log(`Server running on port ${port}`);
  tg('setWebhook', {url: `https://tewfiksoft-hr-bot.onrender.com/api/webhook`});
});
