import BaseRole from './BaseRole.js';
import { send } from '../utils/telegram.js';

export default class GestionnaireRhRole extends BaseRole {
  showMenu(chatId, ar) {
    const kbd = { inline_keyboard: [
      [{ text: ar ? '🟢 تسجيل الدخول للعمل' : '🟢 Pointage Entrée', callback_data: 'work_in' }],
      [{ text: ar ? '🔴 تسجيل الخروج من العمل' : '🔴 Pointage Sortie', callback_data: 'work_out' }],
      [{ text: ar ? '👤 ملفي الشخصي' : '👤 Mon Profil', callback_data: 'my_profile' }],
      [{ text: ar ? '📜 دليل نهاية العمل' : '📜 Guide Fin de Travail', callback_data: 'end_work_guide' }],
      [{ text: ar ? '🌐 تغيير اللغة' : '🌐 Changer Langue', callback_data: 'choose_lang' }]
    ]};

    return send(chatId, ar
      ? `💎 <b>أهلاً بك في فضاء الموارد البشرية</b>\n━━━━━━━━━━━━━━\n👤 المستخدم: <b>${this.user.name}</b>\n🛡️ الرتبة: <code>${String(this.user.role).toUpperCase()}</code>\n━━━━━━━━━━━━━━`
      : `💎 <b>ESPACE RESSOURCES HUMAINES</b>\n━━━━━━━━━━━━━━\n👤 Utilisateur: <b>${this.user.name}</b>\n🛡️ Rôle: <code>${String(this.user.role).toUpperCase()}</code>\n━━━━━━━━━━━━━━`, kbd);
  }
}
