// TewfikSoft Cloud Bot v6.4 - ULTRA STABLE EDITION
import https from 'https';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import http from 'http';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const CONFIG_PATH = path.join(__dirname, 'config.json');
const DB_PATH = path.join(DATA_DIR, 'database.json');

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_CHAT_ID;
const SYNC_PASSWORD = "nouar2026"; // HARDCODED for absolute stability
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
    if (!fs.existsSync(DB_PATH)) return {hr_employees:[], _msg: 'DB_MISSING'};
    const content = fs.readFileSync(DB_PATH, 'utf8');
    if (content.trim().startsWith('{')) return JSON.parse(content);
    const decrypted = decrypt(content, SYNC_PASSWORD);
    if (!decrypted) return {hr_employees:[], _msg: 'DECRYPT_FAIL'};
    const db = JSON.parse(decrypted);
    db._msg = 'OK';
    return db;
  } catch(e) { return {hr_employees:[], _msg: 'ERROR_'+e.message}; }
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

const langs = new Map();
const states = new Map();

function showMenu(chatId, user, ar) {
  const role = String(user.role).toLowerCase();
  let kbd = {inline_keyboard: []};
  if (['admin', 'general_manager'].includes(role)) kbd.inline_keyboard.push([{text: ar ? '📊 الإحصائيات' : '📊 Stats', callback_data: 'stats'}]);
  kbd.inline_keyboard.push([{text: ar ? '🔍 البحث عن موظف' : '🔍 Recherche', callback_data: 'search'}]);
  kbd.inline_keyboard.push([{text: ar ? '👤 ملفي الشخصي' : '👤 Mon Profil', callback_data: 'my_profile'}]);
  kbd.inline_keyboard.push([{text: ar ? '🌐 تغيير اللغة' : '🌐 Langue', callback_data: 'choose_lang'}]);
  return send(chatId, ar ? `💎 <b>لوحة التحكم: ${user.name}</b>` : `💎 <b>DASHBOARD: ${user.name}</b>`, kbd);
}

function showFullEmployeeCard(chatId, emp, ar) {
    const msg = ar 
      ? `👤 <b>بيانات الموظف:</b>\n━━━━━━━━━━━━━━\n👤 الاسم: <b>${T(emp.lastName_ar)} ${T(emp.firstName_ar)}</b>\n🆔 الرمز: <code>${emp.clockingId}</code>\n💼 الوظيفة: <i>${T(emp.jobTitle_ar)}</i>\n🏢 الشركة: <b>${T(emp.companyId).toUpperCase()}</b>\n━━━━━━━━━━━━━━` 
      : `👤 <b>PROFIL EMPLOYE:</b>\n━━━━━━━━━━━━━━\n👤 Nom: <b>${T(emp.lastName_fr)} ${T(emp.firstName_fr)}</b>\n🆔 ID: <code>${emp.clockingId}</code>\n💼 Poste: <i>${T(emp.jobTitle_fr)}</i>\n🏢 Société: <b>${T(emp.companyId).toUpperCase()}</b>\n━━━━━━━━━━━━━━`;
    
    const kbd = {inline_keyboard: [
        [{text: ar ? '📄 الملف الكامل' : '📄 Fiche', callback_data: 'full:'+emp.id}],
        [{text: ar ? '🏖️ العطل' : '🏖️ Congés', callback_data: 'leave:'+emp.id}, {text: ar ? '📜 العقود' : '📜 Contrats', callback_data: 'docs:'+emp.id}],
        [{text: ar ? '🏠 العودة للبحث' : '🏠 Retour Recherche', callback_data: 'search'}]
    ]};
    return send(chatId, msg, kbd);
}

