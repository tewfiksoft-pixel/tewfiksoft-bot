// TewfikSoft Cloud Bot v7.4 - Document Request Edition
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
const ADMIN_ID = process.env.ADMIN_CHAT_ID;

const log = (m) => console.log('[' + new Date().toISOString() + '] ' + m);
const T = (s) => String(s || '').trim() || '—';

function loadDB() {
  try { return JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); }
  catch { return { hr_employees: [], hr_leave_balances: [] }; }
}
function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); }
  catch { return { authorized_users: [] }; }
}

const tg = (method, body) => new Promise((res) => {
  const p = JSON.stringify(body);
  const req = https.request({ hostname: 'api.telegram.org', path: `/bot${BOT_TOKEN}/${method}`, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(p) } }, (r) => {
    let d = ''; r.on('data', c => d += c);
    r.on('end', () => { try { res(JSON.parse(d)); } catch { res({ ok: false }); } });
  });
  req.on('error', () => res({ ok: false }));
  req.write(p); req.end();
});

const send = (chatId, text, kbd = null) => tg('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', ...(kbd ? { reply_markup: kbd } : {}) });

async function notifyStaff(txt, cfg) {
  const admins = cfg.authorized_users?.filter(u => u.role === 'admin' || u.role === 'general_manager') || [];
  for (const a of admins) { if (a.id) await send(a.id, `🔔 <b>إشعار للإدارة:</b>\n${txt}`); }
  const rh = cfg.authorized_users?.filter(u => u.role === 'gestionnaire_rh') || [];
  for (const r of rh) { if (r.id) await send(r.id, `🔔 <b>إشعار للموارد البشرية:</b>\n${txt}`); }
  // Fallback if env ADMIN_ID exists and is not in admins
  if (ADMIN_ID && !admins.find(a => String(a.id) === String(ADMIN_ID))) await send(ADMIN_ID, `🔔 <b>إشعار جديد:</b>\n${txt}`);
}

const app = express();
app.use((req, res, next) => {
  let chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => { req.rawBody = Buffer.concat(chunks); next(); });
});

const langs = new Map();
const states = new Map();

// ── Document types list ──
const DOC_TYPES = [
  { id: 'releve_emol', fr: 'Relevé des Émoluments', ar: 'كشف الرواتب' },
  { id: 'att_travail', fr: 'Attestation de Travail', ar: 'شهادة العمل' },
  { id: 'carte_chifa', fr: 'Activation Carte Chifa', ar: 'تفعيل بطاقة الشفاء' },
  { id: 'accident', fr: 'Déclaration Accident de Travail', ar: 'تصريح حادث عمل' },
  { id: 'fiche_paie', fr: 'Fiche de Paie', ar: 'كشف الراتب' },
];

const DOSSIER_REASONS = [
  { id: 'ass_auto', fr: 'Assurance Automobile', ar: 'تأمين السيارة' },
  { id: 'cpt_banc', fr: 'Ouverture Compte Bancaire', ar: 'فتح حساب بنكي' },
  { id: 'cpt_ccp', fr: 'Ouverture Compte CCP', ar: 'فتح حساب CCP' },
  { id: 'dos_bourse', fr: 'Dossier Bourse', ar: 'ملف المنحة' },
  { id: 'dos_visa', fr: 'Dossier Visa', ar: 'ملف التأشيرة' },
  { id: 'dos_passeport', fr: 'Dossier Passeport', ar: 'ملف جواز السفر' },
  { id: 'achat_fac', fr: 'Achat par Facilité', ar: 'شراء بالتسهيل' },
  { id: 'dos_famille', fr: 'Dossier Soutien de Famille', ar: 'ملف إعالة العائلة' },
  { id: 'dos_logement', fr: 'Dossier Logement', ar: 'ملف السكن' },
  { id: 'credit_banc', fr: 'Crédit Bancaire', ar: 'القرض البنكي' }
];

// ─────── UI ───────

