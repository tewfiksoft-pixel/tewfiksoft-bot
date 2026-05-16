import BaseRole from './BaseRole.js';
import { send } from '../utils/telegram.js';
import { loadDB } from '../utils/database.js';

export default class AdminRole extends BaseRole {
  showMenu(chatId, ar, getStatsMsg) {
    const db = loadDB();
    const kbd = { inline_keyboard: [
      [{ text: ar ? '🚪 إدارة التصاريح (دخول/خروج)' : '🚪 Gestion des Accès', callback_data: 'auth_menu' }],
      [{ text: ar ? '📊 الإحصائيات' : '📊 Statistiques', callback_data: 'stats_menu' }],
      [{ text: ar ? '🛠️ أدوات الإدارة' : '🛠️ Outils de Gestion', callback_data: 'mgmt_tools' }],
      [{ text: ar ? '📈 إحصائيات المديريات' : '📈 Stats par Directions', callback_data: 'effectifs_dir' }],
      [{ text: ar ? '➕ إضافة عامل جديد' : '➕ Ajouter un Employé', callback_data: 'add_emp' }],
      [{ text: ar ? '🔍 البحث السريع' : '🔍 Recherche Rapide', callback_data: 'search' }],
      [{ text: ar ? '📝 تحويل المبالغ' : '📝 Chèque en Lettres', callback_data: 'cheque_step' }],
      [{ text: ar ? '👤 ملفي الشخصي' : '👤 Mon Profil', callback_data: 'my_profile' }],
      [{ text: ar ? '🌐 تغيير اللغة' : '🌐 Changer la Langue', callback_data: 'choose_lang' }]
    ]};

    return send(chatId, ar
      ? `💎 <b>أهلاً بك [v9.6 ☁️ Cloud]</b>\n━━━━━━━━━━━━━━\n👤 المستخدم: <b>${this.user.name}</b>\n🛡️ الرتبة: <code>${String(this.user.role).toUpperCase()}</code>\n━━━━━━━━━━━━━━`
      : `💎 <b>BIENVENUE [v9.6 ☁️ Cloud]</b>\n━━━━━━━━━━━━━━\n👤 Utilisateur: <b>${this.user.name}</b>\n🛡️ Rôle: <code>${String(this.user.role).toUpperCase()}</code>\n━━━━━━━━━━━━━━`, kbd);
  }

  isAdmin() { return true; }
}
