// TewfikSoft Cloud Bot v4.1 - /info /me commands active
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
const OFFSET_PATH = path.join(DATA_DIR, 'offset.json');

const BOT_TOKEN = process.env.BOT_TOKEN || '8675308284:AAHqzorG0t-JxwPhdc6Iy-Tk0heEemyMu1w';
const ADMIN_ID = '8626592284';
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxcj4K0p4FLgGGchC9oe4q95fLnHipbaUXN6hcQsCMDyR7ITH1ozIEF9Dk3SkEujt0njw/exec';
const ENC_KEY = 'nouar2026';
const SALT = Buffer.from('tewfiksoft_hr_salt_2026', 'utf8');

// Docs & Fautes lists
const DOCS = [
  {id:0,ar:'🌴 سند عطلة',fr:'🌴 Titre de congés'},
  {id:1,ar:'💼 شهادة عمل',fr:'💼 Attestation de travail'},
  {id:2,ar:'💰 كشف الراتب',fr:'💰 Relevé des émoluments'},
  {id:3,ar:'📄 قسيمة الراتب',fr:'📄 Fiche de paie'},
  {id:4,ar:'💳 بطاقة الشفاء',fr:'💳 Activation carte Chifa'},
  {id:5,ar:'📊 تسوية الراتب',fr:'📊 Régularisation de paie'},
  {id:6,ar:'📝 فترة تجريبية',fr:'📝 Évaluation Période Essai'}
];
const FAUTES = [
  {id:0,ar:'تخلي عن المنصب',fr:'Abandon de poste'},
  {id:1,ar:'تأخر متكرر',fr:'Retard répété'},
  {id:2,ar:'عصيان',fr:'Insubordination'},
  {id:3,ar:'إهمال',fr:'Négligence'},
  {id:4,ar:'غياب غير مبرر',fr:'Absence injustifiée'},
  {id:5,ar:'مخالفة النظام',fr:'Violation règlement'},
  {id:6,ar:'سلوك غير لائق',fr:'Comportement incorrect'},
  {id:7,ar:'أخرى',fr:'Autre'}
];

const log = (m) => console.log('[' + new Date().toISOString() + '] ' + m);
const T = (s) => { try { return String(s||'').trim() || '—'; } catch { return '—'; } };

function decrypt(b64, pass) {
  try {
    const buf = Buffer.from(b64, 'base64');
    const key = crypto.pbkdf2Sync(pass, SALT, 100000, 32, 'sha256');
    const nonce = buf.slice(0,12), ct = buf.slice(12);
    const tag = ct.slice(ct.length-16), enc = ct.slice(0,ct.length-16);
    const d = crypto.createDecipheriv('aes-256-gcm', key, nonce);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
  } catch { return null; }
}

async function syncDB() {
  try {
    // Use global fetch (Node 18+) which follows redirects automatically
    const response = await fetch(SCRIPT_URL);
    if (!response.ok) return `Error: HTTP ${response.status}`;
    const raw = await response.text();
    if (!raw || raw.length < 100) return 'Error: Data too small';
    
    let data = raw.charCodeAt(0)===0xFEFF ? raw.slice(1) : raw;
    
    // Try plain JSON first
    try {
      const j = JSON.parse(data);
      if (j.hr_employees) { 
        fs.writeFileSync(DB_PATH, data); 
        return `OK: ${j.hr_employees.length} employees`; 
      }
    } catch {}
    
    // Try decryption
    const dec = decrypt(data.trim(), ENC_KEY);
    if (dec) {
      const j = JSON.parse(dec);
      fs.writeFileSync(DB_PATH, dec);
      return `OK (decrypted): ${j.hr_employees?.length||0} employees`;
    }
    return `Error: not JSON, not encrypted. Starts: ${data.substring(0,20)}`;
  } catch(e) { return 'Error: '+e.message; }
}

function loadDB() {
  try { return JSON.parse(fs.readFileSync(DB_PATH,'utf8')); } catch { return {hr_employees:[]}; }
}
function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH,'utf8')); } catch { return {authorized_users:[]}; }
}

// Telegram
const tg = (method, body) => new Promise((res) => {
  const p = JSON.stringify(body);
  const req = https.request({hostname:'api.telegram.org',path:`/bot${BOT_TOKEN}/${method}`,method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(p)}}, (r) => {
    let d=''; r.on('data',c=>d+=c); r.on('end',()=>{ try{res(JSON.parse(d));}catch{res({ok:false});} });
  });
  req.on('error',()=>res({ok:false}));
  req.write(p); req.end();
});

