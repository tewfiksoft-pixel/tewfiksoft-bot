import express from 'express';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import os from 'os';
import { fileURLToPath } from 'url';

import { tg, send, notifyStaff, answerCallbackQuery } from './utils/telegram.js';
import { loadDB, saveDB, loadConfig, T, log } from './utils/database.js';
import { generateExitAuthPDF, generateEntryAuthPDF, generateMissionPDF, generateReturnAuthPDF, generateWorkCertPDF, generateBonVentePDF } from './utils/pdf.js';
import { sendEmail } from './utils/email.js';
import crypto from 'crypto';
import { getStatsMsg, getEffectifsDirMsg, getEffectifsCompanyMsg, calculateAutoLeave } from './utils/ui.js';
import { convertAmountToWords } from './utils/cheque.js';
import { DOC_TYPES, DOSSIER_REASONS, WILAYAS } from './utils/constants.js';
import RoleFactory from './roles/RoleFactory.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const DB_PATH = path.join(DATA_DIR, 'database.json');

const updateConfig = (cfg) => {
  const cleanCfg = JSON.parse(JSON.stringify(cfg));
  if (cleanCfg.authorized_users) {
    for (const u of cleanCfg.authorized_users) {
      if (u._originalRole) {
        u.role = u._originalRole;
        delete u._originalRole;
      }
      delete u._testRole;
    }
  }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cleanCfg, null, 2));
  
  // Persist authorized users in DB so it uploads to Google Drive
  try {
    const db = loadDB();
    db.authorized_users = cleanCfg.authorized_users;
    saveDB(db);
  } catch (e) {
    console.error("Failed to save authorized_users to DB", e);
  }
};

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });


const langs = new Map();
const LANGS_PATH = path.join(DATA_DIR, 'langs.json');
const loadLangs = () => {
  try {
    if (fs.existsSync(LANGS_PATH)) {
      const data = JSON.parse(fs.readFileSync(LANGS_PATH, 'utf8'));
      for (const [k, v] of Object.entries(data)) langs.set(Number(k), v);
    }
  } catch (e) {}
};
const saveLangs = () => {
  try {
    const data = Object.fromEntries(langs);
    fs.writeFileSync(LANGS_PATH, JSON.stringify(data));
  } catch (e) {}
};
loadLangs();

export const states = new Map();
export const testRoles = new Map();

const STATES_PATH = path.join(DATA_DIR, 'states.json');
const loadStates = () => {
  try {
    if (fs.existsSync(STATES_PATH)) {
      const data = JSON.parse(fs.readFileSync(STATES_PATH, 'utf8'));
      for (const [k, v] of Object.entries(data)) states.set(Number(k), v);
    }
  } catch (e) { log(`[States] Load error: ${e.message}`); }
};
const saveStates = () => {
  try {
    const data = Object.fromEntries(states);
    fs.writeFileSync(STATES_PATH, JSON.stringify(data));
  } catch (e) { log(`[States] Save error: ${e.message}`); }
};
const CLIENTS_PATH = path.join(DATA_DIR, 'clients.json');
const loadClients = () => {
  try {
    if (fs.existsSync(CLIENTS_PATH)) return JSON.parse(fs.readFileSync(CLIENTS_PATH, 'utf8'));
  } catch (e) {}
  return [];
};

const ARTICLES_PATH = path.join(DATA_DIR, 'articles.json');
const loadArticles = () => {
  try {
    if (fs.existsSync(ARTICLES_PATH)) return JSON.parse(fs.readFileSync(ARTICLES_PATH, 'utf8'));
  } catch (e) {}
  return [];
};

async function notifyBVARole(txt, role, cfg, kbd) {
  // Notify users with the specific role as well as admins so they can process it directly
  const users = cfg.authorized_users?.filter(u => u.role === role || u.role === 'admin' || u.role === 'general_manager') || [];
  const seenIds = new Set();
  for (const u of users) {
    if (u.id && !seenIds.has(u.id)) {
      seenIds.add(u.id);
      let userTxt = txt;
      if (u.role === 'admin' || u.role === 'general_manager') {
        userTxt = `👑 <b>[نسخة للإدارة - يمكنك إكمال الإجراء مباشرة بدلاً من الموظف]</b>\n\n${txt}`;
      }
      await send(Number(u.id), userTxt, kbd);
    }
  }
}

// ── Helper: generate Work Certificate PDF and dispatch by email ──────────────
async function generateAndSendWorkCert(req, cfg, db) {
  const emp = (db.hr_employees || []).find(e => String(e.id) === String(req.empId));
  if (!emp) throw new Error(`Employee not found: ${req.empId}`);

  const isFartak = String(emp.companyId || '').toLowerCase() === 'vt' ||
                   String(emp.companyId || '').toLowerCase() === 'verre_tech' ||
                   String(emp.companyName || '').toLowerCase().includes('fartak') ||
                   String(emp.companyName || '').toLowerCase().includes('verre tech');

  const companyName = isFartak ? 'Verre Tech Spa' : 'ALVER Spa';
  const companyId   = isFartak ? 'vt' : 'alv';

  const pdfPath = path.join(os.tmpdir(), `cert_${req.id}.pdf`);

  await generateWorkCertPDF({
    id: req.id,
    reason: req.reason,
    approvedBy: req.approvedBy,
    companyName,
    companyId,
    emp
  }, pdfPath);

  // Build recipient list: HR emails + requester email (if present)
  const s = cfg.email_settings || {};
  const hrEmails = s.hr_notification_email
    ? s.hr_notification_email.split(',').map(e => e.trim()).filter(Boolean)
    : [];
  const requesterUser = (cfg.authorized_users || []).find(u => String(u.id) === String(req.requesterId));
  if (requesterUser?.email) hrEmails.push(requesterUser.email);
  const recipients = [...new Set(hrEmails)];

  if (recipients.length > 0) {
    const subject = `Attestation de Travail - ${emp.lastName_fr} ${emp.firstName_fr} - ${new Date().toLocaleDateString('fr-FR')}`;
    const body = `Bonjour,\n\nVeuillez trouver ci-joint l'Attestation de Travail pour ${emp.lastName_fr} ${emp.firstName_fr} (Matricule: ${emp.clockingId}).\n\nMotif: ${req.reason}\nApprouvé par: ${req.approvedBy}\nDate: ${new Date().toLocaleDateString('fr-FR')}\n\nCordialement,\nTewfikSoft HR Bot`;
    await sendEmail(recipients, subject, body, [{ filename: 'Attestation_de_Travail.pdf', path: pdfPath }]);
  }

  // Cleanup temp PDF
  try { fs.unlinkSync(pdfPath); } catch (_) {}
}

function isEmployeeAllowed(userData, emp) {
  const role = String(userData.role || '').toLowerCase();
  if (role === 'admin') return true;
  
  const allowedEmps = (userData.allowed_employees || []).map(id => String(id));
  if (allowedEmps.includes(String(emp.clockingId))) return true;

  if (userData.scope === 'department') {
    const depts = (userData.allowed_departments || []).map(d => String(d).toLowerCase().trim());
    return depts.some(d => String(emp.department_fr || '').toLowerCase().includes(d) || String(emp.direction_fr || '').toLowerCase().includes(d));
  } else if (userData.scope === 'company') {
    return String(emp.companyId).toLowerCase() === String(userData.allowed_company).toLowerCase();
  }
  
  return false;
}

