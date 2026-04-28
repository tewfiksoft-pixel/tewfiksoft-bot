// TewfikSoft Cloud Bot v5.1 - Admin Pro Edition (Notifications + Smart Flow)
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
const REQS_PATH = path.join(DATA_DIR, 'requests.json');

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_CHAT_ID; // معرف الأدمن لاستلام الإشعارات
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

function showLanguageSelect(chatId) {
  return send(chatId, '🌐 <b>الرجاء اختيار اللغة / Veuillez choisir la langue</b>', {
    inline_keyboard: [
      [{text: 'العربية 🇩🇿', callback_data: 'lang:ar'}, {text: 'Français 🇫🇷', callback_data: 'lang:fr'}]
    ]
  });
}

function showMainMenu(chatId, user, ar) {
  let kbd = {inline_keyboard: [
    [{text: ar ? '🔍 البحث عن عامل' : '🔍 Recherche', callback_data: 'search'}],
    [{text: ar ? '📋 القائمة الشاملة (/info)' : '📋 Menu Global (/info)', callback_data: 'info_page'}],
    [{text: ar ? '🌐 تغيير اللغة' : '🌐 Changer Langue', callback_data: 'choose_lang'}]
  ]};
  return send(chatId, ar ? '📌 <b>القائمة الرئيسية</b>' : '📌 <b>Menu Principal</b>', kbd);
}

function showInfoPage(chatId, user, ar) {
  let kbd = {inline_keyboard: []};
  kbd.inline_keyboard.push([{text: ar ? '📁 ملفاتي' : '📁 Mes Fichiers', callback_data: 'my_files'}, {text: ar ? '👤 الملف الشخصي' : '👤 Profil', callback_data: 'my_profile'}]);
  kbd.inline_keyboard.push([{text: ar ? '🏖️ العطل' : '🏖️ Congés', callback_data: 'leave_balance'}, {text: ar ? '📈 الإحصائيات' : '📈 Stats', callback_data: 'stats'}]);
  kbd.inline_keyboard.push([{text: ar ? '🔍 البحث عن عامل' : '🔍 Recherche', callback_data: 'search'}, {text: ar ? '📄 طلب وثائق' : '📄 Documents', callback_data: 'docs'}]);
  kbd.inline_keyboard.push([{text: ar ? '📜 العقود' : '📜 Contrats', callback_data: 'contracts'}, {text: ar ? '🚨 إعلام غياب' : '🚨 Absence', callback_data: 'absence'}]);
  kbd.inline_keyboard.push([{text: ar ? '🗳️ استبيان' : '🗳️ Survey', callback_data: 'survey'}]);
  kbd.inline_keyboard.push([{text: ar ? '🏠 القائمة الرئيسية' : '🏠 Menu', callback_data: 'menu'}]);
  const txt = ar ? '🛠️ <b>لوحة التحكم والمعلومات</b>' : '🛠️ <b>PANNEAU DE CONTRÔLE</b>';
  return send(chatId, txt, kbd);
}

