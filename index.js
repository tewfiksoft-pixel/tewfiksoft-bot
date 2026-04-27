// TewfikSoft Cloud Bot v4.3 - Render.com Edition (Polling + HTTP Health Check)
import https from 'https';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import http from 'http';
import AdminRole from './roles/AdminRole.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const CONFIG_PATH = path.join(__dirname, 'config.json');
const DB_PATH = path.join(DATA_DIR, 'database.json');
const OFFSET_PATH = path.join(DATA_DIR, 'offset.json');

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) { console.error('❌ FATAL: BOT_TOKEN environment variable is not set!'); process.exit(1); }
const ADMIN_ID = process.env.ADMIN_CHAT_ID || '';
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

const ADMIN_MOTIFS = [
  {id:0, ar:"تأمين السيارات", fr:"Assurance Automobile"},
  {id:1, ar:"فتح حساب بنكي", fr:"Ouverture Compte Bancaire"},
  {id:2, ar:"فتح حساب بريدي CCP", fr:"Ouverture Compte CCP"},
  {id:3, ar:"ملف منحة دراسية", fr:"Dossier Bourse"},
  {id:4, ar:"ملف تأشيرة Visa", fr:"Dossier Visa"},
  {id:5, ar:"ملف جواز السفر", fr:"Dossier Passeport"},
  {id:6, ar:"شراء بالتقسيط", fr:"Achat par facilité"},
  {id:7, ar:"ملف كفالة عائلية", fr:"Dossier soutien de Famille"},
  {id:8, ar:"ملف سكن", fr:"Dossier Logement"},
  {id:9, ar:"قرض بنكي", fr:"Crédit Bancaire"}
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
let lastSync = 0;

// Context for roles
const botCtx = {
    send,
    loadDB,
    loadConfig,
    T
};

const adminRole = new AdminRole(botCtx);

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

// --- LIVE ROLE SYNC ---
  try {
    const now = Date.now();
    // Sync every 2 minutes if active
    if (now - lastSync > 120000) {
        lastSync = now;
        syncDB().then(r => log("Auto-Sync: " + r)).catch(() => {});
    }

    const db = loadDB();
    if (db && db.hr_employees) {
      const matchName = (emp) => {
          const clean = (s) => String(s||'').trim().toLowerCase().replace(/\s+/g, ' ');
          const dbNames = [
              clean(`${T(emp.firstName_fr)} ${T(emp.lastName_fr)}`),
              clean(`${T(emp.lastName_fr)} ${T(emp.firstName_fr)}`),
              clean(`${T(emp.firstName_ar)} ${T(emp.lastName_ar)}`),
              clean(`${T(emp.lastName_ar)} ${T(emp.firstName_ar)}`)
          ];
          const target = clean(user.name);
          return dbNames.includes(target);
      };

      const employee = db.hr_employees.find(e => 
          (e.clockingId && String(e.clockingId) === String(user.clockingId)) || 
          (e.phone && e.phone === user.phone) ||
          matchName(e)
      );

      if (employee) {
          log(`👤 User ${user.name} matched in DB as ${employee.clockingId}`);
      } else {
          log(`⚠️ No employee match found in database for ${user.name} (Role: ${user.role})`);
      }
    }
  } catch (e) {
    log("Role Sync Error: " + e.message);
  }
  // --- END SYNC ---

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
      const isAr = l==='ar';
      if (user.role === 'general_manager') return showMenu(chatId, user, isAr);
      if (user.role === 'employee' || user.role === 'gestionnaire_rh' || user.scope === 'self') {
        const db = loadDB();
        const myId = user.allowed_employees?.[0] || user.id;
        const e = db.hr_employees?.find(x=>String(x.clockingId) === String(myId));
        if (e) return showCard(chatId, e.id, isAr, user);
        return send(chatId, isAr?'❌ لم يتم العثور على ملفك الخاص.':'❌ Votre profil n\'a pas été trouvé.');
      }
      states.set(chatId, {step:'search'});
      return send(chatId, isAr?'✅ <b>تم اختيار اللغة.</b>\n\n🔍 يرجى الآن إدخال <b>اسم الموظف</b> أو <b>رقمه</b> للبحث عنه:':'✅ <b>Langue sélectionnée.</b>\n\n🔍 Veuillez maintenant entrer le <b>nom</b> ou <b>matricule</b> de l\'employé :');
    }
    if (d==='menu') return showMenu(chatId, user, ar);
    if (d==='sync') { const r=await syncDB(); return send(chatId, `🔄 Sync: ${r}`); }
    if (d==='stats') {
      if (user.role === 'admin' || user.role === 'general_manager') {
        try {
          return await adminRole.handleStats(chatId, ar);
        } catch (e) {
          log("Stats Error: " + e.message);
          return send(chatId, ar ? '❌ حدث خطأ أثناء استخراج الإحصائيات. تأكد من مزامنة البيانات.' : '❌ Erreur stats. Vérifiez la sync.');
        }
      }
      return send(chatId, ar?'❌ لا تملك صلاحية الوصول للإحصائيات.':'❌ Accès refusé.');
    }
    if (d==='search') { states.set(chatId,{step:'search'}); return send(chatId, ar?'🔍 أدخل اسم الموظف أو رقمه:':'🔍 Nom ou matricule :'); }
    if (d.startsWith('emp:')) return showCard(chatId, d.slice(4), ar, user);
    if (d.startsWith('docs:')) { states.set(chatId,{step:'doc_pick',empId:d.slice(5)}); return showDocs(chatId,ar); }
    if (d.startsWith('doc:')) {
      const [,empId,docId] = d.split(':');
      const doc = DOCS.find(x=>x.id===+docId);
      
      // If doc is Attestation (1) or Relevés (2), show predefined motifs
      if (+docId === 1 || +docId === 2) {
        states.set(chatId, {step:'doc_predefined_motif', empId, doc: ar?doc.ar:doc.fr});
        const kbd = {inline_keyboard: []};
        for (let i = 0; i < ADMIN_MOTIFS.length; i += 2) {
            const row = [];
            row.push({text: ar ? ADMIN_MOTIFS[i].ar : ADMIN_MOTIFS[i].fr, callback_data: 'dmotif:' + i});
            if (ADMIN_MOTIFS[i+1]) row.push({text: ar ? ADMIN_MOTIFS[i+1].ar : ADMIN_MOTIFS[i+1].fr, callback_data: 'dmotif:' + (i+1)});
            kbd.inline_keyboard.push(row);
        }
        return send(chatId, ar?'❓ الرجاء اختيار سبب الطلب:':'❓ Veuillez choisir le motif :', kbd);
      }
      
      states.set(chatId,{step:'doc_motif',empId,doc:ar?doc.ar:doc.fr});
      return send(chatId, ar?'❓ ما هو الغرض من الطلب؟':'❓ Motif de la demande ?');
    }
    
    if (d.startsWith('dmotif:')) {
      const motifId = +d.slice(7);
      const st = states.get(chatId);
      if (st && st.step === 'doc_predefined_motif') {
        const motifObj = ADMIN_MOTIFS[motifId];
        const motifText = motifObj ? (ar ? motifObj.ar : motifObj.fr) : 'Autre';
        saveReq({type:'document',doc:st.doc,motif:motifText,fromId,empId:st.empId});
        states.delete(chatId);
        send(chatId, ar?'✅ تم استلام طلبك بنجاح. سيتم دراسته وإشعارك.\n🌸 يومكم مبارك، وصلّوا على أشرف الخلق. 🌸':'✅ Demande reçue avec succès.\n🌸 Passez une journée bénie, et priez sur le plus noble des créatures. 🌸');
        return showCard(chatId, st.empId, ar, loadConfig().authorized_users?.find(x=>String(x.id)===fromId));
      }
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
    if (d.startsWith('leave:')) return showLeave(chatId, d.slice(6), ar, user);
    if (d.startsWith('full:')) return showFull(chatId, d.slice(5), ar, user);
    return;
  }

  // Commands
  if (txt === '/sync' && (user.role === 'admin' || chatId === ADMIN_ID)) {
    const res = await syncDB();
    const db = loadDB();
    const matchName = (emp) => {
        const clean = (s) => String(s||'').trim().toLowerCase().replace(/\s+/g, ' ');
        const dbNames = [
            clean(`${T(emp.firstName_fr)} ${T(emp.lastName_fr)}`),
            clean(`${T(emp.lastName_fr)} ${T(emp.firstName_fr)}`),
            clean(`${T(emp.firstName_ar)} ${T(emp.lastName_ar)}`),
            clean(`${T(emp.lastName_ar)} ${T(emp.firstName_ar)}`)
        ];
        const target = clean(user.name);
        return dbNames.includes(target);
    };
    const emp = db.hr_employees?.find(e => 
        (e.clockingId && String(e.clockingId) === String(user.clockingId)) || 
        (e.phone && e.phone === user.phone) ||
        matchName(e)
    );
    let info = emp ? `\n👤 Found in DB: <b>${emp.firstName_fr} ${emp.lastName_fr}</b>\n🔑 DB Role: <b>${emp.role}</b>` : `\n⚠️ No match found in DB for name: ${user.name}`;
    return send(chatId, `🔄 Sync Result: ${res}${info}\n\n<i>Note: Use /me to see active role.</i>`);
  }
  if (txt==='/start') {
    const db = loadDB();
    const emp = db.hr_employees?.find(e=>String(e.clockingId)===String(user.clockingId));
    
    if (!emp && user.role !== 'admin' && user.role !== 'general_manager') {
      return send(chatId, ar?'❌ لم يتم العثور على ملفك في القاعدة.':'❌ Votre profil n\'a pas été trouvé.');
    }

    const displayName = emp ? (ar ? `${T(emp.lastName_ar)} ${T(emp.firstName_ar)}` : `${T(emp.lastName_fr)} ${T(emp.firstName_fr)}`) : user.name;
    const welcome = ar ? `🌟 مرحباً <b>${displayName}</b>\nيرجى اختيار اللغة للمتابعة:` : `🌟 Bienvenue <b>${displayName}</b>\nChoisissez la langue :`;
    
    return send(chatId, welcome, {inline_keyboard:[[
      {text:'العربية 🇩🇿',callback_data:'infolang:ar'},
      {text:'Français 🇫🇷',callback_data:'infolang:fr'}
    ]]});
  }
  if (txt==='/info' || txt.toLowerCase().startsWith('/info')) {
    return sendInfoWelcome(chatId, user);
  }
  if (txt==='/me') {
    const db = loadDB();
    const emp = db.hr_employees?.find(e=>String(e.clockingId)===String(user.clockingId));
    const displayName = emp ? (ar ? `${T(emp.lastName_ar)} ${T(emp.firstName_ar)}` : `${T(emp.lastName_fr)} ${T(emp.firstName_fr)}`) : user.name;
    let msg = `👤 <b>بطاقة التعريف</b>\n━━━━━━━━━━━━━━\n🆔 الرمز: <code>${fromId}</code>\n👑 الدور: <b>${user.role}</b>\n👤 الاسم: <b>${displayName}</b>`;
    if (emp) msg += `\n🏢 القسم: <i>${ar ? T(emp.department_ar) : T(emp.department_fr)}</i>`;
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
      if (user.role === 'general_manager') return send(chatId, ar?'❌ لا تملك صلاحية للبحث عن العمال.':'❌ Non autorisé.');
      const visible = getVisibleEmployees(user, db);
      const res = visible.filter(e=>(String(e.clockingId).includes(q)||T(e.lastName_fr).toLowerCase().includes(q)||T(e.lastName_ar).includes(q)||T(e.firstName_fr).toLowerCase().includes(q)));
      if (!res.length) return send(chatId, ar?'❌ لم يتم العثور على موظف.':'❌ Aucun résultat.');
      if (res.length===1) return showCard(chatId, res[0].id, ar, user);
      const kbd = {inline_keyboard: res.slice(0,8).map(e=>[{text:`👤 ${T(e.lastName_fr)} ${T(e.firstName_fr)}`,callback_data:'emp:'+e.id}])};
      return send(chatId, ar?'📂 نتائج البحث:':'📂 Résultats:', kbd);
    }
    if (st.step==='doc_motif') {
      saveReq({type:'document',doc:st.doc,motif:txt,fromId,empId:st.empId});
      states.delete(chatId);
      send(chatId, ar?'✅ تم استلام طلبك بنجاح. سيتم دراسته وإشعارك.\n🌸 يومكم مبارك، وصلّوا على أشرف الخلق. 🌸':'✅ Demande reçue avec succès.\n🌸 Passez une journée bénie, et priez sur le plus noble des créatures. 🌸');
      return showCard(chatId, st.empId, ar, user);
    }
    if (st.step==='abs_date') {
      saveReq({type:'absence',absType:st.absType,date:txt,fromId,empId:st.empId});
      states.delete(chatId);
      send(chatId, ar?'✅ تم تسجيل الغياب.\n🌸 يومكم مبارك، وصلّوا على أشرف الخلق. 🌸':'✅ Absence enregistrée.\n🌸 Passez une journée bénie, et priez sur le plus noble des créatures. 🌸');
      return showCard(chatId, st.empId, ar, user);
    }
    if (st.step==='survey_date') {
      saveReq({type:'survey',faute:st.faute,date:txt,fromId,empId:st.empId});
      states.delete(chatId);
      send(chatId, ar?'✅ تم تسجيل الاستبيان.\n🌸 يومكم مبارك، وصلّوا على أشرف الخلق. 🌸':'✅ Questionnaire enregistré.\n🌸 Passez une journée bénie, et priez sur le plus noble des créatures. 🌸');
      return showCard(chatId, st.empId, ar, user);
    }
  }

  // Direct search if text is not a command
  if (txt.length>=2 && !txt.startsWith('/')) {
    const db = loadDB();
    const q = txt.toLowerCase();
    if (user.role === 'general_manager') return send(chatId, ar?'❌ لا تملك صلاحية للبحث عن العمال.':'❌ Non autorisé.');
    const visible = getVisibleEmployees(user, db);
    const res = visible.filter(e=>(String(e.clockingId).includes(q)||T(e.lastName_fr).toLowerCase().includes(q)||T(e.lastName_ar).includes(q)||T(e.firstName_fr).toLowerCase().includes(q)));
    if (!res.length) return send(chatId, ar?'❌ لم يتم العثور على موظف.':'❌ Aucun résultat.');
    if (res.length===1) return showCard(chatId, res[0].id, ar, user);
    const kbd = {inline_keyboard: res.slice(0,8).map(e=>[{text:`👤 ${T(e.lastName_fr)} ${T(e.firstName_fr)}`,callback_data:'emp:'+e.id}])};
    return send(chatId, ar?'📂 نتائج البحث:':'📂 Résultats:', kbd);
  }
}


