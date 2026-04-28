// TewfikSoft Cloud Bot v4.6 - Render.com Edition (Full Feature Mode)
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
if (!BOT_TOKEN) { console.error('❌ FATAL: BOT_TOKEN environment variable is not set!'); process.exit(1); }
const ADMIN_ID = process.env.ADMIN_CHAT_ID || '';
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxcj4K0p4FLgGGchC9oe4q95fLnHipbaUXN6hcQsCMDyR7ITH1ozIEF9Dk3SkEujt0njw/exec';

const log = (m) => console.log('[' + new Date().toISOString() + '] ' + m);
const T = (s) => { try { return String(s||'').trim() || '—'; } catch { return '—'; } };

function loadDB() {
  try { return JSON.parse(fs.readFileSync(DB_PATH,'utf8')); } catch { return {hr_employees:[]}; }
}
function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH,'utf8')); } catch { return {authorized_users:[]}; }
}

const tg = (method, body) => new Promise((res) => {
  const p = JSON.stringify(body);
  const req = https.request({hostname:'api.telegram.org',path:`/bot${BOT_TOKEN}/${method}`,method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(p)}}, (r) => {
    let d=''; r.on('data',c=>d+=c); r.on('end',()=>{ try{res(JSON.parse(d));}catch{res({ok:false});} });
  });
  req.on('error',()=>res({ok:false}));
  req.write(p); req.end();
});

const send = (chatId, text, kbd=null) => tg('sendMessage', {chat_id:chatId, text:'☁️ '+text, parse_mode:'HTML', ...(kbd?{reply_markup:kbd}:{})});

const langs = new Map();
const states = new Map();

async function syncDB() {
  try {
    const response = await fetch(SCRIPT_URL);
    if (!response.ok) return `Error: HTTP ${response.status}`;
    const raw = await response.text();
    if (!raw || raw.length < 100) return 'Error: Data too small';
    let data = raw.charCodeAt(0)===0xFEFF ? raw.slice(1) : raw;
    fs.writeFileSync(DB_PATH, data); 
    return `OK`;
  } catch(e) { return 'Error: '+e.message; }
}

function getVisibleEmployees(user, db) {
  const emps = db.hr_employees || [];
  if (user.role === 'admin' || user.role === 'general_manager') return emps.filter(e=>e.status==='active');
  
  // For others, filter by scope (if implemented) or just return active for now
  // For safety, employees only see themselves
  if (user.role === 'employee') {
      return emps.filter(e => String(e.clockingId) === String(user.clockingId));
  }
  return emps.filter(e=>e.status==='active');
}

function showCard(chatId, emp, ar) {
  const msg = ar 
    ? `👤 <b>ملف الموظف</b>\n━━━━━━━━━━━━━━\n👤 الاسم: <b>${T(emp.lastName_ar)} ${T(emp.firstName_ar)}</b>\n🆔 الرمز: <code>${emp.clockingId}</code>\n💼 الوظيفة: <i>${T(emp.jobTitle_ar)}</i>\n🏢 القسم: ${T(emp.department_ar)}\n📅 نهاية العقد: ${emp.contractEndDate || '—'}`
    : `👤 <b>PROFIL EMPLOYÉ</b>\n━━━━━━━━━━━━━━\n👤 Nom: <b>${T(emp.lastName_fr)} ${T(emp.firstName_fr)}</b>\n🆔 ID: <code>${emp.clockingId}</code>\n💼 Poste: <i>${T(emp.jobTitle_fr)}</i>\n🏢 Dept: ${T(emp.department_fr)}\n📅 Fin Contrat: ${emp.contractEndDate || '—'}`;
  
  const kbd = {inline_keyboard: [
      [{text: ar ? '🏠 القائمة الرئيسية' : '🏠 Menu Principal', callback_data: 'menu'}]
  ]};
  return send(chatId, msg, kbd);
}

