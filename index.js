// TewfikSoft Cloud Bot v7.3 - Clean & Working Edition
import express from 'express';
import https from 'https';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const CONFIG_PATH = path.join(__dirname, 'config.json');
const DB_PATH = path.join(DATA_DIR, 'database.json');
const BOT_TOKEN = process.env.BOT_TOKEN;

const log = (m) => console.log('[' + new Date().toISOString() + '] ' + m);
const T = (s) => String(s || '').trim() || '—';

function loadDB() {
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    const db = JSON.parse(raw);
    return db;
  } catch (e) {
    log('DB load error: ' + e.message);
    return { hr_employees: [], hr_leave_balances: [] };
  }
}

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); }
  catch { return { authorized_users: [] }; }
}

const tg = (method, body) => new Promise((res) => {
  const p = JSON.stringify(body);
  const req = https.request({
    hostname: 'api.telegram.org',
    path: `/bot${BOT_TOKEN}/${method}`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(p) }
  }, (r) => {
    let d = ''; r.on('data', c => d += c);
    r.on('end', () => { try { res(JSON.parse(d)); } catch { res({ ok: false }); } });
  });
  req.on('error', () => res({ ok: false }));
  req.write(p); req.end();
});

const send = (chatId, text, kbd = null) =>
  tg('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', ...(kbd ? { reply_markup: kbd } : {}) });

const app = express();
app.use((req, res, next) => {
  let chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    req.rawBody = Buffer.concat(chunks);
    next();
  });
});

const langs = new Map();
const states = new Map();

// ─────────────── UI FUNCTIONS ───────────────

function showMenu(chatId, user, ar) {
  const role = String(user.role).toLowerCase();
  const isHighMgmt = ['admin', 'general_manager'].includes(role);
  const isMgmt = ['admin', 'general_manager', 'manager'].includes(role);

  let kbd = { inline_keyboard: [] };
  if (isHighMgmt) kbd.inline_keyboard.push([{ text: ar ? '📊 إحصائيات ALVER & ALVERTEK' : '📊 Stats ALVER & ALVERTEK', callback_data: 'stats' }]);
  if (isMgmt) kbd.inline_keyboard.push([{ text: ar ? '🔍 البحث السريع عن الموظفين' : '🔍 Recherche Rapide', callback_data: 'search' }]);
  kbd.inline_keyboard.push([{ text: ar ? '👤 ملفي الشخصي' : '👤 Mon Profil', callback_data: 'my_profile' }]);
  kbd.inline_keyboard.push([{ text: ar ? '🌐 تغيير اللغة' : '🌐 Changer Langue', callback_data: 'choose_lang' }]);

  const msg = ar
    ? `💎 <b>أهلاً بك في نظام الإدارة العليا</b>\n━━━━━━━━━━━━━━\n👤 المستخدم: <b>${user.name}</b>\n🛡️ الرتبة: <code>${role.toUpperCase()}</code>\n━━━━━━━━━━━━━━`
    : `💎 <b>DASHBOARD DIRECTION GÉNÉRALE</b>\n━━━━━━━━━━━━━━\n👤 Utilisateur: <b>${user.name}</b>\n🛡️ Rôle: <code>${role.toUpperCase()}</code>\n━━━━━━━━━━━━━━`;
  return send(chatId, msg, kbd);
}