const send = (chatId, text, kbd=null) => tg('sendMessage', {chat_id:chatId, text:'☁️ '+text, parse_mode:'HTML', ...(kbd?{reply_markup:kbd}:{})});

// Role-based welcome for /info
function sendInfoWelcome(chatId, user) {
  const hour = new Date().getHours();
  const greetAr = hour < 12 ? 'صباح الخير' : 'مساء الخير';
  const greetFr = hour < 12 ? 'Bonjour' : 'Bonsoir';
  const roleLabels = {
    admin: 'مسؤول / Admin',
    general_manager: 'مدير عام / DG',
    gestionnaire_rh: 'مسؤول الموارد البشرية / RH',
    manager: 'مدير / Manager',
    supervisor: 'مشرف / Superviseur',
    employee: 'موظف / Employé'
  };
  const roleLabel = roleLabels[user.role] || user.role;
  const msg = `🛠️ <b>[VER V4 CLOUD]</b>
🌟 <b>${greetAr}، ${user.name}</b>
💼 المنصب: <b>${roleLabel}</b>

🌟 <b>${greetFr}, M. ${user.name}</b>
💼 Poste: <b>${roleLabel}</b>

✨ يسرنا مساعدتك في الوصول إلى البيانات.
✨ Nous sommes ravis de vous servir.

👉 لو سمحت، اختر لغة العرض:
👉 S'il vous plaît, choisissez la langue:`;
  return send(chatId, msg, {inline_keyboard:[[
    {text:'العربية 🇩🇿', callback_data:'infolang:ar'},
    {text:'Français 🇫🇷', callback_data:'infolang:fr'}
  ]]});
}

// State
const langs = new Map();
const states = new Map();

