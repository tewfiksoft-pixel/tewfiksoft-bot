import BaseRole from './BaseRole.js';
import { send } from '../utils/telegram.js';

export default class ManagerRole extends BaseRole {
  showMenu(chatId, ar) {
    const kbd = { inline_keyboard: [
      [{ text: ar ? '🚪 تصريح خروج' : '🚪 Autorisation de Sortie', callback_data: 'start_exit_req' }],
      [{ text: ar ? '📥 تصريح دخول' : '📥 Autorisation d\'Entrée', callback_data: 'entry_type_pre' }],
      [{ text: ar ? '🛠️ أدوات الإدارة' : '🛠️ Outils de Gestion', callback_data: 'mgmt_tools' }],
      [{ text: ar ? '🔍 البحث السريع' : '🔍 Recherche Rapide', callback_data: 'search' }],
      [{ text: ar ? '👤 ملفي الشخصي' : '👤 Mon Profil', callback_data: 'my_profile' }],
      [{ text: ar ? '🌐 تغيير اللغة' : '🌐 Changer la Langue', callback_data: 'choose_lang' }]
    ]};

    return send(chatId, ar
      ? `💎 <b>أهلاً بك [v8.9.5]</b>\n━━━━━━━━━━━━━━\n👤 المستخدم: <b>${this.user.name}</b>\n🛡️ الرتبة: <code>${String(this.user.role).toUpperCase()}</code>\n━━━━━━━━━━━━━━`
      : `💎 <b>BIENVENUE [v8.9.5]</b>\n━━━━━━━━━━━━━━\n👤 Utilisateur: <b>${this.user.name}</b>\n🛡️ Rôle: <code>${String(this.user.role).toUpperCase()}</code>\n━━━━━━━━━━━━━━`, kbd);
  }
}
