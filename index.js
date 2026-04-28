// TewfikSoft Cloud Bot v6.1 - THE DIRECTOR'S ULTIMATE COMMAND
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
const SYNC_PASSWORD = process.env.SYNC_PASSWORD || "nouar2026";
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
    const content = fs.readFileSync(DB_PATH, 'utf8');
    if (content.trim().startsWith('{')) return JSON.parse(content);
    const decrypted = decrypt(content, SYNC_PASSWORD);
    return decrypted ? JSON.parse(decrypted) : {hr_employees:[]};
  } catch { return {hr_employees:[]}; }
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
  const isManagement = ['admin', 'general_manager', 'manager'].includes(role);
  
  let msg = ar 
    ? `💎 <b>أهلاً بك في نظام الإدارة العليا</b>\n━━━━━━━━━━━━━━\n👤 المستخدم: <b>${user.name}</b>\n🛡️ الرتبة: <code>${role.toUpperCase()}</code>\n━━━━━━━━━━━━━━` 
    : `💎 <b>BIENVENUE - DIRECTION GÉNÉRALE</b>\n━━━━━━━━━━━━━━\n👤 Utilisateur: <b>${user.name}</b>\n🛡️ Rôle: <code>${role.toUpperCase()}</code>\n━━━━━━━━━━━━━━`;

  let kbd = {inline_keyboard: []};
  if (role === 'admin' || role === 'general_manager') {
    kbd.inline_keyboard.push([{text: ar ? '📊 إحصائيات ALVER & ALVERTEK' : '📊 Stats ALVER & ALVERTEK', callback_data: 'stats'}]);
  }
  
  if (isManagement) {
    kbd.inline_keyboard.push([{text: ar ? '🔍 البحث السريع عن الموظفين' : '🔍 Recherche Rapide', callback_data: 'search'}]);
    kbd.inline_keyboard.push([{text: ar ? '📂 تصفية حسب الشركة/القسم' : '📂 Filtrage Avancé', callback_data: 'filter_menu'}]);
  }

  kbd.inline_keyboard.push([{text: ar ? '👤 ملفي الشخصي' : '👤 Mon Profil', callback_data: 'my_profile'}]);
  kbd.inline_keyboard.push([{text: ar ? '🌐 الإعدادات واللغة' : '🌐 Paramètres & Langue', callback_data: 'choose_lang'}]);

  return send(chatId, msg, kbd);
}

function showStats(chatId, ar) {
    const db = loadDB();
    const emps = db.hr_employees || [];
    const stats = { total: emps.length, male: 0, female: 0, CDI: 0, CDD: 0, alver: 0, alvertek: 0 };
    
    emps.forEach(e => {
        const c = String(e.company || '').toUpperCase();
        if (c.includes('ALVERTEK')) stats.alvertek++; else stats.alver++;
        if (String(e.gender).toLowerCase().includes('m') || String(e.gender).includes('\u0630\u0643\u0631')) stats.male++; else stats.female++;
        if (String(e.contractType).toUpperCase() === 'CDI') stats.CDI++; else stats.CDD++;
    });

    let msg = ar ? `📊 <b>إحصائيات ALVER & ALVERTEK</b>\n━━━━━━━━━━━━━━\n` : `📊 <b>STATISTIQUES GÉNÉRALES</b>\n━━━━━━━━━━━━━━\n`;
    msg += `🏢 ALVER: <b>${stats.alver}</b> عمال 🟢\n`;
    msg += `🏢 ALVERTEK: <b>${stats.alvertek}</b> عمال 🔵\n\n`;
    
    msg += ar ? `👥 إجمالي القوى العاملة: <b>${stats.total}</b>\n` : `👥 Effectif Total: <b>${stats.total}</b>\n`;
    msg += `━━━━━━━━━━━━━━\n`;
    msg += ar ? `👦 رجال: <b>${stats.male}</b> | 👧 نساء: <b>${stats.female}</b>\n` : `👦 Hommes: <b>${stats.male}</b> | 👧 Femmes: <b>${stats.female}</b>\n`;
    msg += ar ? `📜 عقود CDI: <b>${stats.CDI}</b> | ⏱️ عقود CDD: <b>${stats.CDD}</b>\n` : `📜 Contrats CDI: <b>${stats.CDI}</b> | ⏱️ Contrats CDD: <b>${stats.CDD}</b>\n`;
    msg += `━━━━━━━━━━━━━━\n✨ ${ar?'لوحة تحكم المدير العام جاهزة':'Panneau DG prêt'}`;

    return send(chatId, msg, {inline_keyboard: [[{text: ar ? '🏠 القائمة الرئيسية' : '🏠 Menu', callback_data: 'menu'}]]});
}