export async function handle(u) {
  log(`[Update] Received: ${JSON.stringify(u).substring(0, 200)}...`);
  const cbq = u.callback_query, msg = u.message || cbq?.message, from = u.message?.from || cbq?.from;
  if (!msg || !from) return;
  const chatId = Number(msg.chat.id), fromId = String(from.id), cfg = loadConfig(), db = loadDB();
  const txt = (msg.text || '').trim(), txtLow = txt.toLowerCase();

  const userData = cfg.authorized_users?.find(u => {
    const adId = String(u.id || '').replace('@', '').toLowerCase().trim();
    return adId === fromId || (from.username && adId === from.username.toLowerCase());
  });

  const detectedLang = langs.get(chatId) || userData?.lang || 'ar';
  const ar = detectedLang === 'ar';
  log(`[Lang-Debug] ChatId: ${chatId} | Detected: ${detectedLang} | Source: ${langs.has(chatId) ? 'Map' : 'Config'}`);

  // Public /id and /me command to help user find their Telegram ID
  if (txtLow === '/id' || (txtLow === '/me' && !userData)) {
    const idMsg = ar 
      ? `🆔 معرفك هو: <code>${fromId}</code>\n\n⚠️ <b>هذا الحساب غير مفعل حالياً.</b>\nيرجى تصوير هذه الشاشة أو إرسال المعرف للمسؤول لتفعيل وصولك للبوت.`
      : `🆔 Votre ID est: <code>${fromId}</code>\n\n⚠️ <b>Ce compte n'est pas activé.</b>\nVeuillez envoyer cet ID à l'administrateur pour activer votre accès.`;
    await send(chatId, idMsg, { parse_mode: 'HTML' });
    log(`[Bot] Public ID request from ${fromId} (${from.username || 'no-user'})`);
    return;
  }

  if (!userData) {
    log(`[Bot] Unauthorized access attempt: ${fromId} (${from.username || 'no-user'})`);
    return;
  }

  // Update user activity timestamp
  try {
    if (!db.user_activity) db.user_activity = {};
    db.user_activity[fromId] = new Date().toISOString();
    saveDB(db);
  } catch (e) {
    log(`[ActivityLog-Error] ${e.message}`);
  }



  // --- DB Recovery & Test Role Logic ---
  // Fix DB if left corrupted by previous versions
  if (userData._originalRole === 'admin') {
    const dbase = loadDB();
    if (dbase.users[fromId]) {
      dbase.users[fromId].role = 'admin';
      delete dbase.users[fromId]._originalRole;
      saveDB(dbase);
    }
    userData.role = 'admin';
    delete userData._originalRole;
  }

  if (txtLow === '/exit_test' || txtLow === 'exit_test') {
    testRoles.delete(chatId);
    states.delete(chatId);
    saveStates();
    await send(chatId, ar ? '✅ <b>تم الخروج من وضع الاختبار ورجعت كمسؤول (Admin).</b>' : '✅ <b>Mode test terminé. Retour au rôle Admin.</b>');
    const freshRoleObj = RoleFactory.create(userData);
    if (freshRoleObj) return freshRoleObj.showMenu(chatId, ar, getStatsMsg);
    return;
  }

  // Always clear any lingering test roles — admin has direct buttons in ventes_menu
  testRoles.delete(chatId);
  const cbqData = cbq?.data || '';

  const roleObj = RoleFactory.create(userData);
  if (!roleObj) return;

  if (cbq) {
    if (cbq.id) await answerCallbackQuery(cbq.id);
    let d = cbq.data;

    if (d.startsWith('lang:')) {
      const selectedLang = d.split(':')[1];
      userData.lang = selectedLang;
      langs.set(chatId, selectedLang);
      saveLangs();
      await updateConfig(cfg);
      const isAr = selectedLang === 'ar';
      return roleObj.showMenu(chatId, isAr, getStatsMsg);
    }

    if (d === 'choose_lang') {
      return send(chatId, '🌐 <b>الرجاء اختيار اللغة / Choisissez la langue</b>', { 
        inline_keyboard: [[
          { text: 'العربية 🇩🇿', callback_data: 'lang:ar' }, 
          { text: 'Français 🇫🇷', callback_data: 'lang:fr' }
        ]] 
      });
    }

    if (d === 'end_work_guide') {
      const guideAr = `📜 <b>دليل نهاية العمل (إجراءات المغادرة)</b>
━━━━━━━━━━━━━━
لضمان إنهاء علاقة العمل بشكل قانوني وسليم، يرجى اتباع الخطوات التالية:

1️⃣ <b>التبليغ الرسمي:</b> تقديم طلب استقالة مكتوب أو استلام إشعار إنهاء العقد (في حالة العقود محددة المدة).
2️⃣ <b>فترة الإشعار:</b> احترام مدة الإشعار المنصوص عليها في العقد (غالباً شهر واحد).
3️⃣ <b>جرد العهدة:</b> تسليم كافة الوسائل الموضوعة تحت تصرف العامل (مفاتيح، حاسوب، ملابس عمل، بطاقة مهنية).
4️⃣ <b>محضر تسليم المهام:</b> إجراء عملية تسليم المهام والملفات للمسؤول المباشر أو الزميل المعين.
5️⃣ <b>تصفية المستحقات:</b> استلام شهادة العمل، كشف الأجر الأخير، ورصيد العطل المتبقي.

⚠️ <i>ملاحظة: الالتزام بهذه الخطوات يحفظ حقوق العامل والشركة ويمنع أي نزاعات قانونية مستقبلية.</i>
━━━━━━━━━━━━━━`;

      const guideFr = `📜 <b>GUIDE DE FIN DE TRAVAIL (PROCÉDURES)</b>
━━━━━━━━━━━━━━
Pour garantir une fin de relation de travail légale et fluide :

1️⃣ <b>Notification :</b> Dépôt d'une démission écrite ou notification de fin de contrat (pour les CDD).
2️⃣ <b>Préavis :</b> Respect du délai de préavis mentionné dans le contrat (généralement 1 mois).
3️⃣ <b>Remise du matériel :</b> Restitution de tous les équipements (clés, PC, badges, outils).
4️⃣ <b>Passation :</b> Effectuer la passation des dossiers et tâches en cours avec le responsable.
5️⃣ <b>Documents de fin :</b> Récupération de l'attestation de travail, solde de tout compte et certificat de travail.

⚠️ <i>Note : Le respect de ces étapes protège les droits de l'employé et de l'entreprise.</i>
━━━━━━━━━━━━━━`;

      return send(chatId, ar ? guideAr : guideFr, { inline_keyboard: [[{ text: ar ? '🏠 القائمة الرئيسية' : '🏠 Menu', callback_data: 'menu' }]] });
    }

    if (d === 'choose_lang') return send(chatId, '🌐', { inline_keyboard: [[{ text: 'العربية 🇩🇿', callback_data: 'lang:ar' }, { text: 'Français 🇫🇷', callback_data: 'lang:fr' }]] });
    
    if (d === 'calc_step_1') {
      states.set(chatId, { step: 'calc_in' });
      return send(chatId, ar 
        ? `🟢 <b>أرسل وقت الدخول الآن</b>\nمثال: <code>08:15</code>` 
        : `🟢 <b>Envoyez l'heure d'entrée</b>\nExemple: <code>08:15</code>`);
    }

    if (d === 'cheque_step') {
      states.set(chatId, { step: 'cheque_amount' });
      return send(chatId, ar 
        ? `📝 <b>تحويل الأرقام إلى حروف (شيك بنكي)</b>\n\n💰 أرسل المبلغ بالأرقام الآن:\nمثال: <code>15000.50</code>` 
        : `📝 <b>Convertir Chiffres en Lettres (Chèque)</b>\n\n💰 Envoyez le montant en chiffres:\nExemple: <code>15000.50</code>`);
    }

    if (d === 'menu') return roleObj.showMenu(chatId, ar, getStatsMsg);

    // test_role: handler removed — Admin has direct access buttons in ventes_menu

    if (d === 'exit_test_mode') {
      // Test mode removed — just show admin menu
      const freshRoleObj = RoleFactory.create(userData);
      await send(chatId, ar ? '✅ <b>أنت مسؤول (Admin) — هنا لوحة التحكم الشاملة.</b>' : '✅ <b>Vous êtes Admin — tableau de bord complet.</b>');
      return freshRoleObj.showMenu(chatId, ar, getStatsMsg);
    }

    // ── Ventes & Bons (BVA) Unified Department Menus ─────────────────────────
    if (d === 'ventes_menu') {
      const role = String(userData.role).toLowerCase();

      if (role === 'admin') {
        // Admin Super Dashboard - direct access without changing roles
        const kbd = { inline_keyboard: [
          [{ text: ar ? '➕ إنشاء إذن بيع وخروج (التجاري)' : '➕ Créer BVA (Commercial)', callback_data: 'bva_create' }],
          [{ text: ar ? '💳 معالجة الفواتير المعلقة (المالية)' : '💳 Traiter Factures (Finance)', callback_data: 'bva_list_pending_finance' }],
          [{ text: ar ? '🚚 معالجة شحنات البضاعة (GDS)' : '🚚 Expédier (GDS)', callback_data: 'bva_list_pending_shipping' }],
          [{ text: ar ? '🚛 تأكيد خروج الشاحنات (الحراسة)' : '🚛 Sortie Camions (Garde)', callback_data: 'bva_list_pending_guard' }],
          [{ text: ar ? '📋 التقارير والأرشيف العام' : '📋 Archives des Bons', callback_data: 'bva_list' }],
          [{ text: ar ? '⚙️ إعداد رقم البداية (BVA N°)' : '⚙️ Régler N° de Départ (BVA)', callback_data: 'bva_set_start_num' }],
          [{ text: ar ? '🔙 العودة للقائمة الرئيسية' : '🔙 Retour Menu Principal', callback_data: 'menu' }]
        ]};
        return send(chatId, ar
          ? `💼 <b>لوحة تحكم الإدارة الشاملة (Admin)</b>\n━━━━━━━━━━━━━━\nبصفتك <b>مديراً للنظام</b>، يمكنك تنفيذ كل مهام المصالح مباشرة وبدون تغيير دورك:`
          : `💼 <b>TABLEAU DE BORD GLOBAL (Admin)</b>\n━━━━━━━━━━━━━━\nEn tant qu'<b>Administrateur</b>, vous avez accès direct à toutes les opérations :`, kbd);
      }

      if (role === 'service_commercial') {
        const kbd = { inline_keyboard: [
          [{ text: ar ? '➕ إنشاء إذن بيع وخروج جديد' : '➕ Créer Bon de Vente & Sortie', callback_data: 'bva_create' }],
          [{ text: ar ? '📋 قائمة أذوناتي الأخيرة' : '📋 Mes Bons Récents', callback_data: 'bva_list' }],
          [{ text: ar ? '⚙️ إعداد رقم البداية (BVA N°)' : '⚙️ Régler N° de Départ (BVA)', callback_data: 'bva_set_start_num' }],
          [{ text: ar ? '🔙 العودة للقائمة الرئيسية' : '🔙 Retour Menu Principal', callback_data: 'menu' }]
        ]};
        return send(chatId, ar
          ? `💼 <b>إدارة المبيعات والطلبيات (التجاري)</b>\n━━━━━━━━━━━━━━\nيرجى اختيار أحد الخيارات لبدء العمل:`
          : `💼 <b>GESTION DES VENTES (Service Commercial)</b>\n━━━━━━━━━━━━━━\nVeuillez choisir une action :`, kbd);
      }

      if (role === 'finance') {
        const kbd = { inline_keyboard: [
          [{ text: ar ? '💳 الفواتير المعلقة بانتظار التأكيد' : '💳 Factures en Attente de Validation', callback_data: 'bva_list_pending_finance' }],
          [{ text: ar ? '📋 أرشيف أذونات البيع' : '📋 Archives des Bons', callback_data: 'bva_list' }],
          [{ text: ar ? '🔙 العودة للقائمة الرئيسية' : '🔙 Retour Menu Principal', callback_data: 'menu' }]
        ]};
        return send(chatId, ar
          ? `💵 <b>إدارة المبيعات والطلبيات (مصلحة المالية)</b>\n━━━━━━━━━━━━━━\nيمكنك استعراض وتأكيد فواتير العملاء ودفعياتهم مع توليد إذن التوجيه التلقائي للمستودع:`
          : `💵 <b>GESTION DES VENTES (Service Finance)</b>\n━━━━━━━━━━━━━━\nValidez les factures clients pour envoyer les ordres de préparation au stock :`, kbd);
      }

      if (role === 'gds') {
        const kbd = { inline_keyboard: [
          [{ text: ar ? '🚚 شحنات جاهزة للتحميل والتعبئة' : '🚚 Expéditions Prêtes à Charger', callback_data: 'bva_list_pending_shipping' }],
          [{ text: ar ? '📋 أرشيف الشحنات المكتملة' : '📋 Archives des Chargements', callback_data: 'bva_list' }],
          [{ text: ar ? '🔙 العودة للقائمة الرئيسية' : '🔙 Retour Menu Principal', callback_data: 'menu' }]
        ]};
        return send(chatId, ar
          ? `📦 <b>إدارة الشحن واللوجستيك (المخازن GDS)</b>\n━━━━━━━━━━━━━━\nيرجى تحديد الشحنة لإدخال تفاصيل السائق، لوحة الشاحنة، ورقم إذن التسليم (BL):`
          : `📦 <b>LOGISTIQUE & EXPÉDITIONS (Stock GDS)</b>\n━━━━━━━━━━━━━━\nSélectionnez une expédition pour saisir les détails du chauffeur et du BL :`, kbd);
      }

      if (role === 'poste_garde') {
        const kbd = { inline_keyboard: [
          [{ text: ar ? '🚛 مراقبة وتأكيد خروج الشاحنات' : '🚛 Contrôle Sortie Camions', callback_data: 'bva_list_pending_guard' }],
          [{ text: ar ? '🔙 العودة للقائمة الرئيسية' : '🔙 Retour Menu Principal', callback_data: 'menu' }]
        ]};
        return send(chatId, ar
          ? `👮 <b>مركز الحراسة (Poste de Garde) - إدارة الشاحنات</b>\n━━━━━━━━━━━━━━\nيرجى تأكيد الخروج الفعلي للشاحنات المحملة عبر البوابة لتوليد وإرسال وثيقة PDF النهائية:`
          : `👮 <b>POSTE DE GARDE - CONTRÔLE DES FLUX CAMIONS</b>\n━━━━━━━━━━━━━━\nValidez la sortie des camions pour générer et archiver l'autorisation finale en PDF :`, kbd);
      }
    }



    if (d === 'search') { 
      const role = String(userData.role).toLowerCase();
      if (role === 'admin' || role === 'manager' || role === 'chef_de_quart') {
        states.set(chatId, { step: 'search' }); 
        return send(chatId, ar ? '🔍 أرسل <b>رقم الموظف</b> أو <b>اسمه</b> :' : '🔍 Entrez <b>ID</b> ou <b>Nom</b> :');
      }
      return;
    }

    if (d === 'add_emp') {
      const role = String(userData.role).toLowerCase();
      if (role !== 'admin' && role !== 'manager' && role !== 'chef_de_quart') {
        return send(chatId, ar ? '❌ <b>هذه الميزة مخصصة للإدارة.</b>' : '❌ <b>Accès restreint à l\'administration.</b>');
      }
      states.set(chatId, { step: 'add_emp_tid' });
      return send(chatId, ar 
        ? `➕ <b>إضافة / تفعيل عامل:</b>\n━━━━━━━━━━━━━━\nيرجى إرسال <b>معرف تيليجرام (ID)</b> الخاص بالعامل (الذي يحصل عليه من أمر /me):` 
        : `➕ <b>Ajouter / Activer un employé:</b>\n━━━━━━━━━━━━━━\nVeuillez envoyer <b>l'ID Telegram</b> de l'employé (obtenu avec /me):`);
    }

    if (d === 'admin_broadcast') {
      const role = String(userData.role).toLowerCase();
      if (role !== 'admin') {
        return send(chatId, ar ? '❌ <b>عذراً، هذه الميزة مخصصة للمسؤول فقط.</b>' : '❌ <b>Accès restreint à l\'administrateur.</b>');
      }
      states.set(chatId, { step: 'broadcast_content' });
      saveStates();
      return send(chatId, ar 
        ? `📢 <b>إرسال تعليمات إدارية (برودكاست):</b>\n━━━━━━━━━━━━━━\nيرجى إرسال <b>نص التعليمات</b> أو <b>صورة مع نص (Caption)</b> لتوزيعها على جميع المستخدمين المفعلين في البوت.\n\n<i>يمكنك إرسال أي وسائط أخرى مثل فيديو أو ملف PDF وسيقوم البوت بتوزيعها تلقائياً.</i>\n\nأرسل /cancel لإلغاء العملية.` 
        : `📢 <b>Diffusion d'instruction administrative :</b>\n━━━━━━━━━━━━━━\nVeuillez envoyer le <b>texte de l'instruction</b> ou une <b>photo avec description (Caption)</b> pour la diffuser à tous les utilisateurs activés du bot.\n\n<i>Vous pouvez aussi envoyer une vidéo ou un fichier PDF.</i>\n\nEnvoyez /cancel pour annuler.`);
    }

    if (d === 'admin_active_users') {
      const role = String(userData.role).toLowerCase();
      if (role !== 'admin') {
        return send(chatId, ar ? '❌ <b>عذراً، هذه الميزة مخصصة للمسؤول فقط.</b>' : '❌ <b>Accès restreint à l\'administrateur.</b>');
      }

      const db2 = loadDB();
      const formatLastActive = (isoString, ar) => {
        if (!isoString) {
          return ar ? 'غير متصل 🔴' : 'Jamais connecté 🔴';
        }
        const diffMs = Date.now() - new Date(isoString).getTime();
        const diffSecs = Math.floor(diffMs / 1000);
        const diffMins = Math.floor(diffSecs / 60);
        const diffHours = Math.floor(diffMins / 60);
        const diffDays = Math.floor(diffHours / 24);

        if (diffSecs < 60) {
          return ar ? 'نشط الآن 🟢' : 'Actif maintenant 🟢';
        } else if (diffMins < 60) {
          return ar ? `منذ ${diffMins} دقيقة 🟡` : `Il y a ${diffMins} min 🟡`;
        } else if (diffHours < 24) {
          return ar ? `منذ ${diffHours} ساعة 🟡` : `Il y a ${diffHours} h 🟡`;
        } else {
          return ar ? `منذ ${diffDays} يوم ⚪` : `Il y a ${diffDays} j ⚪`;
        }
      };

      const sortedUsers = [...(cfg.authorized_users || [])]
        .filter(u => u.id && u.id !== 'ID_HERE')
        .sort((a, b) => {
          const timeA = db2.user_activity?.[a.id] ? new Date(db2.user_activity[a.id]).getTime() : 0;
          const timeB = db2.user_activity?.[b.id] ? new Date(db2.user_activity[b.id]).getTime() : 0;
          return timeB - timeA;
        });

      let msg = ar 
        ? `👥 <b>المستخدمين المتواجدين حالياً في البوت:</b>\n━━━━━━━━━━━━━━\n`
        : `👥 <b>UTILISATEURS ACTIFS SUR LE BOT :</b>\n━━━━━━━━━━━━━━\n`;

      for (const u of sortedUsers) {
        const lastActiveStr = formatLastActive(db2.user_activity?.[u.id], ar);
        const roleName = String(u.role).toUpperCase();
        msg += `👤 <b>${u.name}</b>\n🔑 ID: <code>${u.id}</code> | الرتبة: <code>${roleName}</code>\n⏰ ${lastActiveStr}\n━━━━━━━━━━━━━━\n`;
      }

      const kbd = {
        inline_keyboard: [
          [
            { text: ar ? '🔄 تحديث' : '🔄 Actualiser', callback_data: 'admin_active_users' },
            { text: ar ? '🏠 القائمة الرئيسية' : '🏠 Menu', callback_data: 'menu' }
          ]
        ]
      };

      return send(chatId, msg, kbd);
    }

    const db = loadDB();

    if (d.startsWith('add_emp_rolex:') || d.startsWith('add_emp_rolen:')) {
      const parts = d.split(':');
      const isNew = d.startsWith('add_emp_rolen:');
      const botRole = parts[1];
      const tid = parts[2];
      const empId = parts[3];
      const empName = isNew ? parts.slice(4).join(':') : '';

      // ── Role label for confirmation message ──
      const roleLabels = {
        general_manager: ar ? 'مدير عام' : 'Directeur Général',
        gestionnaire_rh: ar ? 'مسير موارد بشرية' : 'Gestionnaire RH',
        manager:         ar ? 'مسير' : 'Manager',
        chef_de_quart:   ar ? 'رئيس وردية' : 'Chef de Quart',
        poste_garde:     ar ? 'حارس' : 'Poste de Garde',
        employee:        ar ? 'عامل' : 'Employé',
        service_commercial: ar ? 'تجاري (Commercial)' : 'Service Commercial',
        gds:             ar ? 'المخازن والشحن (GDS)' : 'Gestion Stock (GDS)',
        finance:         ar ? 'المالية (Finance)' : 'Finance'
      };
      const roleLabel = roleLabels[botRole] || botRole;

      // ── Determine scope based on role ──
      const isManagement = ['general_manager','gestionnaire_rh','manager','chef_de_quart'].includes(botRole);
      const scope = 'custom_employees';

      const cfg = loadConfig();
      if (!cfg.authorized_users) cfg.authorized_users = [];
      
      let botUser = cfg.authorized_users.find(u => String(u.id) === String(tid));
      if (!botUser) {
         const empRecord = db.hr_employees?.find(e => String(e.clockingId) === empId);
         const displayName = isNew ? empName : (
           empRecord ? `${empRecord.lastName_fr || ''} ${empRecord.firstName_fr || ''}`.trim() || empRecord.firstName_ar || 'Employé' : 'Employé'
         );
         botUser = {
            id: tid,
            name: displayName,
            role: botRole,
            scope,
            allowed_employees: [empId],
            clockingId: empId
         };
         cfg.authorized_users.push(botUser);
      } else {
         botUser.role = botRole;
         botUser.scope = scope;
         botUser.clockingId = empId;
         if (!botUser.allowed_employees) botUser.allowed_employees = [];
         if (!botUser.allowed_employees.includes(empId)) botUser.allowed_employees.push(empId);
         if (isNew && empName) botUser.name = empName;
      }
      updateConfig(cfg);

      if (isNew) {
         const emp = {
           id: crypto.randomUUID(),
           clockingId: empId,
           firstName_ar: empName,
           firstName_fr: empName,
           lastName_ar: '',
           lastName_fr: '',
           status: 'active',
           csp: botRole,
           department_ar: '',
           department_fr: '',
           startDate: new Date().toISOString().split('T')[0],
           createdAt: new Date().toISOString(),
           _addedViaBot: true
         };
         if (!db.hr_employees) db.hr_employees = [];
         db.hr_employees.push(emp);
         saveDB(db);
      }
      
      const finalName = isNew ? empName : (db.hr_employees?.find(e => String(e.clockingId) === empId)?.firstName_fr || empId);
      return send(chatId, ar 
         ? `✅ <b>تمت العملية بنجاح!</b>\n━━━━━━━━━━━━━━\n👤 الاسم: <b>${finalName}</b>\n🆔 الرقم: <code>${empId}</code>\n📱 تيليجرام: <code>${tid}</code>\n🎭 الدور: <b>${roleLabel}</b>\n\n<i>${isNew ? '✅ تمت إضافة العامل للقاعدة وسيظهر في التطبيق.' : '🔗 العامل موجود مسبقاً وتم ربطه بالبوت بالدور الجديد.'}</i>` 
         : `✅ <b>Opération réussie!</b>\n━━━━━━━━━━━━━━\n👤 Nom: <b>${finalName}</b>\n🆔 Matricule: <code>${empId}</code>\n📱 Telegram: <code>${tid}</code>\n🎭 Rôle: <b>${roleLabel}</b>\n\n<i>${isNew ? '✅ Employé ajouté à la base et visible dans l\'application.' : '🔗 Employé existant lié au Bot avec le nouveau rôle.'}</i>`,
         { inline_keyboard: [[{ text: ar ? '🏠 القائمة الرئيسية' : '🏠 Menu Principal', callback_data: 'menu' }]] }
      );
    }

    if (d === 'my_profile') {
      const targetId = String(userData.clockingId || (userData.allowed_employees && userData.allowed_employees[0]) || '').trim();
      const emp = db.hr_employees?.find(e => String(e.clockingId).trim() === targetId);
      if (emp) {
        const bals = (db.hr_leave_balances || []).filter(b => String(b.employeeId) === String(emp.id));
        return roleObj.showEmployeeCard(chatId, emp, ar, bals);
      }
      if (role === 'admin' || role === 'manager' || role === 'chef_de_quart' || role === 'gestionnaire_rh') {
        return send(chatId, ar ? 'ℹ️ <b>أنت مسجل كمسؤول.</b>\nليس لديك "رقم موظف" شخصي مرتبط بحسابك.\n\nاستخدم زر <b>البحث</b> للوصول لبيانات العمال.' : 'ℹ️ <b>Vous êtes Administrateur.</b>\nVous n\'avez pas de "Matricule" personnel lié.\n\nUtilisez le bouton <b>Recherche</b> pour accéder aux dossiers.');
      }
      return send(chatId, ar ? '❌ لم يتم العثور على ملفك الشخصي. يرجى مراجعة الإدارة.' : '❌ Profil introuvable. Veuillez contacter l\'administration.');
    }

    if (d.startsWith('full:')) {
      const emp = db.hr_employees?.find(e => String(e.id) === d.split(':')[1]);
      if (!emp) return;
      if (!isEmployeeAllowed(userData, emp)) {
         return send(chatId, ar ? '❌ غير مصرح لك بعرض هذا الملف.' : '❌ Accès non autorisé à ce dossier.');
      }
      const statusLabel = emp.status === 'active' ? (ar ? 'نشط 🟢' : 'Actif 🟢') : (ar ? 'متوقف 🔴' : 'Arrêté 🔴');
      
      const isAdm = roleObj.isAdmin();
      const mask = (val) => isAdm ? (T(val) || '—') : '<code>********</code>';

      let msg = ar
        ? `📄 <b>التفاصيل الكاملة:</b>\n━━━━━━━━━━━━━━\n👤 ${T(emp.lastName_ar)} ${T(emp.firstName_ar)}\n🆔 الرمز: <code>${emp.clockingId}</code>\n✅ الحالة: <b>${statusLabel}</b>\n🎂 الميلاد: ${mask(emp.birthDate)}\n📍 مكان الميلاد: ${T(emp.birthPlace_ar)}\n🏠 العنوان: ${mask(emp.address_ar)}\n📊 الصنف (CSP): ${mask(emp.csp)}\n📞 الهاتف: ${T(emp.phone)}\n🏢 القسم: ${T(emp.department_ar)}\n🏢 المديرية: ${T(emp.direction_ar)}\n📅 البداية: ${T(emp.startDate)}\n📜 العقد: ${T(emp.contractType)}\n🔚 نهاية العقد: ${T(emp.contractEndDate)}\n🎓 المستوى: ${T(emp.studyLevel_ar)}`
        : `📄 <b>FICHE DÉTAILLÉE:</b>\n━━━━━━━━━━━━━━\n👤 ${T(emp.lastName_fr)} ${T(emp.firstName_fr)}\n🆔 ID: <code>${emp.clockingId}</code>\n✅ Statut: <b>${statusLabel}</b>\n🎂 Naissance: ${mask(emp.birthDate)}\n📍 Lieu: ${T(emp.birthPlace_fr)}\n🏠 Adresse: ${mask(emp.address_fr)}\n📊 CSP: ${mask(emp.csp)}\n📞 Tél: ${T(emp.phone)}\n🏢 Dept: ${T(emp.department_fr)}\n🏢 Direction: ${T(emp.direction_fr)}\n📅 Début: ${T(emp.startDate)}\n📜 Contrat: ${T(emp.contractType)}\n🔚 Fin: ${T(emp.contractEndDate)}\n🎓 Niveau: ${T(emp.studyLevel_fr)}`;
      
      if (emp.status === 'stopped' && emp.departureDate) {
        msg += ar 
          ? `\n━━━━━━━━━━━━━━\n📅 تاريخ المغادرة: <code>${emp.departureDate}</code>\n✍️ السبب: <i>${T(emp.departureReason)}</i>`
          : `\n━━━━━━━━━━━━━━\n📅 Date Départ: <code>${emp.departureDate}</code>\n✍️ Motif: <i>${T(emp.departureReason)}</i>`;
      }
      return send(chatId, msg);
    }

    if (d.startsWith('leave:')) {
      const empId = d.split(':')[1];
      const emp = db.hr_employees?.find(e => String(e.id) === empId);
      if (emp && !isEmployeeAllowed(userData, emp)) {
         return send(chatId, ar ? '❌ غير مصرح لك بعرض هذا الملف.' : '❌ Accès non autorisé à ce dossier.');
      }
      let bals = (db.hr_leave_balances || []).filter(b => String(b.employeeId) === empId);
      
      let msg = ar ? '🏖️ <b>رصيد العطل السنوي:</b>\n━━━━━━━━━━━━━━\n' : '🏖️ <b>SOLDE CONGÉS:</b>\n━━━━━━━━━━━━━━\n';
      
      if (bals.length === 0 && emp) {
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth() + 1;
        const activeEx = month >= 7 ? `${year}/${year + 1}` : `${year - 1}/${year}`;
        const auto = calculateAutoLeave(emp.startDate, activeEx);
        if (auto > 0) {
          bals = [{ exercice: activeEx, totalDays: auto, remainingDays: auto, isAuto: true }];
        }
      }

      if (bals.length === 0) {
        msg += ar ? '⚠️ لا توجد بيانات مسجلة.' : '⚠️ Aucune donnée enregistrée.';
      } else {
        for (const b of bals) {
          const suffix = b.isAuto ? (ar ? ' (تلقائي)' : ' (Auto)') : '';
          msg += `📅 ${b.exercice}: ✅ ${b.remainingDays}/${b.totalDays} ${ar ? 'يوم' : 'jours'}${suffix}\n`;
          if (b.lastComment) msg += `   └ 💬 <i>${b.lastComment}</i>\n`;
        }
      }
      return send(chatId, msg);
    }

    if (d.startsWith('docs:')) {
      const emp = db.hr_employees?.find(e => String(e.id) === d.split(':')[1]);
      if (!emp) return;
      if (!isEmployeeAllowed(userData, emp)) {
         return send(chatId, ar ? '❌ غير مصرح لك بعرض هذا الملف.' : '❌ Accès non autorisé à ce dossier.');
      }
      const isAdm = roleObj.isAdmin();
      const mask = (val) => isAdm ? (T(val) || '—') : '<code>********</code>';

      return send(chatId, ar
        ? `📜 <b>معلومات العقد:</b>\n━━━━━━━━━━━━━━\n📜 النوع: <b>${T(emp.contractType)}</b>\n📅 البداية: ${T(emp.startDate)}\n🔚 النهاية: ${T(emp.contractEndDate)}\n🏢 الشركة: ${T(emp.companyId).toUpperCase()}\n💼 CSP: ${mask(emp.csp)}`
        : `📜 <b>INFOS CONTRAT:</b>\n━━━━━━━━━━━━━━\n📜 Type: <b>${T(emp.contractType)}</b>\n📅 Début: ${T(emp.startDate)}\n🔚 Fin: ${T(emp.contractEndDate)}\n🏢 Société: ${T(emp.companyId).toUpperCase()}\n💼 CSP: ${mask(emp.csp)}`);
    }

    if (d.startsWith('abs:') && !d.startsWith('abs_type:')) {
      const empId = d.split(':')[1];
      const emp = db.hr_employees?.find(e => String(e.id) === empId);
      if (emp && !isEmployeeAllowed(userData, emp)) {
         return send(chatId, ar ? '❌ غير مصرح لك بهذا الإجراء.' : '❌ Action non autorisée pour ce dossier.');
      }
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

    if (d.startsWith('survey:') && !d.startsWith('survey_r:')) {
      const empId = d.split(':')[1];
      const emp = db.hr_employees?.find(e => String(e.id) === empId);
      if (emp && !isEmployeeAllowed(userData, emp)) {
         return send(chatId, ar ? '❌ غير مصرح لك بهذا الإجراء.' : '❌ Action non autorisée pour ce dossier.');
      }
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

    if (d.startsWith('reqmenu:')) {
      const empId = d.split(':')[1];
      const emp = db.hr_employees?.find(e => String(e.id) === empId);
      if (emp && !isEmployeeAllowed(userData, emp)) {
         return send(chatId, ar ? '❌ غير مصرح لك بهذا الإجراء.' : '❌ Action non autorisée pour ce dossier.');
      }
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

    if (d.startsWith('drsn:')) {
      const parts = d.split(':');
      const docId = parts[1], rsnId = parts[2], empId = parts[3];
      const doc = DOC_TYPES.find(dt => dt.id === docId);
      const rsn = DOSSIER_REASONS.find(r => r.id === rsnId);
      const docName = doc ? (ar ? doc.ar : doc.fr) : 'Document';
      const rsnName = rsn ? (ar ? rsn.ar : rsn.fr) : 'Autre';

      const emp = db.hr_employees?.find(e => String(e.id) === empId);
      const empName = emp ? `${emp.lastName_fr} ${emp.firstName_fr} (${emp.clockingId})` : empId;
      const role = String(userData.role).toLowerCase();

      // ── Attestation de Travail: route through admin approval ──
      if (docId === 'att_travail') {
        const reqId = 'cert_' + Math.random().toString(36).substring(2, 9);
        if (!db.bot_requests) db.bot_requests = [];
        db.bot_requests.push({
          id: reqId,
          type: 'work_cert_auth',
          status: 'pending_admin',
          empId,
          empName,
          reason: rsnName,
          reasonId: rsnId,
          requesterId: String(fromId),
          requesterName: userData.name,
          requesterChatId: String(chatId),
          createdAt: new Date().toISOString()
        });
        saveDB(db);

        const approvalMsg = ar
          ? `📋 <b>طلب شهادة عمل — موافقة مطلوبة</b>\n━━━━━━━━━━━━━━\n👤 الموظف: <b>${empName}</b>\n✍️ السبب: <b>${rsnName}</b>\n👤 طلب بواسطة: ${userData.name}\n⏰ ${new Date().toLocaleString('fr-FR')}\n\n⚠️ الرجاء اتخاذ قرار:`
          : `📋 <b>Demande Attestation de Travail — Approbation requise</b>\n━━━━━━━━━━━━━━\n👤 Employé: <b>${empName}</b>\n✍️ Motif: <b>${rsnName}</b>\n👤 Demandé par: ${userData.name}\n⏰ ${new Date().toLocaleString('fr-FR')}\n\n⚠️ Veuillez prendre une décision:`;

        const approvalKbd = { inline_keyboard: [[
          { text: '✅ Approuver', callback_data: `work_adm_app:${reqId}` },
          { text: '❌ Rejeter', callback_data: `work_adm_rej:${reqId}` }
        ]]};

        await notifyStaff(approvalMsg, cfg, send, approvalKbd);

        return send(chatId, ar
          ? `✅ <b>تم إرسال طلب شهادة العمل!</b>\n👤 الموظف: ${empName}\n✍️ السبب: ${rsnName}\n⏳ <b>بانتظار موافقة الإدارة. ستصلك إشعار عند الموافقة.</b>`
          : `✅ <b>Demande Attestation de Travail envoyée!</b>\n👤 Employé: ${empName}\n✍️ Motif: ${rsnName}\n⏳ <b>En attente d'approbation. Vous serez notifié(e) dès validation.</b>`);
      }

      // ── All other documents: notify staff directly ──
      const isManager = role === 'manager' || role === 'chef_de_quart';
      await notifyStaff(`📄 <b>طلب وثيقة جديد</b>\n━━━━━━━━━━━━━━\n👤 الموظف: ${empName}\n📄 الوثيقة: <b>${docName}</b>\n✍️ السبب: ${rsnName}\n👤 من طرف: ${userData.name}`, cfg, send);
      
      return send(chatId, isManager
        ? (ar ? `✅ تم إرسال طلبك.\n📄 ${docName}\n✍️ السبب: ${rsnName}\n⏳ <b>سوف يُدرس طلبك من طرف الإدارة.</b>` : `✅ Demande envoyée.\n📄 ${docName}\n✍️ Motif: ${rsnName}\n⏳ <b>Votre demande sera étudiée par l'administration.</b>`)
        : (ar ? `✅ <b>تم إرسال الطلب!</b>\n📄 ${docName}\n✍️ ${rsnName}` : `✅ <b>Demande envoyée!</b>\n📄 ${docName}\n✍️ ${rsnName}`));
    }

    if (d.startsWith('accident:')) {
      const empId = d.split(':')[1];
      states.set(chatId, { 
        step: 'acc_date', 
        empId, 
        data: { reporter: userData.name, timestamp: new Date().toLocaleString() } 
      });
      return send(chatId, ar 
        ? `🚑 <b>التبليغ عن حادث عمل (خطوة 1/7)</b>\n━━━━━━━━━━━━━━\n📅 يرجى كتابة <b>تاريخ ووقت</b> وقوع الحادث:\nمثال: <code>اليوم 10:30</code> أو <code>أمس المساء</code>` 
        : `🚑 <b>DÉCLARATION D'ACCIDENT (Étape 1/7)</b>\n━━━━━━━━━━━━━━\n📅 Veuillez écrire <b>la date et l'heure</b> de l'accident :\nEx: <code>Aujourd'hui 10:30</code>`);
    }

    // ── Work Certificate: APPROVE ──────────────────────────────────────
    if (d.startsWith('work_adm_app:')) {
      const reqId = d.split(':')[1];
      const db2 = loadDB();
      const req = (db2.bot_requests || []).find(r => r.id === reqId);
      if (!req) return send(chatId, ar ? '❌ الطلب غير موجود أو انتهت صلاحيته.' : '❌ Demande introuvable ou expirée.');
      if (req.status !== 'pending_admin') return send(chatId, ar ? '⚠️ تم معالجة هذا الطلب مسبقاً.' : '⚠️ Cette demande a déjà été traitée.');

      req.status = 'completed';
      req.approvedBy = userData.name;
      req.approvedAt = new Date().toISOString();
      saveDB(db2);

      await answerCallbackQuery(cbq.id, '✅ Approuvé!');
      await send(chatId, ar
        ? `✅ <b>تمت الموافقة على شهادة العمل!</b>\n👤 ${req.empName}\n🔄 جاري إنشاء PDF وإرساله...`
        : `✅ <b>Attestation de Travail approuvée!</b>\n👤 ${req.empName}\n🔄 Génération du PDF en cours...`);

      try {
        await generateAndSendWorkCert(req, cfg, db2);
        // Notify requester
        if (req.requesterChatId) {
          await send(Number(req.requesterChatId), ar
            ? `✅ <b>تمت الموافقة على طلب شهادة العمل!</b>\n👤 الموظف: ${req.empName}\n✍️ السبب: ${req.reason}\n📧 تم إرسال الوثيقة بالبريد الإلكتروني.`
            : `✅ <b>Votre demande d'Attestation de Travail a été approuvée!</b>\n👤 Employé: ${req.empName}\n✍️ Motif: ${req.reason}\n📧 Document envoyé par email.`);
        }
        return send(chatId, ar ? '📧 تم إرسال شهادة العمل بالبريد الإلكتروني بنجاح!' : '📧 Attestation envoyée par email avec succès!');
      } catch (pdfErr) {
        log(`[WorkCert] PDF/email error: ${pdfErr.message}`);
        return send(chatId, `❌ Erreur lors de la génération du PDF: ${pdfErr.message}`);
      }
    }

    // ── Work Certificate: REJECT ───────────────────────────────────────
    if (d.startsWith('work_adm_rej:')) {
      const reqId = d.split(':')[1];
      const db2 = loadDB();
      const req = (db2.bot_requests || []).find(r => r.id === reqId);
      if (!req) return send(chatId, ar ? '❌ الطلب غير موجود.' : '❌ Demande introuvable.');
      if (req.status !== 'pending_admin') return send(chatId, ar ? '⚠️ تم معالجة هذا الطلب مسبقاً.' : '⚠️ Cette demande a déjà été traitée.');

      req.status = 'rejected_adm';
      req.rejectedBy = userData.name;
      req.rejectedAt = new Date().toISOString();
      saveDB(db2);

      await answerCallbackQuery(cbq.id, '❌ Rejeté');
      await send(chatId, ar
        ? `❌ <b>تم رفض طلب شهادة العمل.</b>\n👤 ${req.empName}`
        : `❌ <b>Demande d'Attestation rejetée.</b>\n👤 ${req.empName}`);

      // Notify requester of rejection
      if (req.requesterChatId) {
        await send(Number(req.requesterChatId), ar
          ? `❌ <b>تم رفض طلب شهادة العمل.</b>\n👤 الموظف: ${req.empName}\n✍️ السبب: ${req.reason}\n👤 رُفض بواسطة: ${userData.name}\n\nيمكنك التواصل مع الإدارة لمزيد من المعلومات.`
          : `❌ <b>Votre demande d'Attestation de Travail a été rejetée.</b>\n👤 Employé: ${req.empName}\n✍️ Motif: ${req.reason}\n👤 Rejeté par: ${userData.name}\n\nVeuillez contacter l'administration pour plus d'informations.`);
      }
      return;
    }

    if (d === 'auth_menu') {
      states.set(chatId, { step: 'auth_menu_sel', data: { managerId: fromId, managerName: userData.name } });
      saveStates();
      const kbd = { inline_keyboard: [
        [{ text: ar ? '💼 تصريح خروج (مهمة عمل)' : '💼 Sortie (Raison de Service)', callback_data: 'exittype_pre:Service' }],
        [{ text: ar ? '👤 تصريح خروج (شخصي)' : '👤 Sortie (Personnelle)', callback_data: 'exittype_pre:Personnel' }],
        [{ text: ar ? '📥 تصريح دخول إلى الشركة' : '📥 Demande d\'Entrée', callback_data: 'entry_type_pre' }],
        [{ text: ar ? '📝 أمر بمهمة (Ordre de Mission)' : '📝 Ordre de Mission', callback_data: 'om_start' }],
        [{ text: ar ? '❌ إلغاء' : '❌ Annuler', callback_data: 'menu' }]
      ]};
      return send(chatId, ar 
        ? `🚪 <b>إدارة التصاريح</b>\nالرجاء اختيار نوع التصريح المطلوب:` 
        : `🚪 <b>GESTION DES AUTORISATIONS</b>\nVeuillez choisir le type d'autorisation :`, kbd);
    }

    if (d.startsWith('exittype_pre:')) {
      const type = d.split(':')[1];
      let st = states.get(chatId);
      if (!st) {
         st = { step: 'auth_menu_sel', data: { managerId: fromId, managerName: userData.name } };
      }
      st.data.type = type;
      st.step = 'exit_search';
      states.set(chatId, st);
      saveStates();
      log(`[Exit] Step: Search Employee (2/5) for ${chatId}`);
      return send(chatId, ar 
        ? `🔍 <b>البحث عن الموظف (2/5)</b>\nيرجى إرسال <b>اسم الموظف</b> أو <b>رقمه</b>:` 
        : `🔍 <b>RECHERCHE EMPLOYÉ (2/5)</b>\nVeuillez envoyer le <b>Nom</b> ou <b>Matricule</b> :`);
    }

    if (d === 'entry_type_pre') {
      const st = states.get(chatId);
      if (!st) return send(chatId, ar ? '❌ انتهت الجلسة، يرجى البدء من جديد:' : '❌ Session expirée, veuillez recommencer:', { inline_keyboard: [[{ text: ar ? '🏠 القائمة' : '🏠 Menu', callback_data: 'menu' }]] });
      st.data.type = 'Entry';
      st.step = 'entry_search';
      states.set(chatId, st);
      saveStates();
      log(`[Entry] Step: Search Employee (2/5) for ${chatId}`);
      return send(chatId, ar 
        ? `🔍 <b>البحث عن الموظف للدخول (2/5)</b>\nيرجى إرسال <b>اسم الموظف</b> أو <b>رقمه</b>:` 
        : `🔍 <b>RECHERCHE EMPLOYÉ ENTRÉE (2/5)</b>\nVeuillez envoyer le <b>Nom</b> ou <b>Matricule</b> :`);
    }

    if (d === 'om_start') {
      const role = String(userData.role).toLowerCase();
      const allowedRoles = ['admin', 'manager', 'chef_de_quart', 'gestionnaire_rh', 'service_commercial', 'gds', 'finance'];
      if (!allowedRoles.includes(role)) {
         return send(chatId, ar ? '❌ <b>عذراً، هذه الميزة مخصصة للإدارة فقط.</b>' : '❌ <b>Accès réservé à l\'administration.</b>');
      }
      states.set(chatId, { step: 'om_search', data: { managerId: fromId, managerName: userData.name, destinations: [] } });
      saveStates();
      return send(chatId, ar ? '🔍 <b>أمر بمهمة:</b> يرجى إرسال <b>اسم الموظف</b> أو <b>رقمه</b> :' : '🔍 <b>Ordre de Mission:</b> Entrez <b>Nom</b> ou <b>ID</b> :');
    }

    if (d.startsWith('om_sel:')) {
      const empId = d.split(':')[1];
      let st = states.get(chatId);
      if (!st) {
        // Try to recover state if possible
        st = { step: 'om_search', data: { managerId: fromId, managerName: userData.name, destinations: [] } };
      }
      st.empId = empId;
      st.step = 'om_motifs';
      states.set(chatId, st);
      saveStates();
      return send(chatId, ar ? '📝 <b>أرسل سبب المهمة (Motifs) :</b>' : '📝 <b>Entrez les motifs de la mission :</b>');
    }

    if (d.startsWith('om_dest:')) {
      const parts = d.split(':');
      const action = parts[1]; // toggle, page, done
      const st = states.get(chatId);
      if (!st) return;

      if (!st.data.destinations) st.data.destinations = [];

      if (action === 'toggle') {
        const val = parts[2];
        st.data.destinations.push(val);
      }

      if (action === 'undo') {
        st.data.destinations.pop();
      }

      if (action === 'clear') {
        st.data.destinations = [];
      }

      let page = parseInt(parts[3] || '0', 10);
      if (action === 'page') page = parseInt(parts[2], 10);
      
      if (action === 'done') {
        if (st.data.destinations.length === 0) {
          return send(chatId, ar ? '⚠️ يرجى اختيار ولاية واحدة على الأقل.' : '⚠️ Sélectionnez au moins une wilaya.');
        }
        st.step = 'om_date_start';
        states.set(chatId, st);
        saveStates();
        return send(chatId, ar ? '📅 <b>تاريخ الذهاب (مثال: 2026/05/20) :</b>' : '📅 <b>Date de départ (Ex: 2026/05/20) :</b>');
      }

      // Show Wilayas Grid
      const pageSize = 12;
      const start = page * pageSize;
      const end = start + pageSize;
      const totalPages = Math.ceil(WILAYAS.length / pageSize);
      
      const rows = [];
      for (let i = start; i < end && i < WILAYAS.length; i += 2) {
        const row = [];
        [WILAYAS[i], WILAYAS[i+1]].forEach(w => {
          if (w) {
            const count = st.data.destinations.filter(x => x === w).length;
            const prefix = count > 0 ? (count > 1 ? `✅ (${count}x) ` : '✅ ') : '';
            row.push({ text: prefix + w, callback_data: `om_dest:toggle:${w}:${page}` });
          }
        });
        rows.push(row);
      }

      const navRow = [];
      if (page > 0) navRow.push({ text: '⬅️ السابق', callback_data: `om_dest:page:${page - 1}` });
      navRow.push({ text: `📄 ${page + 1}/${totalPages}`, callback_data: 'none' });
      if (end < WILAYAS.length) navRow.push({ text: 'التالي ➡️', callback_data: `om_dest:page:${page + 1}` });
      rows.push(navRow);
      
      rows.push([
        { text: ar ? '↩️ تراجع' : '↩️ Retour', callback_data: `om_dest:undo:0:${page}` },
        { text: ar ? '🧹 مسح الكل' : '🧹 Effacer', callback_data: `om_dest:clear:0:${page}` },
        { text: ar ? '🏁 تأكيد الوجهات' : '🏁 Confirmer', callback_data: 'om_dest:done' }
      ]);

      const msg = ar 
        ? `📍 <b>اختر وجهات المهمة (يمكنك اختيار عدة ولايات):</b>\n━━━━━━━━━━━━━━\nالوجهات المختارة: ${st.data.destinations.join(' - ') || '—'}\n\n💡 <i>اضغط على الولاية للاختيار، ثم اضغط "تأكيد" عند الانتهاء.</i>`
        : `📍 <b>Choisissez les destinations (Multi-sélection):</b>\n━━━━━━━━━━━━━━\nSélection: ${st.data.destinations.join(' - ') || '—'}\n\n💡 <i>Appuyez pour choisir, puis sur "Confirmer" une fois fini.</i>`;
      
      return send(chatId, msg, { inline_keyboard: rows });
    }

    if (d === 'om_final_send') {
      const st = states.get(chatId);
      if (!st || st.processing) return;
      st.processing = true; states.set(chatId, st);
      
      const emp = db.hr_employees?.find(e => String(e.id) === st.empId);
      const empName = emp ? `${emp.lastName_fr} ${emp.firstName_fr}` : 'Unknown';
      const reqId = crypto.randomBytes(4).toString('hex');
      
      const request = {
        id: reqId,
        type: 'ordre_mission',
        empId: st.empId,
        empName,
        companyId: emp?.companyId || 'alver',
        managerId: st.data.managerId,
        managerName: st.data.managerName,
        reason: st.data.reason,
        destinations: st.data.destinations,
        startDate: st.data.startDate,
        endDate: st.data.endDate,
        transport: st.data.transport,
        status: 'completed',
        createdAt: new Date().toISOString(),
        adminApprovedBy: 'Auto',
        adminApprovedAt: new Date().toISOString()
      };
      
      if (!db.bot_requests) db.bot_requests = [];
      db.bot_requests.push(request);
      saveDB(db);

      const msg = ar 
        ? `📝 <b>إشعار بصدور "أمر بمهمة"</b>\n━━━━━━━━━━━━━━\n👤 الموظف: <b>${empName}</b>\n📍 الوجهات: ${st.data.destinations.join(' - ')}\n📅 الفترة: من ${st.data.startDate} إلى ${st.data.endDate}\n✍️ السبب: ${st.data.reason}\n👤 المُصدِر: ${st.data.managerName}`
        : `📝 <b>NOTIFICATION D'ORDRE DE MISSION</b>\n━━━━━━━━━━━━━━\n👤 Employé: <b>${empName}</b>\n📍 Destinations: ${st.data.destinations.join(' - ')}\n📅 Période: du ${st.data.startDate} au ${st.data.endDate}\n✍️ Motifs: ${st.data.reason}\n👤 Émis par: ${st.data.managerName}`;
      
      // Notify Staff (Admins get just text, no validation buttons)
      await notifyStaff(msg, cfg, send);
      states.delete(chatId);

      // Generate and Send PDF directly
      try {
        await generateAndSendMissionAuth(request, cfg);
        log(`[OM] PDF generated and sent for ${empName}`);
      } catch (e) { 
        log(`[OM-Error] PDF failed: ${e.message}`);
        send(chatId, `❌ Error sending email: ${e.message}`);
      }

      return send(chatId, ar ? `✅ تم إصدار أمر المهمة بنجاح وإرسال الإشعار والملف للبريد.` : `✅ Ordre de mission émis, notifié et envoyé.`);
    }

    if (d.startsWith('om_adm_app:')) {
      const reqId = d.split(':')[1];
      const req = db.bot_requests?.find(r => r.id === reqId);
      if (!req || req.status !== 'pending_gm') return;
      
      req.status = 'completed';
      req.adminApprovedBy = userData.name;
      req.adminApprovedAt = new Date().toISOString();
      saveDB(db);

      const msg = ar 
        ? `✅ <b>تم اعتماد "أمر بمهمة"</b>\n━━━━━━━━━━━━━━\n👤 الموظف: <b>${req.empName}</b>\n📍 الوجهات: ${req.destinations.join(', ')}\n📅 الفترة: ${req.startDate} - ${req.endDate}\n✅ اعتمدها: ${userData.name}`
        : `✅ <b>ORDRE DE MISSION APPROUVÉ</b>\n━━━━━━━━━━━━━━\n👤 Employé: <b>${req.empName}</b>\n📍 Destinations: ${req.destinations.join(', ')}\n📅 Période: ${req.startDate} - ${req.endDate}\n✅ Approuvé par: ${userData.name}`;
      
      await notifyStaff(msg, cfg, send);

      // Generate and Send PDF
      try {
        await generateAndSendMissionAuth(req, cfg);
        log(`[OM] PDF generated and sent for ${req.empName}`);
      } catch (e) { 
        log(`[OM-Error] PDF failed: ${e.message}`);
        await send(chatId, `❌ Error sending email: ${e.message}`);
      }

      return send(chatId, ar ? `✅ تم اعتماد المهمة بنجاح وإرسال الملف للبريد.` : `✅ Mission approuvée et PDF envoyé.`);
    }

    if (d.startsWith('om_adm_rej:')) {
      const reqId = d.split(':')[1];
      const req = db.bot_requests?.find(r => r.id === reqId);
      if (!req || req.status !== 'pending_gm') return;
      
      req.status = 'rejected_adm';
      req.adminRejectedBy = userData.name;
      saveDB(db);

      const msg = ar ? `❌ تم رفض طلب المهمة لـ <b>${req.empName}</b> من طرف الإدارة.` : `❌ Ordre de mission rejeté par l'Admin pour <b>${req.empName}</b>.`;
      if (req.managerId) await send(req.managerId, msg);
      return send(chatId, ar ? `✅ تم تسجيل الرفض.` : `✅ Rejet enregistré.`);
    }

    if (d.startsWith('om_trans:')) {
      const st = states.get(chatId);
      if (!st) return;
      st.data.transport = d.split(':')[1];
      st.step = 'om_confirm';
      states.set(chatId, st); saveStates();
      const emp = db.hr_employees?.find(e => String(e.id) === st.empId);
      const summary = ar 
        ? `📋 <b>ملخص أمر بمهمة</b>\n━━━━━━━━━━━━━━\n👤 الموظف: <b>${emp?.lastName_fr} ${emp?.firstName_fr}</b>\n📍 الوجهات: ${st.data.destinations.join(', ')}\n📅 الفترة: ${st.data.startDate} إلى ${st.data.endDate}\n✍️ السبب: ${st.data.reason}\n🚗 النقل: ${st.data.transport}`
        : `📋 <b>RÉSUMÉ MISSION</b>\n━━━━━━━━━━━━━━\n👤 Employé: <b>${emp?.lastName_fr} ${emp?.firstName_fr}</b>\n📍 Destinations: ${st.data.destinations.join(', ')}\n📅 Période: ${st.data.startDate} - ${st.data.endDate}\n✍️ Motif: ${st.data.reason}\n🚗 Transport: ${st.data.transport}`;
      const kbd = { inline_keyboard: [[{ text: ar ? '✅ تأكيد وإرسال للمدير العام' : '✅ Confirmer & Envoyer au DG', callback_data: 'om_final_send' }, { text: ar ? '❌ إلغاء' : '❌ Annuler', callback_data: 'menu' }]]};
      return send(chatId, summary, kbd);
    }

    if (d.startsWith('exit_sel:')) {
      const parts = d.split(':');
      const type = parts[1];
      const empId = parts[2];
      let st = states.get(chatId);
      
      if (!st) {
        // Reconstruct state if lost
        st = { step: 'exit_reason', empId, data: { type, managerId: fromId, managerName: userData.name } };
      } else {
        st.empId = empId;
        st.data.type = type;
        st.step = 'exit_reason';
      }
      
      states.set(chatId, st);
      saveStates();
      log(`[Exit] Step: Enter Reason (3/5) for ${chatId} | Type: ${type} | Emp: ${empId}`);
      return send(chatId, ar 
        ? `✍️ <b>السبب (3/5)</b>\nيرجى كتابة سبب الخروج بالتفصيل:` 
        : `✍️ <b>MOTIF (3/5)</b>\nVeuillez détailler le motif :`);
    }

    // Removed exittype callback handling here as it's now handled by exittype_pre

    if (d === 'exit_final_send') {
      const st = states.get(chatId);
      if (!st || st.processing) return;
      
      // Mark as processing to block double-clicks
      st.processing = true;
      states.set(chatId, st);
      
      const emp = db.hr_employees?.find(e => String(e.id) === st.empId);
      const empName = emp ? `${emp.lastName_fr} ${emp.firstName_fr} (${emp.clockingId})` : 'Unknown';
      
      let companyName = 'ALVER / TEWFIKSOFT';
      if (emp && emp.companyId && db.hr_companies && db.hr_companies[emp.companyId]) {
        const comp = db.hr_companies[emp.companyId];
        companyName = comp.fr?.name || comp.name || companyName;
      }

      const reqId = crypto.randomBytes(4).toString('hex');
      const request = {
        id: reqId,
        type: 'exit_auth',
        empId: st.empId,
        empName,
        companyName, // Added dynamic company name
        managerId: st.data.managerId,
        managerName: st.data.managerName,
        exitType: st.data.type,
        reason: st.data.reason,
        exitTime: st.data.exitTime,
        status: 'pending_admin',
        createdAt: new Date().toISOString()
      };
      
      if (!db.bot_requests) db.bot_requests = [];
      db.bot_requests.push(request);
      saveDB(db);

      const msg = ar 
        ? `🚪 <b>طلب تصريح خروج جديد</b>\n━━━━━━━━━━━━━━\n👤 الموظف: <b>${empName}</b>\n📂 النوع: ${st.data.type === 'Service' ? 'مهمة عمل' : 'شخصي'}\n📅 وقت الخروج: ${st.data.exitTime}\n✍️ السبب: ${st.data.reason}\n👤 من طرف: ${st.data.managerName}`
        : `🚪 <b>DEMANDE DE SORTIE</b>\n━━━━━━━━━━━━━━\n👤 Employé: <b>${empName}</b>\n📂 Type: ${st.data.type === 'Service' ? 'Raison de Service' : 'Sortie Personnelle'}\n📅 Heure Sortie: ${st.data.exitTime}\n✍️ Motif: ${st.data.reason}\n👤 Par: ${st.data.managerName}`;
      
      const kbd = { inline_keyboard: [
        [{ text: ar ? '✅ موافقة الإدارة' : '✅ Approuver', callback_data: `exit_adm_app:${reqId}` }, { text: ar ? '❌ رفض' : '❌ Rejeter', callback_data: `exit_adm_rej:${reqId}` }]
      ]};

      await notifyStaff(msg, cfg, (id, t) => send(id, t, kbd));
      states.delete(chatId);
      return send(chatId, ar ? `✅ تم إرسال طلبك للإدارة للموافقة.` : `✅ Demande envoyée à l'administration.`);
    }

    if (d.startsWith('exit_adm_app:')) {
      const reqId = d.split(':')[1];
      const req = db.bot_requests?.find(r => r.id === reqId);
      if (!req || req.status !== 'pending_admin') return;
      
      req.status = 'pending_guard';
      req.adminApprovedBy = userData.name;
      req.adminApprovedAt = new Date().toISOString();
      saveDB(db);

      const msgObj = {
        ar: `🚨 <b>تصريح خروج معتمد - يرجى التأكيد</b>\n━━━━━━━━━━━━━━\n👤 الموظف: <b>${req.empName}</b>\n📂 النوع: ${req.exitType === 'Service' ? 'مهمة عمل' : 'شخصي'}\n📅 وقت الخروج: ${req.exitTime}\n✍️ السبب: ${req.reason}\n✅ وافقت الإدارة: ${userData.name}`,
        fr: `🚨 <b>SORTIE APPROUVÉE - À CONFIRMER</b>\n━━━━━━━━━━━━━━\n👤 Employé: <b>${req.empName}</b>\n📂 Type: ${req.exitType === 'Service' ? 'Raison de Service' : 'Sortie Personnelle'}\n📅 Heure Sortie: ${req.exitTime}\n✍️ Motif: ${req.reason}\n✅ Approuvé par: ${userData.name}`
      };
      
      const kbd = { inline_keyboard: [[{ text: ar ? '🏁 تأكيد الخروج الفعلي' : '🏁 Confirmer le Départ', callback_data: `exit_guard_conf:${reqId}` }]] };
      
      const guards = cfg.authorized_users?.filter(u => u.role === 'poste_garde') || [];
      for (const g of guards) { 
        if (g.id) {
          const gLang = g.lang || 'ar';
          await send(g.id, msgObj[gLang] || msgObj['ar'], kbd); 
        }
      }
      
      return send(chatId, ar ? `✅ تم تحويل الطلب لمركز الحراسة.` : `✅ Demande transmise au Poste de Garde.`);
    }

    if (d.startsWith('exit_adm_rej:')) {
      const reqId = d.split(':')[1];
      const req = db.bot_requests?.find(r => r.id === reqId);
      if (!req || req.status !== 'pending_admin') return;
      
      req.status = 'rejected';
      req.rejectedBy = userData.name;
      req.rejectedAt = new Date().toISOString();
      saveDB(db);

      const msg = ar ? `❌ <b>تم رفض طلب تصريح الخروج</b>\n━━━━━━━━━━━━━━\n👤 الموظف: <b>${req.empName}</b>\n🚫 الرفض من طرف: ${userData.name}` : `❌ <b>DEMANDE DE SORTIE REJETÉE</b>\n━━━━━━━━━━━━━━\n👤 Employé: <b>${req.empName}</b>\n🚫 Rejeté par: ${userData.name}`;
      
      if (req.managerId) await send(req.managerId, msg);
      return send(chatId, ar ? `✅ تم رفض الطلب وإبلاغ المسؤول.` : `✅ Demande rejetée et responsable notifié.`);
    }

    if (d.startsWith('exit_guard_conf:')) {
      const reqId = d.split(':')[1];
      const req = db.bot_requests?.find(r => r.id === reqId);
      if (!req || req.status !== 'pending_guard' || req.processing) return;
      
      req.processing = true;
      req.status = 'out';
      req.guardConfirmedBy = userData.name;
      req.guardConfirmedAt = new Date().toISOString();
      saveDB(db);

      const msgFinal = {
        ar: `✅ <b>تأكيد خروج عامل</b>\n━━━━━━━━━━━━━━\n👤 الموظف: <b>${req.empName}</b> قد خرج الآن من المؤسسة.\n👮 حارس المناوبة: ${userData.name}\n\n⏳ <i>بانتظار تسجيل العودة...</i>`,
        fr: `✅ <b>SORTIE CONFIRMÉE</b>\n━━━━━━━━━━━━━━\n👤 L'employé <b>${req.empName}</b> a quitté l'entreprise.\n👮 Garde: ${userData.name}\n\n⏳ <i>En attente de retour...</i>`
      };

      if (req.managerId) await send(req.managerId, ar ? msgFinal.ar : msgFinal.fr);
      await notifyStaff(msgFinal, cfg, send);

      try {
        await generateAndSendExitAuth(req, cfg); 
        log(`[Exit] Exit confirmed for ${req.empName}. PDF/Email sent.`);
      } catch (e) { log(`[Exit-Error] PDF/Email failed: ${e.message}`); }

      const returnKbd = { inline_keyboard: [[{ text: ar ? '🏠 تأكيد العودة الآن' : '🏠 Confirmer le RETOUR', callback_data: `exit_guard_return:${reqId}` }]] };
      return send(chatId, ar ? `✅ تم تأكيد الخروج. اضغط الزر أدناه عند عودة الموظف:` : `✅ Sortie confirmée. Appuyez ci-dessous au retour :`, returnKbd);
    }

    if (d.startsWith('exit_guard_return:')) {
      const reqId = d.split(':')[1];
      const req = db.bot_requests?.find(r => r.id === reqId);
      if (!req || req.status !== 'out') return;
      
      req.status = 'completed';
      req.returnedAt = new Date().toISOString();
      req.returnConfirmedBy = userData.name;
      saveDB(db);

      const start = new Date(req.guardConfirmedAt);
      const end = new Date(req.returnedAt);
      const diffMs = end - start;
      const diffHrs = Math.floor(diffMs / 3600000);
      const diffMins = Math.floor((diffMs % 3600000) / 60000);
      const durationStr = `${diffHrs}h ${diffMins}m`;

      const msgReturn = {
        ar: `🏁 <b>تأكيد عودة عامل</b>\n━━━━━━━━━━━━━━\n👤 الموظف: <b>${req.empName}</b> عاد الآن إلى المؤسسة.\n👮 حارس المناوبة: ${userData.name}\n⏰ وقت العودة: ${new Date(req.returnedAt).toLocaleTimeString()}\n⏱️ مدة الخروج: ${diffHrs} ساعة و ${diffMins} دقيقة`,
        fr: `🏁 <b>RETOUR CONFIRMÉ</b>\n━━━━━━━━━━━━━━\n👤 L'employé <b>${req.empName}</b> est de retour.\n👮 Garde: ${userData.name}\n⏰ Heure: ${new Date(req.returnedAt).toLocaleTimeString()}\n⏱️ Durée: ${diffHrs}h ${diffMins}m`
      };

      if (req.managerId) await send(req.managerId, ar ? msgReturn.ar : msgReturn.fr);
      await notifyStaff(msgReturn, cfg, send);

      try {
        req.actualReturnTime = new Date(req.returnedAt).toLocaleTimeString();
        req.actualDuration = durationStr;
        await generateAndSendReturnNotify(req, cfg);
        log(`[Return] Email notification sent for request ${reqId}`);
      } catch (e) { log(`[Return-Email-Err] ${e.message}`); }

      return send(chatId, ar ? `✅ تم تسجيل عودة الموظف بنجاح.` : `✅ Retour enregistré avec succès.`);
    }

    if (d.startsWith('entry_sel:')) {
      const parts = d.split(':');
      const empId = parts[2];
      let st = states.get(chatId);
      if (!st) {
        st = { step: 'entry_reason', empId, data: { type: 'Entry', managerId: fromId, managerName: userData.name } };
      } else {
        st.step = 'entry_reason';
        st.empId = empId;
        if (!st.data) st.data = {};
        st.data.type = 'Entry';
      }
      states.set(chatId, st);
      saveStates();
      return send(chatId, ar 
        ? `✍️ <b>سبب الدخول (3/5)</b>\nيرجى كتابة سبب دخول الموظف بالتفصيل (مثلاً: عمل إضافي):` 
        : `✍️ <b>MOTIF D'ENTRÉE (3/5)</b>\nVeuillez détailler le motif (Ex: Heures Supp) :`);
    }

    if (d === 'entry_final_send') {
      const st = states.get(chatId);
      if (!st || st.processing) return;
      st.processing = true; states.set(chatId, st);
      
      const emp = db.hr_employees?.find(e => String(e.id) === st.empId);
      const empName = emp ? `${emp.lastName_fr} ${emp.firstName_fr} (${emp.clockingId})` : 'Unknown';
      
      let companyName = 'ALVER / TEWFIKSOFT';
      if (emp && emp.companyId && db.hr_companies && db.hr_companies[emp.companyId]) {
        const comp = db.hr_companies[emp.companyId];
        companyName = comp.fr?.name || comp.name || companyName;
      }

      const reqId = crypto.randomBytes(4).toString('hex');
      const request = {
        id: reqId,
        type: 'entry_auth',
        empId: st.empId,
        empName,
        companyName,
        managerId: st.data.managerId,
        managerName: st.data.managerName,
        reason: st.data.reason,
        entryTime: st.data.entryTime,
        status: 'pending_admin_entry',
        createdAt: new Date().toISOString()
      };
      
      if (!db.bot_requests) db.bot_requests = [];
      db.bot_requests.push(request);
      saveDB(db);

      const msg = ar 
        ? `📥 <b>طلب تصريح دخول جديد</b>\n━━━━━━━━━━━━━━\n👤 الموظف: <b>${empName}</b>\n📅 وقت الدخول: ${st.data.entryTime}\n✍️ السبب: ${st.data.reason}\n👤 من طرف: ${st.data.managerName}`
        : `📥 <b>DEMANDE D'ENTRÉE</b>\n━━━━━━━━━━━━━━\n👤 Employé: <b>${empName}</b>\n📅 Heure Entrée: ${st.data.entryTime}\n✍️ Motif: ${st.data.reason}\n👤 Par: ${st.data.managerName}`;
      
      const kbd = { inline_keyboard: [
        [{ text: ar ? '✅ موافقة' : '✅ Approuver', callback_data: `entry_adm_app:${reqId}` }, { text: ar ? '❌ رفض' : '❌ Rejeter', callback_data: `entry_adm_rej:${reqId}` }]
      ]};

      await notifyStaff(msg, cfg, (id, t) => send(id, t, kbd));
      states.delete(chatId);
      return send(chatId, ar ? `✅ تم إرسال طلب الدخول للإدارة.` : `✅ Demande d'entrée envoyée.`);
    }

    if (d.startsWith('entry_adm_app:')) {
      const reqId = d.split(':')[1];
      const req = db.bot_requests?.find(r => r.id === reqId);
      if (!req || req.status !== 'pending_admin_entry') return;
      
      req.status = 'pending_guard_entry';
      req.adminApprovedBy = userData.name;
      saveDB(db);

      const msg = ar 
        ? `🚨 <b>تصريح دخول معتمد</b>\n━━━━━━━━━━━━━━\n👤 الموظف: <b>${req.empName}</b>\n📅 وقت الدخول: ${req.entryTime}\n✍️ السبب: ${req.reason}\n✅ وافقت الإدارة: ${userData.name}`
        : `🚨 <b>ENTRÉE APPROUVÉE</b>\n━━━━━━━━━━━━━━\n👤 Employé: <b>${req.empName}</b>\n📅 Heure Entrée: ${req.entryTime}\n✍️ Motif: ${req.reason}\n✅ Approuvé par: ${userData.name}`;
      
      const kbd = { inline_keyboard: [[{ text: ar ? '🏁 تأكيد الدخول الفعلي' : '🏁 Confirmer l\'Entrée', callback_data: `entry_guard_conf:${reqId}` }]] };
      
      const guards = cfg.authorized_users?.filter(u => u.role === 'poste_garde') || [];
      for (const g of guards) { if (g.id) await send(g.id, msg, kbd); }
      
      return send(chatId, ar ? `✅ تم إرسال الموافقة لمركز الحراسة.` : `✅ Approbation transmise au Poste de Garde.`);
    }

    if (d.startsWith('entry_adm_rej:')) {
      const reqId = d.split(':')[1];
      const req = db.bot_requests?.find(r => r.id === reqId);
      if (!req || req.status !== 'pending_admin_entry') return;
      
      req.status = 'rejected_entry';
      req.rejectedBy = userData.name;
      req.rejectedAt = new Date().toISOString();
      saveDB(db);

      const msg = ar 
        ? `❌ <b>تم رفض طلب تصريح الدخول</b>\n━━━━━━━━━━━━━━\n👤 الموظف: <b>${req.empName}</b>\n🚫 الرفض من طرف: ${userData.name}`
        : `❌ <b>DEMANDE D'ENTRÉE REJETÉE</b>\n━━━━━━━━━━━━━━\n👤 Employé: <b>${req.empName}</b>\n🚫 Rejeté par: ${userData.name}`;
      
      if (req.managerId) await send(req.managerId, msg);
      return send(chatId, ar ? `✅ تم رفض الطلب وإبلاغ المسؤول.` : `✅ Demande rejetée et responsable notifié.`);
    }

    if (d.startsWith('entry_guard_conf:')) {
      const reqId = d.split(':')[1];
      const req = db.bot_requests?.find(r => r.id === reqId);
      if (!req || req.status !== 'pending_guard_entry' || req.processing) return;
      
      req.processing = true; req.status = 'completed';
      req.guardConfirmedBy = userData.name;
      req.guardConfirmedAt = new Date().toISOString();
      saveDB(db);

      const msgFinal = ar 
        ? `✅ <b>تأكيد دخول عامل</b>\n━━━━━━━━━━━━━━\n👤 الموظف: <b>${req.empName}</b> دخل المؤسسة الآن.\n👮 حارس المناوبة: ${userData.name}`
        : `✅ <b>ENTRÉE CONFIRMÉE</b>\n━━━━━━━━━━━━━━\n👤 L'employé <b>${req.empName}</b> est entré.\n👮 Garde: ${userData.name}`;

      await notifyStaff(msgFinal, cfg, send);
      
      try {
        await generateAndSendEntryAuth(req, cfg);
        log(`[Entry] Entry confirmed for ${req.empName}. PDF/Email sent.`);
      } catch (e) { log(`[Entry-Error] PDF/Email failed: ${e.message}`); }

      return send(chatId, ar ? `✅ تم تأكيد الدخول وإشعار الإدارة.` : `✅ Entrée confirmée et direction notifiée.`);
    }

    if (d === 'list_out_emps') {
      const outRequests = (db.bot_requests || []).filter(r => r.status === 'out');
      if (outRequests.length === 0) {
        return send(chatId, ar ? 'ℹ️ لا يوجد أي موظف في الخارج حالياً.' : 'ℹ️ Aucun employé en sortie pour le moment.');
      }

      for (const req of outRequests) {
        const kbd = { inline_keyboard: [[{ text: ar ? `🏠 تأكيد عودة: ${req.empName}` : `🏠 Confirmer retour: ${req.empName}`, callback_data: `exit_guard_return:${req.id}` }]] };
        await send(chatId, ar 
          ? `👤 <b>${req.empName}</b>\n⏰ خرج في: ${new Date(req.guardConfirmedAt).toLocaleTimeString()}\n📝 السبب: ${req.reason}`
          : `👤 <b>${req.empName}</b>\n⏰ Sorti à: ${new Date(req.guardConfirmedAt).toLocaleTimeString()}\n📝 Motif: ${req.reason}`, kbd);
      }
      return;
    }

    if (d === 'list_in_emps') {
      const inRequests = (db.bot_requests || []).filter(r => r.status === 'pending_guard_entry');
      if (inRequests.length === 0) {
        return send(chatId, ar ? 'ℹ️ لا يوجد أي موظف متوقع دخوله حالياً.' : 'ℹ️ Aucun employé prévu pour l\'entrée pour le moment.');
      }

      for (const req of inRequests) {
        const kbd = { inline_keyboard: [[{ text: ar ? `🏁 تأكيد دخول: ${req.empName}` : `🏁 Confirmer l'entrée: ${req.empName}`, callback_data: `entry_guard_conf:${req.id}` }]] };
        await send(chatId, ar 
          ? `👤 <b>${req.empName}</b>\n📅 وقت الدخول المتوقع: ${req.entryTime}\n📝 السبب: ${req.reason}`
          : `👤 <b>${req.empName}</b>\n📅 Heure prévue: ${req.entryTime}\n📝 Motif: ${req.reason}`, kbd);
      }
      return;
    }

    if (d === 'mgmt_tools') {
      const kbd = { inline_keyboard: [
        [{ text: ar ? '🛠️ طلب وسائل / معدات' : '🛠️ Demande de Moyens', callback_data: 'start_res_req' }],
        [{ text: ar ? '⚙️ بلاغ عن عطب تقني' : '⚙️ Signalement de Panne', callback_data: 'start_maint_req' }],
        [{ text: ar ? '💼 طلب توظيف جديد' : '💼 Demande de Recrutement', callback_data: 'start_hire_req' }],
        [{ text: ar ? '📊 تقرير الإنتاج اليومي' : '📊 Rapport Production', callback_data: 'start_prod_req' }],
        [{ text: ar ? '💡 صندوق الاقتراحات' : '💡 Boîte à Idées', callback_data: 'start_suggest' }],
        [{ text: ar ? '🔙 العودة' : '🔙 Retour', callback_data: 'menu' }]
      ]};
      return send(chatId, ar 
        ? `🛠️ <b>أدوات الإدارة والتشغيل</b>\n━━━━━━━━━━━━━━\nيرجى اختيار النظام المطلوب للبدء في ملء البيانات:` 
        : `🛠️ <b>OUTILS DE GESTION & OPS</b>\n━━━━━━━━━━━━━━\nVeuillez choisir un système :`, kbd);
    }

    // --- 🛠️ 1. Resource Request Start ---
    if (d === 'start_res_req') {
      states.set(chatId, { step: 'res_cat', data: { reporter: userData.name } });
      const kbd = { inline_keyboard: [
        [{ text: ar ? '📝 أدوات مكتبية' : '📝 Papeterie', callback_data: 'rescat:Papeterie' }, { text: ar ? '🦺 وسائل وقاية' : '🦺 EPI', callback_data: 'rescat:EPI' }],
        [{ text: ar ? '🛠️ أدوات عمل' : '🛠️ Outillage', callback_data: 'rescat:Outils' }, { text: ar ? '🌐 أخرى' : '🌐 Autre', callback_data: 'rescat:Autre' }]
      ]};
      return send(chatId, ar ? `📂 <b>طلب وسائل (1/4)</b>\nاختر فئة المعدات المطلوبة:` : `📂 <b>REQUÊTE (1/4)</b>\nChoisissez une catégorie :`, kbd);
    }

    // --- ⚙️ 2. Maintenance Report Start ---
    if (d === 'start_maint_req') {
      states.set(chatId, { step: 'maint_loc', data: { reporter: userData.name } });
      const kbd = { inline_keyboard: [
        [{ text: ar ? '🏭 الورشة' : '🏭 Atelier', callback_data: 'maintloc:Atelier' }, { text: ar ? '🏢 المكتب' : '🏢 Bureau', callback_data: 'maintloc:Bureau' }],
        [{ text: ar ? '📦 المستودع' : '📦 Dépôt', callback_data: 'maintloc:Depot' }, { text: ar ? '🌐 أخرى' : '🌐 Autre', callback_data: 'maintloc:Autre' }]
      ]};
      return send(chatId, ar ? `📍 <b>بلاغ عطب (1/4)</b>\nأين يقع العطب التقني؟` : `📍 <b>PANNE (1/4)</b>\nOù est la panne ?`, kbd);
    }

    // --- 💼 3. Recruitment Start ---
    if (d === 'start_hire_req') {
      states.set(chatId, { step: 'hire_dept', data: { reporter: userData.name } });
      return send(chatId, ar ? `🏢 <b>طلب توظيف (1/4)</b>\nما هو القسم أو المديرية الطالبة؟` : `🏢 <b>RECRUTEMENT (1/4)</b>\nQuel est le département demandeur ?`);
    }

    // --- 📊 5. Daily Production Start ---
    if (d === 'start_prod_req') {
      states.set(chatId, { step: 'prod_shift', data: { reporter: userData.name } });
      const kbd = { inline_keyboard: [[
        { text: ar ? '☀️ نهار' : '☀️ Jour', callback_data: 'prodshift:Jour' },
        { text: ar ? '🌙 ليل' : '🌙 Nuit', callback_data: 'prodshift:Nuit' }
      ]]};
      return send(chatId, ar ? `📊 <b>تقرير الإنتاج (1/3)</b>\nاختر الوردية (Shift):` : `📊 <b>PRODUCTION (1/3)</b>\nChoisissez le shift :`, kbd);
    }

    // --- 💡 6. Suggestion Box Start ---
    if (d === 'start_suggest') {
      states.set(chatId, { step: 'sug_cat', data: { reporter: userData.name } });
      const kbd = { inline_keyboard: [
        [{ text: ar ? '💰 توفير مال' : '💰 Économie', callback_data: 'sugcat:Economie' }, { text: ar ? '🚀 تحسين عمل' : '🚀 Efficacité', callback_data: 'sugcat:Efficacité' }],
        [{ text: ar ? '🛡️ سلامة' : '🛡️ Sécurité', callback_data: 'sugcat:Sécurité' }, { text: ar ? '🌐 أخرى' : '🌐 Autre', callback_data: 'sugcat:Autre' }]
      ]};
      return send(chatId, ar ? `💡 <b>صندوق الاقتراحات (1/3)</b>\nما هو مجال فكرتك؟` : `💡 <b>BOÎTE À IDÉES (1/3)</b>\nQuel est le domaine de l'idée ?`, kbd);
    }

    if (d.startsWith('back:')) {
      const emp = db.hr_employees?.find(e => String(e.id) === d.split(':')[1]);
      if (emp) return roleObj.showEmployeeCard(chatId, emp, ar);
    }

    // --- 🚑 Accident Wizard Callbacks ---

    if (d.startsWith('accloc:')) {
      const loc = d.split(':')[1];
      const st = states.get(chatId);
      if (!st) return;
      st.data.location = loc;
      st.step = 'acc_injury';
      const kbd = { inline_keyboard: [
        [{ text: ar ? '🦴 كسر' : '🦴 Fracture', callback_data: 'accinj:Fracture' }, { text: ar ? '🩸 جرح' : '🩸 Plaie/Coupure', callback_data: 'accinj:Plaie' }],
        [{ text: ar ? '🔥 حرق' : '🔥 Brûlure', callback_data: 'accinj:Brulure' }, { text: ar ? '😵 إغماء' : '😵 Malaise', callback_data: 'accinj:Malaise' }],
        [{ text: ar ? '🩹 أخرى' : '🩹 Autre', callback_data: 'accinj:Autre' }]
      ]};
      return send(chatId, ar 
        ? `🤕 <b>نوع الإصابة (خطوة 3/7)</b>\nما هي طبيعة الإصابة الظاهرة؟` 
        : `🤕 <b>NATURE DE LA BLESSURE (Étape 3/7)</b>\nQuelle est la nature de la blessure ?`, kbd);
    }

    if (d.startsWith('accinj:')) {
      const inj = d.split(':')[1];
      const st = states.get(chatId);
      if (!st) return;
      st.data.injury = inj;
      st.step = 'acc_witnesses';
      return send(chatId, ar 
        ? `👥 <b>الشهود (خطوة 4/7)</b>\nهل وجد شهود على الحادث؟ يرجى كتابة أسمائهم (أو اكتب "لا يوجد"):` 
        : `👥 <b>TÉMOINS (Étape 4/7)</b>\nY a-t-il eu des témoins ? Veuillez écrire leurs noms (ou "Aucun") :`);
    }

    if (d.startsWith('acchosp:')) {
      const hosp = d.split(':')[1];
      const st = states.get(chatId);
      if (!st) return;
      st.data.hospital = hosp;
      st.step = 'acc_status';
      const kbd = { inline_keyboard: [
        [{ text: ar ? '✅ قادر على العمل' : '✅ Apte au travail', callback_data: 'accstatus:Apte' }],
        [{ text: ar ? '❌ غير قادر' : '❌ Inapte', callback_data: 'accstatus:Inapte' }],
        [{ text: ar ? '⚠️ جزئياً' : '⚠️ Partiellement', callback_data: 'accstatus:Partiel' }]
      ]};
      return send(chatId, ar 
        ? `🏃 <b>الحالة الصحية الحالية (خطوة 6/7)</b>\nكيف تقيم قدرة الموظف على مواصلة العمل؟` 
        : `🏃 <b>STATUT D'APTITUDE (Étape 6/7)</b>\nComment évaluez-vous l'aptitude de l'employé ?`, kbd);
    }

    if (d.startsWith('accstatus:')) {
      const status = d.split(':')[1];
      const st = states.get(chatId);
      if (!st) return;
      st.data.status = status;
      st.step = 'acc_desc';
      return send(chatId, ar 
        ? `📝 <b>وصف الحادث (خطوة 7/7)</b>\nيرجى كتابة وصف مختصر كيف وقع الحادث:` 
        : `📝 <b>DESCRIPTION (Étape 7/7)</b>\nVeuillez écrire une brève description des faits :`);
    }

    // --- 🚑 Accident Wizard Callbacks ---
    // (Already implemented)

    // --- 🛠️ 1. Resource Callbacks ---
    if (d.startsWith('rescat:')) {
      const st = states.get(chatId); if (!st) return;
      st.data.category = d.split(':')[1]; st.step = 'res_item';
      return send(chatId, ar ? `🛠️ <b>اسم القطعة (2/4)</b>\nما هي المعدات أو الوسائل المطلوبة؟` : `🛠️ <b>ITEM (2/4)</b>\nQuel est l'article demandé ?`);
    }
    if (d === 'res_final_send') {
      const st = states.get(chatId); if (!st) return;
      const r = ar ? `🛠️ <b>طلب وسائل جديد</b>\n━━━━━━━━━━━━━━\n📂 الفئة: ${st.data.category}\n🛠️ القطعة: ${st.data.item}\n🔢 الكمية: ${st.data.qty}\n✍️ السبب: ${st.data.reason}\n👤 بواسطة: ${st.data.reporter}` 
                   : `🛠️ <b>NOUVELLE DEMANDE DE MOYENS</b>\n━━━━━━━━━━━━━━\n📂 Cat: ${st.data.category}\n🛠️ Item: ${st.data.item}\n🔢 Qté: ${st.data.qty}\n✍️ Raison: ${st.data.reason}\n👤 Par: ${st.data.reporter}`;
      await notifyStaff(r, cfg, send); states.delete(chatId);
      return send(chatId, ar ? `✅ تم إرسال طلبك للإدارة بنجاح.` : `✅ Demande envoyée avec succès.`);
    }

    // --- ⚙️ 2. Maintenance Callbacks ---
    if (d.startsWith('maintloc:')) {
      const st = states.get(chatId); if (!st) return;
      st.data.location = d.split(':')[1]; st.step = 'maint_eq';
      return send(chatId, ar ? `⚙️ <b>اسم الجهاز/الآلة (2/4)</b>\nما هو الجهاز المتعطل؟` : `⚙️ <b>ÉQUIPEMENT (2/4)</b>\nQuel appareil est en panne ?`);
    }
    if (d.startsWith('maintpri:')) {
      const st = states.get(chatId); if (!st) return;
      st.data.priority = d.split(':')[1]; st.step = 'maint_stop';
      const kbd = { inline_keyboard: [[{ text: ar ? '✅ نعم' : '✅ Oui', callback_data: 'maintstop:Oui' }, { text: ar ? '❌ لا' : '❌ Non', callback_data: 'maintstop:Non' }]]};
      return send(chatId, ar ? `🛑 <b>توقف العمل (4/4)</b>\nهل تسبب هذا العطب في توقف العمل؟` : `🛑 <b>ARRÊT TRAVAIL (4/4)</b>\nLa panne bloque-t-elle le travail ?`, kbd);
    }
    if (d.startsWith('maintstop:')) {
      const st = states.get(chatId); if (!st) return;
      st.data.stops_work = d.split(':')[1]; st.step = 'maint_desc';
      return send(chatId, ar ? `📝 <b>وصف العطب</b>\nيرجى كتابة تفاصيل إضافية عن المشكلة:` : `📝 <b>DESCRIPTION</b>\nVeuillez décrire le problème :`);
    }
    if (d === 'maint_final_send') {
      const st = states.get(chatId); if (!st) return;
      const r = ar ? `⚙️ <b>بلاغ عطب تقني جديد</b>\n━━━━━━━━━━━━━━\n📍 المكان: ${st.data.location}\n⚙️ الجهاز: ${st.data.equipment}\n⚡ الأولوية: ${st.data.priority}\n🛑 توقف العمل: ${st.data.stops_work}\n📝 الوصف: ${st.data.description}\n👤 بواسطة: ${st.data.reporter}`
                   : `⚙️ <b>NOUVEAU SIGNALEMENT DE PANNE</b>\n━━━━━━━━━━━━━━\n📍 Lieu: ${st.data.location}\n⚙️ Équip: ${st.data.equipment}\n⚡ Prio: ${st.data.priority}\n🛑 Arrêt: ${st.data.stops_work}\n📝 Desc: ${st.data.description}\n👤 Par: ${st.data.reporter}`;
      await notifyStaff(r, cfg, send); states.delete(chatId);
      return send(chatId, ar ? `✅ تم إبلاغ مصلحة الصيانة والإدارة.` : `✅ Service maintenance informé.`);
    }

    // --- 💼 3. Recruitment Callbacks ---
    if (d.startsWith('hiretype:')) {
      const st = states.get(chatId); if (!st) return;
      st.data.contract = d.split(':')[1]; st.step = 'hire_reason';
      return send(chatId, ar ? `✍️ <b>التبرير (4/4)</b>\nلماذا نحتاج لهذا الموظف؟ (مثال: استبدال موظف مستقيل)` : `✍️ <b>JUSTIFICATION (4/4)</b>\nPourquoi ce recrutement ?`);
    }
    if (d === 'hire_final_send') {
      const st = states.get(chatId); if (!st) return;
      const r = ar ? `💼 <b>طلب توظيف جديد</b>\n━━━━━━━━━━━━━━\n🏢 القسم: ${st.data.department}\n💼 المنصب: ${st.data.title}\n📜 العقد: ${st.data.contract}\n✍️ التبرير: ${st.data.reason}\n👤 بواسطة: ${st.data.reporter}`
                   : `💼 <b>DEMANDE DE RECRUTEMENT</b>\n━━━━━━━━━━━━━━\n🏢 Dept: ${st.data.department}\n💼 Poste: ${st.data.title}\n📜 Contrat: ${st.data.contract}\n✍️ Motif: ${st.data.reason}\n👤 Par: ${st.data.reporter}`;
      await notifyStaff(r, cfg, send); states.delete(chatId);
      return send(chatId, ar ? `✅ تم إرسال طلب التوظيف للمدير العام.` : `✅ Demande envoyée au DG.`);
    }

    // --- 📊 5. Production Callbacks ---
    if (d.startsWith('prodshift:')) {
      const st = states.get(chatId); if (!st) return;
      st.data.shift = d.split(':')[1]; st.step = 'prod_target';
      const kbd = { inline_keyboard: [[{ text: ar ? '✅ نعم' : '✅ Oui', callback_data: 'prodtarget:Oui' }, { text: ar ? '❌ لا' : '❌ Non', callback_data: 'prodtarget:Non' }]]};
      return send(chatId, ar ? `🎯 <b>تحقيق الهدف (2/3)</b>\nهل تم تحقيق هدف الإنتاج المسطر لهذا اليوم؟` : `🎯 <b>OBJECTIF (2/3)</b>\nL'objectif a-t-il été atteint ?`, kbd);
    }
    if (d.startsWith('prodtarget:')) {
      const st = states.get(chatId); if (!st) return;
      st.data.target = d.split(':')[1]; st.step = 'prod_notes';
      return send(chatId, ar ? `📝 <b>ملاحظات (3/3)</b>\nاكتب أي ملاحظات أو مشاكل حدثت أثناء الوردية:` : `📝 <b>NOTES (3/3)</b>\nNotes ou problèmes rencontrés :`);
    }
    if (d === 'prod_final_send') {
      const st = states.get(chatId); if (!st) return;
      const r = ar ? `📊 <b>تقرير إنتاج يومي</b>\n━━━━━━━━━━━━━━\n🕒 الوردية: ${st.data.shift}\n🎯 تحقيق الهدف: ${st.data.target}\n📝 ملاحظات: ${st.data.notes}\n👤 المسؤول: ${st.data.reporter}`
                   : `📊 <b>RAPPORT DE PRODUCTION</b>\n━━━━━━━━━━━━━━\n🕒 Shift: ${st.data.shift}\n🎯 Objectif atteint: ${st.data.target}\n📝 Notes: ${st.data.notes}\n👤 Resp: ${st.data.reporter}`;
      await notifyStaff(r, cfg, send); states.delete(chatId);
      return send(chatId, ar ? `✅ تم إرسال تقرير الإنتاج للمدير العام.` : `✅ Rapport de production envoyé.`);
    }

    // --- 💡 6. Suggestion Callbacks ---
    if (d.startsWith('sugcat:')) {
      const st = states.get(chatId); if (!st) return;
      st.data.category = d.split(':')[1]; st.step = 'sug_idea';
      return send(chatId, ar ? `💡 <b>اشرح فكرتك (2/3)</b>\nيرجى كتابة اقتراحك بالتفصيل:` : `💡 <b>VOTRE IDÉE (2/3)</b>\nVeuillez détailler votre idée :`);
    }
    if (d === 'sug_final_send') {
      const st = states.get(chatId); if (!st) return;
      const r = ar ? `💡 <b>اقتراح جديد من موظف</b>\n━━━━━━━━━━━━━━\n📂 المجال: ${st.data.category}\n💡 الفكرة: ${st.data.idea}\n🚀 الفائدة: ${st.data.benefit}\n👤 صاحب الفكرة: ${st.data.reporter}`
                   : `💡 <b>NOUVELLE IDÉE / SUGGESTION</b>\n━━━━━━━━━━━━━━\n📂 Domaine: ${st.data.category}\n💡 Idée: ${st.data.idea}\n🚀 Bénéfice: ${st.data.benefit}\n👤 Auteur: ${st.data.reporter}`;
      await notifyStaff(r, cfg, send); states.delete(chatId);
      return send(chatId, ar ? `✅ شكراً لك! تم إرسال فكرتك للمدير العام لدراستها.` : `✅ Merci ! Idée envoyée au DG.`);
    }

    if (d === 'acc_final_send') {
      const st = states.get(chatId);
      if (!st) return;
      const emp = db.hr_employees?.find(e => String(e.id) === st.empId);
      const empName = emp ? (ar ? `${emp.lastName_ar} ${emp.firstName_ar}` : `${emp.lastName_fr} ${emp.firstName_fr}`) : 'Unknown';
      const d = st.data;
      
      const report = ar 
        ? `🚨 <b>تبليغ رسمي عن حادث عمل</b>\n━━━━━━━━━━━━━━\n👤 <b>المصاب:</b> ${empName}\n📅 <b>التاريخ:</b> ${d.date}\n📍 <b>المكان:</b> ${d.location}\n🤕 <b>الإصابة:</b> ${d.injury}\n👥 <b>الشهود:</b> ${d.witnesses}\n🏥 <b>المستشفى:</b> ${d.hospital}\n🏃 <b>الحالة:</b> ${d.status}\n📝 <b>الوصف:</b> ${d.description}\n━━━━━━━━━━━━━━\n👤 <b>بواسطة:</b> ${userData.name}\n⏰ ${new Date().toLocaleString()}`
        : `🚨 <b>ACCIDENT DE TRAVAIL SIGNALÉ</b>\n━━━━━━━━━━━━━━\n👤 <b>Victime:</b> ${empName}\n📅 <b>Date:</b> ${d.date}\n📍 <b>Lieu:</b> ${d.location}\n🤕 <b>Blessure:</b> ${d.injury}\n👥 <b>Témoins:</b> ${d.witnesses}\n🏥 <b>Hôpital:</b> ${d.hospital}\n🏃 <b>Statut:</b> ${d.status}\n📝 <b>Description:</b> ${d.description}\n━━━━━━━━━━━━━━\n👤 <b>Par:</b> ${userData.name}\n⏰ ${new Date().toLocaleString()}`;

      await notifyStaff(report, cfg, send);
      states.delete(chatId);
      return send(chatId, ar 
        ? `✅ <b>تم إرسال التقرير بنجاح!</b>\nتم إخطار الإدارة والمدير العام بالحادث فوراً.` 
        : `✅ <b>Rapport envoyé avec succès !</b>\nLa direction et le DG ont été informés immédiatement.`);
    }

    if (d === 'stats_menu') {
      const kbd = { inline_keyboard: [
        [{ text: ar ? '🟢 شركة الفار' : '🟢 Statistiques ALVER', callback_data: 'stats:alver' }],
        [{ text: ar ? '🔵 شركة فارتك' : '🔵 Statistiques VERRE TECH', callback_data: 'stats:vt' }],
        [{ text: ar ? '👑 الحصيلة المجمعة' : '👑 Bilan Global', callback_data: 'stats:global' }],
        [{ text: ar ? '🏠 القائمة الرئيسية' : '🏠 Menu Principal', callback_data: 'menu' }]
      ]};
      return send(chatId, ar ? '📊 <b>اختر نوع الإحصائيات:</b>' : '📊 <b>Choisissez le type de statistiques :</b>', kbd);
    }

    if (d.startsWith('stats:')) {
      const type = d.split(':')[1];
      return send(chatId, getStatsMsg(db, ar, type), { inline_keyboard: [
        [{ text: ar ? '🔄 تحديث' : '🔄 Actualiser', callback_data: d }],
        [{ text: ar ? '🔙 رجوع' : '🔙 Retour', callback_data: 'stats_menu' }]
      ]});
    }

    if (d === 'effectifs_dir' || d.startsWith('eff_comp:')) {
      const role = String(userData.role).toLowerCase();
      if (role !== 'admin' && role !== 'general_manager') {
        return send(chatId, ar ? '❌ <b>عذراً، هذه الميزة مخصصة للإدارة العليا فقط.</b>' : '❌ <b>Accès restreint à la Direction Générale.</b>');
      }
      
      const db = loadDB();
      if (d === 'effectifs_dir') {
        return send(chatId, ar ? '🏢 <b>الرجاء اختيار الشركة لعرض الإحصائيات:</b>\n━━━━━━━━━━━━━━' : '🏢 <b>Veuillez choisir la société:</b>\n━━━━━━━━━━━━━━', { inline_keyboard: [
          [{ text: ar ? '🟢 شركة الفار (ALVER)' : '🟢 ALVER', callback_data: 'eff_comp:alver' }],
          [{ text: ar ? '🔵 شركة فارتك (VERRE TECH)' : '🔵 VERRE TECH', callback_data: 'eff_comp:vt' }],
          [{ text: ar ? '🔙 رجوع' : '🔙 Retour', callback_data: 'menu' }]
        ]});
      }

      if (d.startsWith('eff_comp:')) {
        const compType = d.split(':')[1];
        return send(chatId, getEffectifsCompanyMsg(db, ar, compType), { inline_keyboard: [
          [{ text: ar ? '🔄 تحديث' : '🔄 Actualiser', callback_data: d }],
          [{ text: ar ? '🔙 رجوع' : '🔙 Retour', callback_data: 'effectifs_dir' }],
          [{ text: ar ? '🏠 القائمة الرئيسية' : '🏠 Menu Principal', callback_data: 'menu' }]
        ]});
      }
    }

    if (d === 'bva_set_start_num') {
      states.set(chatId, { step: 'bva_set_start_num_wait' });
      saveStates();
      return send(chatId, ar 
        ? `⚙️ <b>إعداد رقم البداية لإذن البيع (BVA)</b>\n━━━━━━━━━━━━━━\nالرجاء كتابة الرقم الذي تريد أن تبدأ به الفواتير القادمة (مثلاً: <code>152</code> ليكون الإذن القادم 152/2026):`
        : `⚙️ <b>Réglage du numéro de départ (BVA)</b>\n━━━━━━━━━━━━━━\nVeuillez écrire le numéro de départ pour le prochain bon (Ex: <code>152</code> pour BVA 152/2026) :`);
    }

    if (d === 'bva_create') {
      states.set(chatId, { step: 'bva_client', data: { commercialName: userData.name, commercialId: fromId, articles: [] } });
      saveStates();
      return send(chatId, ar 
        ? `🔍 <b>الخطوة 1/5: اختيار الزبون</b>\nيرجى إرسال اسم الزبون أو جزء منه للبحث عنه في قاعدة البيانات:` 
        : `🔍 <b>Étape 1/5: Sélection du Client</b>\nVeuillez envoyer le nom ou code du client pour rechercher :`);
    }

    if (d.startsWith('bva_clsel:')) {
      const clientId = d.split(':')[1];
      const clients = loadClients();
      const client = clients.find(c => c.id === clientId);
      const clientName = client ? `${client.id} - ${client.name}` : clientId;
      
      const st = states.get(chatId);
      if (!st) return;
      st.data.clientId = clientId;
      st.data.clientName = clientName;
      st.step = 'bva_bcnum';
      states.set(chatId, st);
      saveStates();
      
      return send(chatId, ar
        ? `✅ تم اختيار الزبون: <b>${clientName}</b>\n\n✍️ <b>الخطوة 2/5: إدخال رقم الطلبية (BC N°):</b>`
        : `✅ Client sélectionné: <b>${clientName}</b>\n\n✍️ <b>Étape 2/5: Saisir BC N° :</b>`);
    }

    if (d === 'bva_add_more_btn') {
      return send(chatId, ar ? '✍️ اكتب اسم أو رمز المادة الآن:' : '✍️ Tapez le nom ou le code de l\'article maintenant :');
    }

    if (d === 'bva_art_done') {
      const st = states.get(chatId);
      if (!st || !st.data.articles || st.data.articles.length === 0) {
        return send(chatId, ar ? '⚠️ يرجى إضافة أرتيكل واحد على الأقل!' : '⚠️ Veuillez ajouter au moins un article!');
      }
      st.step = 'bva_paymeth';
      states.set(chatId, st);
      saveStates();
      
      const kbd = { inline_keyboard: [
        [{ text: ar ? '🏦 تحويل بنكي (Virement)' : '🏦 Virement', callback_data: 'bva_pm:Virement' }],
        [{ text: ar ? '💵 دفع نقدي (Espèce)' : '💵 Espèce', callback_data: 'bva_pm:Espèce' }],
        [{ text: ar ? '✍️ شيك (Chèque)' : '✍️ Chèque', callback_data: 'bva_pm:Chèque' }],
        [{ text: ar ? '📥 إيداع (Versement)' : '📥 Versement', callback_data: 'bva_pm:Versement' }]
      ]};
      return send(chatId, ar 
        ? `💳 <b>الخطوة 4/5: اختر طريقة الدفع:</b>` 
        : `💳 <b>Étape 4/5: Mode de paiement :</b>`, kbd);
    }

    // ── Article selection callback ─────────────────────────────────────────
    if (d.startsWith('bva_artsel:')) {
      const artId = d.replace('bva_artsel:', '');
      const st = states.get(chatId);
      if (!st) return;
      const articles = loadArticles();
      const article = articles.find(a => String(a.id) === artId);
      if (!article) return send(chatId, ar ? '⚠️ المادة غير موجودة!' : '⚠️ Article introuvable!');
      st.data.currentArticle = article;
      st.step = 'bva_article_qty';
      states.set(chatId, st);
      saveStates();
      return send(chatId, ar 
        ? `✅ اخترت: <b>${article.name}</b>${article.unit ? ` (${article.unit})` : ''}\n\n🔢 <b>أدخل الكمية المطلوبة (أرقام فقط):</b>` 
        : `✅ Article: <b>${article.name}</b>${article.unit ? ` (${article.unit})` : ''}\n\n🔢 <b>Saisissez la quantité :</b>`);
    }

    if (d.startsWith('bva_pm:')) {
      const method = d.split(':')[1];
      const st = states.get(chatId);
      if (!st) return;
      st.data.paymentMethod = method;
      st.step = 'bva_trans';
      states.set(chatId, st);
      saveStates();
      
      const kbd = { inline_keyboard: [
        [{ text: ar ? '🟢 نقل عبر مؤسسة الفار (ALVER)' : '🟢 ALVER (Si rendu)', callback_data: 'bva_tr:ALVER' }],
        [{ text: ar ? '🔵 النقل على عاتق الزبون (CLIENT)' : '🔵 CLIENT', callback_data: 'bva_tr:CLIENT' }]
      ]};
      return send(chatId, ar 
        ? `🚚 <b>الخطوة 5/5: اختر نوع النقل واللوجستيك:</b>` 
        : `🚚 <b>Étape 5/5: Mode de Transport :</b>`, kbd);
    }

    if (d.startsWith('bva_tr:')) {
      const transType = d.split(':')[1];
      const st = states.get(chatId);
      if (!st) return;
      st.data.transportType = transType;
      st.step = 'bva_fact_num';
      states.set(chatId, st);
      saveStates();
      
      return send(chatId, ar 
        ? `📝 <b>الخطوة 6/7: إدخال رقم الفاتورة (N° Facture)</b>\nيرجى إرسال رقم الفاتورة:` 
        : `📝 <b>Étape 6/7: Saisir N° Facture</b>\nVeuillez envoyer le numéro de facture :`);
    }

    // After message text for Facture N° (handled in text handler), step becomes 'bva_fact_montant'
    // After message text for Montant (handled in text handler), we display summary.
    // Wait, the message text handlers are elsewhere. I will need to update them too!
    
    // I am modifying the bva_confirm step here, which used to be step 5/5.
    // Let's create a new callback for the summary confirmation.
    if (d === 'bva_show_summary') {
      const st = states.get(chatId);
      if (!st) return;
      
      const itemsList = st.data.articles.map(a => `├ <code>${a.code}</code> - ${a.prod} (<b>${a.qty}</b>)`).join('\n');
      const payMethText = st.data.paymentMethod;
      
      const summary = ar 
        ? `📋 <b>ملخص إذن البيع والخروج (بما فيها الفوترة)</b>\n━━━━━━━━━━━━━━\n👤 الزبون: <b>${st.data.clientName}</b>\n📄 طلبية رقم (BC): <code>${st.data.bcNum}</code>\n💳 طريقة الدفع: <b>${payMethText}</b>\n🚚 النقل: <b>${st.data.transportType}</b>\n\n🧾 رقم الفاتورة: <code>${st.data.factureNum}</code>\n💰 المبلغ الإجمالي: <b>${st.data.amount} DA</b>\n\n📦 <b>المواد المشحونة:</b>\n${itemsList}\n━━━━━━━━━━━━━━`
        : `📋 <b>RÉSUMÉ DU BON DE VENTE ET FACTURATION</b>\n━━━━━━━━━━━━━━\n👤 Client: <b>${st.data.clientName}</b>\n📄 BC N°: <code>${st.data.bcNum}</code>\n💳 Paiement: <b>${payMethText}</b>\n🚚 Transport: <b>${st.data.transportType}</b>\n\n🧾 N° Facture: <code>${st.data.factureNum}</code>\n💰 Montant Total: <b>${st.data.amount} DA</b>\n\n📦 <b>Articles :</b>\n${itemsList}\n━━━━━━━━━━━━━━`;
        
      const kbd = { inline_keyboard: [
        [{ text: ar ? '✅ تأكيد وإرسال للمستودع (GDS)' : '✅ Confirmer & Envoyer (GDS)', callback_data: 'bva_confirm_sales' }],
        [{ text: ar ? '❌ إلغاء' : '❌ Annuler', callback_data: 'menu' }]
      ]};
      return send(chatId, summary, kbd);
    }

    if (d === 'bva_confirm_sales') {
      const st = states.get(chatId);
      if (!st || st.processing) return;
      st.processing = true;
      states.set(chatId, st);
      
      const db2 = loadDB();
      const bvaYear = new Date().getFullYear();
      let nextSeq = 1;
      log(`[BVA-Seq] hr_settings exists: ${!!db2.hr_settings} | bvaNextNumber: ${db2.hr_settings?.bvaNextNumber}`);
      if (db2.hr_settings && db2.hr_settings.bvaNextNumber) {
        nextSeq = parseInt(db2.hr_settings.bvaNextNumber);
        db2.hr_settings.bvaNextNumber = nextSeq + 1; // Increment for the next one
        log(`[BVA-Seq] ✅ Using bvaNextNumber: ${nextSeq}, next will be: ${nextSeq + 1}`);
      } else {
        const bvasThisYear = (db2.bon_vente || []).filter(b => new Date(b.createdAt || Date.now()).getFullYear() === bvaYear);
        const maxSeq = bvasThisYear.reduce((max, b) => {
          if (b.seqNumber) return Math.max(max, parseInt(b.seqNumber));
          return max;
        }, bvasThisYear.length);
        nextSeq = maxSeq + 1;
        log(`[BVA-Seq] ⚠️ bvaNextNumber NOT found, fallback seq: ${nextSeq}`);
      }

      const bvaId = 'bva_' + Math.random().toString(36).substring(2, 9);
      const newBva = {
        id: bvaId,
        seqNumber: nextSeq,
        clientId: st.data.clientId,
        clientName: st.data.clientName,
        bcNum: st.data.bcNum,
        articles: st.data.articles,
        paymentMethod: st.data.paymentMethod,
        transportType: st.data.transportType,
        factureNum: st.data.factureNum, // added from Commercial
        amount: st.data.amount,         // added from Commercial
        commercialName: st.data.commercialName,
        commercialId: st.data.commercialId,
        commercialDate: new Date().toLocaleDateString('fr-FR'),
        status: 'pending_shipping', // Changed to GDS directly
        createdAt: new Date().toISOString()
      };
      
      if (!db2.bon_vente) db2.bon_vente = [];
      db2.bon_vente.push(newBva);
      saveDB(db2);
      states.delete(chatId);
      saveStates();
      
      // Notify GDS Role (Expedition)
      const notifyMsg = ar
        ? `🔔 <b>إشعار للمستودع (GDS): إذن بيع جديد بانتظار التحميل</b>\n━━━━━━━━━━━━━━\n👤 الزبون: <b>${newBva.clientName}</b>\n📄 طلبية رقم: <code>${newBva.bcNum}</code>\n👤 من طرف: ${newBva.commercialName}\n\nيرجى إدخال رقم إذن التسليم (BL) ومعلومات الشاحنة والسائق.`
        : `🔔 <b>GDS: NOUVELLE EXPÉDITION PRÊTE</b>\n━━━━━━━━━━━━━━\n👤 Client: <b>${newBva.clientName}</b>\n📄 BC N°: <code>${newBva.bcNum}</code>\n👤 Par: ${newBva.commercialName}\n\nVeuillez saisir le N° BL et les détails du chauffeur.`;
        
      const kbd = { inline_keyboard: [[{ text: ar ? '🚚 تحميل وتأكيد الشحنة' : '🚚 Charger l\'Expédition', callback_data: `bva_ship_start:${bvaId}` }]] };
      await notifyBVARole(notifyMsg, 'gds', cfg, kbd);
      
      return send(chatId, ar 
        ? `✅ <b>تم إنشاء إذن البيع بنجاح!</b>\nتم إرسال إشعار لمصلحة المخازن (GDS) لتحميل الشحنة.`
        : `✅ <b>Bon de vente créé avec succès!</b>\nNotification transmise au service GDS pour expédition.`, 
        { inline_keyboard: [[{ text: ar ? '🏠 القائمة الرئيسية' : '🏠 Menu', callback_data: 'menu' }]] });
    }

    if (d.startsWith('bva_fin_start:')) {
      const bvaId = d.split(':')[1];
      const db2 = loadDB();
      const bva = (db2.bon_vente || []).find(b => b.id === bvaId);
      if (!bva) return send(chatId, ar ? '❌ إذن البيع غير موجود.' : '❌ Bon introuvable.');
      if (bva.status !== 'pending_finance') {
        return send(chatId, ar ? `⚠️ تم معالجة هذا الإذن مسبقاً` : `⚠️ Ce bon a déjà été traité.`);
      }
      
      const itemsList = bva.articles.map(a => `├ <code>${a.code}</code> - ${a.prod} (<b>${a.qty}</b>)`).join('\n');
      const summary = ar 
        ? `📋 <b>المراجعة النهائية (المالية)</b>\n━━━━━━━━━━━━━━\n👤 الزبون: <b>${bva.clientName}</b>\n📄 طلبية رقم (BC): <code>${bva.bcNum}</code>\n💳 طريقة الدفع: <b>${bva.paymentMethod}</b>\n🚚 النقل: <b>${bva.transportType}</b>\n\n🧾 رقم الفاتورة: <code>${bva.factureNum}</code>\n💰 المبلغ الإجمالي: <b>${bva.amount} DA</b>\n\n📦 <b>المواد المشحونة:</b>\n${itemsList}\n━━━━━━━━━━━━━━\n\nهل أنت متأكد من تأكيد هذه العملية لإصدار الوثيقة النهائية؟`
        : `📋 <b>VALIDATION FINALE (FINANCE)</b>\n━━━━━━━━━━━━━━\n👤 Client: <b>${bva.clientName}</b>\n📄 BC N°: <code>${bva.bcNum}</code>\n💳 Paiement: <b>${bva.paymentMethod}</b>\n🚚 Transport: <b>${bva.transportType}</b>\n\n🧾 N° Facture: <code>${bva.factureNum}</code>\n💰 Montant Total: <b>${bva.amount} DA</b>\n\n📦 <b>Articles :</b>\n${itemsList}\n━━━━━━━━━━━━━━\n\nVoulez-vous valider et générer le document PDF ?`;
      
      const kbd = { inline_keyboard: [
        [{ text: ar ? '✅ تأكيد وإصدار وثيقة الخروج' : '✅ Valider et Générer PDF', callback_data: `bva_fin_confirm_final:${bvaId}` }],
        [{ text: ar ? '❌ إلغاء الرجوع' : '❌ Annuler', callback_data: 'menu' }]
      ]};
      return send(chatId, summary, kbd);
    }

    if (d.startsWith('bva_fin_confirm_final:')) {
      const bvaId = d.split(':')[1];
      const db2 = loadDB();
      const bva = (db2.bon_vente || []).find(b => b.id === bvaId);
      if (!bva || bva.status !== 'pending_finance') return;
      
      // Finance validates → next step is Guard (pending_guard)
      bva.status = 'pending_guard';
      bva.financeName = userData.name;
      bva.financeId = fromId;
      bva.financeDate = new Date().toLocaleDateString('fr-FR');
      saveDB(db2);
      
      // Notify Guard (Poste de Garde) role
      const guardMsg = ar
        ? `🚛 <b>إشعار لمركز الحراسة (Poste de Garde): شاحنة في انتظار الإذن بالخروج</b>\n━━━━━━━━━━━━━━\n👤 الزبون: <b>${bva.clientName}</b>\n🚚 السائق: <b>${bva.driverName || 'N/A'}</b>\n🚛 الشاحنة: <code>${bva.vehiclePlate || 'N/A'}</code>\n💳 الفاتورة: <code>${bva.factureNum}</code>\n💰 المبلغ: <b>${bva.amount} DA</b>\n\nتمت مراجعة الوثيقة من طرف المالية. يرجى تأكيد خروج الشاحنة.`
        : `🚛 <b>POSTE DE GARDE: CAMION EN ATTENTE DE SORTIE</b>\n━━━━━━━━━━━━━━\n👤 Client: <b>${bva.clientName}</b>\n🚚 Chauffeur: <b>${bva.driverName || 'N/A'}</b>\n🚛 Camion: <code>${bva.vehiclePlate || 'N/A'}</code>\n💳 Facture: <code>${bva.factureNum}</code>\n💰 Montant: <b>${bva.amount} DA</b>\n\nDocument validé par la Finance. Veuillez confirmer la sortie du camion.`;

      const guardKbd = { inline_keyboard: [[{ text: ar ? '🚛 تأكيد خروج الشاحنة' : '🚛 Confirmer Sortie Camion', callback_data: `bva_guard_start:${bvaId}` }]] };
      await notifyBVARole(guardMsg, 'poste_garde', cfg, guardKbd);

      return send(chatId, ar
        ? `✅ <b>تمت المراجعة المالية بنجاح!</b>\n📤 تم إرسال إشعار لمركز الحراسة لتأكيد خروج الشاحنة وإصدار الوثيقة.`
        : `✅ <b>Validation financière effectuée!</b>\n📤 Notification transmise au Poste de Garde pour confirmer la sortie et générer le document.`,
        { inline_keyboard: [[{ text: ar ? '🏠 القائمة الرئيسية' : '🏠 Menu', callback_data: 'menu' }]] });
    }


    if (d.startsWith('bva_ship_start:')) {
      const bvaId = d.split(':')[1];
      const db2 = loadDB();
      const bva = (db2.bon_vente || []).find(b => b.id === bvaId);
      if (!bva) return send(chatId, ar ? '❌ إذن البيع غير موجود.' : '❌ Bon introuvable.');
      if (bva.status !== 'pending_shipping') {
        return send(chatId, ar ? `⚠️ تم الشحن مسبقاً.` : `⚠️ Déjà expédié.`);
      }
      states.set(chatId, { step: 'bva_ship_bl', bvaId, data: {} });
      saveStates();
      const isAdm = String(userData.role).toLowerCase() === 'admin' || String(userData.role).toLowerCase() === 'general_manager';
      return send(chatId, ar 
        ? (isAdm ? `👑 <b>الإدارة (تدخل مباشر): إدخال رقم إذن التسليم (Bon de Livraison)</b>\nيرجى كتابة رقم إذن التسليم (BL N°):` : `🚚 <b>مصلحة الشحن: إدخال رقم إذن التسليم (Bon de Livraison)</b>\nيرجى كتابة رقم إذن التسليم (BL N°):`) 
        : (isAdm ? `👑 <b>ADMIN: Saisir N° Bon de Livraison (BL)</b>\nVeuillez écrire le numéro de BL :` : `🚚 <b>EXPÉDITION: Saisir N° Bon de Livraison (BL)</b>\nVeuillez écrire le numéro de BL :`));
    }

    if (d.startsWith('bva_ship_final:')) {
      const bvaId = d.split(':')[1];
      const db2 = loadDB();
      const bva = (db2.bon_vente || []).find(b => b.id === bvaId);
      if (!bva || bva.status !== 'pending_shipping') return;
      
      const st = states.get(chatId);
      bva.status = 'pending_finance';
      bva.blNum = st.data.blNum;
      bva.transporter = st.data.transporter;
      bva.driverName = st.data.driverName;
      bva.vehiclePlate = st.data.vehiclePlate;
      bva.pcNum = st.data.pcNum;
      bva.gdsName = userData.name;
      bva.gdsId = fromId;
      bva.shippingDate = new Date().toLocaleDateString('fr-FR');
      saveDB(db2);
      states.delete(chatId);
      saveStates();
      
      // Notify Finance Role
      const notifyMsg = ar
        ? `🔔 <b>إشعار للمالية (Comptabilité): شحنة جاهزة للتأكيد والفوترة</b>\n━━━━━━━━━━━━━━\n👤 الزبون: <b>${bva.clientName}</b>\n📄 رقم الفاتورة: <code>${bva.factureNum || 'N/A'}</code>\n💰 المبلغ: <b>${bva.amount || 'N/A'} DA</b>\n\nيرجى المراجعة وتأكيد الدفع النهائي لإصدار الوثيقة.`
        : `🔔 <b>FINANCE: EXPÉDITION PRÊTE À VALIDER</b>\n━━━━━━━━━━━━━━\n👤 Client: <b>${bva.clientName}</b>\n📄 Facture N°: <code>${bva.factureNum || 'N/A'}</code>\n💰 Montant: <b>${bva.amount || 'N/A'} DA</b>\n\nVeuillez valider le paiement final pour générer le document.`;
        
      const kbd = { inline_keyboard: [[{ text: ar ? '💳 مراجعة وتأكيد الوثيقة' : '💳 Valider et Générer le Document', callback_data: `bva_fin_start:${bvaId}` }]] };
      await notifyBVARole(notifyMsg, 'finance', cfg, kbd);
      
      return send(chatId, ar 
        ? `✅ <b>تم تسجيل معلومات الشحن بنجاح!</b>\nتم إرسال إشعار للمالية للمراجعة النهائية وإصدار الوثيقة.`
        : `✅ <b>Détails de chargement validés!</b>\nNotification transmise à la Finance pour validation finale.`,

        { inline_keyboard: [[{ text: ar ? '🏠 القائمة الرئيسية' : '🏠 Menu', callback_data: 'menu' }]] });
    }

    if (d.startsWith('bva_guard_start:')) {
      const bvaId = d.split(':')[1];
      const db2 = loadDB();
      const bva = (db2.bon_vente || []).find(b => b.id === bvaId);
      if (!bva) return send(chatId, ar ? '❌ إذن البيع غير موجود.' : '❌ Bon introuvable.');
      if (bva.status !== 'pending_guard') {
        return send(chatId, ar ? `⚠️ تمت مغادرة الشاحنة مسبقاً.` : `⚠️ Camion déjà sorti.`);
      }
      
      states.set(chatId, { step: 'bva_guard_shift', bvaId });
      saveStates();
      
      const kbd = { inline_keyboard: [
        [{ text: ar ? 'الفرقة A' : 'Équipe A', callback_data: `bva_gd_conf:${bvaId}:A` },
         { text: ar ? 'الفرقة B' : 'Équipe B', callback_data: `bva_gd_conf:${bvaId}:B` }],
        [{ text: ar ? 'الفرقة C' : 'Équipe C', callback_data: `bva_gd_conf:${bvaId}:C` },
         { text: ar ? 'الفرقة D' : 'Équipe D', callback_data: `bva_gd_conf:${bvaId}:D` }]
      ]};
      const isAdm = String(userData.role).toLowerCase() === 'admin' || String(userData.role).toLowerCase() === 'general_manager';
      return send(chatId, ar 
        ? (isAdm ? `👑 <b>الإدارة (تدخل مباشر): اختر فرقة الحراسة (Shift) لتأكيد خروج الشاحنة:</b>` : `👮 <b>مركز الحراسة: اختر فرقة الحراسة (Shift) لتأكيد خروج الشاحنة:</b>`) 
        : (isAdm ? `👑 <b>ADMIN: Choisir l'équipe de garde :</b>` : `👮 <b>POSTE DE GARDE: Choisir l'équipe de garde :</b>`), kbd);
    }

    if (d.startsWith('bva_gd_conf:')) {
      const parts = d.split(':');
      const bvaId = parts[1];
      const shift = parts[2];
      const db2 = loadDB();
      const bva = (db2.bon_vente || []).find(b => b.id === bvaId);
      if (!bva || bva.status !== 'pending_guard') return;
      
      bva.status = 'completed';
      bva.guardName = userData.name;
      bva.guardId = fromId;
      bva.guardDate = new Date().toLocaleDateString('fr-FR');
      const tzOpts = { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Algiers' };
      bva.entryTime = new Date(bva.createdAt).toLocaleTimeString('fr-FR', tzOpts);
      bva.exitTime = new Date().toLocaleTimeString('fr-FR', tzOpts);
      bva.guardShift = shift;
      saveDB(db2);
      
      await answerCallbackQuery(cbq.id, ar ? '✅ تم تأكيد الخروج الفعلي!' : '✅ Sortie camion confirmée!');
      
      await send(chatId, ar
        ? `✅ <b>تم تأكيد خروج الشاحنة وإتمام إذن البيع!</b>\n🔄 جاري توليد وثيقة PDF وإرسالها...`
        : `✅ <b>Sortie camion confirmée et bon complété!</b>\n🔄 Génération du PDF en cours...`);
        
      try {
        const pdfPath = path.join(os.tmpdir(), `BVA_${bva.id}.pdf`);
        await generateBonVentePDF(bva, pdfPath);
        
        // Send ONLY TEXT notification back to Guard Post
        await send(chatId, ar ? `📄 إذن خروج شاحنة مكتمل: <b>${bva.clientName}</b>\n📧 سيتم إرسال الوثيقة عبر البريد الإلكتروني للمراجعة والطباعة.` : `📄 Autorisation de sortie complétée: <b>${bva.clientName}</b>\n📧 Le document sera envoyé par e-mail.`);
        
        // Notify Commercial of completion with TEXT ONLY
        if (bva.commercialId) {
          await send(bva.commercialId, ar ? `✅ <b>اكتمل شحن إذن البيع الخاص بك!</b>\nالزبون: ${bva.clientName}\n📧 تم إرسال وثيقة الخروج للإدارة عبر البريد.` : `✅ <b>Votre bon de vente a été expédié!</b>\nClient: ${bva.clientName}\n📧 Document envoyé par e-mail.`);
        }
        
        // Email PDF to HR / Admin email
        const s = cfg.email_settings || {};
        const emails = s.hr_notification_email
          ? s.hr_notification_email.split(',').map(e => e.trim()).filter(Boolean)
          : [];
        if (emails.length > 0) {
          const subject = `Bon de Vente & Sortie - ${bva.clientName} - BL ${bva.blNum}`;
          const body = `Bonjour,\n\nVeuillez trouver ci-joint le Bon de Vente et Autorisation de Sortie au format paysage complété pour le client ${bva.clientName}.\n\n- Bon N°: ${bva.id.toUpperCase().slice(0,8)}\n- BL N°: ${bva.blNum}\n- Facture N°: ${bva.factureNum}\n- Montant: ${bva.amount} DA\n- Saisie par: ${bva.commercialName}\n- Date de sortie: ${bva.guardDate} à ${bva.exitTime} (Equipe: ${bva.guardShift})\n\nCordialement,\nALVER Spa Automation Bot`;
          await sendEmail(emails, subject, body, [{ filename: `BVA_${bva.id.slice(0,8)}.pdf`, path: pdfPath }]);
        }
        
        // Clean up temp
        try { fs.unlinkSync(pdfPath); } catch (_) {}
        
      } catch (e) {
        log(`[BVA-PDF-Error] ${e.message}`);
        await send(chatId, `❌ Error generating/sending BVA PDF: ${e.message}`);
      }
      return;
    }

    if (d === 'bva_list') {
      const db2 = loadDB();
      const list = (db2.bon_vente || []).slice(-8).reverse();
      if (list.length === 0) {
        return send(chatId, ar ? 'ℹ️ لا توجد أذونات مسجلة حالياً.' : 'ℹ️ Aucun bon enregistré.');
      }
      let msg = ar ? `📋 <b>أحدث أذونات البيع والخروج:</b>\n━━━━━━━━━━━━━━\n` : `📋 <b>Derniers Bons de Vente :</b>\n━━━━━━━━━━━━━━\n`;
      for (const b of list) {
        const statusLabels = { pending_finance: 'المالية 💵', pending_shipping: 'المستودع 🚚', pending_guard: 'الحراسة 👮', completed: 'مكتمل ✅' };
        const statusLabel = ar ? (statusLabels[b.status] || b.status) : b.status.toUpperCase();
        msg += `📄 كود: <code>${b.id.toUpperCase().slice(0, 8)}</code>\n👤 زبون: <b>${b.clientName}</b>\n📌 الحالة: <code>${statusLabel}</code>\n━━━━━━━━━━━━━━\n`;
      }
      return send(chatId, msg, { inline_keyboard: [[{ text: ar ? '🏠 القائمة الرئيسية' : '🏠 Menu', callback_data: 'menu' }]] });
    }

    if (d === 'bva_list_pending_finance') {
      const db2 = loadDB();
      const list = (db2.bon_vente || []).filter(b => b.status === 'pending_finance');
      if (list.length === 0) {
        return send(chatId, ar ? 'ℹ️ لا توجد أذونات بيع معلقة للمالية.' : 'ℹ️ Aucune facture en attente pour la Finance.');
      }
      for (const b of list) {
        const kbd = { inline_keyboard: [[{ text: ar ? `💳 معالجة: ${b.clientName}` : `💳 Traiter: ${b.clientName}`, callback_data: `bva_fin_start:${b.id}` }]] };
        await send(chatId, ar 
          ? `📄 كود: <code>${b.id.toUpperCase().slice(0, 8)}</code>\n👤 زبون: <b>${b.clientName}</b>\n📄 BC N°: <code>${b.bcNum}</code>\n⏰ أنشئ في: ${new Date(b.createdAt).toLocaleDateString()}`
          : `📄 ID: <code>${b.id.toUpperCase().slice(0, 8)}</code>\n👤 Client: <b>${b.clientName}</b>\n📄 BC: <code>${b.bcNum}</code>`, kbd);
      }
      return;
    }

    if (d === 'bva_list_pending_shipping') {
      const db2 = loadDB();
      const list = (db2.bon_vente || []).filter(b => b.status === 'pending_shipping');
      if (list.length === 0) {
        return send(chatId, ar ? 'ℹ️ لا توجد شحنات معلقة للمخازن (GDS).' : 'ℹ️ Aucune expédition en attente pour le GDS.');
      }
      for (const b of list) {
        const kbd = { inline_keyboard: [[{ text: ar ? `🚚 شحن البضاعة` : `🚚 Expédier`, callback_data: `bva_ship_start:${b.id}` }]] };
        await send(chatId, ar 
          ? `📄 كود: <code>${b.id.toUpperCase().slice(0, 8)}</code>\n👤 زبون: <b>${b.clientName}</b>\n💳 الفاتورة: <code>${b.factureNum}</code>\n💰 القيمة: <b>${b.amount} DA</b>\n⏰ جاهز منذ: ${new Date(b.financeDate ? b.financeDate : b.createdAt).toLocaleDateString()}`
          : `📄 ID: <code>${b.id.toUpperCase().slice(0, 8)}</code>\n👤 Client: <b>${b.clientName}</b>\n💳 Invoice: <code>${b.factureNum}</code>`, kbd);
      }
      return;
    }

    if (d === 'bva_list_pending_guard') {
      const db2 = loadDB();
      const list = (db2.bon_vente || []).filter(b => b.status === 'pending_guard');
      if (list.length === 0) {
        return send(chatId, ar ? 'ℹ️ لا توجد شاحنات عند البوابة بانتظار الخروج.' : 'ℹ️ Aucun camion en attente au Poste de Garde.');
      }
      for (const b of list) {
        const kbd = { inline_keyboard: [[{ text: ar ? `🚛 تأكيد خروج الشاحنة` : `🚛 Confirmer Sortie`, callback_data: `bva_guard_start:${b.id}` }]] };
        await send(chatId, ar 
          ? `📄 إذن بيع: <code>${b.id.toUpperCase().slice(0, 8)}</code>\n👤 زبون: <b>${b.clientName}</b>\n🚚 سائق: <b>${b.driverName}</b> | شاحنة: <code>${b.vehiclePlate}</code>\n⏰ جاهز منذ: ${new Date(b.shippingDate ? b.shippingDate : b.createdAt).toLocaleDateString()}`
          : `📄 ID: <code>${b.id.toUpperCase().slice(0, 8)}</code>\n👤 Client: <b>${b.clientName}</b>\n🚚 Driver: <b>${b.driverName}</b>`, kbd);
      }
      return;
    }

    return;
  }


  if (txtLow === '/get_logs') {
    if (userData.role !== 'admin') return;
    const logPath = path.join(ROOT_DIR, 'bot_debug.log');
    if (!fs.existsSync(logPath)) return send(chatId, 'Log file not found.');
    
    // Send as document via direct fetch
    const BOT_TOKEN = cfg.bot_token || process.env.BOT_TOKEN;
    const fsData = fs.readFileSync(logPath);
    const formData = new FormData();
    formData.append('chat_id', String(chatId));
    formData.append('document', new Blob([fsData]), 'bot_debug.log');
    
    try {
      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`, {
        method: 'POST',
        body: formData
      });
    } catch (e) {
      log(`[Logs-Error] Failed to send logs: ${e.message}`);
      await send(chatId, `❌ Error sending logs: ${e.message}`);
    }
    return;
  }

  if (txtLow === '/start' || txtLow === '/m') {
    // Check saved language: 1st from persistent Map, 2nd from config
    const savedLang = langs.get(chatId) || userData?.lang;
    
    if (savedLang) {
      return roleObj.showMenu(chatId, savedLang === 'ar', getStatsMsg);
    }

    // If no language is found, show the selection keyboard
    return send(chatId, '🌐 <b>الرجاء اختيار اللغة / Choisissez la langue</b>', { 
      inline_keyboard: [[
        { text: 'العربية 🇩🇿', callback_data: 'lang:ar' }, 
        { text: 'Français 🇫🇷', callback_data: 'lang:fr' }
      ]] 
    });
  }

  if (txtLow === '/test_email') {
    const role = String(userData.role).toLowerCase();
    if (role !== 'admin' && role !== 'manager' && role !== 'chef_de_quart') return;
    
    await send(chatId, '📧 <b>جاري إرسال بريد تجريبي (Port 465)...</b>');
    try {
      const success = await sendEmail(userData.email || 'tewfik.nouar@alver.dz', 'Test Bot Email', 'Ceci est un test de la configuration SMTP Cloud via Port 465.');
      return send(chatId, success ? '✅ تم إرسال البريد التجريبي بنجاح!' : '❌ فشل إرسال البريد. تأكد من إعدادات السيرفر.');
    } catch (e) {
      return send(chatId, `❌ خطأ تقني: ${e.message}`);
    }
  }

  if (txtLow === '/show_config' && String(userData.role).toLowerCase() === 'admin') {
    const s = cfg.email_settings || {};
    return send(chatId, `📧 <b>إعدادات البريد الحالية:</b>\nقائمة HR: <code>${s.hr_notification_email || 'غير محددة'}</code>\nالمنفذ: <code>${s.smtp_port || 2525}</code>`);
  }

  if (txtLow === '/me' || txtLow === '/id') {
    const isAdminRole = String(userData.role).toLowerCase() === 'admin' || String(userData.role).toLowerCase() === 'manager' || String(userData.role).toLowerCase() === 'chef_de_quart';
    const db = isAdminRole ? loadDB() : null;
    const count = db?.hr_employees?.length || 0;
    
    const meMsg = ar 
      ? `👤 <b>البطاقة التعريفية:</b>\n━━━━━━━━━━━━━━\n🆔 المعرف: <code>${fromId}</code>\n👤 الاسم: <b>${userData.name}</b>\n🛡️ الرتبة: <code>${userData.role}</code>${isAdminRole ? `\n👥 قاعدة البيانات: <b>${count} موظف</b>` : ''}\n🌐 اللغة: ${userData.lang || 'ar'}`
      : `👤 <b>CARTE D'IDENTITÉ:</b>\n━━━━━━━━━━━━━━\n🆔 ID: <code>${fromId}</code>\n👤 Nom: <b>${userData.name}</b>\n🛡️ Rôle: <code>${userData.role}</code>${isAdminRole ? `\n👥 Base de données: <b>${count} employés</b>` : ''}\n🌐 Langue: ${userData.lang || 'fr'}`;
    
    return send(chatId, meMsg);
  }

  if (txtLow === '/version') {
    return send(chatId, `🚀 <b>TewfikSoft HR Bot v10.2</b>\n━━━━━━━━━━━━━━\n✅ التحديثات الأخيرة:\n- تحديث قائمة الإيميلات لإرسال الإشعارات لـ 5 عناوين بريد إلكتروني.\n- تحسين "أمر بمهمة" (المسافات والوظيفة).\n- دعم شعارات الشركات المتعددة.\n- منطق شرطي للشعارات (Alver/Fartak).\n\n⏰ وقت التحديث: ${new Date().toLocaleString()}`);
  }

  const st = states.get(chatId);
  if (st) {
    if (txtLow === '/cancel') {
      states.delete(chatId);
      saveStates();
      return roleObj.showMenu(chatId, ar, getStatsMsg);
    }

    if (st.step === 'broadcast_content') {
      states.delete(chatId);
      saveStates();

      let method = 'sendMessage';
      let params = {};

      if (msg.photo && msg.photo.length > 0) {
        method = 'sendPhoto';
        params = { photo: msg.photo[msg.photo.length - 1].file_id };
      } else if (msg.video) {
        method = 'sendVideo';
        params = { video: msg.video.file_id };
      } else if (msg.document) {
        method = 'sendDocument';
        params = { document: msg.document.file_id };
      } else if (msg.voice) {
        method = 'sendVoice';
        params = { voice: msg.voice.file_id };
      } else if (msg.audio) {
        method = 'sendAudio';
        params = { audio: msg.audio.file_id };
      }

      const rawContent = msg.caption || msg.text || '';
      const allUsers = cfg.authorized_users || [];
      let successCount = 0;
      let failCount = 0;

      await send(chatId, ar ? '⏳ <b>جاري إرسال التعليمات للجميع...</b>' : '⏳ <b>Diffusion de l\'instruction en cours...</b>');

      for (const u of allUsers) {
        if (!u.id) continue;
        
        const isUserAr = (u.lang || 'ar') === 'ar';
        const header = isUserAr 
          ? `📢 <b>تعليمة إدارية هامة</b> 📢\n━━━━━━━━━━━━━━\n`
          : `📢 <b>INSTRUCTION ADMINISTRATIVE</b> 📢\n━━━━━━━━━━━━━━\n`;
        
        const fullText = rawContent ? `${header}${rawContent}` : header;
        
        const payload = {
          chat_id: String(u.id),
          parse_mode: 'HTML',
          ...params
        };
        
        if (method === 'sendMessage') {
          payload.text = fullText;
        } else {
          payload.caption = fullText;
        }

        try {
          const res = await tg(method, payload);
          if (res.ok) successCount++;
          else {
            log(`[Broadcast-Error] Failed to send to ${u.name} (${u.id}): ${JSON.stringify(res)}`);
            failCount++;
          }
        } catch (e) {
          log(`[Broadcast-Error] Failed to send to ${u.name} (${u.id}): ${e.message}`);
          failCount++;
        }
      }

      const confirmMsg = ar
        ? `✅ <b>تم إرسال التعليمات بنجاح!</b>\n━━━━━━━━━━━━━━\n👥 تم الإرسال إلى: <b>${successCount}</b> مستخدم.\n⚠️ فشل الإرسال إلى: <b>${failCount}</b> مستخدم.`
        : `✅ <b>Instruction diffusée avec succès !</b>\n━━━━━━━━━━━━━━\n👥 Envoyé à: <b>${successCount}</b> utilisateurs.\n⚠️ Échecs: <b>${failCount}</b>.`;

      await send(chatId, confirmMsg);
      return roleObj.showMenu(chatId, ar, getStatsMsg);
    }
  }

  if (st && txt && !txt.startsWith('/')) {
    if (st.step === 'bva_set_start_num_wait') {
      const num = parseInt(txt, 10);
      if (isNaN(num) || num <= 0) {
        return send(chatId, ar ? '⚠️ الرجاء إدخال رقم صحيح أكبر من 0:' : '⚠️ Veuillez entrer un nombre valide supérieur à 0 :');
      }
      const db2 = loadDB();
      if (!db2.hr_settings) db2.hr_settings = {};
      db2.hr_settings.bvaNextNumber = num;
      saveDB(db2);
      states.delete(chatId);
      saveStates();
      return send(chatId, ar 
        ? `✅ <b>تم الحفظ!</b>\nسيتم إصدار إذن البيع القادم بالرقم: <code>BVA ${num}/${new Date().getFullYear()}</code>`
        : `✅ <b>Enregistré !</b>\nLe prochain bon sera émis avec le numéro : <code>BVA ${num}/${new Date().getFullYear()}</code>`,
        { inline_keyboard: [[{ text: ar ? '🏠 القائمة الرئيسية' : '🏠 Menu Principal', callback_data: 'menu' }]] });
    }

    // ── BVA (Bon de Vente & Autorisation de Sortie) State Machine Steps ──
    if (st.step === 'bva_client') {
      const q = txt.trim().toLowerCase();
      const clients = loadClients();
      
      // Pad to 'C0000' format if input is purely numeric or c followed by digits
      let searchCode = q;
      if (/^\d+$/.test(q)) {
        const num = parseInt(q, 10);
        searchCode = 'c' + String(num).padStart(4, '0');
      } else if (q.startsWith('c') && /^\d+$/.test(q.slice(1))) {
        const num = parseInt(q.slice(1), 10);
        searchCode = 'c' + String(num).padStart(4, '0');
      }
      
      // Check for EXACT code match first → auto-select immediately
      const exactMatch = clients.find(c => c.id.toLowerCase() === searchCode);
      if (exactMatch) {
        const clientName = `${exactMatch.id} - ${exactMatch.name}`;
        st.data.clientId = exactMatch.id;
        st.data.clientName = clientName;
        st.step = 'bva_bcnum';
        states.set(chatId, st);
        saveStates();
        return send(chatId, ar 
          ? `✅ <b>تم اختيار الزبون تلقائياً:</b>\n👤 <b>${exactMatch.name}</b> (${exactMatch.id})\n\n✍️ <b>الخطوة 2/7: إدخال رقم الطلبية (BC N°):</b>`
          : `✅ <b>Client sélectionné automatiquement:</b>\n👤 <b>${exactMatch.name}</b> (${exactMatch.id})\n\n✍️ <b>Étape 2/7: Saisir BC N° :</b>`);
      }
      
      const matches = clients.filter(c => 
        c.id.toLowerCase().includes(q) || 
        c.name.toLowerCase().includes(q) ||
        (searchCode !== q && c.id.toLowerCase().includes(searchCode))
      ).slice(0, 8);
      
      if (matches.length === 0) {
        states.set(chatId, st);
        return send(chatId, ar 
          ? `❌ لم يتم العثور على زبائن يطابقون: <b>${txt}</b>\n\n🔍 يرجى كتابة اسم أو رمز زبون آخر للبحث:` 
          : `❌ Aucun client trouvé pour: <b>${txt}</b>\n\n🔍 Réessayez avec un autre nom ou ID :`, 
          { inline_keyboard: [[{ text: ar ? '❌ إلغاء' : '❌ Annuler', callback_data: 'menu' }]] });
      }
      
      // Show matching results as buttons
      const kbd = { inline_keyboard: matches.map(c => [{ text: `👤 ${c.id} - ${c.name}`, callback_data: `bva_clsel:${c.id}` }]) };
      kbd.inline_keyboard.push([{ text: ar ? '❌ إلغاء' : '❌ Annuler', callback_data: 'menu' }]);
      
      states.set(chatId, st);
      return send(chatId, ar 
        ? `🔍 <b>اختر الزبون من النتائج أدناه:</b>` 
        : `🔍 <b>Sélectionnez un client :</b>`, kbd);
    }


    if (st.step === 'bva_bcnum') {
      st.data.bcNum = txt;
      st.step = 'bva_article_search';
      states.set(chatId, st);
      saveStates();
      
      return send(chatId, ar 
        ? `📦 <b>الخطوة 3/5: اختيار المواد (Articles)</b>\n━━━━━━━━━━━━━━\nيرجى كتابة اسم أو رمز المادة للبحث عنها:\n(مثال: <code>VERRE</code> أو <code>9000101</code>)`
        : `📦 <b>Étape 3/5: Sélection des Articles</b>\n━━━━━━━━━━━━━━\nVeuillez écrire le nom ou le code de l'article pour le rechercher :`);
    }

    if (st.step === 'bva_article_search') {
      const q = txt.trim().toLowerCase();
      const articles = loadArticles();
      
      const exactMatch = articles.find(a => String(a.id).toLowerCase() === q);
      const matches = exactMatch ? [exactMatch] : articles.filter(a => 
        String(a.id).toLowerCase().includes(q) || 
        String(a.name).toLowerCase().includes(q)
      ).slice(0, 8);
      
      if (matches.length === 0) {
        states.set(chatId, st);
        return send(chatId, ar 
          ? `❌ لم يتم العثور على مواد تطابق: <b>${txt}</b>\n\n🔍 يرجى كتابة اسم أو رمز مادة آخر للبحث:` 
          : `❌ Aucun article trouvé pour: <b>${txt}</b>\n\n🔍 Réessayez avec un autre nom ou code :`, 
          { inline_keyboard: [[{ text: ar ? '❌ إلغاء البحث' : '❌ Annuler la recherche', callback_data: 'menu' }]] });
      }
      
      // Show matching results as buttons
      const kbd = { inline_keyboard: matches.map(a => [{ text: `📦 ${a.id} - ${a.name}`, callback_data: `bva_artsel:${a.id}` }]) };
      kbd.inline_keyboard.push([{ text: ar ? '❌ إلغاء' : '❌ Annuler', callback_data: 'menu' }]);
      
      states.set(chatId, st);
      return send(chatId, ar 
        ? `🔍 <b>اختر المادة من النتائج أدناه:</b>` 
        : `🔍 <b>Sélectionnez un article :</b>`, kbd);
    }

    if (st.step === 'bva_article_qty') {
      // Expecting a quantity number
      const qty = parseFloat(txt.replace(',', '.'));
      if (isNaN(qty) || qty <= 0) {
        return send(chatId, ar ? `⚠️ الرجاء إدخال كمية صحيحة (أرقام فقط):` : `⚠️ Veuillez entrer une quantité valide (chiffres uniquement):`);
      }
      
      if (!st.data.articles) st.data.articles = [];
      st.data.articles.push({ 
        code: st.data.currentArticle.id, 
        prod: st.data.currentArticle.name, 
        qty: qty 
      });
      delete st.data.currentArticle;
      st.step = 'bva_article_search'; // Go back to search step to add more
      states.set(chatId, st);
      saveStates();
      
      const listMsg = st.data.articles.map((a, i) => `${i+1}. <code>${a.code}</code> - ${a.prod} (<b>${a.qty}</b>)`).join('\n');
      return send(chatId, ar 
        ? `✅ تم إضافة المادة بنجاح!\n\n📋 <b>القائمة الحالية للمواد:</b>\n${listMsg}\n\n💡 للبحث عن مادة أخرى اكتب اسمها أو رمزها الآن، أو اضغط الزر بالأسفل للانتهاء:` 
        : `✅ Article ajouté!\n\n📋 <b>Liste actuelle :</b>\n${listMsg}\n\n💡 Recherchez un autre article en tapant son nom/code, ou appuyez ci-dessous pour valider :`,
        { inline_keyboard: [
          [{ text: ar ? '➕ إضافة مادة أخرى' : '➕ Ajouter un autre article', callback_data: 'bva_add_more_btn' }],
          [{ text: ar ? '🏁 الانتهاء من إضافة المواد' : '🏁 Terminer l\'ajout', callback_data: 'bva_art_done' }]
        ] });
    }

    if (st.step === 'bva_fact_num') {
      st.data.factureNum = txt;
      st.step = 'bva_fact_montant';
      states.set(chatId, st);
      saveStates();
      return send(chatId, ar 
        ? `💰 <b>الخطوة 7/7: إدخال مبلغ الفاتورة الإجمالي (Montant)</b>\nيرجى كتابة المبلغ بالأرقام (مثال: <code>150000.00</code>):` 
        : `💰 <b>Étape 7/7: Saisir le Montant</b>\nVeuillez écrire le montant en chiffres (Ex: <code>150000.00</code>) :`);
    }

    if (st.step === 'bva_fact_montant') {
      st.data.amount = txt;
      st.step = 'bva_show_summary'; // Fake step, immediately handle logic
      
      const itemsList = st.data.articles.map(a => `├ <code>${a.code}</code> - ${a.prod} (<b>${a.qty}</b>)`).join('\n');
      const payMethText = st.data.paymentMethod;
      
      const summary = ar 
        ? `📋 <b>ملخص إذن البيع والخروج (بما فيها الفوترة)</b>\n━━━━━━━━━━━━━━\n👤 الزبون: <b>${st.data.clientName}</b>\n📄 طلبية رقم (BC): <code>${st.data.bcNum}</code>\n💳 طريقة الدفع: <b>${payMethText}</b>\n🚚 النقل: <b>${st.data.transportType}</b>\n\n🧾 رقم الفاتورة: <code>${st.data.factureNum}</code>\n💰 المبلغ الإجمالي: <b>${st.data.amount} DA</b>\n\n📦 <b>المواد المشحونة:</b>\n${itemsList}\n━━━━━━━━━━━━━━`
        : `📋 <b>RÉSUMÉ DU BON DE VENTE ET FACTURATION</b>\n━━━━━━━━━━━━━━\n👤 Client: <b>${st.data.clientName}</b>\n📄 BC N°: <code>${st.data.bcNum}</code>\n💳 Paiement: <b>${payMethText}</b>\n🚚 Transport: <b>${st.data.transportType}</b>\n\n🧾 N° Facture: <code>${st.data.factureNum}</code>\n💰 Montant Total: <b>${st.data.amount} DA</b>\n\n📦 <b>Articles :</b>\n${itemsList}\n━━━━━━━━━━━━━━`;
        
      const kbd = { inline_keyboard: [
        [{ text: ar ? '✅ تأكيد وإرسال للمستودع (GDS)' : '✅ Confirmer & Envoyer (GDS)', callback_data: 'bva_confirm_sales' }],
        [{ text: ar ? '❌ إلغاء' : '❌ Annuler', callback_data: 'menu' }]
      ]};
      
      states.set(chatId, st);
      saveStates();
      return send(chatId, summary, kbd);
    }



    if (st.step === 'bva_ship_bl') {
      st.data.blNum = txt;
      st.step = 'bva_ship_transporter';
      states.set(chatId, st);
      saveStates();
      return send(chatId, ar 
        ? `🚚 <b>مصلحة الشحن: إدخال اسم الناقل (Transporteur)</b>\nاكتب اسم الناقل (مثلاً: <code>ALVER</code> أو اسم الزبون):` 
        : `🚚 <b>EXPÉDITION: Saisir le Transporteur</b>\nÉcrivez le nom du transporteur (Ex: <code>ALVER</code>) :`);
    }

    if (st.step === 'bva_ship_transporter') {
      st.data.transporter = txt;
      st.step = 'bva_ship_driver';
      states.set(chatId, st);
      saveStates();
      return send(chatId, ar 
        ? `👤 <b>مصلحة الشحن: إدخال اسم السائق (Chauffeur)</b>\nاكتب اسم سائق الشاحنة الكترونياً:` 
        : `👤 <b>EXPÉDITION: Saisir Nom du Chauffeur</b>\nÉcrivez le nom du chauffeur :`);
    }

    if (st.step === 'bva_ship_driver') {
      st.data.driverName = txt;
      st.step = 'bva_ship_plate';
      states.set(chatId, st);
      saveStates();
      return send(chatId, ar 
        ? `🚛 <b>مصلحة الشحن: إدخال رقم لوحة الشاحنة (Matricule)</b>\nاكتب رقم تسجيل الشاحنة:` 
        : `🚛 <b>EXPÉDITION: Saisir le Matricule du Camion</b>\nÉcrivez le numéro de plaque minéralogique :`);
    }

    if (st.step === 'bva_ship_plate') {
      st.data.vehiclePlate = txt;
      st.step = 'bva_ship_pc';
      states.set(chatId, st);
      saveStates();
      return send(chatId, ar 
        ? `🪪 <b>مصلحة الشحن: إدخال رقم رخصة السياقة (N° Permis de Conduite)</b>\nاكتب رقم رخصة القيادة للسائق:` 
        : `🪪 <b>EXPÉDITION: Saisir N° Permis de Conduite</b>\nÉcrivez le numéro du permis de conduire du chauffeur :`);
    }

    if (st.step === 'bva_ship_pc') {
      st.data.pcNum = txt;
      st.step = 'bva_ship_confirm';
      states.set(chatId, st);
      saveStates();
      
      const db2 = loadDB();
      const bva = (db2.bon_vente || []).find(b => b.id === st.bvaId);
      if (!bva) return;
      
      const summary = ar 
        ? `📋 <b>ملخص شحن البضاعة</b>\n━━━━━━━━━━━━━━\n👤 الزبون: <b>${bva.clientName}</b>\n📄 رقم BL: <code>${st.data.blNum}</code>\n🚚 الناقل: <b>${st.data.transporter}</b>\n👤 السائق: <b>${st.data.driverName}</b>\n🚛 رقم الشاحنة: <code>${st.data.vehiclePlate}</code>\n🪪 رخصة القيادة: <code>${st.data.pcNum}</code>\n━━━━━━━━━━━━━━`
        : `📋 <b>RÉSUMÉ EXPÉDITION (GDS)</b>\n━━━━━━━━━━━━━━\n👤 Client: <b>${bva.clientName}</b>\n📄 BL N°: <code>${st.data.blNum}</code>\n🚚 Transp: <b>${st.data.transporter}</b>\n👤 Chauffeur: <b>${st.data.driverName}</b>\n🚛 Matricule Camion: <code>${st.data.vehiclePlate}</code>\n🪪 N° Permis de Conduite: <code>${st.data.pcNum}</code>\n━━━━━━━━━━━━━━`;
        
      const kbd = { inline_keyboard: [
        [{ text: ar ? '✅ تأكيد جاهزية الخروج' : '✅ Confirmer le Chargement', callback_data: `bva_ship_final:${st.bvaId}` }],
        [{ text: ar ? '❌ إلغاء' : '❌ Annuler', callback_data: 'menu' }]
      ]};
      return send(chatId, summary, kbd);
    }

    states.delete(chatId);
    const db = loadDB();
    const emp = db.hr_employees?.find(e => String(e.id) === st.empId);
    const empName = emp ? `${emp.lastName_fr} ${emp.firstName_fr} (${emp.clockingId})` : st.empId;
    const role = String(userData.role).toLowerCase();
    const isManager = role === 'manager' || role === 'chef_de_quart';

    if (st.step === 'add_emp_tid') {
      if (!/^\d+$/.test(txt)) {
         return send(chatId, ar ? `⚠️ معرف تيليجرام يجب أن يكون أرقاماً فقط. حاول مجدداً:` : `⚠️ L'ID Telegram doit être numérique:`);
      }
      states.set(chatId, { step: 'add_emp_id', tid: txt });
      return send(chatId, ar 
        ? `✅ تم استلام المعرف.\n\n✍️ الآن، أرسل <b>رقم الموظف (Matricule)</b> لربطه بهذا الحساب:`
        : `✅ ID reçu.\n\n✍️ Maintenant, envoyez <b>le matricule (ID)</b> de l'employé:`);
    }

    if (st.step === 'add_emp_id') {
      const exists = (db.hr_employees || []).find(e => String(e.clockingId) === txt);
      if (exists) {
         states.set(chatId, { step: 'add_emp_role_existing', tid: st.tid, empId: txt, empName: `${exists.firstName_ar} ${exists.lastName_ar}`.trim() });
         const empLabel = ar ? `${exists.firstName_ar} ${exists.lastName_ar}`.trim() : `${exists.firstName_fr} ${exists.lastName_fr}`.trim();
         const kbd = { inline_keyboard: [
           [{ text: ar ? '👑 مدير عام (Directeur Général)' : '👑 Directeur Général', callback_data: `add_emp_rolex:general_manager:${st.tid}:${txt}` }],
           [{ text: ar ? '🗂️ مسير الموارد البشرية (Gest. RH)' : '🗂️ Gestionnaire RH', callback_data: `add_emp_rolex:gestionnaire_rh:${st.tid}:${txt}` }],
           [{ text: ar ? '👔 مسير (Manager)' : '👔 Manager', callback_data: `add_emp_rolex:manager:${st.tid}:${txt}` }],
           [{ text: ar ? '🔄 رئيس وردية (Chef de Quart)' : '🔄 Chef de Quart', callback_data: `add_emp_rolex:chef_de_quart:${st.tid}:${txt}` }],
           [{ text: ar ? '💼 تجاري (Service Commercial)' : '💼 Service Commercial', callback_data: `add_emp_rolex:service_commercial:${st.tid}:${txt}` }],
           [{ text: ar ? '💵 المالية (Finance)' : '💵 Finance', callback_data: `add_emp_rolex:finance:${st.tid}:${txt}` }],
           [{ text: ar ? '📦 المخازن والشحن (GDS)' : '📦 Gestion Stock (GDS)', callback_data: `add_emp_rolex:gds:${st.tid}:${txt}` }],
           [{ text: ar ? '🛡️ حارس (Poste de Garde)' : '🛡️ Poste de Garde', callback_data: `add_emp_rolex:poste_garde:${st.tid}:${txt}` }],
           [{ text: ar ? '👷 عامل (Employé)' : '👷 Employé', callback_data: `add_emp_rolex:employee:${st.tid}:${txt}` }],
           [{ text: ar ? '❌ إلغاء' : '❌ Annuler', callback_data: 'menu' }]
         ]};
         return send(chatId, ar 
           ? `✅ <b>هذا العامل موجود مسبقاً!</b>\nالاسم: <b>${empLabel}</b>\n\n📌 <b>اختر الصلاحية التي تريد منحها له في البوت:</b>`
           : `✅ <b>Cet employé existe déjà!</b>\nNom: <b>${empLabel}</b>\n\n📌 <b>Choisissez son rôle d'accès au Bot:</b>`, kbd);
      } else {
         states.set(chatId, { step: 'add_emp_name', tid: st.tid, empId: txt });
         return send(chatId, ar 
           ? `✅ الرقم جديد.\n\n✍️ أرسل <b>الاسم الكامل</b> للعامل الجديد لإنشائه:`
           : `✅ Nouveau matricule.\n\n✍️ Envoyez <b>le nom complet</b> du nouvel employé:`);
      }
    }

    if (st.step === 'add_emp_name') {
      const kbd = { inline_keyboard: [
        [{ text: ar ? '👑 مدير عام (Directeur Général)' : '👑 Directeur Général', callback_data: `add_emp_rolen:general_manager:${st.tid}:${st.empId}:${txt}` }],
        [{ text: ar ? '🗂️ مسير الموارد البشرية (Gest. RH)' : '🗂️ Gestionnaire RH', callback_data: `add_emp_rolen:gestionnaire_rh:${st.tid}:${st.empId}:${txt}` }],
        [{ text: ar ? '👔 مسير (Manager)' : '👔 Manager', callback_data: `add_emp_rolen:manager:${st.tid}:${st.empId}:${txt}` }],
        [{ text: ar ? '🔄 رئيس وردية (Chef de Quart)' : '🔄 Chef de Quart', callback_data: `add_emp_rolen:chef_de_quart:${st.tid}:${st.empId}:${txt}` }],
        [{ text: ar ? '💼 تجاري (Service Commercial)' : '💼 Service Commercial', callback_data: `add_emp_rolen:service_commercial:${st.tid}:${st.empId}:${txt}` }],
        [{ text: ar ? '💵 المالية (Finance)' : '💵 Finance', callback_data: `add_emp_rolen:finance:${st.tid}:${st.empId}:${txt}` }],
        [{ text: ar ? '📦 المخازن والشحن (GDS)' : '📦 Gestion Stock (GDS)', callback_data: `add_emp_rolen:gds:${st.tid}:${st.empId}:${txt}` }],
        [{ text: ar ? '🛡️ حارس (Poste de Garde)' : '🛡️ Poste de Garde', callback_data: `add_emp_rolen:poste_garde:${st.tid}:${st.empId}:${txt}` }],
        [{ text: ar ? '👷 عامل (Employé)' : '👷 Employé', callback_data: `add_emp_rolen:employee:${st.tid}:${st.empId}:${txt}` }],
        [{ text: ar ? '❌ إلغاء' : '❌ Annuler', callback_data: 'menu' }]
      ]};
      return send(chatId, ar 
        ? `✅ الاسم: <b>${txt}</b>\n\n📌 <b>اختر صلاحية البوت والمنصب:</b>`
        : `✅ Nom: <b>${txt}</b>\n\n📌 <b>Choisissez le rôle d'accès:</b>`, kbd);
    }

    if (st.step === 'calc_in') {
      let norm = txt.replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
      const times = [...norm.matchAll(/(\d{1,2})\s*[:.hH،,]\s*(\d{0,2})/g)];
      if (times.length > 0) {
        const inH = parseInt(times[0][1], 10), inM = parseInt(times[0][2] || '0', 10);
        states.set(chatId, { step: 'calc_out', inH, inM });
        return send(chatId, ar 
          ? `🔴 <b>تم استلام وقت الدخول (${inH}:${inM < 10 ? '0'+inM : inM}).</b>\nأرسل وقت الخروج الآن:` 
          : `🔴 <b>Heure d'entrée reçue (${inH}:${inM < 10 ? '0'+inM : inM}).</b>\nEnvoyez l'heure de sortie maintenant:`);
      } else {
        states.set(chatId, { step: 'calc_in' }); // keep state
        return send(chatId, ar ? `⚠️ صيغة خاطئة. أرسل الوقت هكذا: <code>08:15</code>` : `⚠️ Format invalide. Exemple: <code>08:15</code>`);
      }
    }

    if (st.step === 'calc_out') {
      let norm = txt.replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
      const times = [...norm.matchAll(/(\d{1,2})\s*[:.hH،,]\s*(\d{0,2})/g)];
      if (times.length > 0) {
        const outH = parseInt(times[0][1], 10), outM = parseInt(times[0][2] || '0', 10);
        const inH = st.inH, inM = st.inM;
        
        let inTotal = inH * 60 + inM;
        let outTotal = outH * 60 + outM;
        if (outTotal < inTotal) outTotal += 24 * 60;
        
        const diffMins = outTotal - inTotal;
        const diffHrs = Math.floor(diffMins / 60);
        const remMins = diffMins % 60;
        
        let reply = ar ? `⏱️ <b>المدة الإجمالية للعمل:</b>\n` : `⏱️ <b>Durée totale de travail:</b>\n`;
        if (diffHrs > 0) reply += ar ? `<b>${diffHrs}</b> ساعة و ` : `<b>${diffHrs}</b> heure(s) et `;
        reply += ar ? `<b>${remMins}</b> دقيقة.` : `<b>${remMins}</b> minute(s).`;
        
        return send(chatId, reply, { inline_keyboard: [[{ text: ar ? '🏠 القائمة الرئيسية' : '🏠 Menu', callback_data: 'menu' }]] });
      } else {
        states.set(chatId, { step: 'calc_out', inH: st.inH, inM: st.inM }); // keep state
        return send(chatId, ar ? `⚠️ صيغة خاطئة. أرسل الوقت هكذا: <code>16:30</code>` : `⚠️ Format invalide. Exemple: <code>16:30</code>`);
      }
    }

    if (st.step === 'cheque_amount') {
      let norm = txt.replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
      const words = convertAmountToWords(norm, ar ? 'ar' : 'fr');
      if (words) {
        return send(chatId, ar 
          ? `🏦 <b>المبلغ بالحروف:</b>\n\n${words}` 
          : `🏦 <b>Montant en lettres:</b>\n\n${words}`, 
          { inline_keyboard: [
            [{ text: ar ? '🔄 حساب مبلغ آخر' : '🔄 Autre montant', callback_data: 'cheque_step' }],
            [{ text: ar ? '🏠 القائمة الرئيسية' : '🏠 Menu', callback_data: 'menu' }]
          ]});
      } else {
        states.set(chatId, { step: 'cheque_amount' }); // keep state
        return send(chatId, ar ? `⚠️ الرجاء إرسال رقم صحيح. مثال: <code>15000.50</code>` : `⚠️ Montant invalide. Exemple: <code>15000.50</code>`);
      }
    }

    if (st.step === 'doc_reason') {
      await notifyStaff(`📄 <b>طلب وثيقة جديد</b>\n━━━━━━━━━━━━━━\n👤 الموظف: ${empName}\n📄 الوثيقة: <b>${st.docName}</b>\n✍️ السبب: ${txt}\n👤 من طرف: ${userData.name}`, cfg, send);
      return send(chatId, isManager
        ? (ar ? `✅ تم إرسال طلبك.\n📄 ${st.docName}\n⏳ <b>سوف يُدرس طلبك من طرف الإدارة.</b>` : `✅ Demande envoyée.\n📄 ${st.docName}\n⏳ <b>Votre demande sera étudiée par l'administration.</b>`)
        : (ar ? `✅ <b>تم إرسال الطلب!</b>\n📄 ${st.docName}\n✍️ ${txt}` : `✅ <b>Demande envoyée!</b>\n📄 ${st.docName}\n✍️ ${txt}`));
    }

    if (st.step === 'abs_date') {
      await notifyStaff(`🚨 <b>إعلام عن غياب</b>\n━━━━━━━━━━━━━━\n👤 الموظف: ${empName}\n📊 النوع: <b>${st.typeName}</b>\n📅 التاريخ: ${txt}\n👤 من طرف: ${userData.name}`, cfg, send);
      return send(chatId, isManager
        ? (ar ? `✅ تم تسجيل الغياب.\n📊 ${st.typeName} | 📅 ${txt}\n⏳ <b>سوف يُدرس طلبك من طرف الإدارة.</b>` : `✅ Absence enregistrée.\n📊 ${st.typeName} | 📅 ${txt}\n⏳ <b>Votre demande sera étudiée par l'administration.</b>`)
        : (ar ? `✅ <b>تم تسجيل الغياب!</b>\n📊 ${st.typeName} | 📅 ${txt}` : `✅ <b>Absence enregistrée!</b>\n📊 ${st.typeName} | 📅 ${txt}`));
    }

    // --- 🚑 Accident Wizard Steps ---
    if (st.step === 'acc_date') {
      st.data.date = txt;
      st.step = 'acc_loc';
      const kbd = { inline_keyboard: [
        [{ text: ar ? '🏭 الورشة' : '🏭 Atelier', callback_data: 'accloc:Atelier' }, { text: ar ? '🏢 المكتب' : '🏢 Bureau', callback_data: 'accloc:Bureau' }],
        [{ text: ar ? '📦 المستودع' : '📦 Dépôt', callback_data: 'accloc:Depot' }, { text: ar ? '🚗 طريق (مهمة)' : '🚗 Route (Mission)', callback_data: 'accloc:Route' }],
        [{ text: ar ? '🌐 مكان آخر' : '🌐 Autre lieu', callback_data: 'accloc:Autre' }]
      ]};
      states.set(chatId, st);
      saveStates();
      return send(chatId, ar 
        ? `📍 <b>مكان الحادث (خطوة 2/7)</b>\nأين وقع الحادث بالضبط؟` 
        : `📍 <b>LIEU DE L'ACCIDENT (Étape 2/7)</b>\nOù l'accident s'est-il produit ?`, kbd);
    }
    if (st.step === 'acc_witnesses') {
      st.data.witnesses = txt;
      st.step = 'acc_hospital';
      const kbd = { inline_keyboard: [[
        { text: ar ? '✅ نعم' : '✅ Oui', callback_data: 'acchosp:Oui' },
        { text: ar ? '❌ لا' : '❌ Non', callback_data: 'acchosp:Non' }
      ]]};
      states.set(chatId, st);
      saveStates();
      return send(chatId, ar 
        ? `🏥 <b>النقل للمستشفى (خطوة 5/7)</b>\nهل تم نقل الموظف للمستشفى أو تلقى إسعافات طبية؟` 
        : `🏥 <b>TRANSFERT À L'HÔPITAL (Étape 5/7)</b>\nL'employé a-t-il été transféré à l'hôpital ?`, kbd);
    }
    if (st.step === 'acc_desc') {
      st.data.description = txt;
      st.step = 'acc_confirm';
      const d = st.data;
      const summary = ar 
        ? `📋 <b>ملخص تقرير الحادث</b>\n━━━━━━━━━━━━━━\n👤 <b>المصاب:</b> ${empName}\n📅 <b>التاريخ:</b> ${d.date}\n📍 <b>المكان:</b> ${d.location}\n🤕 <b>الإصابة:</b> ${d.injury}\n👥 <b>الشهود:</b> ${d.witnesses}\n🏥 <b>المستشفى:</b> ${d.hospital}\n🏃 <b>الحالة:</b> ${d.status}\n📝 <b>الوصف:</b> ${d.description}\n━━━━━━━━━━━━━━\n👤 <b>المُبلِّغ:</b> ${d.reporter}`
        : `📋 <b>RÉSUMÉ DU RAPPORT</b>\n━━━━━━━━━━━━━━\n👤 <b>Victime:</b> ${empName}\n📅 <b>Date:</b> ${d.date}\n📍 <b>Lieu:</b> ${d.location}\n🤕 <b>Blessure:</b> ${d.injury}\n👥 <b>Témoins:</b> ${d.witnesses}\n🏥 <b>Hôpital:</b> ${d.hospital}\n🏃 <b>Statut:</b> ${d.status}\n📝 <b>Description:</b> ${d.description}\n━━━━━━━━━━━━━━\n👤 <b>Rapporteur:</b> ${d.reporter}`;
      const kbd = { inline_keyboard: [[
        { text: ar ? '✅ تأكيد وإرسال' : '✅ Confirmer & Envoyer', callback_data: 'acc_final_send' },
        { text: ar ? '❌ إلغاء' : '❌ Annuler', callback_data: 'menu' }
      ]]};
      states.set(chatId, st);
      saveStates();
      return send(chatId, summary, kbd);
    }
    
    // --- 🛠️ 1. Resource Request Steps ---
    if (st.step === 'res_item') {
      st.data.item = txt; st.step = 'res_qty';
      states.set(chatId, st);
      saveStates();
      return send(chatId, ar ? `🔢 <b>الكمية (3/4)</b>\nما هي الكمية المطلوبة؟` : `🔢 <b>QUANTITÉ (3/4)</b>\nQuelle est la quantité ?`);
    }
    if (st.step === 'res_qty') {
      st.data.qty = txt; st.step = 'res_reason';
      states.set(chatId, st);
      saveStates();
      return send(chatId, ar ? `✍️ <b>السبب (4/4)</b>\nلماذا تحتاج هذه المعدات؟ (مثال: تلف القطعة القديمة)` : `✍️ <b>RAISON (4/4)</b>\nPourquoi en avez-vous besoin ?`);
    }
    if (st.step === 'res_reason') {
      st.data.reason = txt; st.step = 'res_confirm';
      const d = st.data;
      const summary = ar 
        ? `📦 <b>ملخص طلب معدات</b>\n━━━━━━━━━━━━━━\n📂 الفئة: ${d.category}\n🛠️ القطعة: ${d.item}\n🔢 الكمية: ${d.qty}\n✍️ السبب: ${d.reason}\n👤 الطالب: ${d.reporter}`
        : `📦 <b>RÉSUMÉ DEMANDE</b>\n━━━━━━━━━━━━━━\n📂 Cat: ${d.category}\n🛠️ Item: ${d.item}\n🔢 Qté: ${d.qty}\n✍️ Raison: ${d.reason}\n👤 Demandeur: ${d.reporter}`;
      const kbd = { inline_keyboard: [[{ text: ar ? '✅ تأكيد الطلب' : '✅ Confirmer', callback_data: 'res_final_send' }, { text: ar ? '❌ إلغاء' : '❌ Annuler', callback_data: 'menu' }]]};
      states.set(chatId, st);
      saveStates();
      return send(chatId, summary, kbd);
    }

    // --- ⚙️ 2. Maintenance Report Steps ---
    if (st.step === 'maint_eq') {
      st.data.equipment = txt; st.step = 'maint_pri';
      const kbd = { inline_keyboard: [[
        { text: ar ? '🟢 عادي' : '🟢 Normal', callback_data: 'maintpri:Normal' },
        { text: ar ? '🟡 متوسط' : '🟡 Moyen', callback_data: 'maintpri:Moyen' },
        { text: ar ? '🔴 عاجل' : '🔴 Urgent', callback_data: 'maintpri:Urgent' }
      ]]};
      states.set(chatId, st);
      saveStates();
      return send(chatId, ar ? `⚡ <b>مستوى الأهمية (3/4)</b>\nما مدى تأثير هذا العطب على العمل؟` : `⚡ <b>PRIORITÉ (3/4)</b>\nImportance de la panne ?`, kbd);
    }
    if (st.step === 'maint_desc') {
      st.data.description = txt; st.step = 'maint_confirm';
      const d = st.data;
      const summary = ar 
        ? `⚙️ <b>ملخص بلاغ عطب</b>\n━━━━━━━━━━━━━━\n📍 المكان: ${d.location}\n⚙️ الجهاز: ${d.equipment}\n⚡ الأولوية: ${d.priority}\n🛑 توقف العمل: ${d.stops_work}\n📝 الوصف: ${d.description}\n👤 المُبلِّغ: ${d.reporter}`
        : `⚙️ <b>RÉSUMÉ PANNE</b>\n━━━━━━━━━━━━━━\n📍 Lieu: ${d.location}\n⚙️ Équip: ${d.equipment}\n⚡ Prio: ${d.priority}\n🛑 Arrêt travail: ${d.stops_work}\n📝 Desc: ${d.description}\n👤 Rapporteur: ${d.reporter}`;
      const kbd = { inline_keyboard: [[{ text: ar ? '✅ إرسال البلاغ' : '✅ Envoyer', callback_data: 'maint_final_send' }, { text: ar ? '❌ إلغاء' : '❌ Annuler', callback_data: 'menu' }]]};
      states.set(chatId, st);
      saveStates();
      return send(chatId, summary, kbd);
    }

    // --- 💼 3. Recruitment Steps ---
    if (st.step === 'hire_dept') {
      st.data.department = txt; st.step = 'hire_title';
      states.set(chatId, st);
      saveStates();
      return send(chatId, ar ? `💼 <b>المسمى الوظيفي (2/4)</b>\nما هو المنصب المراد شغله؟` : `💼 <b>POSTE (2/4)</b>\nQuel est le poste ?`);
    }
    if (st.step === 'hire_title') {
      st.data.title = txt; st.step = 'hire_type';
      const kbd = { inline_keyboard: [[{ text: 'CDI (Titulaire)', callback_data: 'hiretype:CDI' }, { text: 'CDD (Contractuel)', callback_data: 'hiretype:CDD' }]]};
      states.set(chatId, st);
      saveStates();
      return send(chatId, ar ? `📜 <b>نوع العقد (3/4)</b>\nما هو نوع العقد المقترح؟` : `📜 <b>CONTRAT (3/4)</b>\nType de contrat ?`, kbd);
    }
    if (st.step === 'hire_reason') {
      st.data.reason = txt; st.step = 'hire_confirm';
      const d = st.data;
      const summary = ar 
        ? `💼 <b>ملخص طلب توظيف</b>\n━━━━━━━━━━━━━━\n🏢 القسم: ${d.department}\n💼 المنصب: ${d.title}\n📜 العقد: ${d.contract}\n✍️ التبرير: ${d.reason}\n👤 الطالب: ${d.reporter}`
        : `💼 <b>RÉSUMÉ RECRUTEMENT</b>\n━━━━━━━━━━━━━━\n🏢 Dept: ${d.department}\n💼 Poste: ${d.title}\n📜 Contrat: ${d.contract}\n✍️ Motif: ${d.reason}\n👤 Demandeur: ${d.reporter}`;
      const kbd = { inline_keyboard: [[{ text: ar ? '✅ تأكيد الطلب' : '✅ Confirmer', callback_data: 'hire_final_send' }, { text: ar ? '❌ إلغاء' : '❌ Annuler', callback_data: 'menu' }]]};
      states.set(chatId, st);
      saveStates();
      return send(chatId, summary, kbd);
    }

    // --- 📊 5. Daily Production Steps ---
    if (st.step === 'prod_notes') {
      st.data.notes = txt; st.step = 'prod_confirm';
      const d = st.data;
      const summary = ar 
        ? `📊 <b>ملخص تقرير الإنتاج</b>\n━━━━━━━━━━━━━━\n🕒 الوردية: ${d.shift}\n✅ الهدف: ${d.target}\n📝 ملاحظات: ${d.notes}\n👤 المسؤول: ${d.reporter}`
        : `📊 <b>RÉSUMÉ PRODUCTION</b>\n━━━━━━━━━━━━━━\n🕒 Shift: ${d.shift}\n✅ Objectif: ${d.target}\n📝 Notes: ${d.notes}\n👤 Resp: ${d.reporter}`;
      const kbd = { inline_keyboard: [[{ text: ar ? '✅ إرسال التقرير' : '✅ Envoyer', callback_data: 'prod_final_send' }, { text: ar ? '❌ إلغاء' : '❌ Annuler', callback_data: 'menu' }]]};
      states.set(chatId, st);
      saveStates();
      return send(chatId, summary, kbd);
    }

    // --- 💡 6. Suggestion Steps ---
    if (st.step === 'sug_idea') {
      st.data.idea = txt; st.step = 'sug_benefit';
      states.set(chatId, st);
      saveStates();
      return send(chatId, ar ? `🚀 <b>الفائدة المتوقعة (3/3)</b>\nما هي الفائدة التي ستعود على الشركة من هذه الفكرة؟` : `🚀 <b>BÉNÉFICE (3/3)</b>\nQuel est le bénéfice attendu ?`);
    }
    if (st.step === 'sug_benefit') {
      st.data.benefit = txt; st.step = 'sug_confirm';
      const d = st.data;
      const summary = ar 
        ? `💡 <b>ملخص الاقتراح</b>\n━━━━━━━━━━━━━━\n📂 المجال: ${d.category}\n💡 الفكرة: ${d.idea}\n🚀 الفائدة: ${d.benefit}\n👤 صاحب الفكرة: ${d.reporter}`
        : `💡 <b>RÉSUMÉ IDÉE</b>\n━━━━━━━━━━━━━━\n📂 Domaine: ${d.category}\n💡 Idée: ${d.idea}\n🚀 Bénéfice: ${d.benefit}\n👤 Auteur: ${d.reporter}`;
      const kbd = { inline_keyboard: [[{ text: ar ? '✅ إرسال الفكرة' : '✅ Envoyer', callback_data: 'sug_final_send' }, { text: ar ? '❌ إلغاء' : '❌ Annuler', callback_data: 'menu' }]]};
      states.set(chatId, st);
      saveStates();
      return send(chatId, summary, kbd);
    }

    // --- 📝 Ordre de Mission Steps ---
    if (st.step === 'om_search') {
      const q = txtLow.trim();
      const results = (db.hr_employees || []).filter(e => {
        if (!isEmployeeAllowed(userData, e)) return false;
        const cid = String(e.clockingId || '').toLowerCase().trim();
        const lnf = String(e.lastName_fr || '').toLowerCase();
        const fnf = String(e.firstName_fr || '').toLowerCase();
        const qLow = q.toLowerCase();
        if (/^\d+$/.test(qLow) && qLow.length <= 3) {
           return cid === qLow || parseInt(cid) === parseInt(qLow);
        }
        return cid.includes(qLow) || lnf.includes(qLow) || fnf.includes(qLow);
      }).slice(0, 5);

      if (results.length === 0) return send(chatId, ar ? `❌ لا يوجد موظف بهذا الاسم/الرقم. حاول مجدداً:` : `❌ Aucun employé trouvé. Réessayez :`);
      const kbd = { inline_keyboard: results.map(e => [{ text: `👤 ${e.lastName_fr} ${e.firstName_fr}`, callback_data: `om_sel:${e.id}` }]) };
      kbd.inline_keyboard.push([{ text: ar ? '❌ إلغاء' : '❌ Annuler', callback_data: 'menu' }]);
      return send(chatId, ar ? `🔍 اختر الموظف للمهمة:` : `🔍 Sélectionnez l'employé pour la mission :`, kbd);
    }

    if (st.step === 'om_motifs') {
      st.data.reason = txt;
      st.step = 'om_dest_select';
      states.set(chatId, st); saveStates();
      // Use callback_data trigger for destinations
      return handle({ callback_query: { from: { id: fromId }, message: { chat: { id: chatId } }, data: 'om_dest:page:0' } });
    }

    if (st.step === 'om_date_start') {
      st.data.startDate = txt;
      st.step = 'om_date_end';
      states.set(chatId, st); saveStates();
      return send(chatId, ar ? '📅 <b>تاريخ العودة (مثال: 2026/05/22) :</b>' : '📅 <b>Date de retour (Ex: 2026/05/22) :</b>');
    }

    if (st.step === 'om_date_end') {
      st.data.endDate = txt;
      st.step = 'om_transport';
      states.set(chatId, st); saveStates();
      const kbd = { inline_keyboard: [
        [{ text: ar ? '🚗 سيارة المصلحة' : '🚗 Véhicule de service', callback_data: 'om_trans:Service' }],
        [{ text: ar ? '👤 سيارة خاصة' : '👤 Véhicule personnel', callback_data: 'om_trans:Personnel' }],
        [{ text: ar ? '🚌 حافلة / أخرى' : '🚌 Bus / Autre', callback_data: 'om_trans:Autre' }]
      ]};
      return send(chatId, ar ? '🚗 <b>وسيلة النقل :</b>' : '🚗 <b>Moyen de transport :</b>', kbd);
    }
    if (st.step === 'entry_search') {
      const q = txtLow.trim();
      const results = (db.hr_employees || []).filter(e => {
        if (!isEmployeeAllowed(userData, e)) return false;
        const cid = String(e.clockingId || '').toLowerCase().trim();
        const lnf = String(e.lastName_fr || '').toLowerCase();
        const fnf = String(e.firstName_fr || '').toLowerCase();
        const isNum = /^\d+$/.test(q);
        if (isNum) return cid === q || parseInt(cid) === parseInt(q);
        return lnf.includes(q) || fnf.includes(q);
      }).slice(0, 5);

      if (results.length === 0) return send(chatId, ar ? `❌ لا يوجد موظف بهذا الاسم/الرقم. حاول مجدداً:` : `❌ Aucun employé trouvé. Réessayez :`);
      
      const kbd = { inline_keyboard: results.map(e => [{ text: `👤 ${e.lastName_fr} ${e.firstName_fr}`, callback_data: `entry_sel:${st.data.type}:${e.id}` }]) };
      kbd.inline_keyboard.push([{ text: ar ? '❌ إلغاء' : '❌ Annuler', callback_data: 'menu' }]);
      
      states.set(chatId, st); saveStates();
      return send(chatId, ar ? `🔍 اختر الموظف المطلوب للدخول:` : `🔍 Sélectionnez l'employé pour l'entrée :`, kbd);
    }

    if (st.step === 'entry_reason') {
      st.data.reason = txt;
      st.step = 'entry_time';
      states.set(chatId, st); saveStates();
      return send(chatId, ar 
        ? `📅 <b>اليوم والساعة (4/5)</b>\nيرجى كتابة التاريخ والوقت المتوقع للدخول:\nمثال: <code>غداً 08:00</code>` 
        : `📅 <b>JOUR ET HEURE (4/5)</b>\nVeuillez écrire la date et l'heure d'entrée :\nEx: <code>Demain 08:00</code>`);
    }

    if (st.step === 'entry_time') {
      st.data.entryTime = txt;
      st.step = 'entry_confirm';
      const d = st.data;
      const emp = db.hr_employees?.find(e => String(e.id) === st.empId);
      const empName = emp ? `${emp.lastName_fr} ${emp.firstName_fr}` : 'Unknown';
      
      const summary = ar 
        ? `📋 <b>ملخص تصريح الدخول</b>\n━━━━━━━━━━━━━━\n👤 الموظف: <b>${empName}</b>\n📅 وقت الدخول: ${d.entryTime}\n✍️ السبب: ${d.reason}\n👤 الطالب: ${d.managerName}`
        : `📋 <b>RÉSUMÉ ENTRÉE</b>\n━━━━━━━━━━━━━━\n👤 Employé: <b>${empName}</b>\n📅 Heure Entrée: ${d.entryTime}\n✍️ Motif: ${d.reason}\n👤 Demandeur: ${d.managerName}`;
      
      const kbd = { inline_keyboard: [[{ text: ar ? '✅ تأكيد وإرسال' : '✅ Confirmer & Envoyer', callback_data: 'entry_final_send' }, { text: ar ? '❌ إلغاء' : '❌ Annuler', callback_data: 'menu' }]]};
      states.set(chatId, st); saveStates();
      return send(chatId, summary, kbd);
    }

    if (st.step === 'exit_search') {
      const q = txtLow.trim();
      const results = (db.hr_employees || []).filter(e => {
        if (!isEmployeeAllowed(userData, e)) return false;
        const cid = String(e.clockingId || '').toLowerCase().trim();
        const lnf = String(e.lastName_fr || '').toLowerCase();
        const fnf = String(e.firstName_fr || '').toLowerCase();
        const isNum = /^\d+$/.test(q);
        if (isNum) return cid === q || parseInt(cid) === parseInt(q);
        return lnf.includes(q) || fnf.includes(q);
      }).slice(0, 5);

      if (results.length === 0) return send(chatId, ar ? `❌ لا يوجد موظف بهذا الاسم/الرقم. حاول مجدداً:` : `❌ Aucun employé trouvé. Réessayez :`);
      
      const kbd = { inline_keyboard: results.map(e => [{ text: `👤 ${e.lastName_fr} ${e.firstName_fr}`, callback_data: `exit_sel:${st.data.type}:${e.id}` }]) };
      kbd.inline_keyboard.push([{ text: ar ? '❌ إلغاء' : '❌ Annuler', callback_data: 'menu' }]);
      
      states.set(chatId, st);
      saveStates();
      return send(chatId, ar ? `🔍 اختر الموظف المطلوب:` : `🔍 Sélectionnez l'employé :`, kbd);
    }

    if (st.step === 'exit_reason') {
      st.data.reason = txt;
      st.step = 'exit_time';
      states.set(chatId, st);
      saveStates();
      return send(chatId, ar 
        ? `📅 <b>اليوم والساعة (4/5)</b>\nيرجى كتابة تاريخ وساعة الخروج المتوقعة:\nمثال: <code>اليوم 14:30</code>` 
        : `📅 <b>JOUR ET HEURE (4/5)</b>\nVeuillez écrire le jour et l'heure de sortie :\nEx: <code>Aujourd'hui 14:30</code>`);
    }

    if (st.step === 'exit_time') {
      st.data.exitTime = txt;
      st.step = 'exit_confirm';
      const d = st.data;
      const emp = db.hr_employees?.find(e => String(e.id) === st.empId);
      const empName = emp ? `${emp.lastName_fr} ${emp.firstName_fr}` : 'Unknown';
      
      const summary = ar 
        ? `📋 <b>ملخص تصريح الخروج</b>\n━━━━━━━━━━━━━━\n👤 الموظف: <b>${empName}</b>\n📂 النوع: ${d.type === 'Service' ? 'مهمة عمل' : 'شخصي'}\n📅 وقت الخروج: ${d.exitTime}\n✍️ السبب: ${d.reason}\n👤 الطالب: ${d.managerName}`
        : `📋 <b>RÉSUMÉ AUTORISATION</b>\n━━━━━━━━━━━━━━\n👤 Employé: <b>${empName}</b>\n📂 Type: ${d.type === 'Service' ? 'Raison de Service' : 'Sortie Personnelle'}\n📅 Heure Sortie: ${d.exitTime}\n✍️ Motif: ${d.reason}\n👤 Demandeur: ${d.managerName}`;
      
      const kbd = { inline_keyboard: [[{ text: ar ? '✅ تأكيد وإرسال' : '✅ Confirmer & Envoyer', callback_data: 'exit_final_send' }, { text: ar ? '❌ إلغاء' : '❌ Annuler', callback_data: 'menu' }]]};
      states.set(chatId, st);
      saveStates();
      return send(chatId, summary, kbd);
    }


    if (st.step === 'survey_detail') {
      return send(chatId, isManager
        ? (ar ? `✅ تم إرسال البلاغ.\n📊 ${st.reasonName} \n⏳ <b>سوف يُدرس طلبك من طرف الإدارة.</b>` : `✅ Rapport envoyé.\n📊 ${st.reasonName}\n⏳ <b>Votre demande sera étudiée par l'administration.</b>`)
        : (ar ? `✅ <b>تم إرسال البلاغ!</b>\n📊 ${st.reasonName}\n✍️ ${txt}` : `✅ <b>Rapport envoyé!</b>\n📊 ${st.reasonName}\n✍️ ${txt}`));
    }

    // ── 🔍 Search State Handler ────────────────────────────────────────────────
    if (st.step === 'search') {
      const q = txt.trim();
      const qLow = q.toLowerCase();
      const searchResults = (db.hr_employees || []).filter(e => {
        if (e.status === 'deleted') return false;
        if (!isEmployeeAllowed(userData, e)) return false;
        
        // Query match
        const cid = String(e.clockingId || '').toLowerCase().trim();
        const lnf = String(e.lastName_fr || '').toLowerCase();
        const fnf = String(e.firstName_fr || '').toLowerCase();
        const lna = String(e.lastName_ar || '');
        const fna = String(e.firstName_ar || '');
        if (/^\d+$/.test(qLow)) {
          if (qLow.length <= 3) return cid === qLow || parseInt(cid) === parseInt(qLow);
          return cid.includes(qLow);
        }
        return lnf.includes(qLow) || fnf.includes(qLow) || lna.includes(qLow) || fna.includes(qLow);
      }).slice(0, 8);

      if (searchResults.length === 0) {
        // No results – keep state active so user can try again
        states.set(chatId, { step: 'search' });
        return send(chatId,
          ar ? `❌ لا يوجد موظف بهذا الاسم أو الرقم: <b>${txt}</b>\n\n🔍 حاول مجدداً بإرسال رقم أو اسم آخر:` : `❌ Aucun employé trouvé pour: <b>${txt}</b>\n\n🔍 Réessayez avec un autre ID ou nom:`,
          { inline_keyboard: [[{ text: ar ? '❌ إلغاء البحث' : '❌ Annuler', callback_data: 'menu' }]] }
        );
      }

      if (searchResults.length === 1) {
        // Single result – show employee card directly
        const emp = searchResults[0];
        let bals = (db.hr_leave_balances || []).filter(b => String(b.employeeId) === String(emp.id));
        if (bals.length === 0) {
          const now = new Date();
          const year = now.getFullYear();
          const month = now.getMonth() + 1;
          const activeEx = month >= 7 ? `${year}/${year + 1}` : `${year - 1}/${year}`;
          const auto = calculateAutoLeave(emp.startDate, activeEx);
          if (auto > 0) bals = [{ exercice: activeEx, totalDays: auto, remainingDays: auto, isAuto: true }];
        }
        return roleObj.showEmployeeCard(chatId, emp, ar, bals);
      }

      // Multiple results – show selection list
      const kbd = {
        inline_keyboard: [
          ...searchResults.map(e => [{
            text: `👤 ${e.lastName_fr} ${e.firstName_fr} (${e.clockingId})`,
            callback_data: `full:${e.id}`
          }]),
          [{ text: ar ? '🔍 بحث جديد' : '🔍 Nouvelle recherche', callback_data: 'search' }],
          [{ text: ar ? '❌ إلغاء' : '❌ Annuler', callback_data: 'menu' }]
        ]
      };
      return send(chatId, ar ? `🔍 <b>اختر الموظف من النتائج:</b>` : `🔍 <b>Sélectionnez un employé :</b>`, kbd);
    }

    return;
  } else if (txt && !txt.startsWith('/')) {
    const role = String(userData.role).toLowerCase();
    if (role === 'general_manager' || role === 'employee' || role === 'gestionnaire_rh') return;

    const db = loadDB(), q = txtLow.trim();
    const results = (db.hr_employees || []).filter(e => {
      // 1. Scoping
      let allowed = false;
      const scope = userData.scope || 'all';
      if (role === 'admin' || scope === 'all') {
        allowed = true;
      } else if (scope === 'department') {
        const depts = (userData.allowed_departments || []).map(d => String(d).toLowerCase().trim());
        const empDeptFr = String(e.department_fr || '').toLowerCase().trim();
        const empDirFr = String(e.direction_fr || '').toLowerCase().trim();
        allowed = depts.some(d => empDeptFr.includes(d) || empDirFr.includes(d));
      } else if (scope === 'custom_employees') {
        const ids = (userData.allowed_employees || []).map(id => String(id));
        allowed = ids.includes(String(e.clockingId));
      } else if (scope === 'company') {
        allowed = String(e.companyId).toLowerCase() === String(userData.allowed_company).toLowerCase();
      }

      if (!allowed) return false;
      if (e.status === 'deleted') return false;

      // 2. Query match
      const cid = String(e.clockingId || '').toLowerCase().trim();
      const lnf = String(e.lastName_fr || '').toLowerCase();
      const fnf = String(e.firstName_fr || '').toLowerCase();
      const lna = String(e.lastName_ar || '');
      
      if (/^\d+$/.test(q)) {
        // Precise match for short numeric IDs (1-3 chars), otherwise includes
        if (q.length <= 3) return cid === q || parseInt(cid) === parseInt(q);
        return cid.includes(q);
      }
      return lnf.includes(q) || fnf.includes(q) || lna.includes(q);
    }).slice(0, 5);

    if (results.length === 0) return send(chatId, ar ? `❌ لا يوجد موظف بهذا الرقم: <b>${txt}</b>\n\n🔍 حاول مجدداً:` : `❌ Aucun employé trouvé: <b>${txt}</b>\n\n🔍 Réessayez:`);
    for (const emp of results) {
      let bals = (db.hr_leave_balances || []).filter(b => String(b.employeeId) === String(emp.id));
      
      // إذا لم يكن هناك رصيد يدوي، قم بحساب الرصيد التلقائي للسنة الجارية
      if (bals.length === 0) {
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth() + 1;
        const activeEx = month >= 7 ? `${year}/${year + 1}` : `${year - 1}/${year}`;
        const auto = calculateAutoLeave(emp.startDate, activeEx);
        
        if (auto > 0) {
          bals = [{
            exercice: activeEx,
            totalDays: auto,
            remainingDays: auto,
            isAuto: true
          }];
        }
      }

      await roleObj.showEmployeeCard(chatId, emp, ar, bals);
    }
  }
}

const app = express();
app.use((req, res, next) => {
  if (req.method !== 'POST') return next();
  let chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => { req.rawBody = Buffer.concat(chunks); next(); });
});



app.post('/api/database', (req, res) => {
  try {
    const incomingDb = JSON.parse(req.rawBody.toString('utf8'));
    const currentDb = loadDB();
    
    // Merge: Keep cloud-specific data (bon_vente, authorized_users, etc), overwrite HR data from desktop
    const mergedDb = {
      ...currentDb,
      hr_employees: incomingDb.hr_employees || currentDb.hr_employees || [],
      hr_leave_balances: incomingDb.hr_leave_balances || currentDb.hr_leave_balances || []
    };
    
    // Save locally and push to Google Drive to persist the merge
    saveDB(mergedDb);
    
    res.status(200).send('Database merged and updated.');
  } catch (e) {
    res.status(500).send(e.message);
  }
});

app.post('/api/clients', (req, res) => {
  try {
    fs.writeFileSync(CLIENTS_PATH, req.rawBody.toString('utf8'));
    res.status(200).send('Clients updated.');
  } catch (e) {
    res.status(500).send(e.message);
  }
});

app.post('/api/articles', (req, res) => {
  try {
    const CLIENTS_PATH = path.join(DATA_DIR, 'clients.json');
    const ARTICLES_PATH = path.join(DATA_DIR, 'articles.json');
    fs.writeFileSync(ARTICLES_PATH, req.rawBody.toString('utf8'));
    res.status(200).send('Articles updated.');
  } catch (e) {
    res.status(500).send(e.message);
  }
});

app.get('/api/debug-config', (req, res) => {
  try {
    const cfg = loadConfig();
    const cleanCfg = { ...cfg, bot_token: cfg.bot_token ? (cfg.bot_token.substring(0, 5) + '...') : 'missing' };
    res.json(cleanCfg);
  } catch (e) { res.status(500).send(e.message); }
});

app.get('/api/config', (req, res) => {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      res.sendFile(CONFIG_PATH);
    } else {
      res.status(404).send('Config not found');
    }
  } catch (e) { res.status(500).send(e.message); }
});

app.get('/api/logs', (req, res) => {
  try {
    const logPath = path.join(__dirname, 'bot_debug.log');
    if (fs.existsSync(logPath)) {
      const logs = fs.readFileSync(logPath, 'utf8');
      res.header('Content-Type', 'text/plain');
      res.send(logs);
    } else {
      res.send('Log file not found.');
    }
  } catch (e) { res.status(500).send(e.message); }
});

// ── Smart Config Merge: merges authorized_users from both sides without data loss ──
function mergeAuthorizedUsers(existingUsers = [], incomingUsers = []) {
  const merged = [...incomingUsers];
  const incomingIds = new Set(incomingUsers.map(u => String(u.id)));
  // Add users from cloud that are NOT in the incoming (bot-added users)
  for (const eu of existingUsers) {
    if (!incomingIds.has(String(eu.id))) {
      merged.push(eu);
      log(`[Config-Merge] Preserved bot-added user: ${eu.name || eu.id} (${eu.role})`);
    }
  }
  return merged;
}

app.post('/api/config', (req, res) => {
  try {
    let data = req.rawBody;
    if (data[0] === 0x1f && data[1] === 0x8b) data = zlib.gunzipSync(data);
    
    // ⚠️ CRITICAL PROTECTION: Never overwrite config with an invalid/empty token!
    let incoming;
    try { incoming = JSON.parse(data.toString('utf8')); } catch(e) { incoming = null; }
    
    if (!incoming || !incoming.bot_token || incoming.bot_token.trim().length < 20) {
      log('[Config API] ⚠️ REJECTED: Incoming config has no valid bot_token. Current config PRESERVED.');
      return res.status(400).json({ error: 'Invalid config: missing or empty bot_token. Existing config preserved.' });
    }
    
    // ✅ SMART MERGE: Preserve ALL users from both cloud and incoming (app-side)
    const existingCfg = loadConfig();
    // We removed mergeAuthorizedUsers so the app is the absolute source of truth.
    // incoming.authorized_users is used exactly as provided by the desktop app.

    // Preserve other cloud-side settings not present in incoming
    if (!incoming.email_settings && existingCfg.email_settings) {
      incoming.email_settings = existingCfg.email_settings;
    }
    
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(incoming, null, 2));
    log(`[Config API] ✅ Smart-merged config saved | users: ${incoming.authorized_users.length}`);
    res.sendStatus(200);
  } catch (e) { res.status(500).send(e.message); }
});

// ── Clients (قائمة الزبائن) API ──────────────────────────────────────────────
app.get('/api/clients', (req, res) => {
  try {
    if (fs.existsSync(CLIENTS_PATH)) {
      res.setHeader('Content-Type', 'application/json');
      res.sendFile(CLIENTS_PATH);
    } else {
      res.json([]);
    }
  } catch (e) { res.status(500).send(e.message); }
});

app.post('/api/clients', (req, res) => {
  try {
    let data = req.rawBody;
    if (data[0] === 0x1f && data[1] === 0x8b) data = zlib.gunzipSync(data);
    let incoming;
    try { incoming = JSON.parse(data.toString('utf8')); } catch(e) { incoming = null; }
    if (!incoming || !Array.isArray(incoming)) {
      return res.status(400).json({ error: 'Invalid clients data: expected an array.' });
    }
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(CLIENTS_PATH, JSON.stringify(incoming, null, 2));
    log(`[Clients API] ✅ Saved ${incoming.length} clients to clients.json`);
    res.sendStatus(200);
  } catch (e) { res.status(500).send(e.message); }
});

// ── Articles (قائمة المواد) API ──────────────────────────────────────────────
app.get('/api/articles', (req, res) => {
  try {
    if (fs.existsSync(ARTICLES_PATH)) {
      res.setHeader('Content-Type', 'application/json');
      res.sendFile(ARTICLES_PATH);
    } else {
      res.json([]);
    }
  } catch (e) { res.status(500).send(e.message); }
});

app.post('/api/articles', (req, res) => {
  try {
    let data = req.rawBody;
    if (data[0] === 0x1f && data[1] === 0x8b) data = zlib.gunzipSync(data);
    let incoming;
    try { incoming = JSON.parse(data.toString('utf8')); } catch(e) { incoming = null; }
    if (!incoming || !Array.isArray(incoming)) {
      return res.status(400).json({ error: 'Invalid articles data: expected an array.' });
    }
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(ARTICLES_PATH, JSON.stringify(incoming, null, 2));
    log(`[Articles API] ✅ Saved ${incoming.length} articles to articles.json`);
    res.sendStatus(200);
  } catch (e) { res.status(500).send(e.message); }
});

app.get('/ping', (req, res) => res.send('pong - bot is alive ♥️'));
app.get('/health', (req, res) => {
  const db = loadDB();
  const cfg = loadConfig();
  res.json({
    status: 'OK',
    employees: db.hr_employees?.length || 0,
    token_ok: !!(cfg.bot_token && cfg.bot_token.length > 20),
    time: new Date().toISOString()
  });
});

app.get('/api/logs', (req, res) => {
  try {
    const logPath = path.join(__dirname, 'bot_debug.log');
    if (!fs.existsSync(logPath)) return res.type('text/plain').send('No logs yet.');
    const logs = fs.readFileSync(logPath, 'utf8');
    res.type('text/plain').send(logs.split('\n').slice(-100).join('\n'));
  } catch (e) { res.status(500).send(e.message); }
});

app.get('/api/database', (req, res) => {
  try {
    if (fs.existsSync(DB_PATH)) {
      res.sendFile(DB_PATH);
    } else {
      res.status(404).send('Database not found');
    }
  } catch (e) { res.status(500).send(e.message); }
});

// ── Smart DB Merge: merges any array-of-objects collection by unique 'id' field ──
function mergeCollection(existing = [], incoming = [], key = 'id') {
  const map = new Map();
  for (const item of existing) if (item[key]) map.set(String(item[key]), item);
  for (const item of incoming) if (item[key]) map.set(String(item[key]), { ...(map.get(String(item[key])) || {}), ...item });
  return Array.from(map.values());
}

function mergeEmployees(existing = [], incoming = []) {
  const byId  = new Map();
  const byMat = new Map();
  // Index existing
  for (const e of existing) {
    if (e.id)        byId.set(String(e.id), e);
    if (e.clockingId) byMat.set(String(e.clockingId).trim(), e);
  }
  // Merge incoming on top
  for (const inc of incoming) {
    const existById  = inc.id        ? byId.get(String(inc.id))              : null;
    const existByMat = inc.clockingId ? byMat.get(String(inc.clockingId).trim()) : null;
    const base = existById || existByMat;
    if (base) {
      const merged = { ...base, ...inc }; // incoming wins (desktop app edits)
      byId.set(String(merged.id), merged);
      if (merged.clockingId) byMat.set(String(merged.clockingId).trim(), merged);
    } else {
      if (inc.id) byId.set(String(inc.id), inc);
      if (inc.clockingId) byMat.set(String(inc.clockingId).trim(), inc);
    }
  }
  // Deduplicate: prefer byId map (includes all)
  const seen = new Set();
  const result = [];
  for (const emp of byId.values()) {
    const key = String(emp.id || emp.clockingId || '');
    if (!seen.has(key)) { seen.add(key); result.push(emp); }
  }
  return result;
}

function mergeDatabases(cloudDb, incomingDb) {
  const merged = { ...cloudDb, ...incomingDb };
  merged.hr_employees      = mergeEmployees(cloudDb.hr_employees || [], incomingDb.hr_employees || []);
  merged.hr_leave_balances = mergeCollection(cloudDb.hr_leave_balances || [], incomingDb.hr_leave_balances || [], 'id');
  merged.bot_requests      = mergeCollection(cloudDb.bot_requests || [], incomingDb.bot_requests || [], 'id');
  merged.user_activity     = { ...(cloudDb.user_activity || {}), ...(incomingDb.user_activity || {}) };
  merged._last_updated     = Date.now();
  merged._last_updated_iso = new Date().toISOString();
  return merged;
}

app.post('/api/database', (req, res) => {
  try {
    let data = req.rawBody;
    if (data[0] === 0x1f && data[1] === 0x8b) data = zlib.gunzipSync(data);
    
    let incoming;
    try { incoming = JSON.parse(data.toString('utf8')); } catch(e) { incoming = null; }
    if (!incoming) { res.status(400).send('Invalid JSON'); return; }

    // ✅ SMART MERGE: combine cloud DB with incoming instead of overwriting
    let cloudDb = {};
    if (fs.existsSync(DB_PATH)) {
      try { cloudDb = JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); } catch(_) {}
    }
    const merged = mergeDatabases(cloudDb, incoming);

    fs.writeFileSync(DB_PATH, JSON.stringify(merged));
    log(`[DB API] ✅ Smart-merged DB saved | employees: ${merged.hr_employees?.length || 0} | ts: ${merged._last_updated_iso}`);
    res.sendStatus(200);
  } catch (e) { res.status(500).send(e.message); }
});