function showEmployeeCard(chatId, emp, ar) {
  const msg = ar
    ? `👤 <b>الملف الشامل للموظف</b>\n━━━━━━━━━━━━━━\n👤 الاسم: <b>${T(emp.lastName_ar)} ${T(emp.firstName_ar)}</b>\n🆔 الرمز: <code>${emp.clockingId}</code>\n💼 الوظيفة: <i>${T(emp.jobTitle_ar)}</i>\n🏢 الشركة: <b>${T(emp.companyId).toUpperCase()}</b>\n🏢 القسم: ${T(emp.department_ar)}\n📅 تاريخ البداية: ${T(emp.startDate)}\n📜 نوع العقد: ${T(emp.contractType)}\n━━━━━━━━━━━━━━`
    : `👤 <b>DOSSIER COMPLET</b>\n━━━━━━━━━━━━━━\n👤 Nom: <b>${T(emp.lastName_fr)} ${T(emp.firstName_fr)}</b>\n🆔 ID: <code>${emp.clockingId}</code>\n💼 Poste: <i>${T(emp.jobTitle_fr)}</i>\n🏢 Société: <b>${T(emp.companyId).toUpperCase()}</b>\n🏢 Dept: ${T(emp.department_fr)}\n📅 Début: ${T(emp.startDate)}\n📜 Contrat: ${T(emp.contractType)}\n━━━━━━━━━━━━━━`;

  const kbd = {
    inline_keyboard: [
      [{ text: ar ? '📄 الملف الكامل' : '📄 Fiche Complète', callback_data: 'full:' + emp.id }],
      [{ text: ar ? '📜 العقود' : '📜 Contrats', callback_data: 'docs:' + emp.id }, { text: ar ? '🏖️ العطل' : '🏖️ Congés', callback_data: 'leave:' + emp.id }],
      [{ text: ar ? '🚨 الغيابات' : '🚨 Absences', callback_data: 'abs:' + emp.id }, { text: ar ? '🗳️ الاستبيان' : '🗳️ Sondage', callback_data: 'survey:' + emp.id }],
      [{ text: ar ? '🔍 بحث جديد' : '🔍 Nouvelle Recherche', callback_data: 'search' }]
    ]
  };
  return send(chatId, msg, kbd);
}

// ─────────────── HANDLER ───────────────