async function handle(u) {
  const cbq = u.callback_query;
  const msg = u.message || cbq?.message;
  const from = u.message?.from || cbq?.from;
  if (!msg||!from) return;

  const chatId = msg.chat.id;
  const fromId = String(from.id);
  const txt = (msg.text||'').trim();
  const ar = (langs.get(chatId)||'ar') === 'ar';

  if (cbq) await tg('answerCallbackQuery',{callback_query_id:cbq.id});

  const cfg = loadConfig();
  const user = cfg.authorized_users?.find(x=>String(x.id)===fromId);
  if (!user) return send(chatId, `❌ Unauthorized ID: <code>${fromId}</code>`);

  log(`Msg from ${fromId}: ${txt||'callback:'+cbq?.data}`);

  // Handle callbacks
  if (cbq) {
    const d = cbq.data;
    if (d.startsWith('lang:')) {
      langs.set(chatId, d.split(':')[1]);
      return showMenu(chatId, user, d.split(':')[1]==='ar');
    }
    if (d.startsWith('infolang:')) {
      const l = d.split(':')[1];
      langs.set(chatId, l);
      states.set(chatId, {step:'search'});
      const isAr = l==='ar';
      return send(chatId, isAr?'✅ <b>تم اختيار اللغة.</b>\n\n🔍 يرجى الآن إدخال <b>اسم الموظف</b> أو <b>رقمه</b> للبحث عنه:':'✅ <b>Langue sélectionnée.</b>\n\n🔍 Veuillez maintenant entrer le <b>nom</b> ou <b>matricule</b> de l\'employé :');
    }
    if (d==='menu') return showMenu(chatId, user, ar);
    if (d==='sync') { const r=await syncDB(); return send(chatId, `🔄 Sync: ${r}`); }
    if (d==='search') { states.set(chatId,{step:'search'}); return send(chatId, ar?'🔍 أدخل اسم الموظف أو رقمه:':'🔍 Nom ou matricule :'); }
    if (d.startsWith('emp:')) return showCard(chatId, d.slice(4), ar);
    if (d.startsWith('docs:')) { states.set(chatId,{step:'doc_pick',empId:d.slice(5)}); return showDocs(chatId,ar); }
    if (d.startsWith('doc:')) {
      const [,empId,docId] = d.split(':');
      const doc = DOCS.find(x=>x.id===+docId);
      states.set(chatId,{step:'doc_motif',empId,doc:ar?doc.ar:doc.fr});
      return send(chatId, ar?'❓ ما هو الغرض من الطلب؟':'❓ Motif de la demande ?');
    }
    if (d.startsWith('abs:')) { states.set(chatId,{step:'abs_type',empId:d.slice(4)}); return showAbsType(chatId,ar); }
    if (d.startsWith('atype:')) {
      const [,empId,type] = d.split(':');
      states.set(chatId,{step:'abs_date',empId,absType:type});
      return send(chatId, ar?'📅 تاريخ الغياب:':'📅 Date absence :');
    }
    if (d.startsWith('survey:')) { states.set(chatId,{step:'faute_pick',empId:d.slice(7)}); return showFautes(chatId,ar); }
    if (d.startsWith('faute:')) {
      const [,empId,fId] = d.split(':');
      const f = FAUTES.find(x=>x.id===+fId);
      states.set(chatId,{step:'survey_date',empId,faute:ar?f.ar:f.fr});
      return send(chatId, ar?'📅 تاريخ الواقعة:':'📅 Date incident :');
    }
    if (d.startsWith('leave:')) return showLeave(chatId, d.slice(6), ar);
    if (d.startsWith('full:')) return showFull(chatId, d.slice(5), ar);
    return;
  }

  // Commands
  if (txt==='/start') {
    return send(chatId, ar?`🌟 مرحباً ${user.name}\nاختر اللغة:`:`🌟 Bienvenue ${user.name}\nChoisissez la langue:`, {inline_keyboard:[[{text:'العربية 🇩🇿',callback_data:'lang:ar'},{text:'Français 🇫🇷',callback_data:'lang:fr'}]]});
  }
  if (txt==='/info' || txt.toLowerCase().startsWith('/info')) {
    return sendInfoWelcome(chatId, user);
  }
  if (txt==='/me') {
    const db = loadDB();
    const emp = db.hr_employees?.find(e=>String(e.clockingId)===String(user.clockingId));
    const hour = new Date().getHours();
    const greeting = hour<12?'صباح الخير':'مساء الخير';
    let msg = `👤 <b>بطاقة التعريف</b>\n━━━━━━━━━━━━━━\n🆔 الرمز: <code>${fromId}</code>\n👑 الدور: <b>${user.role}</b>`;
    if (emp) msg += `\n👤 الموظف: <b>${T(emp.lastName_ar)} ${T(emp.firstName_ar)}</b>\n🏢 القسم: <i>${T(emp.department_ar)}</i>`;
    return send(chatId, msg);
  }
  if (txt==='/menu') return showMenu(chatId, user, ar);
  if (txt==='/sync') { const r=await syncDB(); return send(chatId, `🔄 Sync: ${r}`); }

  // States
  const st = states.get(chatId);
  if (st) {
    if (st.step==='search') {
      states.delete(chatId);
      const db = loadDB();
      const q = txt.toLowerCase();
      const res = db.hr_employees.filter(e=>e.status==='active'&&(String(e.clockingId).includes(q)||T(e.lastName_fr).toLowerCase().includes(q)||T(e.lastName_ar).includes(q)||T(e.firstName_fr).toLowerCase().includes(q)));
      if (!res.length) return send(chatId, ar?'❌ لم يتم العثور على موظف.':'❌ Aucun résultat.');
      if (res.length===1) return showCard(chatId, res[0].id, ar);
      const kbd = {inline_keyboard: res.slice(0,8).map(e=>[{text:`👤 ${T(e.lastName_fr)} ${T(e.firstName_fr)}`,callback_data:'emp:'+e.id}])};
      return send(chatId, ar?'📂 نتائج البحث:':'📂 Résultats:', kbd);
    }
    if (st.step==='doc_motif') {
      saveReq({type:'document',doc:st.doc,motif:txt,fromId,empId:st.empId});
      states.delete(chatId);
      return send(chatId, ar?'✅ تم استلام طلبك بنجاح.':'✅ Demande reçue avec succès.');
    }
    if (st.step==='abs_date') {
      saveReq({type:'absence',absType:st.absType,date:txt,fromId,empId:st.empId});
      states.delete(chatId);
      return send(chatId, ar?'✅ تم تسجيل الغياب.':'✅ Absence enregistrée.');
    }
    if (st.step==='survey_date') {
      saveReq({type:'survey',faute:st.faute,date:txt,fromId,empId:st.empId});
      states.delete(chatId);
      return send(chatId, ar?'✅ تم تسجيل الاستبيان.':'✅ Questionnaire enregistré.');
    }
  }

  // Direct search if text is not a command
  if (txt.length>=2 && !txt.startsWith('/')) {
    const db = loadDB();
    const q = txt.toLowerCase();
    const res = db.hr_employees?.filter(e=>e.status==='active'&&(String(e.clockingId).includes(q)||T(e.lastName_fr).toLowerCase().includes(q)||T(e.lastName_ar).includes(q)||T(e.firstName_fr).toLowerCase().includes(q))) || [];
    if (!res.length) return send(chatId, ar?'❌ لم يتم العثور على موظف.':'❌ Aucun résultat.');
    if (res.length===1) return showCard(chatId, res[0].id, ar);
    const kbd = {inline_keyboard: res.slice(0,8).map(e=>[{text:`👤 ${T(e.lastName_fr)} ${T(e.firstName_fr)}`,callback_data:'emp:'+e.id}])};
    return send(chatId, ar?'📂 نتائج البحث:':'📂 Résultats:', kbd);
  }
}

