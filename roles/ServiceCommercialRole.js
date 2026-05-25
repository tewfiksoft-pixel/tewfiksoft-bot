import BaseRole from './BaseRole.js';
import { send } from '../utils/telegram.js';

export default class ServiceCommercialRole extends BaseRole {
  showMenu(chatId, ar) {
    const kbd = { inline_keyboard: [
      [{ text: ar ? '💼 المبيعات والطلبيات' : '💼 Ventes & Bons', callback_data: 'ventes_menu' }],
      [{ text: ar ? '👤 ملفي الشخصي' : '👤 Mon Profil', callback_data: 'my_profile' }],
      [{ text: ar ? '🌐 تغيير اللغة' : '🌐 Changer la Langue', callback_data: 'choose_lang' }]
    ]};

    return send(chatId, ar
      ? `💼 <b>المصلحة التجارية (Commercial)</b>\n━━━━━━━━━━━━━━\n👤 المستخدم: <b>${this.user.name}</b>\n🛡️ الرتبة: <code>${String(this.user.role).toUpperCase()}</code>\n━━━━━━━━━━━━━━\nيرجى اختيار أحد الخيارات أدناه للبدء:`
      : `💼 <b>SERVICE COMMERCIAL</b>\n━━━━━━━━━━━━━━\n👤 Utilisateur: <b>${this.user.name}</b>\n🛡️ Rôle: <code>${String(this.user.role).toUpperCase()}</code>\n━━━━━━━━━━━━━━\nVeuillez choisir une action ci-dessous :`, kbd);
  }
}
