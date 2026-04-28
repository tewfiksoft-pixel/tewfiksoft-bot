// TewfikSoft Cloud Bot v5.2 - Director General Analytics Edition
import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const CONFIG_PATH = path.join(__dirname, 'config.json');
const DB_PATH = path.join(DATA_DIR, 'database.json');

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_CHAT_ID;
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxcj4K0p4FLgGGchC9oe4q95fLnHipbaUXN6hcQsCMDyR7ITH1ozIEF9Dk3SkEujt0njw/exec';

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

function calculateStats(db) {
    const emps = db.hr_employees || [];
    const stats = {
        total: emps.length,
        companies: {},
        gender: { male: 0, female: 0 },
        contracts: { CDI: 0, CDD: 0 },
        totalAge: 0,
        totalExp: 0,
        ageCount: 0,
        expCount: 0
    };

    const now = new Date();
    emps.forEach(e => {
        // Company
        const c = e.company || 'TewfikSoft';
        stats.companies[c] = (stats.companies[c] || 0) + 1;
        
        // Gender
        if (String(e.gender).toLowerCase().includes('m') || String(e.gender).includes('\u0630\u0643\u0631')) stats.gender.male++;
        else stats.gender.female++;

        // Contracts
        if (String(e.contractType).toUpperCase() === 'CDI') stats.contracts.CDI++;
        else stats.contracts.CDD++;

        // Age
        if (e.birthDate) {
            const birth = new Date(e.birthDate);
            if (!isNaN(birth)) {
                stats.totalAge += (now.getFullYear() - birth.getFullYear());
                stats.ageCount++;
            }
        }

        // Experience
        if (e.startDate) {
            const start = new Date(e.startDate);
            if (!isNaN(start)) {
                stats.totalExp += (now.getFullYear() - start.getFullYear());
                stats.expCount++;
            }
        }
    });

    stats.avgAge = stats.ageCount ? Math.round(stats.totalAge / stats.ageCount) : 0;
    stats.avgExp = stats.expCount ? Math.round(stats.totalExp / stats.expCount * 10) / 10 : 0;

    return stats;
}

function showStats(chatId, ar) {
    const db = loadDB();
    const s = calculateStats(db);
    
    let msg = ar ? `📊 <b>لوحة إحصائيات المدير العام</b>\n━━━━━━━━━━━━━━\n` : `📊 <b>TABLEAU DE BORD DG</b>\n━━━━━━━━━━━━━━\n`;
    
    // Companies
    msg += ar ? `🏢 <b>العمال حسب الشركة:</b>\n` : `🏢 <b>Effectif par filiale :</b>\n`;
    Object.keys(s.companies).forEach(c => {
        msg += `🟢 ${c}: <b>${s.companies[c]}</b>\n`;
    });

    // Gender
    msg += ar ? `\n👥 <b>توزيع الجنس:</b>\n` : `\n👥 <b>Répartition par sexe :</b>\n`;
    msg += `👦 ${ar?'رجال':'Hommes'}: <b>${s.gender.male}</b>\n`;
    msg += `👧 ${ar?'نساء':'Femmes'}: <b>${s.gender.female}</b>\n`;

    // Contracts
    msg += ar ? `\n📜 <b>أنواع العقود:</b>\n` : `\n📜 <b>Types de contrats :</b>\n`;
    msg += `✅ CDI: <b>${s.contracts.CDI}</b>\n`;
    msg += `⏱️ CDD: <b>${s.contracts.CDD}</b>\n`;

    // Averages
    msg += ar ? `\n📈 <b>المؤشرات العامة:</b>\n` : `\n📈 <b>Indicateurs généraux :</b>\n`;
    msg += `🎂 ${ar?'متوسط العمر':'Âge moyen'}: <b>${s.avgAge}</b> ${ar?'سنة':'ans'}\n`;
    msg += `🎖️ ${ar?'متوسط الخبرة':'Expérience moy.'}: <b>${s.avgExp}</b> ${ar?'سنة':'ans'}\n`;

    msg += `\n━━━━━━━━━━━━━━\n✨ ${ar?'البيانات محدثة لحظياً':'Données à jour'}`;

    return send(chatId, msg, {inline_keyboard: [[{text: ar?'🏠 القائمة الرئيسية':'🏠 Menu', callback_data:'menu'}]]});
}