function showMenu(chatId, user, ar) {
  const kbd = {inline_keyboard:[
    [{text:ar?'🔍 بحث عن موظف':'🔍 Chercher employé',callback_data:'search'}],
    [{text:ar?'🔄 تحديث قاعدة البيانات':'🔄 Sync DB',callback_data:'sync'}]
  ]};
  return send(chatId, ar?'📋 القائمة الرئيسية':'📋 Menu Principal', kbd);
}

function showCard(chatId, empId, ar) {
  const db = loadDB();
  const e = db.hr_employees?.find(x=>String(x.id)===String(empId));
  if (!e) return send(chatId, '❌ Not found');
  const msg = ar
    ? `📂 <b>خيارات الموظف</b>\n━━━━━━━━━━━━━━\n👤 الاسم: <b>${T(e.lastName_ar)} ${T(e.firstName_ar)}</b>\n🆔 ID: <code>${e.clockingId}</code>\n💼 الوظيفة: <i>${T(e.jobTitle_ar)}</i>\n⏳ نهاية العقد: ${e.contractEndDate||'—'}\n\nيرجى اختيار الإجراء:`
    : `📂 <b>OPTIONS EMPLOYÉ</b>\n━━━━━━━━━━━━━━\n👤 Nom: <b>${T(e.lastName_fr)} ${T(e.firstName_fr)}</b>\n🆔 ID: <code>${e.clockingId}</code>\n💼 Poste: <i>${T(e.jobTitle_fr)}</i>\n⏳ Fin: ${e.contractEndDate||'—'}\n\nVeuillez choisir:`;
  const kbd = {inline_keyboard:[
    [{text:ar?'📄 ملف الموظف':'📄 Fiche Employé',callback_data:'full:'+empId}],
    [{text:ar?'🏖️ رصيد العطل':'🏖️ Solde Congés',callback_data:'leave:'+empId}],
    [{text:ar?'📝 طلب وثيقة':'📝 Demander Doc',callback_data:'docs:'+empId},{text:ar?'🚨 إعلام غياب':'🚨 Absence',callback_data:'abs:'+empId}],
    [{text:ar?'📊 إجراء استبيان':'📊 Questionnaire',callback_data:'survey:'+empId}],
    [{text:ar?'🏠 القائمة':'🏠 Menu',callback_data:'menu'}]
  ]};
  return send(chatId, msg, kbd);
}

function showFull(chatId, empId, ar) {
  const db = loadDB();
  const e = db.hr_employees?.find(x=>String(x.id)===String(empId));
  if (!e) return;
  const msg = ar
    ? `📋 <b>بيانات الموظف</b>\n━━━━━━━━━━━━━━\n👤 ${T(e.lastName_ar)} ${T(e.firstName_ar)}\n🏢 ${T(e.department_ar)}\n💼 ${T(e.jobTitle_ar)}\n📅 التوظيف: ${e.startDate||'—'}\n📜 العقد: ${T(e.contractType)}\n⏳ نهاية: ${e.contractEndDate||'—'}`
    : `📋 <b>FICHE EMPLOYÉ</b>\n━━━━━━━━━━━━━━\n👤 ${T(e.lastName_fr)} ${T(e.firstName_fr)}\n🏢 ${T(e.department_fr)}\n💼 ${T(e.jobTitle_fr)}\n📅 Embauche: ${e.startDate||'—'}\n📜 Contrat: ${T(e.contractType)}\n⏳ Fin: ${e.contractEndDate||'—'}`;
  return send(chatId, msg, {inline_keyboard:[[{text:ar?'🔙 رجوع':'🔙 Retour',callback_data:'emp:'+empId}]]});
}

