// TewfikSoft Cloud Bot v5.7 - Visitor & Employee Privacy Edition
import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const CONFIG_PATH = path.join(__dirname, 'config.json');
const DB_PATH = path.join(DATA_DIR, 'database.json');

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_CHAT_ID;
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxcj4K0p4FLgGGchC9oe4q95fLnHipbaUXN6hcQsCMDyR7ITH1ozIEF9Dk3SkEujt0njw/exec';

const log = (m) => console.log('[' + new Date().toISOString() + '] ' + m);
const T = (s) => { try { return String(s||'').trim() || '—'; } catch { return '—'; } };

function loadDB() { try { return JSON.parse(fs.readFileSync(DB_PATH,'utf8')); } catch { return {hr_employees:[]}; } }
function loadConfig() { try { return JSON.parse(fs.readFileSync(CONFIG_PATH,'utf8')); } catch { return {authorized_users:[]}; } }

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

async function notifyStaff(txt, cfg) {
    if (ADMIN_ID) await send(ADMIN_ID, `🔔 <b>إشعار جديد:</b>\n${txt}`);
    const rhStaff = cfg.authorized_users?.filter(u => u.role === 'gestionnaire_rh') || [];
    for (const rh of rhStaff) { if (rh.id) await send(rh.id, `🔔 <b>إشعار للموارد البشرية:</b>\n${txt}`); }
}

function showMenu(chatId, user, ar) {
  let kbd = {inline_keyboard: []};
  const role = String(user.role).toLowerCase();
  const isHighMgmt = ['admin', 'general_manager'].includes(role);
  const isManager = role === 'manager';
  const isRestricted = ['employee', 'visiteur'].includes(role);

  if (isHighMgmt) kbd.inline_keyboard.push([{text: ar?'📊 إحصائيات الشركة':'📊 Stats',callback_data:'stats'}]);
  if (!isRestricted) {
    kbd.inline_keyboard.push([{text: ar?'🔍 بحث عن موظف':'🔍 Chercher employé',callback_data:'search'}]);
    kbd.inline_keyboard.push([{text: ar?'📂 تصفية العمال':'📂 Filtrer employés',callback_data:'filter_menu'}]);
  }

  // Restricted users (Employee/Visitor) see My Profile
  kbd.inline_keyboard.push([{text: ar?'👤 ملفي الشخصي':'👤 Mon Profil',callback_data:'my_profile'}]);
  
  kbd.inline_keyboard.push([{text: ar?'🌐 تغيير اللغة':'🌐 Changer Langue',callback_data:'choose_lang'}]);
  return send(chatId, ar ? '📌 <b>القائمة الرئيسية</b>' : '📌 <b>Menu Principal</b>', kbd);
}

function showCard(chatId, emp, ar) {
    const msg = ar ? `👤 <b>ملف الموظف</b>\n━━━━━━━━━━━━━━\n👤 الاسم: <b>${T(emp.lastName_ar)} ${T(emp.firstName_ar)}</b>\n🆔 ID: <code>${emp.clockingId}</code>\n💼 الوظيفة: <i>${T(emp.jobTitle_ar)}</i>` : `👤 <b>PROFIL EMPLOYÉ</b>\n━━━━━━━━━━━━━━\n👤 Nom: <b>${T(emp.lastName_fr)} ${T(emp.firstName_fr)}</b>\n🆔 ID: <code>${emp.clockingId}</code>\n💼 Poste: <i>${T(emp.jobTitle_fr)}</i>`;
    const kbd = {inline_keyboard: [[{text:ar?'📄 طلب وثيقة':'📄 Demander Doc',callback_data:'req_doc:'+emp.id}],[{text:ar?'🏠 القائمة الرئيسية':'🏠 Menu',callback_data:'menu'}]]};
    return send(chatId, msg, kbd);
}

