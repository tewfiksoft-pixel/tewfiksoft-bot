// TewfikSoft Cloud Bot v4.7 - Render.com Edition (Legacy Menus Restored)
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
    const raw = await response.text();
    let data = raw.charCodeAt(0)===0xFEFF ? raw.slice(1) : raw;
    fs.writeFileSync(DB_PATH, data); 
    return `OK`;
  } catch(e) { return 'Error'; }
}

function showMenu(chatId, user, ar) {
  let kbd = {inline_keyboard: []};
  let txt = ar ? '📌 <b>القائمة الرئيسية</b>\n━━━━━━━━━━━━━━\nالرجاء اختيار الإجراء المطلوب:' : '📌 <b>Menu Principal</b>\n━━━━━━━━━━━━━━\nVeuillez choisir une action :';

  if (user.role === 'admin' || user.role === 'general_manager') {
    kbd.inline_keyboard.push([{text:ar?'📊 إحصائيات الشركة':'📊 Statistiques',callback_data:'stats'}]);
  }

  if (user.role === 'supervisor' || user.role === 'admin' || user.role === 'manager') {
    kbd.inline_keyboard.push([{text:ar?'👥 فريقي':'👥 Mon Équipe',callback_data:'team'}]);
  }

  kbd.inline_keyboard.push([{text:ar?'🔍 بحث عن موظف':'🔍 Chercher employé',callback_data:'search'}]);
  
  if (user.role === 'employee' || user.role === 'gestionnaire_rh' || user.role === 'manager') {
    kbd.inline_keyboard.push([{text:ar?'👤 ملفي الشخصي':'👤 Mon Profil',callback_data:'my_profile'}]);
  }
  
  if (user.role === 'admin') {
    kbd.inline_keyboard.push([{text:ar?'🔄 تحديث البيانات':'🔄 Sync DB',callback_data:'sync'}]);
  }

  kbd.inline_keyboard.push([{text:ar?'🌐 تغيير اللغة':'🌐 Changer Langue',callback_data:'choose_lang'}]);

  return send(chatId, txt, kbd);
}

function showCard(chatId, emp, ar, user) {
  const msg = ar 
    ? `📂 <b>خيارات الموظف</b>\n━━━━━━━━━━━━━━\n👤 الاسم: <b>${T(emp.lastName_ar)} ${T(emp.firstName_ar)}</b>\n🆔 ID: <code>${emp.clockingId}</code>\n💼 الوظيفة: <i>${T(emp.jobTitle_ar)}</i>\n🏢 القسم: ${T(emp.department_ar)}\n\nيرجى اختيار الإجراء:`
    : `📂 <b>OPTIONS EMPLOYÉ</b>\n━━━━━━━━━━━━━━\n👤 Nom: <b>${T(emp.lastName_fr)} ${T(emp.firstName_fr)}</b>\n🆔 ID: <code>${emp.clockingId}</code>\n💼 Poste: <i>${T(emp.jobTitle_fr)}</i>\n🏢 Dept: ${T(emp.department_fr)}\n\nVeuillez choisir:`;
  
  const kbd = {inline_keyboard: [
      [{text: ar ? '📄 ملف الموظف' : '📄 Fiche Employé', callback_data: 'full:'+emp.id}],
      [{text: ar ? '🏖️ رصيد العطل' : '🏖️ Solde Congés', callback_data: 'leave:'+emp.id}],
      [{text: ar ? '📝 قسم الطلبات' : '📝 Demander Doc', callback_data: 'docs:'+emp.id}],
      [{text: ar ? '🚨 إعلام غياب' : '🚨 Absence', callback_data: 'abs:'+emp.id}],
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
      if (d === 'menu') return showMenu(chatId, user, ar);
      if (d === 'search') { states.set(chatId, {step: 'search'}); return send(chatId, ar ? '🔍 أدخل اسم الموظف أو رقمه:' : '🔍 Entrez nom ou ID:'); }
      if (d === 'choose_lang') return send(chatId, 'Language?', {inline_keyboard: [[{text:'AR',callback_data:'lang:ar'},{text:'FR',callback_data:'lang:fr'}]]});
      if (d.startsWith('lang:')) { langs.set(chatId, d.split(':')[1]); return showMenu(chatId, user, d.split(':')[1]==='ar'); }
      if (d === 'sync') { const r = await syncDB(); return send(chatId, `🔄 Sync: ${r}`); }
      if (d === 'my_profile') {
          const db = loadDB();
          const emp = db.hr_employees?.find(e => String(e.clockingId) === String(user.clockingId));
          if (emp) return showCard(chatId, emp, ar, user);
          return send(chatId, ar ? '❌ لم يتم العثور على ملفك الشخصي.' : '❌ Profil introuvable.');
      }
  }

  if (states.get(chatId)?.step === 'search' && txt) {
      states.delete(chatId);
      const db = loadDB();
      const query = txt.toLowerCase();
      const results = (db.hr_employees || []).filter(e => 
          String(e.clockingId).includes(query) || 
          T(e.lastName_fr).toLowerCase().includes(query) || 
          T(e.firstName_fr).toLowerCase().includes(query)
      ).slice(0, 5);

      if (results.length === 0) return send(chatId, ar ? '❌ لا توجد نتائج.' : '❌ Aucun résultat.');
      for (const emp of results) await showCard(chatId, emp, ar, user);
      return;
  }

  if (txt === '/start' || txt === '/menu' || txt === '/start ar' || txt === '/start fr') {
      return showMenu(chatId, user, ar);
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
        fs.writeFileSync(CONFIG_PATH, body);
        res.writeHead(200); res.end(JSON.stringify({success:true}));
      } catch(e) { res.writeHead(400); res.end('Fail'); }
    });
    return;
  }
  if (req.method === 'POST' && req.url === '/api/database') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        fs.writeFileSync(DB_PATH, body);
        res.writeHead(200); res.end(JSON.stringify({success:true}));
      } catch(e) { res.writeHead(400); res.end('Fail'); }
    });
    return;
  }
  res.writeHead(200); res.end('TewfikSoft HR Bot v4.7 Menus Restored');
}).listen(process.env.PORT || 10000);

(async () => {
  log('=== TewfikSoft HR Bot v4.7 Menus Restored Starting... ===');
  await syncDB();
  const url = `https://tewfiksoft-hr-bot.onrender.com/api/webhook`;
  await tg('setWebhook', {url});
  log('Webhook set to: ' + url);
})();