function getVisibleEmployees(user, db) {
  if (user.role === 'general_manager' || user.role === 'admin') return (db.hr_employees||[]).filter(e=>e.status==='active');
  const myId = user.allowed_employees?.[0] || user.id;
  if (user.role === 'employee' || user.role === 'gestionnaire_rh' || user.scope === 'self') {
    return (db.hr_employees||[]).filter(e=>e.status==='active' && String(e.clockingId) === String(myId));
  }
  return (db.hr_employees||[]).filter(e => {
    if(e.status !== 'active') return false;
    if (user.scope === 'all') return true;
    if (user.scope === 'department') {
      const depts = user.allowed_departments || [];
      return depts.includes(e.department_fr) || depts.includes(e.department_ar);
    }
    if (user.scope === 'custom_employees') {
      const emps = user.allowed_employees || [];
      return emps.includes(String(e.clockingId));
    }
    return false;
  });
}

function showMenu(chatId, user, ar) {
  let kbd = [];
  
  // General Manager ONLY sees stats
  if (user.role === 'general_manager' || user.role === 'admin') {
    kbd.push([{text:ar?'📊 إحصائيات الشركة':'📊 Statistiques',callback_data:'stats'}]);
  }

  // Others see search (and GM is excluded from search)
  if (user.role !== 'general_manager' && user.role !== 'admin') {
    kbd.push([{text:ar?'🔍 بحث عن موظف':'🔍 Chercher employé',callback_data:'search'}]);
  }
  
  // Only technical manager or RH see sync
  if (user.role === 'gestionnaire_rh') {
    kbd.push([{text:ar?'🔄 تحديث قاعدة البيانات':'🔄 Sync DB',callback_data:'sync'}]);
  }

  return send(chatId, ar?'📋 القائمة الرئيسية لمدير العام':'📋 Menu Direction', {inline_keyboard: kbd});
}