// ✅ Endpoint خفيف لمقارنة الـ timestamp فقط (بدون تحميل كامل DB)
app.get('/api/db-version', (req, res) => {
  try {
    if (fs.existsSync(DB_PATH)) {
      const stat = fs.statSync(DB_PATH);
      // محاولة قراءة _last_updated من الـ DB مباشرة
      try {
        const raw = fs.readFileSync(DB_PATH, 'utf8');
        const db = JSON.parse(raw);
        return res.json({
          last_updated: db._last_updated || stat.mtimeMs,
          last_updated_iso: db._last_updated_iso || stat.mtime.toISOString(),
          employee_count: db.hr_employees?.length || 0,
          file_mtime: stat.mtimeMs
        });
      } catch (_) {}
      return res.json({ last_updated: stat.mtimeMs, file_mtime: stat.mtimeMs, employee_count: 0 });
    }
    res.json({ last_updated: 0, employee_count: 0 });
  } catch (e) { res.status(500).send(e.message); }
});

async function dispatchEmails(recipients, subject, body, attachments = []) {
  const finalRecipients = [...new Set(recipients.filter(Boolean))];
  if (finalRecipients.length > 0) {
    log(`[Email-Dispatch] Sending to ${finalRecipients.length} recipients: ${finalRecipients.join(', ')}`);
    const success = await sendEmail(finalRecipients, subject, body, attachments);
    if (!success) {
      log(`[Email-Dispatch-Retry] Individual retry mode...`);
      for (const recipient of finalRecipients) {
        await sendEmail(recipient, subject, body, attachments);
      }
    }
    return success;
  }
  log(`[Email-Warn] No recipients found for: ${subject}`);
  return false;
}

