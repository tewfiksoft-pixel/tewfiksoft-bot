import BaseRole from './BaseRole.js';
import { send } from '../utils/telegram.js';

export default class ManagerRole extends BaseRole {
  showMenu(chatId, ar) {
    const kbd = { inline_keyboard: [
      [{ text: '🔍 Recherche (البحث السريع)', callback_data: 'search' }],
      [{ text: '👤 Mon Profil (ملفي الشخصي)', callback_data: 'my_profile' }],
      [{ text: '🌐 Langue (تغيير اللغة)', callback_data: 'choose_lang' }]
    ]};

    return send(chatId, ar
      ? `💎 <b>أهلاً بك</b>\n━━━━━━━━━━━━━━\n👤 المستخدم: <b>${this.user.name}</b>\n🛡️ الرتبة: <code>${String(this.user.role).toUpperCase()}</code>\n━━━━━━━━━━━━━━`
      : `💎 <b>BIENVENUE</b>\n━━━━━━━━━━━━━━\n👤 Utilisateur: <b>${this.user.name}</b>\n🛡️ Rôle: <code>${String(this.user.role).toUpperCase()}</code>\n━━━━━━━━━━━━━━`, kbd);
  }
}
