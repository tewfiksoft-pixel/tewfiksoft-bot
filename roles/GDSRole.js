import BaseRole from './BaseRole.js';
import { send } from '../utils/telegram.js';

export default class GDSRole extends BaseRole {
  showMenu(chatId, ar) {
    const kbd = { inline_keyboard: [
      [{ text: ar ? '🚪 إدارة التصاريح والمهمات' : '🚪 Gestion des Accès & Missions', callback_data: 'auth_menu' }],
      [{ text: ar ? '💼 المبيعات والطلبيات' : '💼 Ventes & Bons', callback_data: 'ventes_menu' }],
      [{ text: ar ? '👤 ملفي الشخصي' : '👤 Mon Profil', callback_data: 'my_profile' }],
      [{ text: ar ? '🌐 تغيير اللغة' : '🌐 Changer la Langue', callback_data: 'choose_lang' }]
    ]};

    return send(chatId, ar
      ? `📦 <b>مصلحة المخازن والشحن (GDS)</b>\n━━━━━━━━━━━━━━\n👤 المستخدم: <b>${this.user.name}</b>\n🛡️ الرتبة: <code>${String(this.user.role).toUpperCase()}</code>\n━━━━━━━━━━━━━━\nيرجى تأكيد وتعبئة بيانات الشاحنات والسائقين:`
      : `📦 <b>GESTION DE STOCK & EXPÉDITION</b>\n━━━━━━━━━━━━━━\n👤 Utilisateur: <b>${this.user.name}</b>\n🛡️ Rôle: <code>${String(this.user.role).toUpperCase()}</code>\n━━━━━━━━━━━━━━\nVeuillez charger les camions et valider l'expédition :`, kbd);
  }
}
