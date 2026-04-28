// TewfikSoft Cloud Bot v7.0 - THE FINAL MASTERPIECE (Express + Premium UI)
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
    if (!fs.existsSync(DB_PATH)) return {hr_employees:[], hr_leave_balances:[]};
    const content = fs.readFileSync(DB_PATH, 'utf8');
    if (content.trim().startsWith('{')) return JSON.parse(content);
    const decrypted = decrypt(content, SYNC_PASSWORD);
    return decrypted ? JSON.parse(decrypted) : {hr_employees:[], hr_leave_balances:[]};
  } catch { return {hr_employees:[], hr_leave_balances:[]}; }
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
  const role = String(user.role).toLowerCase();
  const isMgmt = ['admin', 'general_manager', 'manager'].includes(role);
  
  let msg = ar 
    ? `💎 <b>أهلاً بك في نظام الإدارة العليا</b>\n━━━━━━━━━━━━━━\n👤 المستخدم: <b>${user.name}</b>\n🛡️ الرتبة: <code>${role.toUpperCase()}</code>\n━━━━━━━━━━━━━━` 
    : `💎 <b>DASHBOARD DIRECTION GÉNÉRALE</b>\n━━━━━━━━━━━━━━\n👤 Utilisateur: <b>${user.name}</b>\n🛡️ Rôle: <code>${role.toUpperCase()}</code>\n━━━━━━━━━━━━━━`;

  let kbd = {inline_keyboard: []};
  if (role === 'admin' || role === 'general_manager') kbd.inline_keyboard.push([{text: ar ? '📊 إحصائيات ALVER & ALVERTEK' : '📊 Stats ALVER & ALVERTEK', callback_data: 'stats'}]);
  if (isMgmt) kbd.inline_keyboard.push([{text: ar ? '🔍 البحث السريع عن الموظفين' : '🔍 Recherche Rapide', callback_data: 'search'}]);
  kbd.inline_keyboard.push([{text: ar ? '👤 ملفي الشخصي' : '👤 Mon Profil', callback_data: 'my_profile'}], [{text: ar ? '🌐 تغيير اللغة' : '🌐 Changer Langue', callback_data: 'choose_lang'}]);

  return send(chatId, msg, kbd);
}

function showFullEmployeeCard(chatId, emp, ar) {
    const msg = ar 
      ? `👤 <b>الملف الشامل للموظف</b>\n━━━━━━━━━━━━━━\n👤 الاسم: <b>${T(emp.lastName_ar)} ${T(emp.firstName_ar)}</b>\n🆔 الرمز: <code>${emp.clockingId}</code>\n💼 الوظيفة: <i>${T(emp.jobTitle_ar)}</i>\n🏢 الشركة: <b>${T(emp.companyId).toUpperCase()}</b>\n━━━━━━━━━━━━━━` 
      : `👤 <b>DOSSIER COMPLET</b>\n━━━━━━━━━━━━━━\n👤 Nom: <b>${T(emp.lastName_fr)} ${T(emp.firstName_fr)}</b>\n🆔 ID: <code>${emp.clockingId}</code>\n💼 Poste: <i>${T(emp.jobTitle_fr)}</i>\n🏢 Société: <b>${T(emp.companyId).toUpperCase()}</b>\n━━━━━━━━━━━━━━`;
    
    const kbd = {inline_keyboard: [
        [{text: ar ? '📄 الملف الكامل' : '📄 Fiche', callback_data: 'full:'+emp.id}],
        [{text: ar ? '📜 العقود' : '📜 Contrats', callback_data: 'docs:'+emp.id}, {text: ar ? '🏖️ العطل' : '🏖️ Congés', callback_data: 'leave:'+emp.id}],
        [{text: ar ? '🚨 الغيابات' : '🚨 Absences', callback_data: 'abs:'+emp.id}, {text: ar ? '🗳️ الاستبيان' : '🗳️ Survey', callback_data: 'survey:'+emp.id}],
        [{text: ar ? '🏠 العودة للبحث' : '🏠 Retour', callback_data: 'search'}]
    ]};
    return send(chatId, msg, kbd);
}