function showLeave(chatId, empId, ar) {
  const db = loadDB();
  const e = db.hr_employees?.find(x=>String(x.id)===String(empId));
  const bals = (db.hr_leave_balances||[]).filter(b=>String(b.employeeId)===String(empId));
  if (!e) return;
  let msg = ar ? `🏖️ <b>رصيد العطل</b>\n━━━━━━━━━━━━━━\n👤 ${T(e.lastName_ar)}\n` : `🏖️ <b>SOLDE CONGÉS</b>\n━━━━━━━━━━━━━━\n👤 ${T(e.lastName_fr)}\n`;
  if (bals.length) { bals.forEach(b=>{ msg += `📅 ${b.year}: <b>${b.balance||0}</b> ${ar?'يوم':'j'}\n`; }); }
  else { msg += ar ? '⚠️ لا توجد بيانات.' : '⚠️ Aucune donnée.'; }
  return send(chatId, msg, {inline_keyboard:[[{text:ar?'🔙 رجوع':'🔙 Retour',callback_data:'emp:'+empId}]]});
}

function showDocs(chatId, ar) {
  const kbd = {inline_keyboard: DOCS.map(d=>[{text:ar?d.ar:d.fr, callback_data:`doc:${states.get(chatId)?.empId}:${d.id}`}])};
  return send(chatId, ar?'📝 اختر الوثيقة:':'📝 Choisissez le document:', kbd);
}

function showAbsType(chatId, ar) {
  const empId = states.get(chatId)?.empId;
  return send(chatId, ar?'🚨 نوع الغياب:':'🚨 Type absence:', {inline_keyboard:[
    [{text:ar?'✅ مبرر':'✅ Autorisé',callback_data:`atype:${empId}:auth`},{text:ar?'❌ غير مبرر':'❌ Non autorisé',callback_data:`atype:${empId}:unauth`}]
  ]});
}

function showFautes(chatId, ar) {
  const empId = states.get(chatId)?.empId;
  const kbd = {inline_keyboard: FAUTES.map(f=>[{text:ar?f.ar:f.fr, callback_data:`faute:${empId}:${f.id}`}])};
  return send(chatId, ar?'📊 نوع المخالفة:':'📊 Type de faute:', kbd);
}

function saveReq(data) {
  const p = path.join(DATA_DIR, 'requests.json');
  let reqs = [];
  try { reqs = JSON.parse(fs.readFileSync(p,'utf8')); } catch {}
  reqs.unshift({...data, id:Date.now().toString(), createdAt:new Date().toISOString(), status:'pending'});
  fs.writeFileSync(p, JSON.stringify(reqs.slice(0,500)));
}

// HTTP server for Render health check and remote config updates
http.createServer((req,res)=>{ 
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(200); return res.end(); }
  
  if (req.method === 'POST' && req.url === '/api/config') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const newConfig = JSON.parse(body);
        if (newConfig.authorized_users) {
          fs.writeFileSync(CONFIG_PATH, JSON.stringify(newConfig, null, 2), 'utf8');
          log('✅ Received remote config update. Users: ' + newConfig.authorized_users.length);
          res.writeHead(200, {'Content-Type': 'application/json'});
          return res.end(JSON.stringify({success: true}));
        }
      } catch(e) {
        log('❌ Failed to parse remote config: ' + e.message);
      }
      res.writeHead(400, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({success: false, error: 'Invalid config'}));
    });
    return;
  }
  res.writeHead(200);
  res.end('OK'); 
}).listen(process.env.PORT||8080);

// Polling
let offset = 0;
try { offset = JSON.parse(fs.readFileSync(OFFSET_PATH,'utf8')).offset||0; } catch {}

async function poll() {
  try {
    const res = await tg('getUpdates',{offset,timeout:25,allowed_updates:['message','callback_query']});
    if (res.ok && res.result) {
      for (const u of res.result) {
        offset = u.update_id+1;
        fs.writeFileSync(OFFSET_PATH, JSON.stringify({offset}));
        await handle(u).catch(e=>log('Handle error: '+e.message));
      }
    }
  } catch(e) { log('Poll error: '+e.message); }
  setTimeout(poll, 500);
}

// Boot
(async () => {
  log('Cloud Bot Starting...');
  const syncResult = await syncDB();
  log('Initial sync: ' + syncResult);
  await send(ADMIN_ID, `✅ <b>البوت السحابي يعمل!</b>\n📊 ${syncResult}\n\nأرسل أي رقم للبحث عن موظف.`);
  poll();
})();
