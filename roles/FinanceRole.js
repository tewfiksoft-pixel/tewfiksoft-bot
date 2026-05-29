import BaseRole from './BaseRole.js';
import { send } from '../utils/telegram.js';

export default class FinanceRole extends BaseRole {
  showMenu(chatId, ar) {
    const kbd = { inline_keyboard: [
      [{ text: ar ? '🚪 إدارة التصاريح والمهمات' : '🚪 Gestion des Accès & Missions', callback_data: 'auth_menu' }],
      [{ text: ar ? '💼 المبيعات والطلبيات' : '💼 Ventes & Bons', callback_data: 'ventes_menu' }],
      [{ text: ar ? '👤 ملفي الشخصي' : '👤 Mon Profil', callback_data: 'my_profile' }],
      [{ text: ar ? '🌐 تغيير اللغة' : '🌐 Changer la Langue', callback_data: 'choose_lang' }]
    ]};

    return send(chatId, ar
      ? `💵 <b>مصلحة المالية (Finance)</b>\n━━━━━━━━━━━━━━\n👤 المستخدم: <b>${this.user.name}</b>\n🛡️ الرتبة: <code>${String(this.user.role).toUpperCase()}</code>\n━━━━━━━━━━━━━━\nيرجى تأكيد فواتير المبيعات أو استعراض الأذونات:`
      : `💵 <b>SERVICE FINANCE</b>\n━━━━━━━━━━━━━━\n👤 Utilisateur: <b>${this.user.name}</b>\n🛡️ Rôle: <code>${String(this.user.role).toUpperCase()}</code>\n━━━━━━━━━━━━━━\nVeuillez valider les paiements ou consulter la liste :`, kbd);
  }
}