function getStatsMsg(db, ar) {
  const emps = db.hr_employees || [];
  const leaves = db.hr_leave_balances || [];
  
  let alver = 0, alvertek = 0, male = 0, female = 0, cdi = 0, cdd = 0;
  let totalAge = 0, ageCount = 0;
  
  emps.forEach(e => {
    if (String(e.companyId || '').toLowerCase().includes('tek')) alvertek++; else alver++;
    if (String(e.gender || '').toUpperCase() === 'M') male++; else female++;
    const ct = String(e.contractType || '').toLowerCase();
    if (ct.includes('tit') || ct === 'cdi') cdi++; else cdd++;
    
    if (e.birthDate) {
      const parts = e.birthDate.split(/[-/]/);
      let year = null;
      if (parts.length === 3) { year = parts[2].length === 4 ? parseInt(parts[2]) : parseInt(parts[0]); }
      else if (parts.length === 1 && parts[0].length === 4) { year = parseInt(parts[0]); }
      if (year && year > 1900 && year <= new Date().getFullYear()) {
        totalAge += (new Date().getFullYear() - year);
        ageCount++;
      }
    }
  });
  
  const avgAge = ageCount > 0 ? Math.round(totalAge / ageCount) : 0;
  
  let totalLeaveDays = 0;
  leaves.forEach(l => {
    const r = parseFloat(l.remainingDays);
    if (!isNaN(r)) totalLeaveDays += r;
  });

  return ar
    ? `📊 <b>إحصائيات الإدارة العليا | ALVER & ALVERTEK</b>\n━━━━━━━━━━━━━━\n🏢 ALVER: <b>${alver}</b> 🟢\n🏢 ALVERTEK: <b>${alvertek}</b> 🔵\n━━━━━━━━━━━━━━\n👥 إجمالي العمال: <b>${emps.length}</b>\n👦 رجال: <b>${male}</b> | 👧 نساء: <b>${female}</b>\n📜 العقود الدائمة (CDI/Titulaire): <b>${cdi}</b>\n⏱️ العقود المؤقتة (CDD): <b>${cdd}</b>\n━━━━━━━━━━━━━━\n🎂 متوسط العمر: <b>${avgAge} سنة</b>\n🏖️ إجمالي العطل المتبقية: <b>${totalLeaveDays} يوم</b>\n━━━━━━━━━━━━━━`
    : `📊 <b>STATS DIRECTION GÉNÉRALE | ALVER & ALVERTEK</b>\n━━━━━━━━━━━━━━\n🏢 ALVER: <b>${alver}</b> 🟢\n🏢 ALVERTEK: <b>${alvertek}</b> 🔵\n━━━━━━━━━━━━━━\n👥 Effectif Total: <b>${emps.length}</b>\n👦 Hommes: <b>${male}</b> | 👧 Femmes: <b>${female}</b>\n📜 Contrats CDI/Titulaire: <b>${cdi}</b>\n⏱️ Contrats CDD: <b>${cdd}</b>\n━━━━━━━━━━━━━━\n🎂 Moyenne d'âge: <b>${avgAge} ans</b>\n🏖️ Total Congés Restants: <b>${totalLeaveDays} jours</b>\n━━━━━━━━━━━━━━`;
}

function showMenu(chatId, user, ar) {
  const role = String(user.role).toLowerCase();
  if (role === 'general_manager') {
    const db = loadDB();
    const kbd = { inline_keyboard: [
      [{ text: ar ? '🔄 تحديث الإحصائيات' : '🔄 Actualiser', callback_data: 'stats' }],
      [{ text: ar ? '🌐 تغيير اللغة' : '🌐 Changer Langue', callback_data: 'choose_lang' }]
    ]};
    return send(chatId, getStatsMsg(db, ar), kbd);
  }

  const isHighMgmt = ['admin'].includes(role);
  const isMgmt = ['admin', 'manager'].includes(role);
  let kbd = { inline_keyboard: [] };
  if (isHighMgmt) kbd.inline_keyboard.push([{ text: ar ? '📊 إحصائيات ALVER & ALVERTEK' : '📊 Stats ALVER & ALVERTEK', callback_data: 'stats' }]);
  if (isMgmt) kbd.inline_keyboard.push([{ text: ar ? '🔍 البحث السريع عن الموظفين' : '🔍 Recherche Rapide', callback_data: 'search' }]);
  kbd.inline_keyboard.push([{ text: ar ? '👤 ملفي الشخصي' : '👤 Mon Profil', callback_data: 'my_profile' }]);
  kbd.inline_keyboard.push([{ text: ar ? '🌐 تغيير اللغة' : '🌐 Changer Langue', callback_data: 'choose_lang' }]);
  return send(chatId, ar
    ? `💎 <b>أهلاً بك في نظام الإدارة العليا</b>\n━━━━━━━━━━━━━━\n👤 المستخدم: <b>${user.name}</b>\n🛡️ الرتبة: <code>${String(user.role).toUpperCase()}</code>\n━━━━━━━━━━━━━━`
    : `💎 <b>DASHBOARD DIRECTION GÉNÉRALE</b>\n━━━━━━━━━━━━━━\n👤 Utilisateur: <b>${user.name}</b>\n🛡️ Rôle: <code>${String(user.role).toUpperCase()}</code>\n━━━━━━━━━━━━━━`, kbd);
}