async function handle(u) {
  if (!u) return;
  const cbq = u.callback_query;
  const msg = u.message || cbq?.message;
  const from = u.message?.from || cbq?.from;
  if (!msg||!from) return;

  const chatId = msg.chat.id;
  const fromId = String(from.id);
  const txt = (msg.text||'').trim().toLowerCase();
  
  const cfg = loadConfig();
  const fromUser = (from.username || '').toLowerCase().trim();
  const user = cfg.authorized_users?.find(u => {
      const adId = String(u.id || '').replace('@', '').toLowerCase().trim();
      return adId === fromId || (fromUser && adId === fromUser);
  });
  if (!user) return send(chatId, `❌ Unauthorized ID: <code>${fromId}</code>`);

  if (!langs.has(chatId) && !cbq?.data?.startsWith('lang:')) return showLanguageSelect(chatId);
  const ar = (langs.get(chatId) || 'ar') === 'ar';

  if (cbq) {
      await tg('answerCallbackQuery', {callback_query_id: cbq.id});
      const d = cbq.data;
      if (d.startsWith('lang:')) { 
          const l = d.split(':')[1];
          langs.set(chatId, l);
          const isAr = l === 'ar';
          await send(chatId, isAr ? '✅ <b>تم تغيير اللغة بنجاح!</b>' : '✅ <b>Langue changée avec succès !</b>');
          await send(chatId, isAr ? `🌟 <b>مرحباً بك ${user.name}، أنا في خدمتك.</b>\n\n🔍 اكتب الآن <b>رقم العامل</b> أو اسمه للبحث عنه:` : `🌟 <b>Bienvenue ${user.name}, à votre service.</b>\n\n🔍 Entrez maintenant le <b>numéro d'employé</b> ou son nom :`);
          states.set(chatId, {step: 'search'});
          return;
      }
      if (d === 'choose_lang') return showLanguageSelect(chatId);
      if (d === 'menu') return showMainMenu(chatId, user, ar);
      if (d === 'info_page') return showInfoPage(chatId, user, ar);
      if (d === 'search') { 
          states.set(chatId, {step: 'search'}); 
          return send(chatId, ar ? '🔍 اكتب الآن <b>رقم العامل</b> أو اسمه للبحث عنه:' : '🔍 Entrez le <b>numéro d\'employé</b> أو son nom :'); 
      }
      
      // Placeholder for Doc Request with Admin Notification
      if (d === 'docs') {
          if (ADMIN_ID) {
              await send(ADMIN_ID, `🔔 <b>إشعار طلب وثيقة:</b>\n👤 الموظف: ${user.name}\n🆔 المعرف: ${fromId}\n📂 القسم: طلب وثائق`);
          }
          return send(chatId, ar ? '📄 تم إرسال طلبك للمدير بنجاح.' : '📄 Votre demande a été envoyée au directeur.');
      }
  }

  if (states.get(chatId)?.step === 'search' && txt && txt !== '/start' && txt !== '/m' && txt !== '/info') {
      states.delete(chatId);
      const db = loadDB();
      const query = txt.toLowerCase();
      const results = (db.hr_employees || []).filter(e => 
          String(e.clockingId).includes(query) || 
          T(e.lastName_fr).toLowerCase().includes(query) || 
          T(e.firstName_fr).toLowerCase().includes(query)
      ).slice(0, 5);

      if (results.length === 0) return send(chatId, ar ? '❌ لم يتم العثور على نتائج.' : '❌ Aucun résultat.');
      for (const emp of results) {
          const card = ar ? `👤 ${T(emp.lastName_ar)} ${T(emp.firstName_ar)}\n🆔 ${emp.clockingId}\n💼 ${T(emp.jobTitle_ar)}` : `👤 ${T(emp.lastName_fr)} ${T(emp.firstName_fr)}\n🆔 ${emp.clockingId}\n💼 ${T(emp.jobTitle_fr)}`;
          await send(chatId, card);
      }
      return send(chatId, ar ? '🔍 هل تود البحث عن عامل آخر؟' : '🔍 Chercher un autre ?');
  }

  if (txt === '/start' || txt === '/m') return showMainMenu(chatId, user, ar);
  if (txt === '/info') return showInfoPage(chatId, user, ar);
}

http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/api/webhook') {
    let body = ''; req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try { const u = JSON.parse(body); if (u.update_id) await handle(u).catch(e => log('Err: ' + e.message)); } catch(e) {}
      res.writeHead(200); res.end('OK');
    });
    return;
  }
  if (req.method === 'POST' && req.url === '/api/config') {
    let body = ''; req.on('data', chunk => body += chunk);
    req.on('end', () => { try { fs.writeFileSync(CONFIG_PATH, body); res.writeHead(200, {'Content-Type': 'application/json'}); res.end(JSON.stringify({success:true})); } catch(e) { res.writeHead(400); res.end('Fail'); } });
    return;
  }
  if (req.method === 'POST' && req.url === '/api/database') {
    let body = ''; req.on('data', chunk => body += chunk);
    req.on('end', () => { try { fs.writeFileSync(DB_PATH, body); res.writeHead(200, {'Content-Type': 'application/json'}); res.end(JSON.stringify({success:true})); } catch(e) { res.writeHead(400); res.end('Fail'); } });
    return;
  }
  res.writeHead(200); res.end('Bot v5.1 Smart Flow Active');
}).listen(process.env.PORT || 10000);

(async () => {
  log('=== TewfikSoft HR Bot v5.1 Starting... ===');
  const url = `https://tewfiksoft-hr-bot.onrender.com/api/webhook`;
  await tg('setWebhook', {url});
  log('Webhook set to: ' + url);
})();