function showFullEmployeeCard(chatId, emp, ar) {
    const msg = ar 
      ? `👤 <b>الملف الشامل للموظف</b>\n━━━━━━━━━━━━━━\n👤 الاسم: <b>${T(emp.lastName_ar)} ${T(emp.firstName_ar)}</b>\n🆔 الرمز: <code>${emp.clockingId}</code>\n💼 الوظيفة: <i>${T(emp.jobTitle_ar)}</i>\n🏢 الشركة: ${T(emp.company)}\n━━━━━━━━━━━━━━\nيرجى اختيار البيانات المطلوبة:` 
      : `👤 <b>DOSSIER COMPLET</b>\n━━━━━━━━━━━━━━\n👤 Nom: <b>${T(emp.lastName_fr)} ${T(emp.firstName_fr)}</b>\n🆔 ID: <code>${emp.clockingId}</code>\n💼 Poste: <i>${T(emp.jobTitle_fr)}</i>\n🏢 Société: ${T(emp.company)}\n━━━━━━━━━━━━━━\nConsulter :`;
    
    const kbd = {inline_keyboard: [
        [{text: ar ? '📄 ملف الموظف الكامل' : '📄 Fiche Employé', callback_data: 'full:'+emp.id}],
        [{text: ar ? '📜 العقود والوثائق' : '📜 Contrats & Docs', callback_data: 'contracts:'+emp.id}, {text: ar ? '🏖️ العطل السنوية' : '🏖️ Congés', callback_data: 'leave:'+emp.id}],
        [{text: ar ? '🚨 الغيابات والتأخير' : '🚨 Absences', callback_data: 'abs:'+emp.id}, {text: ar ? '📝 الطلبيات' : '📝 Commandes', callback_data: 'orders:'+emp.id}],
        [{text: ar ? '🗳️ الاستبيانات' : '🗳️ Questionnaires', callback_data: 'survey:'+emp.id}],
        [{text: ar ? '🏠 العودة للقائمة' : '🏠 Menu Principal', callback_data: 'menu'}]
    ]};
    return send(chatId, msg, kbd);
}

