import BaseRole from './BaseRole.js';
import { send } from '../utils/telegram.js';
import { loadDB } from '../utils/database.js';

export default class AdminRole extends BaseRole {
  showMenu(chatId, ar, getStatsMsg) {
    const db = loadDB();
    const kbd = { inline_keyboard: [
      [{ text: '📊 Statistiques (ستاتستيك)', callback_data: 'stats' }],
      [{ text: '👥 Effectifs/Dir (تعداد العمال)', callback_data: 'effectifs_dir' }],
      [{ text: '🔍 Recherche (البحث السريع)', callback_data: 'search' }],
      [{ text: '📝 Chèque/Lettres (تحويل المبالغ)', callback_data: 'cheque_step' }],
      [{ text: '👤 Mon Profil (ملفي الشخصي)', callback_data: 'my_profile' }],
      [{ text: '🌐 Langue (تغيير اللغة)', callback_data: 'choose_lang' }]
    ]};

    let header = ar
      ? `💎 <b>أهلاً بك في نظام الإدارة العليا</b>\n👤 المستخدم: <b>${this.user.name}</b>\n🛡️ الرتبة: <code>${String(this.user.role).toUpperCase()}</code>\n`
      : `💎 <b>DASHBOARD DIRECTION GÉNÉRALE</b>\n👤 Utilisateur: <b>${this.user.name}</b>\n🛡️ Rôle: <code>${String(this.user.role).toUpperCase()}</code>\n`;

    return send(chatId, header, kbd);
  }

  isAdmin() { return true; }
}