function showCard(chatId, empId, ar, user) {
  const db = loadDB();
  const visible = getVisibleEmployees(user, db);
  const e = visible.find(x=>String(x.id)===String(empId));
  if (!e) return send(chatId, ar ? '❌ غير مصرح لك بمشاهدة هذا الموظف.' : '❌ Non autorisé.');
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

function showFull(chatId, empId, ar, user) {
  const db = loadDB();
  const visible = getVisibleEmployees(user, db);
  const e = visible.find(x=>String(x.id)===String(empId));
  if (!e) return send(chatId, ar ? '❌ غير مصرح لك بمشاهدة هذا الموظف.' : '❌ Non autorisé.');
  const msg = ar
    ? `📋 <b>بيانات الموظف</b>\n━━━━━━━━━━━━━━\n👤 ${T(e.lastName_ar)} ${T(e.firstName_ar)}\n🏢 ${T(e.department_ar)}\n💼 ${T(e.jobTitle_ar)}\n📅 التوظيف: ${e.startDate||'—'}\n📜 العقد: ${T(e.contractType)}\n⏳ نهاية: ${e.contractEndDate||'—'}`
    : `📋 <b>FICHE EMPLOYÉ</b>\n━━━━━━━━━━━━━━\n👤 ${T(e.lastName_fr)} ${T(e.firstName_fr)}\n🏢 ${T(e.department_fr)}\n💼 ${T(e.jobTitle_fr)}\n📅 Embauche: ${e.startDate||'—'}\n📜 Contrat: ${T(e.contractType)}\n⏳ Fin: ${e.contractEndDate||'—'}`;
  return send(chatId, msg, {inline_keyboard:[[{text:ar?'🔙 رجوع':'🔙 Retour',callback_data:'emp:'+empId}]]});
}

function showLeave(chatId, empId, ar, user) {
  const db = loadDB();
  const visible = getVisibleEmployees(user, db);
  const e = visible.find(x=>String(x.id)===String(empId));
  if (!e) return send(chatId, ar ? '❌ غير مصرح لك بمشاهدة هذا الموظف.' : '❌ Non autorisé.');
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

  // Send Notification to Admins and RH
  try {
    const cfg = loadConfig();
    const db = loadDB();
    const emp = db.hr_employees?.find(e=>String(e.id)===String(data.empId)) || {};
    const empName = `${T(emp.lastName_ar)} ${T(emp.firstName_ar)}`;
    const empNum = emp.clockingId || '—';
    
    let notifMsg = `🔔 <b>إشعار بطلب جديد</b>\n━━━━━━━━━━━━━━\n👤 الموظف: <b>${empName}</b> (ID: ${empNum})`;
    if (data.type === 'document') {
      notifMsg += `\n📄 نوع الطلب: طلب وثيقة\n📁 الوثيقة: <b>${data.doc}</b>\n❓ السبب: ${data.motif}`;
    } else if (data.type === 'absence') {
      notifMsg += `\n🚨 إعلام غياب\nالنوع: ${data.absType === 'auth' ? 'مبرر' : 'غير مبرر'}\nالتاريخ: ${data.date}`;
    } else if (data.type === 'survey') {
      notifMsg += `\n📊 استبيان مخالفة\nالمخالفة: ${data.faute}\nالتاريخ: ${data.date}`;
    }

    const notifiers = cfg.authorized_users?.filter(u => u.role === 'admin' || u.role === 'gestionnaire_rh');
    if (notifiers && notifiers.length) {
      notifiers.forEach(admin => {
        send(admin.id, notifMsg).catch(()=>{});
      });
    }
  } catch(e) { log('Notif error: ' + e.message); }
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
          syncDB().then(r => log("Config-Triggered Sync: " + r)).catch(e => log("Config Sync Err: " + e.message));
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
}).listen(process.env.PORT||10000);

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
  log('=== TewfikSoft HR Bot v4.3 (Render) Starting... ===');
  log(`PORT: ${process.env.PORT || 10000}`);
  log(`ADMIN_CHAT_ID: ${ADMIN_ID || '(not set)'}`);
  const syncResult = await syncDB();
  log('Initial sync: ' + syncResult);
  if (ADMIN_ID) {
    await send(ADMIN_ID, `✅ <b>البوت السحابي يعمل! (Render)</b>\n📊 ${syncResult}\n\nأرسل أي رقم للبحث عن موظف.`).catch(e => log('Boot msg error: ' + e.message));
  }
  poll();
})();
