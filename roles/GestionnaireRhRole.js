import BaseRole from './BaseRole.js';
import { send } from '../utils/telegram.js';

export default class GestionnaireRhRole extends BaseRole {
  showMenu(chatId, ar) {
    const kbd = { inline_keyboard: [
      [{ text: '⏱️ Temps de Travail (مدة العمل)', callback_data: 'calc_step_1' }],
      [{ text: '📝 Chèque/Lettres (تحويل المبالغ)', callback_data: 'cheque_step' }],
      [{ text: '👤 Mon Profil (ملفي الشخصي)', callback_data: 'my_profile' }],
      [{ text: '📜 Guide Procédures (دليل العمل)', callback_data: 'end_work_guide' }],
      [{ text: '🌐 Langue (تغيير اللغة)', callback_data: 'choose_lang' }]
    ]};

    return send(chatId, ar
      ? `💎 <b>أهلاً بك في فضاء الموارد البشرية</b>\n━━━━━━━━━━━━━━\n👤 المستخدم: <b>${this.user.name}</b>\n🛡️ الرتبة: <code>${String(this.user.role).toUpperCase()}</code>\n━━━━━━━━━━━━━━`
      : `💎 <b>ESPACE RESSOURCES HUMAINES</b>\n━━━━━━━━━━━━━━\n👤 Utilisateur: <b>${this.user.name}</b>\n🛡️ Rôle: <code>${String(this.user.role).toUpperCase()}</code>\n━━━━━━━━━━━━━━`, kbd);
  }
}