function showEmployeeCard(chatId, emp, ar) {
  const msg = ar
    ? `👤 <b>الملف الشامل للموظف</b>\n━━━━━━━━━━━━━━\n👤 الاسم: <b>${T(emp.lastName_ar)} ${T(emp.firstName_ar)}</b>\n🆔 الرمز: <code>${emp.clockingId}</code>\n💼 الوظيفة: <i>${T(emp.jobTitle_ar)}</i>\n🏢 الشركة: <b>${T(emp.companyId).toUpperCase()}</b>\n🏢 القسم: ${T(emp.department_ar)}\n📅 تاريخ البداية: ${T(emp.startDate)}\n📜 نوع العقد: ${T(emp.contractType)}\n━━━━━━━━━━━━━━`
    : `👤 <b>DOSSIER COMPLET</b>\n━━━━━━━━━━━━━━\n👤 Nom: <b>${T(emp.lastName_fr)} ${T(emp.firstName_fr)}</b>\n🆔 ID: <code>${emp.clockingId}</code>\n💼 Poste: <i>${T(emp.jobTitle_fr)}</i>\n🏢 Société: <b>${T(emp.companyId).toUpperCase()}</b>\n🏢 Dept: ${T(emp.department_fr)}\n📅 Début: ${T(emp.startDate)}\n📜 Contrat: ${T(emp.contractType)}\n━━━━━━━━━━━━━━`;
  const kbd = { inline_keyboard: [
    [{ text: ar ? '📄 الملف الكامل' : '📄 Fiche Complète', callback_data: 'full:' + emp.id }],
    [{ text: ar ? '📜 العقود' : '📜 Contrats', callback_data: 'docs:' + emp.id }, { text: ar ? '🏖️ العطل' : '🏖️ Congés', callback_data: 'leave:' + emp.id }],
    [{ text: ar ? '🚨 الغيابات' : '🚨 Absences', callback_data: 'abs:' + emp.id }, { text: ar ? '🗳️ الاستبيان' : '🗳️ Sondage', callback_data: 'survey:' + emp.id }],
    [{ text: ar ? '📄 طلب وثيقة' : '📄 Demander Document', callback_data: 'reqmenu:' + emp.id }],
    [{ text: ar ? '🔍 بحث جديد' : '🔍 Nouvelle Recherche', callback_data: 'search' }]
  ]};
  return send(chatId, msg, kbd);
}

// ─────── HANDLER ───────

