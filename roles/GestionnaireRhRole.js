import BaseRole from './BaseRole.js';
import { send } from '../utils/telegram.js';

export default class GestionnaireRhRole extends BaseRole {
  showMenu(chatId, ar) {
    const kbd = { inline_keyboard: [
      [{ text: ar ? '🚪 تصريح خروج' : '🚪 Autorisation de Sortie', callback_data: 'start_exit_req' }],
      [{ text: ar ? '🛠️ أدوات الإدارة' : '🛠️ Outils de Gestion', callback_data: 'mgmt_tools' }],
      [{ text: ar ? '⏱️ حساب مدة العمل' : '⏱️ Temps de Travail', callback_data: 'calc_step_1' }],
      [{ text: ar ? '📝 تحويل المبالغ' : '📝 Chèque en Lettres', callback_data: 'cheque_step' }],
      [{ text: ar ? '🔍 البحث السريع' : '🔍 Recherche Rapide', callback_data: 'search' }],
      [{ text: ar ? '👤 ملفي الشخصي' : '👤 Mon Profil', callback_data: 'my_profile' }],
      [{ text: ar ? '📜 دليل العمل' : '📜 Guide Procédures', callback_data: 'end_work_guide' }],
      [{ text: ar ? '🌐 تغيير اللغة' : '🌐 Changer la Langue', callback_data: 'choose_lang' }]
    ]};

    return send(chatId, ar
      ? `💎 <b>أهلاً بك في فضاء الموارد البشرية</b>\n━━━━━━━━━━━━━━\n👤 المستخدم: <b>${this.user.name}</b>\n🛡️ الرتبة: <code>${String(this.user.role).toUpperCase()}</code>\n━━━━━━━━━━━━━━`
      : `💎 <b>ESPACE RESSOURCES HUMAINES</b>\n━━━━━━━━━━━━━━\n👤 Utilisateur: <b>${this.user.name}</b>\n🛡️ Rôle: <code>${String(this.user.role).toUpperCase()}</code>\n━━━━━━━━━━━━━━`, kbd);
  }
}