async function handle(u) {
  const cbq = u.callback_query;
  const msg = u.message || cbq?.message;
  const from = u.message?.from || cbq?.from;
  if (!msg || !from) return;

  const chatId = msg.chat.id;
  const fromId = String(from.id);
  const cfg = loadConfig();

  const user = cfg.authorized_users?.find(u => {
    const adId = String(u.id || '').replace('@', '').toLowerCase().trim();
    return adId === fromId || (from.username && adId === from.username.toLowerCase());
  });
  if (!user) return;

  const ar = (langs.get(chatId) || 'ar') === 'ar';

  // ── Callback queries ──
  if (cbq) {
    await tg('answerCallbackQuery', { callback_query_id: cbq.id });
    const d = cbq.data;

    if (d.startsWith('lang:')) {
      const lang = d.split(':')[1];
      langs.set(chatId, lang);
      const isAr = lang === 'ar';
      states.set(chatId, { step: 'search' });
      return send(chatId, isAr
        ? '✅ تم ضبط اللغة.\n\n🔍 اكتب الآن <b>رقم الموظف</b> وسأعرض لك ملفه الشامل :'
        : '✅ Langue configurée.\n\n🔍 Entrez le <b>numéro d\'employé</b> :');
    }

    if (d === 'choose_lang') return send(chatId, '🌐 <b>اختر اللغة / Langue</b>', { inline_keyboard: [[{ text: 'العربية 🇩🇿', callback_data: 'lang:ar' }, { text: 'Français 🇫🇷', callback_data: 'lang:fr' }]] });
    if (d === 'menu') return showMenu(chatId, user, ar);
    if (d === 'search') { states.set(chatId, { step: 'search' }); return send(chatId, ar ? '🔍 أرسل <b>رقم الموظف</b> أو <b>اسمه</b> :' : '🔍 Entrez <b>ID</b> ou <b>Nom</b> :'); }

    const db = loadDB();

    if (d === 'my_profile') {
      const emp = db.hr_employees?.find(e => String(e.clockingId).trim() === String(user.clockingId).trim());
      if (emp) return showEmployeeCard(chatId, emp, ar);
      return send(chatId, ar ? '❌ لم يتم العثور على ملفك.' : '❌ Profil introuvable.');
    }

    if (d.startsWith('full:')) {
      const emp = db.hr_employees?.find(e => String(e.id) === d.split(':')[1]);
      if (!emp) return;
      return send(chatId, ar
        ? `📄 <b>التفاصيل الكاملة:</b>\n━━━━━━━━━━━━━━\n👤 ${T(emp.lastName_ar)} ${T(emp.firstName_ar)}\n🎂 الميلاد: ${T(emp.birthDate)}\n📍 مكان الميلاد: ${T(emp.birthPlace_ar)}\n🏠 العنوان: ${T(emp.address_ar)}\n📞 الهاتف: ${T(emp.phone)}\n🏢 القسم: ${T(emp.department_ar)}\n🏢 المديرية: ${T(emp.direction_ar)}\n📅 البداية: ${T(emp.startDate)}\n📜 العقد: ${T(emp.contractType)}\n🔚 نهاية العقد: ${T(emp.contractEndDate)}\n💰 الراتب: ${emp.salary || '—'} DA\n🎓 المستوى: ${T(emp.studyLevel_ar)}`
        : `📄 <b>FICHE DÉTAILLÉE:</b>\n━━━━━━━━━━━━━━\n👤 ${T(emp.lastName_fr)} ${T(emp.firstName_fr)}\n🎂 Naissance: ${T(emp.birthDate)}\n📍 Lieu: ${T(emp.birthPlace_fr)}\n🏠 Adresse: ${T(emp.address_fr)}\n📞 Tél: ${T(emp.phone)}\n🏢 Dept: ${T(emp.department_fr)}\n🏢 Direction: ${T(emp.direction_fr)}\n📅 Début: ${T(emp.startDate)}\n📜 Contrat: ${T(emp.contractType)}\n🔚 Fin: ${T(emp.contractEndDate)}\n💰 Salaire: ${emp.salary || '—'} DA\n🎓 Niveau: ${T(emp.studyLevel_fr)}`);
    }

    if (d.startsWith('leave:')) {
      const empId = d.split(':')[1];
      const bals = (db.hr_leave_balances || []).filter(b => String(b.employeeId) === empId);
      if (bals.length === 0) return send(chatId, ar ? '🏖️ لا يوجد رصيد عطل مسجل.' : '🏖️ Aucun solde de congé.');
      let msg = ar ? '🏖️ <b>رصيد العطل السنوي:</b>\n━━━━━━━━━━━━━━\n' : '🏖️ <b>SOLDE CONGÉS:</b>\n━━━━━━━━━━━━━━\n';
      for (const b of bals) {
        msg += `📅 ${b.exercice}: ✅ ${b.remainingDays}/${b.totalDays} ${ar ? 'يوم' : 'jours'}\n`;
      }
      return send(chatId, msg);
    }

    if (d.startsWith('docs:')) {
      const emp = db.hr_employees?.find(e => String(e.id) === d.split(':')[1]);
      if (!emp) return;
      return send(chatId, ar
        ? `📜 <b>معلومات العقد:</b>\n━━━━━━━━━━━━━━\n📜 النوع: <b>${T(emp.contractType)}</b>\n📅 البداية: ${T(emp.startDate)}\n🔚 النهاية: ${T(emp.contractEndDate)}\n🏢 الشركة: ${T(emp.companyId).toUpperCase()}\n💼 CSP: ${T(emp.csp)}`
        : `📜 <b>INFOS CONTRAT:</b>\n━━━━━━━━━━━━━━\n📜 Type: <b>${T(emp.contractType)}</b>\n📅 Début: ${T(emp.startDate)}\n🔚 Fin: ${T(emp.contractEndDate)}\n🏢 Société: ${T(emp.companyId).toUpperCase()}\n💼 CSP: ${T(emp.csp)}`);
    }

    if (d === 'stats') {
      const emps = db.hr_employees || [];
      let alver = 0, alvertek = 0, male = 0, female = 0, cdi = 0, cdd = 0;
      emps.forEach(e => {
        if (String(e.companyId || '').toLowerCase().includes('tek')) alvertek++; else alver++;
        if (String(e.gender || '').toUpperCase() === 'M') male++; else female++;
        const ct = String(e.contractType || '').toLowerCase();
        if (ct.includes('tit') || ct === 'cdi') cdi++; else cdd++;
      });
      return send(chatId, ar
        ? `📊 <b>إحصائيات ALVER & ALVERTEK</b>\n━━━━━━━━━━━━━━\n🏢 ALVER: <b>${alver}</b> 🟢\n🏢 ALVERTEK: <b>${alvertek}</b> 🔵\n━━━━━━━━━━━━━━\n👥 إجمالي القوى العاملة: <b>${emps.length}</b>\n👦 رجال: <b>${male}</b> | 👧 نساء: <b>${female}</b>\n📜 CDI/Titulaire: <b>${cdi}</b> | ⏱️ CDD: <b>${cdd}</b>\n━━━━━━━━━━━━━━\n✨ بيانات محدثة لحظياً`
        : `📊 <b>STATS ALVER & ALVERTEK</b>\n━━━━━━━━━━━━━━\n🏢 ALVER: <b>${alver}</b> 🟢\n🏢 ALVERTEK: <b>${alvertek}</b> 🔵\n━━━━━━━━━━━━━━\n👥 Effectif Total: <b>${emps.length}</b>\n👦 Hommes: <b>${male}</b> | 👧 Femmes: <b>${female}</b>\n📜 CDI/Tit: <b>${cdi}</b> | ⏱️ CDD: <b>${cdd}</b>\n━━━━━━━━━━━━━━\n✨ Données en temps réel`);
    }
    return;
  }

  // ── Text messages ──
  const txt = (msg.text || '').trim();
  const txtLow = txt.toLowerCase();

  if (txtLow === '/start' || txtLow === '/m') {
    return send(chatId, '🌐 <b>الرجاء اختيار اللغة / Choisissez la langue</b>', { inline_keyboard: [[{ text: 'العربية 🇩🇿', callback_data: 'lang:ar' }, { text: 'Français 🇫🇷', callback_data: 'lang:fr' }]] });
  }

  if (txtLow === '/me') {
    const db = loadDB();
    return send(chatId, `🛠️ <b>System Info:</b>\n🆔 ID: <code>${fromId}</code>\n👤 Name: ${user.name}\n🛡️ Role: ${user.role}\n👥 DB: <b>${db.hr_employees?.length || 0}</b> employees`);
  }

  // ── Search mode: any text that is not a command ──
  if (txt && !txt.startsWith('/')) {
    const db = loadDB();
    const q = txtLow.trim();
    const results = (db.hr_employees || []).filter(e => {
      const cid = String(e.clockingId || '').toLowerCase().trim();
      const lnf = String(e.lastName_fr || '').toLowerCase();
      const fnf = String(e.firstName_fr || '').toLowerCase();
      const lna = String(e.lastName_ar || '');
      return cid === q || cid.includes(q) || lnf.includes(q) || fnf.includes(q) || lna.includes(q);
    }).slice(0, 5);

    if (results.length === 0) {
      return send(chatId, ar ? `❌ لا يوجد موظف بهذا الرقم: <b>${txt}</b>\n\n🔍 حاول مجدداً:` : `❌ Aucun employé trouvé: <b>${txt}</b>\n\n🔍 Réessayez:`);
    }
    for (const emp of results) await showEmployeeCard(chatId, emp, ar);
    return;
  }
}