async function handle(u) {
  const cbq = u.callback_query, msg = u.message || cbq?.message, from = u.message?.from || cbq?.from;
  if (!msg || !from) return;
  const chatId = msg.chat.id, fromId = String(from.id), cfg = loadConfig();
  const user = cfg.authorized_users?.find(u => {
    const adId = String(u.id || '').replace('@', '').toLowerCase().trim();
    return adId === fromId || (from.username && adId === from.username.toLowerCase());
  });
  if (!user) return;
  const ar = (langs.get(chatId) || 'ar') === 'ar';

  if (cbq) {
    await tg('answerCallbackQuery', { callback_query_id: cbq.id });
    const d = cbq.data;

    if (d.startsWith('lang:')) {
      const lang = d.split(':')[1]; langs.set(chatId, lang);
      const role = String(user.role).toLowerCase();
      if (role === 'general_manager') {
        return showMenu(chatId, user, lang === 'ar');
      }
      states.set(chatId, { step: 'search' });
      return send(chatId, lang === 'ar'
        ? '✅ تم ضبط اللغة.\n\n🔍 اكتب الآن <b>رقم الموظف</b> وسأعرض لك ملفه الشامل :'
        : '✅ Langue configurée.\n\n🔍 Entrez le <b>numéro d\'employé</b> :');
    }
    if (d === 'choose_lang') return send(chatId, '🌐', { inline_keyboard: [[{ text: 'العربية 🇩🇿', callback_data: 'lang:ar' }, { text: 'Français 🇫🇷', callback_data: 'lang:fr' }]] });
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
        ? `📄 <b>التفاصيل الكاملة:</b>\n━━━━━━━━━━━━━━\n👤 ${T(emp.lastName_ar)} ${T(emp.firstName_ar)}\n🎂 الميلاد: ${T(emp.birthDate)}\n📍 مكان الميلاد: ${T(emp.birthPlace_ar)}\n🏠 العنوان: ${T(emp.address_ar)}\n📞 الهاتف: ${T(emp.phone)}\n🏢 القسم: ${T(emp.department_ar)}\n🏢 المديرية: ${T(emp.direction_ar)}\n📅 البداية: ${T(emp.startDate)}\n📜 العقد: ${T(emp.contractType)}\n🔚 نهاية العقد: ${T(emp.contractEndDate)}\n🎓 المستوى: ${T(emp.studyLevel_ar)}`
        : `📄 <b>FICHE DÉTAILLÉE:</b>\n━━━━━━━━━━━━━━\n👤 ${T(emp.lastName_fr)} ${T(emp.firstName_fr)}\n🎂 Naissance: ${T(emp.birthDate)}\n📍 Lieu: ${T(emp.birthPlace_fr)}\n🏠 Adresse: ${T(emp.address_fr)}\n📞 Tél: ${T(emp.phone)}\n🏢 Dept: ${T(emp.department_fr)}\n🏢 Direction: ${T(emp.direction_fr)}\n📅 Début: ${T(emp.startDate)}\n📜 Contrat: ${T(emp.contractType)}\n🔚 Fin: ${T(emp.contractEndDate)}\n🎓 Niveau: ${T(emp.studyLevel_fr)}`);
    }

    if (d.startsWith('leave:')) {
      const empId = d.split(':')[1];
      const bals = (db.hr_leave_balances || []).filter(b => String(b.employeeId) === empId);
      if (bals.length === 0) return send(chatId, ar ? '🏖️ لا يوجد رصيد عطل مسجل.' : '🏖️ Aucun solde de congé.');
      let msg = ar ? '🏖️ <b>رصيد العطل السنوي:</b>\n━━━━━━━━━━━━━━\n' : '🏖️ <b>SOLDE CONGÉS:</b>\n━━━━━━━━━━━━━━\n';
      for (const b of bals) msg += `📅 ${b.exercice}: ✅ ${b.remainingDays}/${b.totalDays} ${ar ? 'يوم' : 'jours'}\n`;
      return send(chatId, msg);
    }

    if (d.startsWith('docs:')) {
      const emp = db.hr_employees?.find(e => String(e.id) === d.split(':')[1]);
      if (!emp) return;
      return send(chatId, ar
        ? `📜 <b>معلومات العقد:</b>\n━━━━━━━━━━━━━━\n📜 النوع: <b>${T(emp.contractType)}</b>\n📅 البداية: ${T(emp.startDate)}\n🔚 النهاية: ${T(emp.contractEndDate)}\n🏢 الشركة: ${T(emp.companyId).toUpperCase()}\n💼 CSP: ${T(emp.csp)}`
        : `📜 <b>INFOS CONTRAT:</b>\n━━━━━━━━━━━━━━\n📜 Type: <b>${T(emp.contractType)}</b>\n📅 Début: ${T(emp.startDate)}\n🔚 Fin: ${T(emp.contractEndDate)}\n🏢 Société: ${T(emp.companyId).toUpperCase()}\n💼 CSP: ${T(emp.csp)}`);
    }

    // ── Absences Menu ──
    if (d.startsWith('abs:') && !d.startsWith('abs_type:')) {
      const empId = d.split(':')[1];
      const kbd = { inline_keyboard: [
        [{ text: ar ? '✅ غياب مبرر' : '✅ Absence Justifiée', callback_data: 'abs_type:justified:' + empId }],
        [{ text: ar ? '❌ غياب غير مبرر' : '❌ Absence Non Justifiée', callback_data: 'abs_type:unjustified:' + empId }],
        [{ text: ar ? '🔙 رجوع' : '🔙 Retour', callback_data: 'back:' + empId }]
      ]};
      return send(chatId, ar ? '🚨 <b>الإعلام عن غياب:</b>\n━━━━━━━━━━━━━━\nاختر نوع الغياب:' : '🚨 <b>Déclarer une Absence:</b>\n━━━━━━━━━━━━━━\nType d\'absence:', kbd);
    }

    if (d.startsWith('abs_type:')) {
      const parts = d.split(':');
      const absType = parts[1], empId = parts[2];
      const typeName = absType === 'justified' ? (ar ? 'مبرر' : 'Justifiée') : (ar ? 'غير مبرر' : 'Non Justifiée');
      states.set(chatId, { step: 'abs_date', absType, empId, typeName });
      return send(chatId, ar
        ? `🚨 نوع الغياب: <b>${typeName}</b>\n\n📅 <b>اكتب الآن يوم الغياب</b> (مثلاً: 2026-04-28):`
        : `🚨 Type: <b>${typeName}</b>\n\n📅 <b>Écrivez la date d'absence</b> (ex: 2026-04-28):`);
    }

    // ── Survey / Report Menu ──
    if (d.startsWith('survey:') && !d.startsWith('survey_r:')) {
      const empId = d.split(':')[1];
      const kbd = { inline_keyboard: [
        [{ text: ar ? '❌ غياب غير مبرر' : '❌ Absence Non Justifiée', callback_data: 'survey_r:abs_nj:' + empId }],
        [{ text: ar ? '⚔️ مشاجرة' : '⚔️ Bagarre / Altercation', callback_data: 'survey_r:fight:' + empId }],
        [{ text: ar ? '⏰ تأخر عن العمل' : '⏰ Retard au Travail', callback_data: 'survey_r:late:' + empId }],
        [{ text: ar ? '🚪 مغادرة بدون إذن' : '🚪 Départ sans Autorisation', callback_data: 'survey_r:leave_noauth:' + empId }],
        [{ text: ar ? '🚫 رفض العمل' : '🚫 Refus de Travail', callback_data: 'survey_r:refusal:' + empId }],
        [{ text: ar ? '⚠️ سلوك غير مهني' : '⚠️ Comportement Non Professionnel', callback_data: 'survey_r:behavior:' + empId }],
        [{ text: ar ? '📝 سبب آخر' : '📝 Autre Motif', callback_data: 'survey_r:other:' + empId }],
        [{ text: ar ? '🔙 رجوع' : '🔙 Retour', callback_data: 'back:' + empId }]
      ]};
      return send(chatId, ar ? '🗳️ <b>الإعلام عن مخالفة:</b>\n━━━━━━━━━━━━━━\nاختر السبب:' : '🗳️ <b>Déclaration d\'Incident:</b>\n━━━━━━━━━━━━━━\nMotif:', kbd);
    }

    if (d.startsWith('survey_r:')) {
      const parts = d.split(':');
      const reasonId = parts[1], empId = parts[2];
      const reasons = { abs_nj: ar?'غياب غير مبرر':'Absence Non Justifiée', fight: ar?'مشاجرة':'Bagarre', late: ar?'تأخر عن العمل':'Retard', leave_noauth: ar?'مغادرة بدون إذن':'Départ sans Autorisation', refusal: ar?'رفض العمل':'Refus de Travail', behavior: ar?'سلوك غير مهني':'Comportement Non Pro', other: ar?'سبب آخر':'Autre' };
      states.set(chatId, { step: 'survey_detail', reasonId, empId, reasonName: reasons[reasonId] || reasonId });
      return send(chatId, ar
        ? `🗳️ السبب: <b>${reasons[reasonId]}</b>\n\n✍️ <b>اكتب التفاصيل</b> (التاريخ والملاحظات):`
        : `🗳️ Motif: <b>${reasons[reasonId]}</b>\n\n✍️ <b>Écrivez les détails</b> (date et remarques):`);
    }

    // ── Document Request Menu ──
    if (d.startsWith('reqmenu:')) {
      const empId = d.split(':')[1];
      const rows = [
        [{ text: ar ? '💰 كشف الرواتب' : '💰 Relevé des Émoluments', callback_data: 'rdoc:releve_emol:' + empId }],
        [{ text: ar ? '📋 شهادة العمل' : '📋 Attestation de Travail', callback_data: 'rdoc:att_travail:' + empId }],
        [{ text: ar ? '💳 تفعيل بطاقة الشفاء' : '💳 Activation Carte Chifa', callback_data: 'rdoc:carte_chifa:' + empId }],
        [{ text: ar ? '🚨 تصريح حادث عمل' : '🚨 Déclaration Accident de Travail', callback_data: 'rdoc:accident:' + empId }],
        [{ text: ar ? '📄 كشف الراتب' : '📄 Fiche de Paie', callback_data: 'rdoc:fiche_paie:' + empId }],
        [{ text: ar ? '🔙 رجوع' : '🔙 Retour', callback_data: 'back:' + empId }]
      ];
      return send(chatId, ar ? '📄 <b>اختر الوثيقة المطلوبة:</b>' : '📄 <b>Choisissez le document :</b>', { inline_keyboard: rows });
    }

    // ── Document selected → ask reason or show menu ──
    if (d.startsWith('rdoc:')) {
      const parts = d.split(':');
      const docId = parts[1], empId = parts[2];
      const doc = DOC_TYPES.find(dt => dt.id === docId);
      if (!doc) return;

      if (docId === 'att_travail' || docId === 'releve_emol') {
        const rows = [];
        for (let i = 0; i < DOSSIER_REASONS.length; i += 2) {
          const row = [{ text: ar ? DOSSIER_REASONS[i].ar : DOSSIER_REASONS[i].fr, callback_data: `drsn:${docId}:${DOSSIER_REASONS[i].id}:${empId}` }];
          if (DOSSIER_REASONS[i + 1]) row.push({ text: ar ? DOSSIER_REASONS[i + 1].ar : DOSSIER_REASONS[i + 1].fr, callback_data: `drsn:${docId}:${DOSSIER_REASONS[i + 1].id}:${empId}` });
          rows.push(row);
        }
        rows.push([{ text: ar ? '🔙 رجوع' : '🔙 Retour', callback_data: 'reqmenu:' + empId }]);
        return send(chatId, ar ? `📄 اختر سبب طلب <b>${doc.ar}</b>:` : `📄 Motif pour <b>${doc.fr}</b> :`, { inline_keyboard: rows });
      }

      states.set(chatId, { step: 'doc_reason', docId, empId, docName: ar ? doc?.ar : doc?.fr });
      return send(chatId, ar
        ? `📄 لقد اخترت: <b>${doc?.ar}</b>\n\n✍️ <b>اكتب ملاحظة أو تأكيد الطلب:</b>`
        : `📄 Vous avez choisi: <b>${doc?.fr}</b>\n\n✍️ <b>Écrivez une remarque pour confirmer:</b>`);
    }

    // ── Document Reason Selected from Menu ──
    if (d.startsWith('drsn:')) {
      const parts = d.split(':');
      const docId = parts[1], rsnId = parts[2], empId = parts[3];
      const doc = DOC_TYPES.find(dt => dt.id === docId);
      const rsn = DOSSIER_REASONS.find(r => r.id === rsnId);
      const docName = doc ? (ar ? doc.ar : doc.fr) : 'Document';
      const rsnName = rsn ? (ar ? rsn.ar : rsn.fr) : 'Autre';

      const emp = db.hr_employees?.find(e => String(e.id) === empId);
      const empName = emp ? `${emp.lastName_fr} ${emp.firstName_fr} (${emp.clockingId})` : empId;
      const role = String(user.role).toLowerCase();
      const isManager = role === 'manager';

      await notifyStaff(`📄 <b>طلب وثيقة جديد</b>\n━━━━━━━━━━━━━━\n👤 الموظف: ${empName}\n📄 الوثيقة: <b>${docName}</b>\n✍️ السبب: ${rsnName}\n👤 من طرف: ${user.name}`, cfg);
      
      return send(chatId, isManager
        ? (ar ? `✅ تم إرسال طلبك.\n📄 ${docName}\n✍️ السبب: ${rsnName}\n⏳ <b>سوف يُدرس طلبك من طرف الإدارة.</b>` : `✅ Demande envoyée.\n📄 ${docName}\n✍️ Motif: ${rsnName}\n⏳ <b>Votre demande sera étudiée par l'administration.</b>`)
        : (ar ? `✅ <b>تم إرسال الطلب!</b>\n📄 ${docName}\n✍️ ${rsnName}` : `✅ <b>Demande envoyée!</b>\n📄 ${docName}\n✍️ ${rsnName}`));
    }

    // ── Back to employee card ──
    if (d.startsWith('back:')) {
      const emp = db.hr_employees?.find(e => String(e.id) === d.split(':')[1]);
      if (emp) return showEmployeeCard(chatId, emp, ar);
    }

    // ── Stats ──
    if (d === 'stats') {
      const db = loadDB();
      return send(chatId, getStatsMsg(db, ar), { inline_keyboard: [
        [{ text: ar ? '🔄 تحديث' : '🔄 Actualiser', callback_data: 'stats' }]
      ]});
    }
    return;
  }

  // ── Text messages ──
  const txt = (msg.text || '').trim(), txtLow = txt.toLowerCase();

  if (txtLow === '/start' || txtLow === '/m') {
    return send(chatId, '🌐 <b>الرجاء اختيار اللغة / Choisissez la langue</b>', { inline_keyboard: [[{ text: 'العربية 🇩🇿', callback_data: 'lang:ar' }, { text: 'Français 🇫🇷', callback_data: 'lang:fr' }]] });
  }

  if (txtLow === '/me') {
    const db = loadDB();
    return send(chatId, `🛠️ <b>System:</b>\n🆔 ID: <code>${fromId}</code>\n👤 ${user.name}\n🛡️ ${user.role}\n👥 DB: <b>${db.hr_employees?.length || 0}</b>`);
  }

  // ── Text input handlers ──
  const st = states.get(chatId);
  if (st && txt && !txt.startsWith('/')) {
    states.delete(chatId);
    const db = loadDB();
    const emp = db.hr_employees?.find(e => String(e.id) === st.empId);
    const empName = emp ? `${emp.lastName_fr} ${emp.firstName_fr} (${emp.clockingId})` : st.empId;
    const role = String(user.role).toLowerCase();
    const isManager = role === 'manager';

    // ── Document reason ──
    if (st.step === 'doc_reason') {
      await notifyStaff(`📄 <b>طلب وثيقة جديد</b>\n━━━━━━━━━━━━━━\n👤 الموظف: ${empName}\n📄 الوثيقة: <b>${st.docName}</b>\n✍️ السبب: ${txt}\n👤 من طرف: ${user.name}`, cfg);
      return send(chatId, isManager
        ? (ar ? `✅ تم إرسال طلبك.\n📄 ${st.docName}\n⏳ <b>سوف يُدرس طلبك من طرف الإدارة.</b>` : `✅ Demande envoyée.\n📄 ${st.docName}\n⏳ <b>Votre demande sera étudiée par l'administration.</b>`)
        : (ar ? `✅ <b>تم إرسال الطلب!</b>\n📄 ${st.docName}\n✍️ ${txt}` : `✅ <b>Demande envoyée!</b>\n📄 ${st.docName}\n✍️ ${txt}`));
    }

    // ── Absence date ──
    if (st.step === 'abs_date') {
      await notifyStaff(`🚨 <b>إعلام عن غياب</b>\n━━━━━━━━━━━━━━\n👤 الموظف: ${empName}\n📊 النوع: <b>${st.typeName}</b>\n📅 التاريخ: ${txt}\n👤 من طرف: ${user.name}`, cfg);
      return send(chatId, isManager
        ? (ar ? `✅ تم تسجيل الغياب.\n📊 ${st.typeName} | 📅 ${txt}\n⏳ <b>سوف يُدرس طلبك من طرف الإدارة.</b>` : `✅ Absence enregistrée.\n📊 ${st.typeName} | 📅 ${txt}\n⏳ <b>Votre demande sera étudiée par l'administration.</b>`)
        : (ar ? `✅ <b>تم تسجيل الغياب!</b>\n📊 ${st.typeName} | 📅 ${txt}` : `✅ <b>Absence enregistrée!</b>\n📊 ${st.typeName} | 📅 ${txt}`));
    }

    // ── Survey detail ──
    if (st.step === 'survey_detail') {
      await notifyStaff(`🗳️ <b>إعلام عن مخالفة</b>\n━━━━━━━━━━━━━━\n👤 الموظف: ${empName}\n📊 السبب: <b>${st.reasonName}</b>\n✍️ التفاصيل: ${txt}\n👤 من طرف: ${user.name}`, cfg);
      return send(chatId, isManager
        ? (ar ? `✅ تم إرسال البلاغ.\n📊 ${st.reasonName}\n⏳ <b>سوف يُدرس طلبك من طرف الإدارة.</b>` : `✅ Rapport envoyé.\n📊 ${st.reasonName}\n⏳ <b>Votre demande sera étudiée par l'administration.</b>`)
        : (ar ? `✅ <b>تم إرسال البلاغ!</b>\n📊 ${st.reasonName}\n✍️ ${txt}` : `✅ <b>Rapport envoyé!</b>\n📊 ${st.reasonName}\n✍️ ${txt}`));
    }
  }

  // ── Search: any non-command text ──
  if (txt && !txt.startsWith('/')) {
    const role = String(user.role).toLowerCase();
    if (role === 'general_manager') return; // GM cannot search

    const db = loadDB(), q = txtLow.trim();
    const results = (db.hr_employees || []).filter(e => {
      const cid = String(e.clockingId || '').toLowerCase().trim();
      const lnf = String(e.lastName_fr || '').toLowerCase();
      const fnf = String(e.firstName_fr || '').toLowerCase();
      const lna = String(e.lastName_ar || '');
      return cid === q || cid.includes(q) || lnf.includes(q) || fnf.includes(q) || lna.includes(q);
    }).slice(0, 5);

    if (results.length === 0) return send(chatId, ar ? `❌ لا يوجد موظف بهذا الرقم: <b>${txt}</b>\n\n🔍 حاول مجدداً:` : `❌ Aucun employé trouvé: <b>${txt}</b>\n\n🔍 Réessayez:`);
    for (const emp of results) await showEmployeeCard(chatId, emp, ar);
  }
}

