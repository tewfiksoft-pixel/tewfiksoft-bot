import { send, tg } from '../utils/telegram.js';
import { loadDB, T } from '../utils/database.js';

export default class BaseRole {
  constructor(user) {
    this.user = user;
    this.langs = new Map(); // Note: in practice, we might need a global store or pass it
  }

  async notifyStaff(txt, cfg, sendFn) {
    const admins = cfg.authorized_users?.filter(u => u.role === 'admin' || u.role === 'general_manager') || [];
    for (const a of admins) { if (a.id) await sendFn(a.id, `🔔 <b>إشعار للإدارة:</b>\n${txt}`); }
    const rh = cfg.authorized_users?.filter(u => u.role === 'gestionnaire_rh') || [];
    for (const r of rh) { if (r.id) await sendFn(r.id, `🔔 <b>إشعار للموارد البشرية:</b>\n${txt}`); }
  }

  showMenu(chatId, ar) {
    // Default menu logic (can be overridden)
    const kbd = { inline_keyboard: [] };
    kbd.inline_keyboard.push([{ text: ar ? '👤 ملفي الشخصي' : '👤 Mon Profil', callback_data: 'my_profile' }]);
    kbd.inline_keyboard.push([{ text: ar ? '🌐 تغيير اللغة' : '🌐 Changer Langue', callback_data: 'choose_lang' }]);

    return send(chatId, ar
      ? `💎 <b>أهلاً بك</b>\n━━━━━━━━━━━━━━\n👤 المستخدم: <b>${this.user.name}</b>\n🛡️ الرتبة: <code>${String(this.user.role).toUpperCase()}</code>\n━━━━━━━━━━━━━━`
      : `💎 <b>BIENVENUE</b>\n━━━━━━━━━━━━━━\n👤 Utilisateur: <b>${this.user.name}</b>\n🛡️ Rôle: <code>${String(this.user.role).toUpperCase()}</code>\n━━━━━━━━━━━━━━`, kbd);
  }

  async showEmployeeCard(chatId, emp, ar) {
    const role = String(this.user.role).toLowerCase();
    const msg = ar
      ? `👤 <b>الملف الشامل للموظف</b>\n━━━━━━━━━━━━━━\n👤 الاسم: <b>${T(emp.lastName_ar)} ${T(emp.firstName_ar)}</b>\n🆔 الرمز: <code>${emp.clockingId}</code>\n💼 الوظيفة: <i>${T(emp.jobTitle_ar)}</i>\n🏢 الشركة: <b>${T(emp.companyId).toUpperCase()}</b>\n🏢 القسم: ${T(emp.department_ar)}\n📅 تاريخ البداية: ${T(emp.startDate)}\n📜 نوع العقد: ${T(emp.contractType)}\n━━━━━━━━━━━━━━`
      : `👤 <b>DOSSIER COMPLET</b>\n━━━━━━━━━━━━━━\n👤 Nom: <b>${T(emp.lastName_fr)} ${T(emp.firstName_fr)}</b>\n🆔 ID: <code>${emp.clockingId}</code>\n💼 Poste: <i>${T(emp.jobTitle_fr)}</i>\n🏢 Société: <b>${T(emp.companyId).toUpperCase()}</b>\n🏢 Dept: ${T(emp.department_fr)}\n📅 Début: ${T(emp.startDate)}\n📜 Contrat: ${T(emp.contractType)}\n━━━━━━━━━━━━━━`;
    
    const kbd = { inline_keyboard: [
      [{ text: ar ? '📄 الملف الكامل' : '📄 Fiche Complète', callback_data: 'full:' + emp.id }],
      [{ text: ar ? '📜 العقود' : '📜 Contrats', callback_data: 'docs:' + emp.id }, { text: ar ? '🏖️ العطل' : '🏖️ Congés', callback_data: 'leave:' + emp.id }]
    ]};
    
    if (role !== 'employee' && role !== 'gestionnaire_rh') {
      kbd.inline_keyboard.push([{ text: ar ? '🚨 الغيابات' : '🚨 Absences', callback_data: 'abs:' + emp.id }, { text: ar ? '🗳️ الاستبيان' : '🗳️ Sondage', callback_data: 'survey:' + emp.id }]);
    }
    
    kbd.inline_keyboard.push([{ text: ar ? '📄 طلب وثيقة' : '📄 Demander Document', callback_data: 'reqmenu:' + emp.id }]);
    
    if (role === 'admin' || role === 'manager') {
      kbd.inline_keyboard.push([{ text: ar ? '🔍 بحث جديد' : '🔍 Nouvelle Recherche', callback_data: 'search' }]);
    }
    return send(chatId, msg, kbd);
  }
}