// ─────────────── ROUTES ───────────────

app.post('/api/webhook', (req, res) => {
  try {
    const body = req.rawBody.toString('utf8');
    const update = JSON.parse(body);
    if (update.update_id) handle(update).catch(e => log('Handle err: ' + e.message));
  } catch (e) { log('Webhook parse err: ' + e.message); }
  res.sendStatus(200);
});

app.post('/api/config', (req, res) => {
  try {
    let data = req.rawBody;
    if (data[0] === 0x1f && data[1] === 0x8b) data = zlib.gunzipSync(data);
    fs.writeFileSync(CONFIG_PATH, data);
    log('Config updated: ' + data.length + ' bytes');
    res.sendStatus(200);
  } catch (e) { log('Config err: ' + e.message); res.status(500).send(e.message); }
});

app.post('/api/database', (req, res) => {
  try {
    let data = req.rawBody;
    if (data[0] === 0x1f && data[1] === 0x8b) data = zlib.gunzipSync(data);
    fs.writeFileSync(DB_PATH, data);
    const db = JSON.parse(data.toString('utf8'));
    log(`Database updated: ${db.hr_employees?.length || 0} employees, ${data.length} bytes`);
    res.sendStatus(200);
  } catch (e) { log('DB err: ' + e.message); res.status(500).send(e.message); }
});

app.get('/', (req, res) => {
  const db = loadDB();
  res.send(`TewfikSoft HR Bot v7.3 | ${db.hr_employees?.length || 0} employees loaded`);
});

// ─────────────── START ───────────────

const port = process.env.PORT || 10000;
app.listen(port, () => {
  log(`=== TewfikSoft HR Bot v7.3 running on port ${port} ===`);
  const db = loadDB();
  log(`Database: ${db.hr_employees?.length || 0} employees`);
  tg('setWebhook', { url: 'https://tewfiksoft-hr-bot.onrender.com/api/webhook' });
});