async function handle(u) {
  if (!u) return;
  const cbq = u.callback_query;
  const msg = u.message || cbq?.message;
  const from = u.message?.from || cbq?.from;
  if (!msg||!from) return;

  const chatId = msg.chat.id;
  const fromId = String(from.id);
  const txt = (msg.text||'').trim().toLowerCase();
  
  const cfg = loadConfig();
  const fromUser = (from.username || '').toLowerCase().trim();
  const user = cfg.authorized_users?.find(u => {
      const adId = String(u.id || '').replace('@', '').toLowerCase().trim();
      return adId === fromId || (fromUser && adId === fromUser);
  });
  if (!user) return send(chatId, `❌ Unauthorized ID: <code>${fromId}</code>`);

  if (!langs.has(chatId) && !cbq?.data?.startsWith('lang:')) {
      return send(chatId, '🌐 <b>الرجاء اختيار اللغة / Veuillez choisir la langue</b>', {inline_keyboard: [[{text:'العربية 🇩🇿',callback_data:'lang:ar'},{text:'Français 🇫🇷',callback_data:'lang:fr'}]]});
  }
  const ar = (langs.get(chatId) || 'ar') === 'ar';

  if (cbq) {
      await tg('answerCallbackQuery', {callback_query_id: cbq.id});
      const d = cbq.data;
      if (d.startsWith('lang:')) { langs.set(chatId, d.split(':')[1]); return send(chatId, d.split(':')[1]==='ar'?'✅ تم الضبط':'✅ Langue fixée', {inline_keyboard: [[{text: '🏠 Menu', callback_data:'menu'}]]}); }
      if (d === 'menu') return send(chatId, ar ? '📌 <b>القائمة الرئيسية</b>' : '📌 <b>Menu Principal</b>', {inline_keyboard: [[{text: ar?'📊 الإحصائيات':'📊 Stats', callback_data:'stats'}],[{text: ar?'🔍 البحث':'🔍 Recherche', callback_data:'search'}],[{text:ar?'🌐 اللغة':'🌐 Langue',callback_data:'choose_lang'}]]});
      if (d === 'stats') return showStats(chatId, ar);
      if (d === 'search') { states.set(chatId, {step: 'search'}); return send(chatId, ar ? '🔍 أرسل الرقم أو الاسم:' : '🔍 Entrez ID ou Nom:'); }
      if (d === 'choose_lang') return send(chatId, '🌐 Langue?', {inline_keyboard: [[{text:'AR',callback_data:'lang:ar'},{text:'FR',callback_data:'lang:fr'}]]});
  }

  if (states.get(chatId)?.step === 'search' && txt && txt !== '/start' && txt !== '/m' && txt !== '/info') {
      states.delete(chatId);
      const db = loadDB();
      const query = txt.toLowerCase();
      const results = (db.hr_employees || []).filter(e => String(e.clockingId).includes(query) || T(e.lastName_fr).toLowerCase().includes(query) || T(e.firstName_fr).toLowerCase().includes(query)).slice(0, 5);
      if (results.length === 0) return send(chatId, ar ? '❌ لا توجد نتائج.' : '❌ Aucun résultat.');
      for (const emp of results) {
          const card = ar ? `👤 ${T(emp.lastName_ar)} ${T(emp.firstName_ar)}\n🆔 ${emp.clockingId}\n💼 ${T(emp.jobTitle_ar)}` : `👤 ${T(emp.lastName_fr)} ${T(emp.firstName_fr)}\n🆔 ${emp.clockingId}\n💼 ${T(emp.jobTitle_fr)}`;
          await send(chatId, card);
      }
      return;
  }

  if (txt === '/start' || txt === '/m' || txt === '/info') {
      const kbd = {inline_keyboard: [
          [{text: ar ? '📊 الإحصائيات' : '📊 Statistiques', callback_data: 'stats'}],
          [{text: ar ? '🔍 البحث عن عامل' : '🔍 Recherche', callback_data: 'search'}],
          [{text: ar ? '🌐 تغيير اللغة' : '🌐 Changer Langue', callback_data: 'choose_lang'}]
      ]};
      return send(chatId, ar ? '📌 <b>لوحة تحكم المدير العام</b>' : '📌 <b>PANNEAU DE CONTRÔLE DG</b>', kbd);
  }
}

http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/api/webhook') {
    let body = ''; req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try { const u = JSON.parse(body); if (u.update_id) await handle(u).catch(e => log('Err: ' + e.message)); } catch(e) {}
      res.writeHead(200); res.end('OK');
    });
    return;
  }
  if (req.method === 'POST' && req.url === '/api/config') {
    let body = ''; req.on('data', chunk => body += chunk);
    req.on('end', () => { try { fs.writeFileSync(CONFIG_PATH, body); res.writeHead(200); res.end('OK'); } catch(e) { res.writeHead(400); res.end('Fail'); } });
    return;
  }
  if (req.method === 'POST' && req.url === '/api/database') {
    let body = ''; req.on('data', chunk => body += chunk);
    req.on('end', () => { try { fs.writeFileSync(DB_PATH, body); res.writeHead(200); res.end('OK'); } catch(e) { res.writeHead(400); res.end('Fail'); } });
    return;
  }
  res.writeHead(200); res.end('Bot v5.2 DG Stats Edition Active');
}).listen(process.env.PORT || 10000);

(async () => {
  log('=== TewfikSoft HR Bot v5.2 Starting... ===');
  const url = `https://tewfiksoft-hr-bot.onrender.com/api/webhook`;
  await tg('setWebhook', {url});
  log('Webhook set to: ' + url);
})();
