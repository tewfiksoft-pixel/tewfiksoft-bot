import BaseRole from './BaseRole.js';
import { send } from '../utils/telegram.js';

export default class PosteGardeRole extends BaseRole {
  showMenu(chatId, ar) {
    const kbd = { inline_keyboard: [
      [{ text: ar ? '🚪 العمال المتواجدون في الخارج' : '🚪 Employés en SORTIE', callback_data: 'list_out_emps' }],
      [{ text: ar ? '👤 ملفي الشخصي' : '👤 Mon Profil', callback_data: 'my_profile' }],
      [{ text: ar ? '🌐 تغيير اللغة' : '🌐 Changer la Langue', callback_data: 'choose_lang' }]
    ]};

    return send(chatId, ar
      ? `👮 <b>مركز الحراسة</b>\n━━━━━━━━━━━━━━\n👤 المستخدم: <b>${this.user.name}</b>\n🛡️ الرتبة: <code>${String(this.user.role).toUpperCase()}</code>\n━━━━━━━━━━━━━━\nبانتظار طلبات الخروج للموافقة...`
      : `👮 <b>POSTE DE GARDE</b>\n━━━━━━━━━━━━━━\n👤 Utilisateur: <b>${this.user.name}</b>\n🛡️ Rôle: <code>${String(this.user.role).toUpperCase()}</code>\n━━━━━━━━━━━━━━\nEn attente de demandes de sortie...`, kbd);
  }
}