export async function generateAndSendExitAuth(req, cfg) {
  const tempDir = os.tmpdir();
  const pdfPath = path.join(tempDir, `exit_${req.id}.pdf`);
  await generateExitAuthPDF(req, pdfPath);

  const subject = `📄 Autorisation de Sortie / تصريح خروج - ${req.empName}`;
  const body = `
🌟 Bonjour / السلام عليكم,

Nous vous informons qu'une nouvelle autorisation de sortie a été générée avec succès via le système TewfikSoft HR.
نحيطكم علماً بأنه قد تم إصدار تصريح خروج جديد بنجاح عبر نظام توفيق سوفت للموارد البشرية.

👤 Employé(e) / الموظف(ة): ${req.empName}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📂 Détails de l'autorisation / تفاصيل التصريح:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ Type / النوع: ${req.exitType === 'Service' ? 'Mission de Service / مهمة عمل' : 'Sortie Personnelle / خروج شخصي'}
📝 Motif / السبب: ${req.reason}
⏰ Heure / الوقت: ${req.exitTime}
✍️ Approuvé par / وافق عليه: ${req.adminApprovedBy || 'Admin'}
👮 Confirmé par / أكده: ${req.guardConfirmedBy || 'Garde'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Veuillez trouver le document officiel en pièce jointe (PDF).
يرجى الاطلاع على الوثيقة الرسمية المرفقة (PDF).

Cordialement / مع خالص التقدير،
🤖 Système TewfikSoft HR Automatisé
نظام توفيق سوفت للموارد البشرية المؤتمت
  `;

  const recipients = [];

  // 1. Always send to global HR email(s) - supports comma separated list
  const rawEmails = cfg.email_settings?.hr_notification_email || 'tewfik.nouar@alver.dz, tewfiksoft@gmail.com, nihel.dekiouk@alver.dz, MAMA.BENTAHAR@alver.dz, alverspa1980@gmail.com';
  const hrEmails = rawEmails.split(/[,\s;]+/).map(e => e.trim()).filter(e => e.includes('@'));
  if (hrEmails.length > 0) recipients.push(...hrEmails);

  // 2. Send to the manager who initiated the request (if email exists)
  const manager = cfg.authorized_users?.find(u => String(u.id) === String(req.managerId));
  if (manager?.email) recipients.push(manager.email);

  // 3. Send to the admin who approved it (if email exists)
  const admin = cfg.authorized_users?.find(u => u.name === req.adminApprovedBy);
  if (admin?.email) recipients.push(admin.email);

  const finalRecipients = [...new Set(recipients.filter(Boolean))];
  await dispatchEmails(recipients, subject, body, [
    { filename: `Autorisation_Sortie_${req.id}.pdf`, path: pdfPath }
  ]);
  try { if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath); } catch (e) {}
}