async function handle(u) {
  if (!u) return;
  const cbq = u.callback_query, msg = u.message || cbq?.message, from = u.message?.from || cbq?.from;
  if (!msg||!from) return;
  const chatId = msg.chat.id, fromId = String(from.id), txt = (msg.text||'').trim().toLowerCase(), cfg = loadConfig();
  const user = cfg.authorized_users?.find(u => { const adId = String(u.id || '').replace('@', '').toLowerCase().trim(); return adId === fromId || (from.username && adId === from.username.toLowerCase()); });
  if (!user) return;
  
  if (txt === 'check' || txt === '/start' || txt === '/m') {
      const db = loadDB();
      if (txt === 'check') return send(chatId, `🛠️ <b>Status:</b>\n📦 File: ${fs.existsSync(DB_PATH)}\n🔑 Auth: ${db._msg}\n👥 Count: ${db.hr_employees?.length || 0}`);
      return showMenu(chatId, user, (langs.get(chatId)||'ar')==='ar');
  }

  const ar = (langs.get(chatId) || 'ar') === 'ar';

  if (cbq) {
      await tg('answerCallbackQuery', {callback_query_id: cbq.id});
      const d = cbq.data;
      if (d.startsWith('lang:')) { langs.set(chatId, d.split(':')[1]); return showMenu(chatId, user, d.split(':')[1]==='ar'); }
      if (d === 'menu') return showMenu(chatId, user, ar);
      if (d === 'search') { states.set(chatId, {step: 'search'}); return send(chatId, ar ? '🔍 أرسل الآن <b>رقم الموظف</b> :' : '🔍 Entrez <b>Numéro Employé</b> :'); }
      
      const db = loadDB();
      if (d === 'my_profile') {
          const emp = db.hr_employees?.find(e => String(e.clockingId).trim() === String(user.clockingId).trim());
          if (emp) return showFullEmployeeCard(chatId, emp, ar);
          return send(chatId, ar ? '❌ لم يتم العثور على ملفك.' : '❌ Profil introuvable.');
      }
      if (d.startsWith('full:')) {
          const emp = db.hr_employees?.find(e => String(e.id) === d.split(':')[1]);
          if (emp) return send(chatId, ar ? `📄 <b>التفاصيل:</b>\n👤 ${T(emp.lastName_ar)} ${T(emp.firstName_ar)}\n📅 البداية: ${emp.startDate}\n🏢 القسم: ${T(emp.department_ar)}` : `📄 <b>DETAILS:</b>\n👤 ${T(emp.lastName_fr)} ${T(emp.firstName_fr)}\n📅 Début: ${emp.startDate}\n🏢 Dept: ${T(emp.department_fr)}`);
      }
      if (d.startsWith('leave:')) {
          const bal = (db.hr_leave_balances || []).find(b => String(b.employeeId) === d.split(':')[1]);
          return send(chatId, ar ? `🏖️ <b>رصيد العطل:</b>\n✅ المتبقي: <b>${bal?.remainingDays||0}</b> يوم` : `🏖️ <b>SOLDE CONGÉS:</b>\n✅ Restant: <b>${bal?.remainingDays||0}</b> jours`);
      }
  }

  if (states.get(chatId)?.step === 'search' && txt) {
      const db = loadDB();
      const q = txt.trim().toLowerCase();
      const results = (db.hr_employees || []).filter(e => {
          const cid = String(e.clockingId || '').toLowerCase().trim();
          const ln = String(e.lastName_fr || '').toLowerCase().trim();
          return cid === q || cid.includes(q) || ln.includes(q);
      }).slice(0, 3);

      if (results.length === 0) return send(chatId, ar ? `❌ لا يوجد موظف بالرقم <b>${txt}</b>` : `❌ Aucun employé avec ID <b>${txt}</b>`);
      states.delete(chatId);
      for (const emp of results) await showFullEmployeeCard(chatId, emp, ar);
  }
}

http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/api/webhook') {
    let body = ''; req.on('data', chunk => body += chunk);
    req.on('end', async () => { try { const u = JSON.parse(body); if (u.update_id) await handle(u).catch(e => log('Err: ' + e.message)); } catch(e) {} res.writeHead(200); res.end('OK'); });
    return;
  }
  if (req.method === 'POST' && (req.url === '/api/config' || req.url === '/api/database')) {
    let body = ''; req.on('data', chunk => body += chunk);
    req.on('end', () => { fs.writeFileSync(req.url === '/api/config' ? CONFIG_PATH : DB_PATH, body); res.writeHead(200); res.end('OK'); });
    return;
  }
  res.writeHead(200); res.end('Ultra Stable Bot v6.4 Active');
}).listen(process.env.PORT || 10000);

(async () => {
  log('=== TewfikSoft HR Bot v6.4 Starting... ===');
  const url = `https://tewfiksoft-hr-bot.onrender.com/api/webhook`;
  await tg('setWebhook', {url});
  log('Webhook set to: ' + url);
})();
