import express from 'express';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import os from 'os';
import { fileURLToPath } from 'url';

import { tg, send, notifyStaff, answerCallbackQuery } from './utils/telegram.js';
import { loadDB, saveDB, loadConfig, T, log } from './utils/database.js';
import { generateExitAuthPDF, generateEntryAuthPDF, generateMissionPDF } from './utils/pdf.js';
import { sendEmail } from './utils/email.js';
import crypto from 'crypto';
import { getStatsMsg, getEffectifsDirMsg, getEffectifsCompanyMsg, calculateAutoLeave } from './utils/ui.js';
import { convertAmountToWords } from './utils/cheque.js';
import { DOC_TYPES, DOSSIER_REASONS, WILAYAS } from './utils/constants.js';
import RoleFactory from './roles/RoleFactory.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, 'config.json');
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'database.json');

const updateConfig = (cfg) => fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));

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
loadStates();

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

  const roleObj = RoleFactory.create(userData);
  if (!roleObj) return;

  if (cbq) {
    if (cbq.id) await answerCallbackQuery(cbq.id);
    const d = cbq.data;

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
    if (d === 'search') { 
      const role = String(userData.role).toLowerCase();
      if (role === 'admin' || role === 'manager') {
        states.set(chatId, { step: 'search' }); 
        return send(chatId, ar ? '🔍 أرسل <b>رقم الموظف</b> أو <b>اسمه</b> :' : '🔍 Entrez <b>ID</b> ou <b>Nom</b> :');
      }
      return;
    }

    if (d === 'add_emp') {
      const role = String(userData.role).toLowerCase();
      if (role !== 'admin' && role !== 'manager') {
        return send(chatId, ar ? '❌ <b>هذه الميزة مخصصة للإدارة.</b>' : '❌ <b>Accès restreint à l\'administration.</b>');
      }
      states.set(chatId, { step: 'add_emp_tid' });
      return send(chatId, ar 
        ? `➕ <b>إضافة / تفعيل عامل:</b>\n━━━━━━━━━━━━━━\nيرجى إرسال <b>معرف تيليجرام (ID)</b> الخاص بالعامل (الذي يحصل عليه من أمر /me):` 
        : `➕ <b>Ajouter / Activer un employé:</b>\n━━━━━━━━━━━━━━\nVeuillez envoyer <b>l'ID Telegram</b> de l'employé (obtenu avec /me):`);
    }

    const db = loadDB();

    if (d.startsWith('add_emp_rolex:') || d.startsWith('add_emp_rolen:')) {
      const parts = d.split(':');
      const isNew = d.startsWith('add_emp_rolen:');
      const botRole = parts[1];
      const tid = parts[2];
      const empId = parts[3];
      const empName = isNew ? parts.slice(4).join(':') : '';

      const cfg = loadConfig();
      if (!cfg.authorized_users) cfg.authorized_users = [];
      
      let botUser = cfg.authorized_users.find(u => String(u.id) === String(tid));
      if (!botUser) {
         botUser = {
            id: tid,
            name: isNew ? empName : (db.hr_employees?.find(e => String(e.clockingId) === empId)?.firstName_ar || 'Employé'),
            role: botRole,
            scope: botRole === 'employee' ? 'custom_employees' : 'all',
            allowed_employees: [empId],
            clockingId: empId
         };
         cfg.authorized_users.push(botUser);
      } else {
         botUser.role = botRole;
         botUser.clockingId = empId;
         if (botRole === 'employee') {
            botUser.scope = 'custom_employees';
            botUser.allowed_employees = [empId];
         }
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
           startDate: new Date().toISOString().split('T')[0],
           createdAt: new Date().toISOString()
         };
         if (!db.hr_employees) db.hr_employees = [];
         db.hr_employees.push(emp);
         saveDB(db);
      }
      
      return send(chatId, ar 
         ? `✅ <b>تم العملية بنجاح!</b>\nتم تفعيل حساب التيليجرام: <code>${tid}</code>\nبرقم الموظف: <code>${empId}</code>\n\n<i>${isNew ? 'تمت إضافة العامل للقاعدة وسيظهر في التطبيق.' : 'العامل موجود مسبقاً وتم ربطه بالبوت.'}</i>` 
         : `✅ <b>Opération réussie!</b>\nCompte activé: <code>${tid}</code>\nID: <code>${empId}</code>`,
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
      if (role === 'admin' || role === 'manager' || role === 'gestionnaire_rh') {
        return send(chatId, ar ? 'ℹ️ <b>أنت مسجل كمسؤول.</b>\nليس لديك "رقم موظف" شخصي مرتبط بحسابك.\n\nاستخدم زر <b>البحث</b> للوصول لبيانات العمال.' : 'ℹ️ <b>Vous êtes Administrateur.</b>\nVous n\'avez pas de "Matricule" personnel lié.\n\nUtilisez le bouton <b>Recherche</b> pour accéder aux dossiers.');
      }
      return send(chatId, ar ? '❌ لم يتم العثور على ملفك الشخصي. يرجى مراجعة الإدارة.' : '❌ Profil introuvable. Veuillez contacter l\'administration.');
    }

    if (d.startsWith('full:')) {
      const emp = db.hr_employees?.find(e => String(e.id) === d.split(':')[1]);
      if (!emp) return;
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
      const isAdm = roleObj.isAdmin();
      const mask = (val) => isAdm ? (T(val) || '—') : '<code>********</code>';

      return send(chatId, ar
        ? `📜 <b>معلومات العقد:</b>\n━━━━━━━━━━━━━━\n📜 النوع: <b>${T(emp.contractType)}</b>\n📅 البداية: ${T(emp.startDate)}\n🔚 النهاية: ${T(emp.contractEndDate)}\n🏢 الشركة: ${T(emp.companyId).toUpperCase()}\n💼 CSP: ${mask(emp.csp)}`
        : `📜 <b>INFOS CONTRAT:</b>\n━━━━━━━━━━━━━━\n📜 Type: <b>${T(emp.contractType)}</b>\n📅 Début: ${T(emp.startDate)}\n🔚 Fin: ${T(emp.contractEndDate)}\n🏢 Société: ${T(emp.companyId).toUpperCase()}\n💼 CSP: ${mask(emp.csp)}`);
    }

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
      const isManager = role === 'manager';

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
      if (role !== 'admin' && role !== 'manager' && role !== 'gestionnaire_rh') {
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
        if (st.data.destinations.includes(val)) {
          st.data.destinations = st.data.destinations.filter(x => x !== val);
        } else {
          st.data.destinations.push(val);
        }
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
            const isSel = st.data.destinations.includes(w);
            row.push({ text: (isSel ? '✅ ' : '') + w, callback_data: `om_dest:toggle:${w}:${page}` });
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
        { text: ar ? '🧹 مسح الكل' : '🧹 Effacer', callback_data: `om_dest:clear:0:${page}` },
        { text: ar ? '🏁 تأكيد الوجهات' : '🏁 Confirmer', callback_data: 'om_dest:done' }
      ]);

      const msg = ar 
        ? `📍 <b>اختر وجهات المهمة (يمكنك اختيار عدة ولايات):</b>\n━━━━━━━━━━━━━━\nالوجهات المختارة: ${st.data.destinations.join(', ') || '—'}\n\n💡 <i>اضغط على الولاية للاختيار، ثم اضغط "تأكيد" عند الانتهاء.</i>`
        : `📍 <b>Choisissez les destinations (Multi-sélection):</b>\n━━━━━━━━━━━━━━\nSélection: ${st.data.destinations.join(', ') || '—'}\n\n💡 <i>Appuyez pour choisir, puis sur "Confirmer" une fois fini.</i>`;
      
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
        status: 'pending_gm',
        createdAt: new Date().toISOString()
      };
      
      if (!db.bot_requests) db.bot_requests = [];
      db.bot_requests.push(request);
      saveDB(db);

      const msg = ar 
        ? `📝 <b>طلب "أمر بمهمة" جديد</b>\n━━━━━━━━━━━━━━\n👤 الموظف: <b>${empName}</b>\n📍 الوجهات: ${st.data.destinations.join(', ')}\n📅 الفترة: من ${st.data.startDate} إلى ${st.data.endDate}\n✍️ السبب: ${st.data.reason}\n👤 الطالب: ${st.data.managerName}`
        : `📝 <b>DEMANDE D'ORDRE DE MISSION</b>\n━━━━━━━━━━━━━━\n👤 Employé: <b>${empName}</b>\n📍 Destinations: ${st.data.destinations.join(', ')}\n📅 Période: du ${st.data.startDate} au ${st.data.endDate}\n✍️ Motifs: ${st.data.reason}\n👤 Par: ${st.data.managerName}`;
      
      const kbd = { inline_keyboard: [
        [{ text: ar ? '✅ موافقة الإدارة' : '✅ Approuver par Admin', callback_data: `om_adm_app:${reqId}` }, { text: ar ? '❌ رفض' : '❌ Rejeter', callback_data: `om_adm_rej:${reqId}` }]
      ]};

      // Notify Staff (Admins get buttons, others get text)
      await notifyStaff(msg, cfg, (id, t, userKbd) => send(id, t, userKbd), kbd);
      states.delete(chatId);
      return send(chatId, ar ? `✅ تم إرسال طلب المهمة للإدارة للموافقة.` : `✅ Demande envoyée à l'administration.`);
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

      const msg = ar 
        ? `🚨 <b>تصريح خروج معتمد - يرجى التأكيد</b>\n━━━━━━━━━━━━━━\n👤 الموظف: <b>${req.empName}</b>\n📂 النوع: ${req.exitType === 'Service' ? 'مهمة عمل' : 'شخصي'}\n📅 وقت الخروج: ${req.exitTime}\n✍️ السبب: ${req.reason}\n✅ وافقت الإدارة: ${userData.name}`
        : `🚨 <b>SORTIE APPROUVÉE - À CONFIRMER</b>\n━━━━━━━━━━━━━━\n👤 Employé: <b>${req.empName}</b>\n📂 Type: ${req.exitType === 'Service' ? 'Raison de Service' : 'Sortie Personnelle'}\n📅 Heure Sortie: ${req.exitTime}\n✍️ Motif: ${req.reason}\n✅ Approuvé par: ${userData.name}`;
      
      const kbd = { inline_keyboard: [[{ text: ar ? '🏁 تأكيد الخروج الفعلي' : '🏁 Confirmer le Départ', callback_data: `exit_guard_conf:${reqId}` }]] };
      
      const guards = cfg.authorized_users?.filter(u => u.role === 'poste_garde') || [];
      for (const g of guards) { if (g.id) await send(g.id, msg, kbd); }
      
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

      const msg = ar 
        ? `❌ <b>تم رفض طلب تصريح الخروج</b>\n━━━━━━━━━━━━━━\n👤 الموظف: <b>${req.empName}</b>\n🚫 الرفض من طرف: ${userData.name}`
        : `❌ <b>DEMANDE DE SORTIE REJETÉE</b>\n━━━━━━━━━━━━━━\n👤 Employé: <b>${req.empName}</b>\n🚫 Rejeté par: ${userData.name}`;
      
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

      const msgFinal = ar 
        ? `✅ <b>تأكيد خروج عامل</b>\n━━━━━━━━━━━━━━\n👤 الموظف: <b>${req.empName}</b> قد خرج الآن من المؤسسة.\n👮 حارس المناوبة: ${userData.name}\n\n⏳ <i>بانتظار تسجيل العودة...</i>`
        : `✅ <b>SORTIE CONFIRMÉE</b>\n━━━━━━━━━━━━━━\n👤 L'employé <b>${req.empName}</b> a quitté l'entreprise.\n👮 Garde: ${userData.name}\n\n⏳ <i>En attente de retour...</i>`;

      if (req.managerId) await send(req.managerId, msgFinal);
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

      let durationStr = '';
      if (req.guardConfirmedAt) {
        const start = new Date(req.guardConfirmedAt);
        const end = new Date(req.returnedAt);
        const diffMs = end - start;
        const diffHrs = Math.floor(diffMs / 3600000);
        const diffMins = Math.floor((diffMs % 3600000) / 60000);
        durationStr = ar ? `\n⏱️ مدة الخروج: ${diffHrs} ساعة و ${diffMins} دقيقة` : `\n⏱️ Durée: ${diffHrs}h ${diffMins}m`;
      }

      const msgReturn = ar 
        ? `🏁 <b>تأكيد عودة عامل</b>\n━━━━━━━━━━━━━━\n👤 الموظف: <b>${req.empName}</b> عاد الآن إلى المؤسسة.\n👮 حارس المناوبة: ${userData.name}\n⏰ وقت العودة: ${new Date(req.returnedAt).toLocaleTimeString()}${durationStr}`
        : `🏁 <b>RETOUR CONFIRMÉ</b>\n━━━━━━━━━━━━━━\n👤 L'employé <b>${req.empName}</b> est de retour.\n👮 Garde: ${userData.name}\n⏰ Heure: ${new Date(req.returnedAt).toLocaleTimeString()}${durationStr}`;

      if (req.managerId) await send(req.managerId, msgReturn);
      
      // Ensure all admins/staff get the return notification
      await notifyStaff(msgReturn, cfg, send);

      // --- SEND EMAIL NOTIFICATION FOR RETURN ---
      try {
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
    if (role !== 'admin' && role !== 'manager') return;
    
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
    return send(chatId, `📧 <b>إعدادات البريد الحالية:</b>\nقائمة HR: <code>${s.hr_notification_email || 'غير محددة'}</code>\nالمنفذ: <code>${s.smtp_port || 465}</code>`);
  }

  if (txtLow === '/me' || txtLow === '/id') {
    const isAdminRole = String(userData.role).toLowerCase() === 'admin' || String(userData.role).toLowerCase() === 'manager';
    const db = isAdminRole ? loadDB() : null;
    const count = db?.hr_employees?.length || 0;
    
    const meMsg = ar 
      ? `👤 <b>البطاقة التعريفية:</b>\n━━━━━━━━━━━━━━\n🆔 المعرف: <code>${fromId}</code>\n👤 الاسم: <b>${userData.name}</b>\n🛡️ الرتبة: <code>${userData.role}</code>${isAdminRole ? `\n👥 قاعدة البيانات: <b>${count} موظف</b>` : ''}\n🌐 اللغة: ${userData.lang || 'ar'}`
      : `👤 <b>CARTE D'IDENTITÉ:</b>\n━━━━━━━━━━━━━━\n🆔 ID: <code>${fromId}</code>\n👤 Nom: <b>${userData.name}</b>\n🛡️ Rôle: <code>${userData.role}</code>${isAdminRole ? `\n👥 Base de données: <b>${count} employés</b>` : ''}\n🌐 Langue: ${userData.lang || 'fr'}`;
    
    return send(chatId, meMsg);
  }

  if (txtLow === '/version') {
    return send(chatId, `🚀 <b>TewfikSoft HR Bot v9.6</b>\n━━━━━━━━━━━━━━\n✅ التحديثات الأخيرة:\n- تحسين "أمر بمهمة" (المسافات والوظيفة).\n- دعم شعارات الشركات المتعددة.\n- منطق شرطي للشعارات (Alver/Fartak).\n- تحديث قائمة الإيميلات.\n\n⏰ وقت التحديث: ${new Date().toLocaleString()}`);
  }

  const st = states.get(chatId);
  if (st && txt && !txt.startsWith('/')) {
    states.delete(chatId);
    const db = loadDB();
    const emp = db.hr_employees?.find(e => String(e.id) === st.empId);
    const empName = emp ? `${emp.lastName_fr} ${emp.firstName_fr} (${emp.clockingId})` : st.empId;
    const role = String(userData.role).toLowerCase();
    const isManager = role === 'manager';

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
         const kbd = { inline_keyboard: [
           [{ text: ar ? '👨‍💼 مدير (Directeur)' : '👨‍💼 Directeur', callback_data: `add_emp_rolex:general_manager:${st.tid}:${txt}` }],
           [{ text: ar ? '👔 مسير (Manager)' : '👔 Manager', callback_data: `add_emp_rolex:manager:${st.tid}:${txt}` }],
           [{ text: ar ? '👷 عامل عادي (Employé)' : '👷 Employé normal', callback_data: `add_emp_rolex:employee:${st.tid}:${txt}` }],
           [{ text: ar ? '❌ إلغاء' : '❌ Annuler', callback_data: 'menu' }]
         ]};
         return send(chatId, ar 
           ? `✅ <b>هذا العامل موجود مسبقاً!</b>\nالاسم: ${exists.firstName_ar} ${exists.lastName_ar}\n\n📌 <b>اختر الصلاحية التي تريد منحها له في البوت:</b>`
           : `✅ <b>Cet employé existe déjà!</b>\nNom: ${exists.firstName_fr} ${exists.lastName_fr}\n\n📌 <b>Choisissez son rôle d'accès au Bot:</b>`, kbd);
      } else {
         states.set(chatId, { step: 'add_emp_name', tid: st.tid, empId: txt });
         return send(chatId, ar 
           ? `✅ الرقم جديد.\n\n✍️ أرسل <b>الاسم الكامل</b> للعامل الجديد لإنشائه:`
           : `✅ Nouveau matricule.\n\n✍️ Envoyez <b>le nom complet</b> du nouvel employé:`);
      }
    }

    if (st.step === 'add_emp_name') {
      const kbd = { inline_keyboard: [
        [{ text: ar ? '👨‍💼 مدير (Directeur)' : '👨‍💼 Directeur', callback_data: `add_emp_rolen:general_manager:${st.tid}:${st.empId}:${txt}` }],
        [{ text: ar ? '👔 مسير (Manager)' : '👔 Manager', callback_data: `add_emp_rolen:manager:${st.tid}:${st.empId}:${txt}` }],
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
        const cid = String(e.clockingId || '').toLowerCase().trim();
        const lnf = String(e.lastName_fr || '').toLowerCase();
        const fnf = String(e.firstName_fr || '').toLowerCase();
        return cid === q || cid.includes(q) || lnf.includes(q) || fnf.includes(q);
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
        // Exact match for clockingId (numeric only)
        return cid === q || parseInt(cid) === parseInt(q);
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



app.get('/api/debug-config', (req, res) => {
  try {
    const cfg = loadConfig();
    const cleanCfg = { ...cfg, bot_token: cfg.bot_token ? (cfg.bot_token.substring(0, 5) + '...') : 'missing' };
    res.json(cleanCfg);
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
    
    // Merge authorized_users to prevent local app from overwriting users added via Telegram
    const existingCfg = loadConfig();
    if (existingCfg.authorized_users && incoming.authorized_users) {
      const incomingIds = incoming.authorized_users.map(u => String(u.id));
      for (const eu of existingCfg.authorized_users) {
        if (!incomingIds.includes(String(eu.id))) {
           incoming.authorized_users.push(eu);
        }
      }
    } else if (existingCfg.authorized_users && !incoming.authorized_users) {
      incoming.authorized_users = existingCfg.authorized_users;
    }
    
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(incoming, null, 2));
    log('Config updated and merged: token: ' + incoming.bot_token.substring(0, 8) + '... | users: ' + (incoming.authorized_users ? incoming.authorized_users.length : 0));
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

app.post('/api/database', (req, res) => {
  try {
    let data = req.rawBody;
    if (data[0] === 0x1f && data[1] === 0x8b) data = zlib.gunzipSync(data);
    
    // ✅ إضافة timestamp المزامنة لتمكين المقارنة الذكية بين الأجهزة
    let db;
    try {
      db = JSON.parse(data.toString('utf8'));
      db._last_updated = Date.now();
      db._last_updated_iso = new Date().toISOString();
      data = Buffer.from(JSON.stringify(db));
    } catch (parseErr) {
      log(`[DB] Warning: Could not inject timestamp: ${parseErr.message}`);
    }
    
    fs.writeFileSync(DB_PATH, data);
    log(`DB updated: ${db?.hr_employees?.length || 0} employees | ts: ${db?._last_updated_iso || 'N/A'}`);
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
  const rawEmails = cfg.email_settings?.hr_notification_email || 'tewfik.nouar@alver.dz';
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
  const rawEmails = cfg.email_settings?.hr_notification_email || 'tewfik.nouar@alver.dz';
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

Cordialement / مع خالص التقدير،
🤖 Système TewfikSoft HR Automatisé
نظام توفيق سوفت للموارد البشرية المؤتمت
  `;

  const recipients = [];
  const rawEmails = cfg.email_settings?.hr_notification_email || 'tewfik.nouar@alver.dz';
  const hrEmails = rawEmails.split(/[,\s;]+/).map(e => e.trim()).filter(e => e.includes('@'));
  if (hrEmails.length > 0) recipients.push(...hrEmails);

  const manager = cfg.authorized_users?.find(u => String(u.id) === String(req.managerId));
  if (manager?.email) recipients.push(manager.email);

  const admin = cfg.authorized_users?.find(u => u.name === req.adminApprovedBy);
  if (admin?.email) recipients.push(admin.email);

  log(`[Return-Notify] Final recipients list: ${recipients.join(', ')}`);
  await dispatchEmails(recipients, subject, body);
}

export async function generateAndSendMissionAuth(req, cfg) {
  const tempDir = os.tmpdir();
  const pdfPath = path.join(tempDir, `mission_${req.id}.pdf`);
  const db = loadDB();
  const emp = db.hr_employees?.find(e => String(e.id) === req.empId);
  
  await generateMissionPDF({ ...req, emp }, pdfPath);

  const cleanDestinations = req.destinations.map(d => d.includes(' - ') ? d.split(' - ')[1] : d);
  const subject = `📝 Ordre de Mission / أمر بمهمة - ${req.empName}`;
  const body = `
🌟 Bonjour / السلام عليكم,

Nous vous informons qu'un nouvel ordre de mission a été généré et approuvé via le système TewfikSoft HR.
نحيطكم علماً بأنه قد تم إصدار واعتماد أمر بمهمة جديد بنجاح عبر نظام توفيق سوفت للموارد البشرية.

👤 Employé(e) / الموظف(ة): ${req.empName}
📍 Destinations / الوجهات: ${cleanDestinations.join(', ')}
📅 Période / الفترة: du ${req.startDate} au ${req.endDate}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Veuillez trouver le document officiel en pièce jointe (PDF).
يرجى الاطلاع على الوثيقة الرسمية المرفقة (PDF).

Cordialement / مع خالص التقدير،
🤖 Système TewfikSoft HR Automatisé
نظام توفيق سوفت للموارد البشرية المؤتمت
  `;

  const recipients = [];
  const rawEmails = cfg.email_settings?.hr_notification_email || 'tewfik.nouar@alver.dz';
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
      <h1 style="color: #1a5f7a;">TewfikSoft HR Bot v9.6 ☁️</h1>
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
    log(`=== TewfikSoft HR Bot v9.6 [SMTP-DEBUG] on port ${port} ===`);
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