export async function generateAndSendEntryAuth(req, cfg) {
  const tempDir = os.tmpdir();
  const pdfPath = path.join(tempDir, `entry_${req.id}.pdf`);
  await generateEntryAuthPDF(req, pdfPath);

  const subject = `📥 Confirmation d'Entrée / تأكيد دخول - ${req.empName}`;
  const body = `
🌟 Bonjour / السلام عليكم,

Nous vous informons qu'une nouvelle confirmation d'entrée a été générée via le système TewfikSoft HR.
نحيطكم علماً بأنه قد تم تأكيد دخول الموظف بنجاح عبر نظام توفيق سوفت للموارد البشرية.

👤 Employé(e) / الموظف(ة): ${req.empName}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📂 Détails de l'entrée / تفاصيل الدخول:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📝 Motif / السبب: ${req.reason}
⏰ Heure / الوقت: ${req.entryTime}
✍️ Approuvé par / وافق عليه: ${req.adminApprovedBy || 'Admin'}
👮 Confirmé par / أكده: ${req.guardConfirmedBy || 'Garde'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Veuillez trouver le document officiel en pièce jointe (PDF).
يرجى الاطلاع على الوثيقة الرسمية المرفقة (PDF).

Cordialement / مع خالص التقدير،
🤖 Système TewfikSoft HR Automatisé
نظام توفيق سوفت للموارد البشرية المؤتمت
  `;

  const recipients = [];
  const rawEmails = cfg.email_settings?.hr_notification_email || 'tewfik.nouar@alver.dz, tewfiksoft@gmail.com, nihel.dekiouk@alver.dz, MAMA.BENTAHAR@alver.dz, alverspa1980@gmail.com';
  const hrEmails = rawEmails.split(/[,\s;]+/).map(e => e.trim()).filter(e => e.includes('@'));
  if (hrEmails.length > 0) recipients.push(...hrEmails);

  const manager = cfg.authorized_users?.find(u => String(u.id) === String(req.managerId));
  if (manager?.email) recipients.push(manager.email);

  const admin = cfg.authorized_users?.find(u => u.name === req.adminApprovedBy);
  if (admin?.email) recipients.push(admin.email);

  await dispatchEmails(recipients, subject, body, [
    { filename: `Confirmation_Entree_${req.id}.pdf`, path: pdfPath }
  ]);
  
  try { if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath); } catch (e) {}
}