// ─────── ROUTES ───────

app.post('/api/webhook', (req, res) => {
  try { handle(JSON.parse(req.rawBody.toString('utf8'))).catch(e => log('Err: ' + e.message)); } catch (e) {}
  res.sendStatus(200);
});

app.post('/api/config', (req, res) => {
  try {
    let data = req.rawBody;
    if (data[0] === 0x1f && data[1] === 0x8b) data = zlib.gunzipSync(data);
    fs.writeFileSync(CONFIG_PATH, data);
    log('Config updated: ' + data.length + ' bytes');
    res.sendStatus(200);
  } catch (e) { res.status(500).send(e.message); }
});

app.post('/api/database', (req, res) => {
  try {
    let data = req.rawBody;
    if (data[0] === 0x1f && data[1] === 0x8b) data = zlib.gunzipSync(data);
    fs.writeFileSync(DB_PATH, data);
    const db = JSON.parse(data.toString('utf8'));
    log(`DB updated: ${db.hr_employees?.length || 0} employees`);
    res.sendStatus(200);
  } catch (e) { res.status(500).send(e.message); }
});

app.get('/', (req, res) => {
  const db = loadDB();
  res.send(`TewfikSoft HR Bot v7.4 | ${db.hr_employees?.length || 0} employees`);
});

const port = process.env.PORT || 10000;
app.listen(port, () => {
  log(`=== TewfikSoft HR Bot v7.4 on port ${port} ===`);
  tg('setWebhook', { url: 'https://tewfiksoft-hr-bot.onrender.com/api/webhook' });
});
