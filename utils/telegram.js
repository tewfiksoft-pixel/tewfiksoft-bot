import https from 'https';

const BOT_TOKEN = process.env.BOT_TOKEN;

export const tg = (method, body) => new Promise((res) => {
  const p = JSON.stringify(body);
  const req = https.request({ 
    hostname: 'api.telegram.org', 
    path: `/bot${BOT_TOKEN}/${method}`, 
    method: 'POST', 
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(p) } 
  }, (r) => {
    let d = ''; r.on('data', c => d += c);
    r.on('end', () => { try { res(JSON.parse(d)); } catch { res({ ok: false }); } });
  });
  req.on('error', () => res({ ok: false }));
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

export async function notifyStaff(txt, cfg, sendFn) {
  const admins = cfg.authorized_users?.filter(u => u.role === 'admin' || u.role === 'general_manager') || [];
  for (const a of admins) { if (a.id) await sendFn(a.id, `🔔 <b>إشعار للإدارة:</b>\n${txt}`); }
  const rh = cfg.authorized_users?.filter(u => u.role === 'gestionnaire_rh') || [];
  for (const r of rh) { if (r.id) await sendFn(r.id, `🔔 <b>إشعار للموارد البشرية:</b>\n${txt}`); }
  const ADMIN_ID = process.env.ADMIN_CHAT_ID;
  if (ADMIN_ID && !admins.find(a => String(a.id) === String(ADMIN_ID))) await sendFn(ADMIN_ID, `🔔 <b>إشعار جديد:</b>\n${txt}`);
}