export async function generateAndSendReturnNotify(req, cfg) {
  log(`[Return-Notify] Starting notification for ${req.empName} (ID: ${req.id})`);
  
  const tempDir = os.tmpdir();
  const pdfPath = path.join(tempDir, `return_${req.id}.pdf`);
  
  try {
    await generateReturnAuthPDF(req, pdfPath);
    log(`[Return-Notify] PDF generated: ${pdfPath}`);
  } catch (e) {
    log(`[Return-Notify-Err] PDF Generation failed: ${e.message}`);
  }

  const subject = `🏁 Retour Confirmé / تأكيد عودة - ${req.empName}`;
  
  let duration = req.actualDuration;
  if (!duration && req.guardConfirmedAt && req.returnedAt) {
    const start = new Date(req.guardConfirmedAt);
    const end = new Date(req.returnedAt);
    const diffMs = end - start;
    const diffHrs = Math.floor(diffMs / 3600000);
    const diffMins = Math.floor((diffMs % 3600000) / 60000);
    duration = `${diffHrs}h ${diffMins}m`;
  }

  const body = `
🌟 Bonjour / السلام عليكم,

Nous vous informons que le retour de l'employé a été confirmé via le système TewfikSoft HR.
نحيطكم علماً بأنه قد تم تأكيد عودة الموظف بنجاح عبر نظام توفيق سوفت للموارد البشرية.

👤 Employé(e) / الموظف(ة): ${req.empName}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📂 Détails du retour / تفاصيل العودة:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📝 Motif / السبب: ${req.reason || '—'}
⏰ Heure de retour / وقت العودة: ${req.actualReturnTime || (req.returnedAt ? new Date(req.returnedAt).toLocaleString() : '—')}
⏳ Durée totale / المدة الإجمالية: ${duration || '—'}
✍️ Approuvé par / وافق عليه: ${req.adminApprovedBy || 'Admin'}
👮 Confirmé par / أكده: ${req.guardConfirmedByReturn || req.returnConfirmedBy || 'Garde'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Veuillez trouver la confirmation officielle en pièce jointe (PDF).
يرجى الاطلاع على وثيقة تأكيد العودة الرسمية المرفقة (PDF).

Cordialement / مع خالص التقدير،
🤖 Système TewfikSoft HR Automatisé
نظام توفيق سوفت للموارد البشرية المؤتمت
  `;

  const recipients = [];
  const rawEmails = cfg.email_settings?.hr_notification_email || 'tewfik.nouar@alver.dz, tewfiksoft@gmail.com, nihel.dekiouk@alver.dz, MAMA.BENTAHAR@alver.dz, alverspa1980@gmail.com';
  const hrEmails = rawEmails.split(/[,\s;]+/).map(e => e.trim()).filter(e => e.includes('@'));
  if (hrEmails.length > 0) recipients.push(...hrEmails);

  const manager = cfg.authorized_users?.find(u => String(u.id) === String(req.managerId));
  if (manager?.email) recipients.push(manager.email);

  const admin = cfg.authorized_users?.find(u => u.name === req.adminApprovedBy);
  if (admin?.email) recipients.push(admin.email);

  log(`[Return-Notify] Final recipients list: ${recipients.join(', ')}`);
  
  const attachments = fs.existsSync(pdfPath) ? [{ filename: `Confirmation_Retour_${req.id}.pdf`, path: pdfPath }] : [];
  
  await dispatchEmails(recipients, subject, body, attachments);
  
  try { if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath); } catch (e) {}
}

