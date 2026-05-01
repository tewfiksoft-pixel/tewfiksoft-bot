import BaseRole from './BaseRole.js';
import { send } from '../utils/telegram.js';
import { loadDB } from '../utils/database.js';

export default class GeneralManagerRole extends BaseRole {
  showMenu(chatId, ar, getStatsMsg) {
    const db = loadDB();
    const kbd = { inline_keyboard: [
      [{ text: ar ? '🔄 تحديث الإحصائيات' : '🔄 Actualiser', callback_data: 'stats' }],
      [{ text: ar ? '👥 تعداد العمال حسب المديرية' : '👥 Effectifs par direction', callback_data: 'effectifs_dir' }],
      [{ text: ar ? '🌐 تغيير اللغة' : '🌐 Changer Langue', callback_data: 'choose_lang' }]
    ]};
    return send(chatId, getStatsMsg(db, ar), kbd);
  }
}
