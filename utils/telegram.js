import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { log } from './database.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

const getBotToken = () => {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    return cfg.bot_token || process.env.BOT_TOKEN;
  } catch (e) {
    return process.env.BOT_TOKEN;
  }
};

export const tg = (method, body) => new Promise((res) => {
  const BOT_TOKEN = getBotToken();
  const p = JSON.stringify(body);
  const req = https.request({ 
    hostname: 'api.telegram.org', 
    path: `/bot${BOT_TOKEN}/${method}`, 
    method: 'POST', 
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(p) } 
  }, (r) => {
    let d = ''; r.on('data', c => d += c);
    r.on('end', () => { 
      try { 
        const resObj = JSON.parse(d);
        if (!resObj.ok) log(`[TG-Error] ${method}: ${JSON.stringify(resObj)}`);
        res(resObj); 
      } catch { res({ ok: false }); } 
    });
  });
  req.on('error', (e) => {
    log(`[TG-Network-Error] ${method}: ${e.message}`);
    res({ ok: false });
  });
  req.write(p); req.end();
});

export const send = (chatId, text, kbd = null) => tg('sendMessage', { 
  chat_id: chatId, 
  text, 
  parse_mode: 'HTML', 
  ...(kbd ? { reply_markup: kbd } : {}) 
});

export const answerCallbackQuery = (callbackQueryId) => tg('answerCallbackQuery', { 
  callback_query_id: callbackQueryId 
});

export async function notifyStaff(msg, cfg, sendFn, kbd = null) {
  const allStaff = cfg.authorized_users || [];
  for (const u of allStaff) {
    if (!u.id) continue;
    try {
      const isAdmin = (u.role === 'admin' || u.role === 'general_manager');
      const isRH = (u.role === 'gestionnaire_rh');
      const isGuard = (u.role === 'poste_garde');
      
      const lang = u.lang || 'ar';
      let txt = '';
      let prefix = '';
      
      if (typeof msg === 'string') {
        txt = msg;
        prefix = lang === 'ar' ? '🔔 <b>إشعار:</b>' : '🔔 <b>NOTIFICATION:</b>';
      } else {
        txt = msg[lang] || msg['ar'] || msg['fr'] || '';
        prefix = lang === 'ar' ? '🔔 <b>إشعار للإدارة:</b>' : '🔔 <b>NOTIFICATION ADMIN:</b>';
      }
      
      if (isAdmin) {
        if (u.role === 'general_manager') {
          const txtLow = txt.toLowerCase();
          const isOM = txtLow.includes('أمر بمهمة') || txtLow.includes('ordre de mission') || txtLow.includes('طلب المهمة');
          if (isOM) await sendFn(u.id, `${prefix}\n${txt}`, kbd);
        } else {
          await sendFn(u.id, `${prefix}\n${txt}`, kbd);
        }
      } else if (isRH) {
        const rhPre = lang === 'ar' ? '🔔 <b>إشعار للموارد البشرية:</b>' : '🔔 <b>NOTIFICATION RH:</b>';
        await sendFn(u.id, `${rhPre}\n${txt}`);
      }
    } catch (e) {
      log(`[Notify-Error] Failed to notify user ${u.id}: ${e.message}`);
    }
  }
}