export async function generateAndSendMissionAuth(req, cfg) {
  const tempDir = os.tmpdir();
  const pdfPath = path.join(tempDir, `mission_${req.id}.pdf`);
  const db = loadDB();
  const emp = db.hr_employees?.find(e => String(e.id) === req.empId);
  
  const empCompanyId = emp?.companyId || '';
  const db2 = db;
  const empCompany = (db2.hr_companies && empCompanyId) ? (db2.hr_companies[empCompanyId] || {}) : {};
  const empCompanyName = empCompany.fr?.name || empCompany.name || req.companyName || '';
  
  await generateMissionPDF({ ...req, emp, companyId: empCompanyId, companyName: empCompanyName }, pdfPath);

  const cleanDestinations = req.destinations.map(d => d.includes(' - ') ? d.split(' - ')[1] : d);
  const subject = `📝 Ordre de Mission / أمر بمهمة - ${req.empName}`;
  const body = `
🌟 Bonjour / السلام عليكم,

Nous vous informons qu'un nouvel ordre de mission a été généré et approuvé via le système TewfikSoft HR.
نحيطكم علماً بأنه قد تم إصدار واعتماد أمر بمهمة جديد بنجاح عبر نظام توفيق سوفت للموارد البشرية.

👤 Employé(e) / الموظف(ة): ${req.empName}
📍 Destinations / الوجهات: ${cleanDestinations.join(' - ')}
📅 Période / الفترة: du ${req.startDate} au ${req.endDate}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Veuillez trouver le document officiel en pièce jointe (PDF).
يرجى الاطلاع على الوثيقة الرسمية المرفقة (PDF).

Cordialement / مع خالص التقدير،
🤖 Système TewfikSoft HR Automatisé
نظام توفيق سوفت للموارد البشرية المؤتمت
  `;

  const recipients = [];
  const rawEmails = cfg.email_settings?.hr_notification_email || 'tewfik.nouar@alver.dz, tewfiksoft@gmail.com, nihel.dekiouk@alver.dz, MAMA.BENTAHAR@alver.dz, alverspa1980@gmail.com';
  const hrEmails = rawEmails.split(/[,\s;]+/).map(e => e.trim()).filter(e => e.includes('@'));
  if (hrEmails.length > 0) recipients.push(...hrEmails);

  const manager = cfg.authorized_users?.find(u => String(u.id) === String(req.managerId));
  if (manager?.email) recipients.push(manager.email);

  await dispatchEmails(recipients, subject, body, [
    { filename: `Ordre_Mission_${req.id}.pdf`, path: pdfPath }
  ]);
  
  try { if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath); } catch (e) {}
}

