import BaseRole from './BaseRole.js';
import { send } from '../utils/telegram.js';
import { loadDB } from '../utils/database.js';

export default class GeneralManagerRole extends BaseRole {
  showMenu(chatId, ar, getStatsMsg) {
    const db = loadDB();
    const kbd = { inline_keyboard: [
      [{ text: ar ? '🔄 ستاتستيك' : '🔄 Statistiques', callback_data: 'stats' }],
      [{ text: ar ? '👥 تعداد العمال حسب المديرية' : '👥 Effectifs par direction', callback_data: 'effectifs_dir' }],
      [{ text: ar ? '🌐 تغيير اللغة' : '🌐 Changer Langue', callback_data: 'choose_lang' }]
    ]};
    let header = ar
      ? `💎 <b>أهلاً بك يا سيادة المدير العام</b>\n━━━━━━━━━━━━━━\n👤 المستخدم: <b>${this.user.name}</b>\n🛡️ الرتبة: <code>DIRECTEUR GÉNÉRAL</code>\n━━━━━━━━━━━━━━`
      : `💎 <b>BIENVENUE MONSIEUR LE DIRECTEUR GÉNÉRAL</b>\n━━━━━━━━━━━━━━\n👤 Utilisateur: <b>${this.user.name}</b>\n🛡️ Rôle: <code>DIRECTEUR GÉNÉRAL</code>\n━━━━━━━━━━━━━━`;

    return send(chatId, header, kbd);
  }
}
