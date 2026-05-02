import express from 'express';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

import { tg, send, notifyStaff, answerCallbackQuery } from './utils/telegram.js';
import { loadDB, loadConfig, T, log } from './utils/database.js';
import { getStatsMsg, getEffectifsDirMsg, getEffectifsCompanyMsg } from './utils/ui.js';
import { DOC_TYPES, DOSSIER_REASONS } from './utils/constants.js';
import RoleFactory from './roles/RoleFactory.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, 'config.json');
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'database.json');

const updateConfig = (cfg) => fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });


const langs = new Map();
const states = new Map();

async function handle(u) {
  const cbq = u.callback_query, msg = u.message || cbq?.message, from = u.message?.from || cbq?.from;
  if (!msg || !from) return;
  const chatId = msg.chat.id, fromId = String(from.id), cfg = loadConfig();
  const userData = cfg.authorized_users?.find(u => {
    const adId = String(u.id || '').replace('@', '').toLowerCase().trim();
    return adId === fromId || (from.username && adId === from.username.toLowerCase());
  });
  if (!userData) return;

  const roleObj = RoleFactory.create(userData);
  if (!roleObj) return;

  const ar = (userData.lang || langs.get(chatId) || 'ar') === 'ar';

  if (cbq) {
    await answerCallbackQuery(cbq.id);
    const d = cbq.data;

    if (d.startsWith('lang:')) {
      userData.lang = d.split(':')[1];
      await updateConfig(cfg);
      return roleObj.showMenu(chatId, userData.lang === 'ar', getStatsMsg);
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
    if (d === 'menu') return roleObj.showMenu(chatId, ar, getStatsMsg);
    if (d === 'search') { 
      const role = String(userData.role).toLowerCase();
      if (role === 'admin' || role === 'manager') {
        states.set(chatId, { step: 'search' }); 
        return send(chatId, ar ? '🔍 أرسل <b>رقم الموظف</b> أو <b>اسمه</b> :' : '🔍 Entrez <b>ID</b> ou <b>Nom</b> :');
      }
      return;
    }

    const db = loadDB();

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
      const bals = (db.hr_leave_balances || []).filter(b => String(b.employeeId) === empId);
      let msg = ar ? '🏖️ <b>رصيد العطل السنوي:</b>\n━━━━━━━━━━━━━━\n' : '🏖️ <b>SOLDE CONGÉS:</b>\n━━━━━━━━━━━━━━\n';
      if (bals.length === 0) msg += ar ? '⚠️ لا توجد بيانات مسجلة.' : '⚠️ Aucune donnée enregistrée.';
      for (const b of bals) {
        msg += `📅 ${b.exercice}: ✅ ${b.remainingDays}/${b.totalDays} ${ar ? 'يوم' : 'jours'}\n`;
        if (b.lastComment) msg += `   └ 💬 <i>${b.lastComment}</i>\n`;
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

    if (d.startsWith('back:')) {
      const emp = db.hr_employees?.find(e => String(e.id) === d.split(':')[1]);
      if (emp) return roleObj.showEmployeeCard(chatId, emp, ar);
    }

    if (d === 'stats') {
      const db = loadDB();
      return send(chatId, getStatsMsg(db, ar), { inline_keyboard: [
        [{ text: ar ? '🔄 تحديث' : '🔄 Actualiser', callback_data: 'stats' }]
      ]});
    }

    if (d === 'effectifs_dir') {
      return send(chatId, ar ? '🏢 <b>الرجاء اختيار الشركة لعرض الإحصائيات:</b>\n━━━━━━━━━━━━━━' : '🏢 <b>Veuillez choisir la société:</b>\n━━━━━━━━━━━━━━', { inline_keyboard: [
        [{ text: ar ? '🟢 شركة الفار (ALVER)' : '🟢 ALVER', callback_data: 'eff_comp:alver' }],
        [{ text: ar ? '🔵 شركة فارتك (VERRE TECH)' : '🔵 VERRE TECH', callback_data: 'eff_comp:vt' }],
        [{ text: ar ? '🔙 رجوع' : '🔙 Retour', callback_data: 'menu' }]
      ]});
    }

    if (d.startsWith('eff_comp:')) {
      const compType = d.split(':')[1];
      const db = loadDB();
      return send(chatId, getEffectifsCompanyMsg(db, ar, compType), { inline_keyboard: [
        [{ text: ar ? '🔄 تحديث' : '🔄 Actualiser', callback_data: d }],
        [{ text: ar ? '🔙 رجوع للشركات' : '🔙 Retour aux sociétés', callback_data: 'effectifs_dir' }],
        [{ text: ar ? '🏠 القائمة الرئيسية' : '🏠 Menu', callback_data: 'menu' }]
      ]});
    }
    return;
  }

  const txt = (msg.text || '').trim(), txtLow = txt.toLowerCase();

  // Handle typing 'دخول 08:15 خروج 16:30'
  if ((txt.includes('دخول') && txt.includes('خروج')) || 
      (txtLow.includes('entree') && txtLow.includes('sortie')) || 
      (txtLow.includes('entrée') && txtLow.includes('sortie'))) {
    const times = [...txt.matchAll(/(\d{1,2})[:.hH](\d{2})/g)];
    if (times.length >= 2) {
      const inH = parseInt(times[0][1], 10), inM = parseInt(times[0][2], 10);
      const outH = parseInt(times[1][1], 10), outM = parseInt(times[1][2], 10);
      let inTotal = inH * 60 + inM;
      let outTotal = outH * 60 + outM;
      if (outTotal < inTotal) outTotal += 24 * 60; // handle cross midnight
      
      const diffMins = outTotal - inTotal;
      const diffHrs = Math.floor(diffMins / 60);
      const remMins = diffMins % 60;
      
      let reply = ar ? `⏱️ <b>المدة الإجمالية للعمل:</b>\n` : `⏱️ <b>Durée totale de travail:</b>\n`;
      if (diffHrs > 0) {
        reply += ar ? `<b>${diffHrs}</b> ساعة و ` : `<b>${diffHrs}</b> heure(s) et `;
      }
      reply += ar ? `<b>${remMins}</b> دقيقة.` : `<b>${remMins}</b> minute(s).`;
      
      return send(chatId, reply);
    }
  }

  if (txtLow === '/start' || txtLow === '/m') {
    return send(chatId, '🌐 <b>الرجاء اختيار اللغة / Choisissez la langue</b>', { inline_keyboard: [[{ text: 'العربية 🇩🇿', callback_data: 'lang:ar' }, { text: 'Français 🇫🇷', callback_data: 'lang:fr' }]] });
  }

  if (txtLow === '/me') {
    const isAdminRole = String(userData.role).toLowerCase() === 'admin';
    const db = isAdminRole ? loadDB() : null;
    const dbLine = isAdminRole ? `\n👥 DB: <b>${db.hr_employees?.length || 0}</b>` : '';
    return send(chatId, `🛠️ <b>System:</b>\n🆔 ID: <code>${fromId}</code>\n👤 ${userData.name}\n🛡️ ${userData.role}${dbLine}`);
  }

  const st = states.get(chatId);
  if (st && txt && !txt.startsWith('/')) {
    states.delete(chatId);
    const db = loadDB();
    const emp = db.hr_employees?.find(e => String(e.id) === st.empId);
    const empName = emp ? `${emp.lastName_fr} ${emp.firstName_fr} (${emp.clockingId})` : st.empId;
    const role = String(userData.role).toLowerCase();
    const isManager = role === 'manager';

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

    if (st.step === 'survey_detail') {
      await notifyStaff(`🗳️ <b>إعلام عن مخالفة</b>\n━━━━━━━━━━━━━━\n👤 الموظف: ${empName}\n📊 السبب: <b>${st.reasonName}</b>\n✍️ التفاصيل: ${txt}\n👤 من طرف: ${userData.name}`, cfg, send);
      return send(chatId, isManager
        ? (ar ? `✅ تم إرسال البلاغ.\n📊 ${st.reasonName}\n⏳ <b>سوف يُدرس طلبك من طرف الإدارة.</b>` : `✅ Rapport envoyé.\n📊 ${st.reasonName}\n⏳ <b>Votre demande sera étudiée par l'administration.</b>`)
        : (ar ? `✅ <b>تم إرسال البلاغ!</b>\n📊 ${st.reasonName}\n✍️ ${txt}` : `✅ <b>Rapport envoyé!</b>\n📊 ${st.reasonName}\n✍️ ${txt}`));
    }
  }

  if (txt && !txt.startsWith('/')) {
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
      return cid === q || cid.includes(q) || lnf.includes(q) || fnf.includes(q) || lna.includes(q);
    }).slice(0, 5);

    if (results.length === 0) return send(chatId, ar ? `❌ لا يوجد موظف بهذا الرقم: <b>${txt}</b>\n\n🔍 حاول مجدداً:` : `❌ Aucun employé trouvé: <b>${txt}</b>\n\n🔍 Réessayez:`);
    for (const emp of results) {
      const bals = (db.hr_leave_balances || []).filter(b => String(b.employeeId) === String(emp.id));
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

app.get('/', (req, res) => {
  const db = loadDB();
  res.status(200).send(`TewfikSoft HR Bot v8.0 | Server is running OK | ${db.hr_employees?.length || 0} employees loaded.`);
});

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

const port = process.env.PORT || 10000;
const WEBHOOK_URL = process.env.WEBHOOK_URL || '';

app.listen(port, () => {
  log(`=== TewfikSoft HR Bot v8.7 on port ${port} ===`);

  // ─── ضبط الـ Webhook تلقائياً ───
  if (WEBHOOK_URL) {
    tg('setWebhook', { url: `${WEBHOOK_URL}/api/webhook` });
    log(`✅ Webhook set to: ${WEBHOOK_URL}/api/webhook`);
  } else {
    log('⚠️  WEBHOOK_URL not set! Add it in Koyeb Dashboard > Environment Variables');
  }

  // ─── Keep-Alive: ping كل 10 دقائق لمنع النوم ───
  if (WEBHOOK_URL) {
    setInterval(() => {
      try {
        import('https').then(({ default: https }) => {
          https.get(WEBHOOK_URL, (res) => {
            log(`[Keep-Alive] ping OK - status: ${res.statusCode}`);
          }).on('error', (e) => {
            log(`[Keep-Alive] ping error: ${e.message}`);
          });
        });
      } catch(e) { log(`[Keep-Alive] error: ${e.message}`); }
    }, 10 * 60 * 1000); // كل 10 دقائق
  }
  

  // ─── جلب قاعدة البيانات من السحابة الخارجية (Google Drive) ───
  // ملاحظة: يتم جلب البيانات من Google Drive فقط إذا كانت قاعدة البيانات فارغة (أول تشغيل)
  // البيانات الجديدة تأتي تلقائياً عبر /api/database من التطبيق المحلي (server.js)
  const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxcj4K0p4FLgGGchC9oe4q95fLnHipbaUXN6hcQsCMDyR7ITH1ozIEF9Dk3SkEujt0njw/exec';
  const bootstrapFromCloud = async () => {
    try {
      // تحقق إذا كانت قاعدة البيانات تحتوي على بيانات مسبقاً
      if (fs.existsSync(DB_PATH)) {
        const existing = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
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

  // جلب البيانات مرة واحدة عند الإقلاع فقط إذا كانت قاعدة البيانات فارغة
  bootstrapFromCloud();
  // ⚠️ لا يوجد setInterval هنا — البيانات تأتي من التطبيق عبر /api/database

});