// --- 🌐 WEB INTERFACE / STATUS ---
app.get('/', (req, res) => {
  const db = loadDB();
  const count = db.hr_employees?.length || 0;
  res.send(`
    <div style="font-family: sans-serif; text-align: center; padding-top: 50px;">
      <h1 style="color: #1a5f7a;">TewfikSoft HR Bot v10.2 🚀</h1>
      <p style="font-size: 1.2em;">Status: <span style="color: green; font-weight: bold;">ONLINE</span></p>
      <p>Mode: <b>Webhook (Render-Optimized)</b></p>
      <p>Database: <b>${count} Employees Loaded</b></p>
      <hr style="width: 200px;">
      <p style="color: #666;">© 2026 TewfikSoft Professional HR System</p>
    </div>
  `);
});

// --- 🌐 WEBHOOK ENDPOINT ---
app.post('/api/telegram-webhook', (req, res) => {
  try {
    const body = req.body || (req.rawBody ? JSON.parse(req.rawBody.toString()) : {});
    handle(body).catch(e => log(`Webhook Err: ${e.message}`));
  } catch (e) {
    log(`Webhook Parse Err: ${e.message}`);
  }
  res.sendStatus(200);
});

const port = process.env.PORT || 10000;
const WEBHOOK_URL = process.env.WEBHOOK_URL || '';

const isMain = process.argv[1] && (process.argv[1].endsWith('index.js') || process.argv[1].includes('node_modules')); 

if (isMain) {
  app.listen(port, () => {
    log(`=== TewfikSoft HR Bot v10.4 [BVA-SEQ-DEBUG] on port ${port} ===`);
    // ... rest of the bootstrap ...
    const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxcj4K0p4FLgGGchC9oe4q95fLnHipbaUXN6hcQsCMDyR7ITH1ozIEF9Dk3SkEujt0njw/exec';
    const bootstrapFromCloud = async () => {
        try {
          if (fs.existsSync(DB_PATH)) {
            const existing = loadDB();
            if ((existing.hr_employees || []).length > 0) {
              log(`DB already has ${existing.hr_employees.length} employees — skipping Google Drive bootstrap.`);
              return;
            }
          }
          log('DB is empty — attempting one-time bootstrap from Google Drive...');
          const res = await fetch(GOOGLE_SCRIPT_URL);
          if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
          const data = await res.text();
          if (data && data.includes('hr_employees')) {
            fs.writeFileSync(DB_PATH, data);
            log(`Bootstrap OK: DB saved. Size: ${data.length} bytes.`);
            
            // Restore config.json authorized_users from Cloud
            try {
              const dbParsed = JSON.parse(data);
              if (dbParsed.authorized_users && dbParsed.authorized_users.length > 0) {
                let cfg = { authorized_users: [] };
                if (fs.existsSync(CONFIG_PATH)) cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
                cfg.authorized_users = dbParsed.authorized_users;
                fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
                log(`Bootstrap OK: Restored ${cfg.authorized_users.length} authorized users to config.json`);
              }
            } catch (cfgErr) {
              log(`Bootstrap Config Restore Error: ${cfgErr.message}`);
            }

          } else {
            log('Bootstrap Warning: Fetched data is invalid or empty.');
          }
        } catch (e) {
          log(`Bootstrap Error: ${e.message}`);
        }
      };
    
      bootstrapFromCloud();
    
      bootstrapFromCloud();
    
      // ─── 🌐 WEBHOOK MODE ───
      const RENDER_URL = process.env.RENDER_EXTERNAL_URL || 'https://tewfiksoft-hr-bot.onrender.com';
      const webhookUrl = `${RENDER_URL}/api/telegram-webhook`;
      
      tg('setWebhook', { url: webhookUrl })
        .then(res => log(`Webhook set to: ${webhookUrl} | Success: ${res.ok}`))
        .catch(e => log(`Webhook Set Error: ${e.message}`));
      
      // Polling is DISABLED when webhook is active
      // poll(); 
  });
}