async function handle(u) {
  if (!u) return;
  const cbq = u.callback_query, msg = u.message || cbq?.message, from = u.message?.from || cbq?.from;
  if (!msg||!from) return;
  const chatId = msg.chat.id, fromId = String(from.id), txt = (msg.text||'').trim().toLowerCase(), cfg = loadConfig();
  const user = cfg.authorized_users?.find(u => { const adId = String(u.id || '').replace('@', '').toLowerCase().trim(); return adId === fromId || (from.username && adId === from.username.toLowerCase()); });
  if (!user) return send(chatId, `❌ Unauthorized ID: <code>${fromId}</code>`);
  
  if (txt === '/me') {
      const res = `👤 <b>بياناتي:</b>\n🆔 ID: <code>${fromId}</code>\n📛 Name: ${user.name}\n🛡️ Role: ${user.role}\n🌐 Langue: ${langs.get(chatId)||'AR'}`;
      return send(chatId, res);
  }

  if (!langs.has(chatId) && !cbq?.data?.startsWith('lang:')) {
    return send(chatId, '🌐 <b>الرجاء اختيار اللغة / Langue</b>', {inline_keyboard: [[{text:'العربية 🇩🇿',callback_data:'lang:ar'},{text:'Français 🇫🇷',callback_data:'lang:fr'}]]});
  }
  const ar = (langs.get(chatId) || 'ar') === 'ar';

  if (cbq) {
      await tg('answerCallbackQuery', {callback_query_id: cbq.id});
      const d = cbq.data;
      if (d.startsWith('lang:')) { 
          const l = d.split(':')[1]; langs.set(chatId, l); 
          const isAr = l === 'ar';
          await send(chatId, isAr ? '✅ <b>تم ضبط اللغة بنجاح</b>' : '✅ <b>Langue configurée</b>');
          await send(chatId, isAr ? '🔍 اكتب الآن <b>رقم العامل أو الموظف</b> وأنا في خدمتك :' : '🔍 Entrez maintenant le <b>numéro d\'employé</b> :');
          states.set(chatId, {step: 'search'});
          return;
      }
      if (d === 'menu') return showMenu(chatId, user, ar);
      if (d === 'stats') return showStats(chatId, ar);
      if (d === 'search') { states.set(chatId, {step: 'search'}); return send(chatId, ar ? '🔍 أرسل رقم الموظف المطلوب:' : '🔍 Entrez ID de l\'employé:'); }
      
      const db = loadDB();
      if (d === 'my_profile') {
          const emp = db.hr_employees?.find(e => String(e.clockingId) === String(user.clockingId));
          if (emp) return showFullEmployeeCard(chatId, emp, ar);
          return send(chatId, ar ? '❌ لم يتم العثور على ملفك.' : '❌ Profil introuvable.');
      }
      if (d.startsWith('full:')) {
          const emp = db.hr_employees?.find(e => String(e.id) === d.split(':')[1]);
          return send(chatId, ar ? `📄 <b>ملف الموظف الكامل:</b>\n👤 ${T(emp.lastName_ar)}\n💼 ${T(emp.jobTitle_ar)}\n🏢 الشركة: ${T(emp.company)}\n📅 البداية: ${emp.startDate}\n🔚 النهاية: ${emp.contractEndDate}` : `📄 <b>FICHE COMPLÈTE:</b>\n👤 ${T(emp.lastName_fr)}\n💼 ${T(emp.jobTitle_fr)}\n🏢 Société: ${T(emp.company)}\n📅 Début: ${emp.startDate}\n🔚 Fin: ${emp.contractEndDate}`, {inline_keyboard:[[{text:ar?'🔙 رجوع':'🔙 Retour',callback_data:'menu'}]]});
      }
      if (d.startsWith('leave:')) {
          const bal = (db.hr_leave_balances || []).find(b => String(b.employeeId) === d.split(':')[1]);
          return send(chatId, ar ? `🏖️ <b>الرصيد السنوي:</b>\n📅 السنة: ${bal?.exercice||'2024'}\n✅ الرصيد: <b>${bal?.remainingDays||0}</b> يوم` : `🏖️ <b>SOLDE CONGÉS:</b>\n📅 Année: ${bal?.exercice||'2024'}\n✅ Solde: <b>${bal?.remainingDays||0}</b> jours`, {inline_keyboard:[[{text:ar?'🔙 رجوع':'🔙 Retour',callback_data:'menu'}]]});
      }
      if (['contracts:', 'abs:', 'orders:', 'survey:'].some(p => d.startsWith(p))) {
          return send(chatId, ar ? '🚧 هذا القسم سيتم تحميله من قاعدة البيانات الفرعية قريباً.' : '🚧 Cette section sera bientôt disponible.');
      }
  }

  if (states.get(chatId)?.step === 'search' && txt && !txt.startsWith('/')) {
      states.delete(chatId);
      const db = loadDB(), query = txt.toLowerCase();
      const results = (db.hr_employees || []).filter(e => String(e.clockingId).includes(query) || T(e.lastName_fr).toLowerCase().includes(query) || T(e.firstName_fr).toLowerCase().includes(query)).slice(0, 5);
      if (results.length === 0) return send(chatId, ar ? '❌ لا يوجد موظف بهذا الرقم.' : '❌ Aucun employé trouvé.');
      for (const emp of results) await showFullEmployeeCard(chatId, emp, ar);
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
  res.writeHead(200); res.end('Ultimate Director Bot v6.1 Active');
}).listen(process.env.PORT || 10000);

(async () => {
  log('=== TewfikSoft HR Bot v6.1 Starting... ===');
  const url = `https://tewfiksoft-hr-bot.onrender.com/api/webhook`;
  await tg('setWebhook', {url});
  log('Webhook set to: ' + url);
})();