async function handle(u) {
  const cbq = u.callback_query;
  const msg = u.message || cbq?.message;
  const from = u.message?.from || cbq?.from;
  if (!msg||!from) return;

  const chatId = msg.chat.id;
  const fromId = String(from.id);
  const txt = (msg.text||'').trim();
  const ar = (langs.get(chatId) || 'ar') === 'ar';
  
  const cfg = loadConfig();
  const fromUser = (from.username || '').toLowerCase().trim();
  const user = cfg.authorized_users?.find(u => {
      const adId = String(u.id || '').replace('@', '').toLowerCase().trim();
      return adId === String(fromId) || (fromUser && adId === fromUser);
  });

  if (!user) return send(chatId, `❌ Unauthorized ID: <code>${fromId}</code>`);

  if (cbq) {
      const d = cbq.data;
      if (d === 'menu') {
          return send(chatId, ar ? '📋 <b>القائمة الرئيسية</b>' : '📋 <b>Menu Principal</b>', {inline_keyboard: [
              [{text: ar ? '🔍 بحث عن موظف' : '🔍 Chercher employé', callback_data: 'search'}]
          ]});
      }
      if (d === 'search') {
          states.set(chatId, {step: 'search'});
          return send(chatId, ar ? '🔍 أرسل اسم الموظف أو رقمه للبحث:' : '🔍 Entrez le nom ou l\'ID :');
      }
  }

  if (states.get(chatId)?.step === 'search' && txt) {
      states.delete(chatId);
      const db = loadDB();
      const query = txt.toLowerCase();
      const visible = getVisibleEmployees(user, db);
      const results = visible.filter(e => 
          String(e.clockingId).includes(query) || 
          T(e.lastName_fr).toLowerCase().includes(query) || 
          T(e.firstName_fr).toLowerCase().includes(query) ||
          T(e.lastName_ar).includes(query) ||
          T(e.firstName_ar).includes(query)
      ).slice(0, 5);

      if (results.length === 0) return send(chatId, ar ? '❌ لم يتم العثور على نتائج.' : '❌ Aucun résultat.');
      
      for (const emp of results) {
          await showCard(chatId, emp, ar);
      }
      return;
  }

  if (txt === '/start' || txt === '/menu') {
      return send(chatId, ar ? '🌟 <b>أهلاً بك في نظام TewfikSoft HR</b>' : '🌟 <b>Bienvenue sur TewfikSoft HR</b>', {inline_keyboard: [
          [{text: ar ? '🔍 ابدأ البحث' : '🔍 Démarrer la recherche', callback_data: 'search'}]
      ]});
  }

  if (txt === '/info') {
      states.set(chatId, {step: 'search'});
      return send(chatId, ar ? '🔍 أرسل اسم الموظف أو رقمه للبحث:' : '🔍 Entrez le nom ou l\'ID :');
  }

  if (txt === '/sync' && (user.role === 'admin')) {
      const r = await syncDB();
      return send(chatId, `🔄 Sync Result: ${r}`);
  }
}

http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/api/webhook') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const u = JSON.parse(body);
        if (u.update_id) await handle(u).catch(e => log('Err: ' + e.message));
      } catch(e) {}
      res.writeHead(200); res.end('OK');
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/config') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const newConfig = JSON.parse(body);
        if (newConfig.authorized_users) {
          fs.writeFileSync(CONFIG_PATH, JSON.stringify(newConfig, null, 2), 'utf8');
          log('✅ Config updated.');
          res.writeHead(200); res.end(JSON.stringify({success:true}));
          return;
        }
      } catch(e) {}
      res.writeHead(400); res.end('Fail');
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/database') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        fs.writeFileSync(DB_PATH, body);
        log('✅ Database updated.');
        res.writeHead(200); res.end(JSON.stringify({success:true}));
        return;
      } catch(e) {}
      res.writeHead(400); res.end('Fail');
    });
    return;
  }

  res.writeHead(200); res.end('TewfikSoft HR Bot v4.6 Full Feature Mode');
}).listen(process.env.PORT || 10000);

(async () => {
  log('=== TewfikSoft HR Bot v4.6 Starting... ===');
  await syncDB();
  const url = `https://tewfiksoft-hr-bot.onrender.com/api/webhook`;
  await tg('setWebhook', {url});
  log('Webhook set to: ' + url);
})();
