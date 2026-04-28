// TewfikSoft Cloud Bot v4.5 - Render.com Edition (Webhook Mode)
import https from 'https';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import http from 'http';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const CONFIG_PATH = path.join(__dirname, 'config.json');
const DB_PATH = path.join(DATA_DIR, 'database.json');

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) { console.error('❌ FATAL: BOT_TOKEN environment variable is not set!'); process.exit(1); }
const ADMIN_ID = process.env.ADMIN_CHAT_ID || '';
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxcj4K0p4FLgGGchC9oe4q95fLnHipbaUXN6hcQsCMDyR7ITH1ozIEF9Dk3SkEujt0njw/exec';
const ENC_KEY = 'nouar2026';
const SALT = Buffer.from('tewfiksoft_hr_salt_2026', 'utf8');

const log = (m) => console.log('[' + new Date().toISOString() + '] ' + m);
const T = (s) => { try { return String(s||'').trim() || '—'; } catch { return '—'; } };

function loadDB() {
  try { return JSON.parse(fs.readFileSync(DB_PATH,'utf8')); } catch { return {hr_employees:[]}; }
}
function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH,'utf8')); } catch { return {authorized_users:[]}; }
}

const tg = (method, body) => new Promise((res) => {
  const p = JSON.stringify(body);
  const req = https.request({hostname:'api.telegram.org',path:`/bot${BOT_TOKEN}/${method}`,method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(p)}}, (r) => {
    let d=''; r.on('data',c=>d+=c); r.on('end',()=>{ try{res(JSON.parse(d));}catch{res({ok:false});} });
  });
  req.on('error',()=>res({ok:false}));
  req.write(p); req.end();
});

const send = (chatId, text, kbd=null) => tg('sendMessage', {chat_id:chatId, text:'☁️ '+text, parse_mode:'HTML', ...(kbd?{reply_markup:kbd}:{})});

const langs = new Map();
const states = new Map();

async function syncDB() {
  try {
    const response = await fetch(SCRIPT_URL);
    if (!response.ok) return `Error: HTTP ${response.status}`;
    const raw = await response.text();
    if (!raw || raw.length < 100) return 'Error: Data too small';
    let data = raw.charCodeAt(0)===0xFEFF ? raw.slice(1) : raw;
    fs.writeFileSync(DB_PATH, data); 
    return `OK: Sync successful`;
  } catch(e) { return 'Error: '+e.message; }
}

async function handle(u) {
  const cbq = u.callback_query;
  const msg = u.message || cbq?.message;
  const from = u.message?.from || cbq?.from;
  if (!msg||!from) return;

  const chatId = msg.chat.id;
  const fromId = String(from.id);
  const txt = (msg.text||'').trim();
  
  // --- Role identification from config ---
  const cfg = loadConfig();
  const fromUser = (from.username || '').toLowerCase().trim();
  const fromIdStr = String(fromId).trim();
  
  const user = cfg.authorized_users?.find(u => {
      const adId = String(u.id || '').replace('@', '').toLowerCase().trim();
      return adId === fromIdStr || (fromUser && adId === fromUser);
  });

  if (!user) {
      log(`❌ Unauthorized: ID ${fromIdStr}, User @${fromUser}`);
      return send(chatId, `❌ Unauthorized ID: <code>${fromIdStr}</code>\n<i>Please add this ID to settings and Sync.</i>`);
  }

  log(`👤 Access: ${user.name} [Role: ${user.role}]`);

  if (txt === '/start') {
      return send(chatId, `🌟 <b>أهلاً بك ${user.name}</b>\n\nأنا البوت السحابي الخاص بشركة TewfikSoft.\nاستخدم القائمة أدناه للوصول للخدمات.`);
  }
  
  if (txt === '/me') {
      return send(chatId, `👤 <b>معلوماتك:</b>\n🆔 ID: <code>${fromIdStr}</code>\n👑 الدور: <b>${user.role}</b>`);
  }

  return send(chatId, `✅ البوت يعمل بنجاح.\nدورك الحالي هو: <b>${user.role}</b>`);
}

http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/api/webhook') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const u = JSON.parse(body);
        if (u.update_id) await handle(u).catch(e => log('Err: ' + e.message));
      } catch(e) {}
      res.writeHead(200); res.end('OK');
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/config') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const newConfig = JSON.parse(body);
        if (newConfig.authorized_users) {
          fs.writeFileSync(CONFIG_PATH, JSON.stringify(newConfig, null, 2), 'utf8');
          log('✅ Config updated. Users: ' + newConfig.authorized_users.length);
          res.writeHead(200); res.end(JSON.stringify({success:true}));
          return;
        }
      } catch(e) {}
      res.writeHead(400); res.end('Fail');
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/database') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        fs.writeFileSync(DB_PATH, body);
        log('✅ Database updated.');
        res.writeHead(200); res.end(JSON.stringify({success:true}));
        return;
      } catch(e) {}
      res.writeHead(400); res.end('Fail');
    });
    return;
  }

  res.writeHead(200); res.end('Bot is running v4.5');
}).listen(process.env.PORT || 10000);

(async () => {
  log('=== TewfikSoft HR Bot v4.5 (Render Webhook Edition) Starting... ===');
  const url = `https://tewfiksoft-hr-bot.onrender.com/api/webhook`;
  await tg('setWebhook', {url});
  log('Webhook set to: ' + url);
})();