async function handle(u) {
  if (!u) return;
  const cbq = u.callback_query, msg = u.message || cbq?.message, from = u.message?.from || cbq?.from;
  if (!msg||!from) return;
  const chatId = msg.chat.id, fromId = String(from.id), txt = (msg.text||'').trim().toLowerCase(), cfg = loadConfig();
  const fromUser = (from.username || '').toLowerCase().trim();
  const user = cfg.authorized_users?.find(u => { const adId = String(u.id || '').replace('@', '').toLowerCase().trim(); return adId === fromId || (fromUser && adId === fromUser); });
  if (!user) return send(chatId, `❌ Unauthorized ID: <code>${fromId}</code>`);
  if (!langs.has(chatId) && !cbq?.data?.startsWith('lang:')) return send(chatId, '🌐 Language?', {inline_keyboard: [[{text:'العربية',callback_data:'lang:ar'},{text:'Français',callback_data:'lang:fr'}]]});
  const ar = (langs.get(chatId) || 'ar') === 'ar';

  if (cbq) {
      await tg('answerCallbackQuery', {callback_query_id: cbq.id});
      const d = cbq.data;
      if (d.startsWith('lang:')) { langs.set(chatId, d.split(':')[1]); return showMenu(chatId, user, d.split(':')[1]==='ar'); }
      if (d === 'menu') return showMenu(chatId, user, ar);
      
      const db = loadDB();
      if (d === 'my_profile') {
          const emp = db.hr_employees?.find(e => String(e.clockingId) === String(user.clockingId));
          if (emp) return showCard(chatId, emp, ar);
          return send(chatId, ar ? '❌ لم يتم العثور على ملفك.' : '❌ Profil introuvable.');
      }
      
      const role = String(user.role).toLowerCase();
      const isRestricted = ['employee', 'visiteur'].includes(role);
      if (d === 'search' && !isRestricted) {
          states.set(chatId, {step: 'search'});
          return send(chatId, ar ? '🔍 أرسل الرقم أو الاسم:' : '🔍 Entrez ID ou Nom:');
      }

      if (d.startsWith('req_doc:')) {
          const emp = db.hr_employees?.find(e => String(e.id) === d.split(':')[1]);
          if (isRestricted && String(emp?.clockingId) !== String(user.clockingId)) return;
          await notifyStaff(`📄 <b>طلب وثيقة جديد:</b>\n👤 الموظف: ${emp?.lastName_fr} ${emp?.firstName_fr}\n🆔 ID: ${emp?.clockingId}`, cfg);
          return send(chatId, ar ? '✅ تم إرسال طلبك بنجاح.' : '✅ Demande envoyée.');
      }
  }

  const role = String(user.role).toLowerCase();
  const isRestricted = ['employee', 'visiteur'].includes(role);
  if (states.get(chatId)?.step === 'search' && txt && !isRestricted) {
      states.delete(chatId);
      const db = loadDB(), query = txt.toLowerCase();
      const results = (db.hr_employees || []).filter(e => String(e.clockingId).includes(query) || T(e.lastName_fr).toLowerCase().includes(query) || T(e.firstName_fr).toLowerCase().includes(query)).slice(0, 5);
      if (results.length === 0) return send(chatId, ar ? '❌ لا توجد نتائج.' : '❌ Aucun résultat.');
      for (const emp of results) await showCard(chatId, emp, ar);
      return;
  }
  if (txt === '/start' || txt === '/m' || txt === '/info') return showMenu(chatId, user, ar);
}

http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/api/webhook') {
    let body = ''; req.on('data', chunk => body += chunk);
    req.on('end', async () => { try { const u = JSON.parse(body); if (u.update_id) await handle(u).catch(e => log('Err: ' + e.message)); } catch(e) {} res.writeHead(200); res.end('OK'); });
    return;
  }
  if (req.method === 'POST' && req.url === '/api/config') {
    let body = ''; req.on('data', chunk => body += chunk);
    req.on('end', () => { try { fs.writeFileSync(CONFIG_PATH, body); res.writeHead(200); res.end('OK'); } catch(e) { res.writeHead(400); res.end('Fail'); } });
    return;
  }
  if (req.method === 'POST' && req.url === '/api/database') {
    let body = ''; req.on('data', chunk => body += chunk);
    req.on('end', () => { try { fs.writeFileSync(DB_PATH, body); res.writeHead(200); res.end('OK'); } catch(e) { res.writeHead(400); res.end('Fail'); } });
    return;
  }
  res.writeHead(200); res.end('Bot v5.7 Visitor Privacy Edition Active');
}).listen(process.env.PORT || 10000);

(async () => {
  log('=== TewfikSoft HR Bot v5.7 Starting... ===');
  const url = `https://tewfiksoft-hr-bot.onrender.com/api/webhook`;
  await tg('setWebhook', {url});
  log('Webhook set to: ' + url);
})();
