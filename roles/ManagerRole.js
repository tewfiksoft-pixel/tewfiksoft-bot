import BaseRole from './BaseRole.js';
import { send } from '../utils/telegram.js';

export default class ManagerRole extends BaseRole {
  showMenu(chatId, ar) {
    const kbd = { inline_keyboard: [
      [{ text: ar ? '🔍 البحث السريع عن الموظفين' : '🔍 Recherche Rapide', callback_data: 'search' }],
      [{ text: ar ? '👤 ملفي الشخصي' : '👤 Mon Profil', callback_data: 'my_profile' }],
      [{ text: ar ? '🌐 تغيير اللغة' : '🌐 Changer Langue', callback_data: 'choose_lang' }]
    ]};

    return send(chatId, ar
      ? `💎 <b>أهلاً بك</b>\n━━━━━━━━━━━━━━\n👤 المستخدم: <b>${this.user.name}</b>\n🛡️ الرتبة: <code>${String(this.user.role).toUpperCase()}</code>\n━━━━━━━━━━━━━━`
      : `💎 <b>BIENVENUE</b>\n━━━━━━━━━━━━━━\n👤 Utilisateur: <b>${this.user.name}</b>\n🛡️ Rôle: <code>${String(this.user.role).toUpperCase()}</code>\n━━━━━━━━━━━━━━`, kbd);
  }
}