async function handle(u) {
  const cbq = u.callback_query, msg = u.message || cbq?.message, from = u.message?.from || cbq?.from;
  if (!msg||!from) return;
  const chatId = msg.chat.id, fromId = String(from.id), cfg = loadConfig();
  const user = cfg.authorized_users?.find(u => {
      const adId = String(u.id || '').replace('@','').toLowerCase().trim();
      return adId === fromId || (from.username && adId === from.username.toLowerCase());
  });
  if (!user) return;

  const ar = (langs.get(chatId) || 'ar') === 'ar';

  if (cbq) {
      await tg('answerCallbackQuery', {callback_query_id: cbq.id});
      const d = cbq.data;
      if (d.startsWith('lang:')) { 
          langs.set(chatId, d.split(':')[1]); 
          const isAr = d.split(':')[1] === 'ar';
          await send(chatId, isAr ? '🔍 اكتب الآن <b>رقم العامل</b> وأنا في خدمتك :' : '🔍 Entrez le <b>numéro d\'employé</b> :');
          states.set(chatId, {step: 'search'});
          return;
      }
      if (d === 'menu') return showMenu(chatId, user, ar);
      if (d === 'search') { states.set(chatId, {step: 'search'}); return send(chatId, ar ? '🔍 أرسل رقم الموظف:' : '🔍 Entrez ID :'); }
      if (d === 'choose_lang') return send(chatId, '🌐 Language?', {inline_keyboard: [[{text:'العربية',callback_data:'lang:ar'},{text:'Français',callback_data:'lang:fr'}]]});
      
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
      if (d === 'stats') {
          const emps = db.hr_employees || [];
          let alver=0, alvertek=0;
          emps.forEach(e => { if (String(e.companyId).toLowerCase().includes('tek')) alvertek++; else alver++; });
          return send(chatId, ar ? `📊 <b>الإحصائيات الحالية:</b>\n━━━━━━━━━━━━━━\n🏢 ALVER: <b>${alver}</b>\n🏢 ALVERTEK: <b>${alvertek}</b>\n👥 المجموع: <b>${emps.length}</b>` : `📊 <b>STATISTIQUES:</b>\n━━━━━━━━━━━━━━\n🏢 ALVER: <b>${alver}</b>\n🏢 ALVERTEK: <b>${alvertek}</b>\n👥 Total: <b>${emps.length}</b>`);
      }
  }

  const txt = (msg.text||'').trim().toLowerCase();
  if (txt === '/start' || txt === '/m' || txt === 'check') {
      const db = loadDB();
      if (txt === 'check') return send(chatId, `📊 Status: ${db.hr_employees?.length || 0} employees found.`);
      return send(chatId, '🌐 <b>الرجاء اختيار اللغة / Langue</b>', {inline_keyboard: [[{text:'العربية 🇩🇿',callback_data:'lang:ar'},{text:'Français 🇫🇷',callback_data:'lang:fr'}]]});
  }

  if (states.get(chatId)?.step === 'search' && txt && !txt.startsWith('/')) {
      const db = loadDB();
      const q = txt.toLowerCase().trim();
      const results = (db.hr_employees || []).filter(e => {
          const cid = String(e.clockingId || '').toLowerCase().trim();
          const ln = String(e.lastName_fr || '').toLowerCase().trim();
          return cid === q || cid.includes(q) || ln.includes(q);
      }).slice(0, 3);

      if (results.length === 0) return send(chatId, ar ? `❌ لا يوجد موظف بهذا الرقم <b>${txt}</b>` : `❌ Aucun employé trouvé pour <b>${txt}</b>`);
      states.delete(chatId);
      for (const emp of results) await showFullEmployeeCard(chatId, emp, ar);
  }
}

app.post('/api/webhook', async (req, res) => { try { await handle(req.body); } catch(e) {} res.sendStatus(200); });
app.post('/api/config', (req, res) => { fs.writeFileSync(CONFIG_PATH, JSON.stringify(req.body)); res.sendStatus(200); });
app.post('/api/database', (req, res) => { fs.writeFileSync(DB_PATH, JSON.stringify(req.body)); res.sendStatus(200); });
app.get('/', (req, res) => res.send('TewfikSoft HR Bot v7.0 Final Masterpiece Active'));

const port = process.env.PORT || 10000;
app.listen(port, () => {
  log(`Server running on port ${port}`);
  tg('setWebhook', {url: `https://tewfiksoft-hr-bot.onrender.com/api/webhook`});
});
