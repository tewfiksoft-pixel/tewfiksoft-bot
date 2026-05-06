import BaseRole from './BaseRole.js';
import { send } from '../utils/telegram.js';
import { loadDB } from '../utils/database.js';

export default class AdminRole extends BaseRole {
  showMenu(chatId, ar, getStatsMsg) {
    const db = loadDB();
    const kbd = { inline_keyboard: [
      [{ text: ar ? '🔄 تحديث الإحصائيات' : '🔄 Actualiser', callback_data: 'stats' }],
      [{ text: ar ? '👥 تعداد العمال حسب المديرية' : '👥 Effectifs par direction', callback_data: 'effectifs_dir' }],
      [{ text: ar ? '🔍 البحث السريع عن الموظفين' : '🔍 Recherche Rapide', callback_data: 'search' }],
      [{ text: ar ? '📝 تفقيط الأرقام (شيك)' : '📝 Chiffres en Lettres', callback_data: 'cheque_step' }],
      [{ text: ar ? '👤 ملفي الشخصي' : '👤 Mon Profil', callback_data: 'my_profile' }],
      [{ text: ar ? '🌐 تغيير اللغة' : '🌐 Changer Langue', callback_data: 'choose_lang' }]
    ]};

    let header = ar
      ? `💎 <b>أهلاً بك في نظام الإدارة العليا</b>\n👤 المستخدم: <b>${this.user.name}</b>\n🛡️ الرتبة: <code>${String(this.user.role).toUpperCase()}</code>\n`
      : `💎 <b>DASHBOARD DIRECTION GÉNÉRALE</b>\n👤 Utilisateur: <b>${this.user.name}</b>\n🛡️ Rôle: <code>${String(this.user.role).toUpperCase()}</code>\n`;

    return send(chatId, header + "\n" + getStatsMsg(db, ar), kbd);
  }

  isAdmin() { return true; }
}
