import https from 'https';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import http from 'http';
import { google } from 'googleapis';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// -- Config ------------------------------------------------
const CONFIG_PATH = path.join(__dirname, 'config.json');
const REQUESTS_PATH = path.join(__dirname, 'data', 'requests.json');
const OFFSET_PATH = path.join(__dirname, 'data', 'offset.json');
const GOOGLE_KEY_PATH = path.join(__dirname, 'google_drive_key.json');
const DB_LOCAL_PATH = path.join(__dirname, 'data', 'database.json');

const BOT_TOKEN = process.env.BOT_TOKEN || '7434503714:AAFm0o7rNisG9tKOfYp37C1V9pC-m7q3vPk';
const DB_FILE_ID = process.env.DB_FILE_ID || '';
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'nouar2026';
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxcj4K0p4FLgGGchC9oe4q95fLnHipbaUXN6hcQsCMDyR7ITH1ozIEF9Dk3SkEujt0njw/exec';

const DB_SALT = Buffer.from('tewfiksoft_hr_salt_2026', 'utf8');
const PBKDF2_ITERATIONS = 100000;

// -- Constants ---------------------------------------------
const DOCS = [
  {id: 0, ar: '🌴 سند عطلة', fr: '🌴 Titre de congés', val: 'Titre de congés'},
  {id: 1, ar: '💼 شهادة عمل', fr: '💼 Attestation de travail', val: 'Attestation de travail'},
  {id: 2, ar: '💰 كشف الراتب', fr: '💰 Relevé des émoluments', val: 'Relevé des émoluments'},
  {id: 3, ar: '📄 قسيمة الراتب', fr: '📄 Fiche de paie', val: 'Fiche de paie'},
  {id: 4, ar: '💳 تفعيل بطاقة الشفاء', fr: '💳 Activation carte Chifa', val: 'Activation carte Chifa'},
  {id: 5, ar: '📊 تسوية الراتب', fr: '📊 Régularisation de paie', val: 'Régularisation de paie'},
  {id: 6, ar: '📝 تقييم فترة تجريبية', fr: '📝 Évaluation Période d\'Essai', val: 'Évaluation Période Essai'}
];

const FAUTES = [
  {id: 0, ar: 'تخلي عن المنصب', fr: 'Abandon de poste', val: 'Abandon de poste'},
  {id: 1, ar: 'تأخر متكرر', fr: 'Retard répété', val: 'Retard répété'},
  {id: 2, ar: 'عصيان / تمرد', fr: 'Insubordination', val: 'Insubordination'},
  {id: 3, ar: 'إهمال', fr: 'Négligence', val: 'Négligence'},
  {id: 4, ar: 'غياب غير مبرر', fr: 'Absence injustifiée', val: 'Absence injustifiée'},
  {id: 5, ar: 'مخالفة النظام', fr: 'Violation règlement', val: 'Violation règlement'},
  {id: 6, ar: 'سلوك غير لائق', fr: 'Comportement incorrect', val: 'Comportement incorrect'},
  {id: 7, ar: 'أخرى', fr: 'Autre', val: 'Autre'}
];

const MOTIFS = [
    { ar: '🚗 تأمين السيارة', fr: 'Assurance Automobile' },
    { ar: '🏦 فتح حساب بنكي', fr: 'Ouverture Compte Bancaire' },
    { ar: '📮 فتح حساب CCP', fr: 'Ouverture Compte CCP' },
    { ar: '🎓 ملف المنحة', fr: 'Dossier Bourse' },
    { ar: '🌍 ملف الفيزا', fr: 'Dossier Visa' },
    { ar: '🛂 ملف جواز السفر', fr: 'Dossier Passeport' },
    { ar: '🛒 شراء بالتقسيط', fr: 'Achat par facilité' },
    { ar: '👨‍👩‍👧‍👦 ملف كفالة عائلية', fr: 'Dossier soutien de Famille' },
    { ar: '🏠 ملف سكن', fr: 'Dossier Logement' },
    { ar: '💰 قرض بنكي', fr: 'Crédit Bancaire' }
];

// -- Helpers -----------------------------------------------
const log = (msg) => console.log("[" + new Date().toISOString() + "] " + msg);

const ensureDataDir = () => {
    const dir = path.join(__dirname, 'data');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
};

const E = (s) => String(s||'').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/&/g, '&amp;');

const clean = (s) => {
    let str = String(s||'').trim();
    if (!str.includes('Ã')) return str;
    try {
        let res = str;
        for (let i = 0; i < 5; i++) {
            let b = Buffer.from(res, 'binary');
            let s2 = b.toString('utf8');
            if (s2 === res || !s2.includes('Ã')) { res = s2; break; }
            res = s2;
        }
        return res;
    } catch { return str; }
};

const T = (s, fallback='', len=100) => {
    let str = clean(s);
    if (!str || str.includes('Ã') || str.includes('\uFFFD') || str.length > 500) {
        return fallback ? T(fallback, '', len) : '—';
    }
    if (str.length > len) return str.substring(0, len) + '...';
    return str || '—';
};

function deriveKey(password) {
    return crypto.pbkdf2Sync(password, DB_SALT, PBKDF2_ITERATIONS, 32, 'sha256');
}

function decryptDatabase(encryptedBase64, password) {
    try {
        const data = Buffer.from(encryptedBase64, 'base64');
        if (data.length < 12) return null;
        const nonce = data.slice(0, 12);
        const ciphertext = data.slice(12);
        const key = deriveKey(password);
        const authTag = ciphertext.slice(ciphertext.length - 16);
        const encrypted = ciphertext.slice(0, ciphertext.length - 16);
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
        decipher.setAuthTag(authTag);
        const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
        return decrypted.toString('utf8');
    } catch (e) {
        log("Decryption Error: " + e.message);
        return null;
    }
}

const saveRequest = (data) => {
    ensureDataDir();
    let reqs = [];
    try { reqs = JSON.parse(fs.readFileSync(REQUESTS_PATH, 'utf8')); } catch {}
    reqs.unshift({ ...data, id: Date.now().toString(), createdAt: new Date().toISOString(), status: 'pending' });
    fs.writeFileSync(REQUESTS_PATH, JSON.stringify(reqs.slice(0, 500)));
};

const syncFromDrive = async () => {
    let report = 'Sync Start...\n';
    try {
        ensureDataDir();
        let rawData = null;

        try {
            report += 'Attempting Script URL sync...\n';
            const response = await fetch(SCRIPT_URL);
            if (response.ok) {
                rawData = await response.text();
                report += `Script URL Downloaded: ${rawData.length} bytes.\n`;
            } else {
                report += `Script URL failed: ${response.status}\n`;
            }
        } catch (e) { report += `Script URL Error: ${e.message}\n`; }

        if (!rawData && DB_FILE_ID) {
            try {
                report += 'Attempting Google Drive API sync...\n';
                const auth = new google.auth.GoogleAuth({
                    keyFile: GOOGLE_KEY_PATH,
                    scopes: ['https://www.googleapis.com/auth/drive.readonly']
                });
                const drive = google.drive({ version: 'v3', auth });
                const res = await drive.files.get({ fileId: DB_FILE_ID, alt: 'media' });
                if (res.data) {
                    rawData = res.data;
                    if (typeof rawData !== 'string') rawData = JSON.stringify(rawData);
                    report += `Drive API Downloaded: ${rawData.length} bytes.\n`;
                }
            } catch (e) { report += `Drive API Error: ${e.message}\n`; }
        }

        if (rawData) {
            if (rawData.charCodeAt(0) === 0xFEFF) rawData = rawData.slice(1);
            let parsedData = null;
            try {
                const parsed = JSON.parse(rawData);
                if (parsed && (parsed.hr_employees || parsed.employees)) {
                    fs.writeFileSync(DB_LOCAL_PATH, rawData);
                    report += 'Sync success: DB updated (Plain JSON)\n';
                    parsedData = parsed;
                }
            } catch (e) { report += `Plain JSON Parse Failed: ${e.message}\n`; }
            
            if (!parsedData) {
                const decrypted = decryptDatabase(rawData.trim(), ENCRYPTION_KEY);
                if (decrypted) {
                    fs.writeFileSync(DB_LOCAL_PATH, decrypted);
                    report += 'Sync success: DB decrypted and updated\n';
                    parsedData = true;
                } else {
                    report += 'Sync error: Decryption failed\n';
                }
            }
        } else {
            report += 'Sync error: No data retrieved.\n';
        }
    } catch (e) { report += 'Sync error: ' + e.message + '\n'; }
    return report;
};

const loadDatabase = () => {
    try { return JSON.parse(fs.readFileSync(DB_LOCAL_PATH, 'utf8')); } catch { return { hr_employees: [] }; }
};

const loadConfig = () => {
    try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch { return { authorized_users: [] }; }
};

// -- Telegram API ------------------------------------------
const tgCall = (method, body = {}) => new Promise((resolve) => {
    const payload = JSON.stringify(body);
    const req = https.request({
        hostname: 'api.telegram.org',
        path: "/bot" + BOT_TOKEN + "/" + method,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    }, (res) => {
        let d = '';
        res.on('data', (chunk) => d += chunk);
        res.on('end', () => resolve(JSON.parse(d)));
    });
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.write(payload);
    req.end();
});

const send = (chatId, text, kbd = null) => tgCall('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', reply_markup: kbd });

// -- Logic -------------------------------------------------
const canViewStats = (role) => ['admin', 'general_manager'].includes(role);
const canViewEmployees = (role) => ['admin', 'general_manager', 'gestionnaire_rh', 'manager', 'supervisor'].includes(role);

const langs = new Map();
const states = new Map();

const handleStart = async (chatId, user, lang) => {
    const ar = lang === 'ar';
    const msg = ar ? `🌟 <b>مرحباً بك، ${user.name}</b>\nرتبتك: <b>${user.role}</b>\n\nيرجى اختيار لغة العرض:` 
                   : `🌟 <b>Bienvenue, ${user.name}</b>\nRôle: <b>${user.role}</b>\n\nVeuillez choisir la langue :`;
    const kbd = { inline_keyboard: [[{ text: 'العربية 🇩🇿', callback_data: 'lang:ar' }, { text: 'Français 🇫🇷', callback_data: 'lang:fr' }]] };
    return send(chatId, msg, kbd);
};

const showMenu = async (chatId, user, lang) => {
    const ar = lang === 'ar';
    const kbd = { inline_keyboard: [] };
    if (canViewEmployees(user.role)) {
        kbd.inline_keyboard.push([{ text: ar ? '🔍 بحث عن موظف' : '🔍 Chercher employé', callback_data: 'emp_search' }]);
    }
    if (canViewStats(user.role)) {
        kbd.inline_keyboard.push([{ text: ar ? '📊 الإحصائيات' : '📊 Statistiques', callback_data: 'stats' }]);
    }
    kbd.inline_keyboard.push([{ text: ar ? '⚙️ تحديث البيانات' : '⚙️ Sync Database', callback_data: 'sync_db' }]);
    return send(chatId, ar ? '📋 <b>القائمة الرئيسية</b>' : '📋 <b>Menu Principal</b>', kbd);
};

const showEmpCard = async (chatId, empId, lang, user) => {
    const db = loadDatabase();
    const e = db.hr_employees?.find(x => String(x.id) === String(empId));
    if (!e) return;
    const ar = lang === 'ar';
    
    let msg = ar ? `📂 <b>خيارات الموظف</b>\n━━━━━━━━━━━━━━\n👤 الاسم: <b>${T(e.lastName_ar)} ${T(e.firstName_ar)}</b>\n🆔 ID: <code>${e.clockingId}</code>\n💼 الوظيفة: <i>${T(e.jobTitle_ar)}</i>\n⏳ نهاية العقد: <code>${e.contractEndDate || '—'}</code>\n\nيرجى اختيار الإجراء المطلوب:`
                 : `📂 <b>OPTIONS EMPLOYÉ</b>\n━━━━━━━━━━━━━━\n👤 Nom: <b>${T(e.lastName_fr)} ${T(e.firstName_fr)}</b>\n🆔 ID: <code>${e.clockingId}</code>\n💼 Poste: <i>${T(e.jobTitle_fr)}</i>\n⏳ Fin Contrat: <code>${e.contractEndDate || '—'}</code>\n\nVeuillez choisir l'action :`;

    const kbd = { inline_keyboard: [
        [{ text: ar ? '📄 ملف الموظف' : '📄 Fiche Employé', callback_data: 'full_card:' + empId }],
        [{ text: ar ? '🏖️ رصيد العطل' : '🏖️ Solde Congés', callback_data: 'emp_leave:' + empId }],
        [{ text: ar ? '📝 طلب وثيقة' : '📝 Demander Doc', callback_data: 'emp_docs:' + empId }, { text: ar ? '🚨 إعلام غياب' : '🚨 Signal. Absence', callback_data: 'emp_abs:' + empId }],
        [{ text: ar ? '📊 إجراء استبيان' : '📊 Faire un Questionnaire', callback_data: 'emp_survey:' + empId }],
        [{ text: ar ? '🏠 القائمة الرئيسية' : '🏠 Menu', callback_data: 'menu' }]
    ] };
    return send(chatId, msg, kbd);
};

const showStats = async (chatId, lang) => {
    const db = loadDatabase();
    const emps = (db.hr_employees || []).filter(e => e.status === 'active');
    const ar = lang === 'ar';
    const al = emps.filter(e => e.companyId === 'alver'), vt = emps.filter(e => e.companyId !== 'alver');
    const msg = ar ? `📊 <b>إحصائيات الشركة</b>\n━━━━━━━━━━━━━━\n👥 إجمالي العمال: <code>${emps.length}</code>\n├ 🟢 ALVER: <code>${al.length}</code>\n└ 🔵 Verre Tech: <code>${vt.length}</code>`
                   : `📊 <b>STATISTIQUES</b>\n━━━━━━━━━━━━━━\n👥 Effectif: <code>${emps.length}</code>\n├ 🟢 ALVER: <code>${al.length}</code>\n└ 🔵 Verre Tech: <code>${vt.length}</code>`;
    return send(chatId, msg, { inline_keyboard: [[{ text: ar ? '🏠 القائمة الرئيسية' : '🏠 Menu', callback_data: 'menu' }]] });
};

const handleCb = async (chatId, fromId, data, user, lang) => {
    const ar = lang === 'ar';
    if (data.startsWith('lang:')) { langs.set(chatId, data.split(':')[1]); return showMenu(chatId, user, data.split(':')[1]); }
    if (data === 'menu') return showMenu(chatId, user, lang);
    if (data === 'stats') return showStats(chatId, lang);
    if (data === 'sync_db') { const r = await syncFromDrive(); return send(chatId, `Sync Report:\n${r}`); }
    if (data === 'emp_search') { states.set(chatId, { step: 'search_query' }); return send(chatId, ar ? '🔍 أدخل اسم الموظف أو رقمه:' : '🔍 Entrez nom ou matricule :'); }
    if (data.startsWith('select:')) return showEmpCard(chatId, data.split(':')[1], lang, user);
    if (data.startsWith('full_card:')) {
        const db = loadDatabase();
        const e = db.hr_employees?.find(x => String(x.id) === String(data.split(':')[1]));
        const msg = ar ? `📋 <b>الملف الكامل: ${T(e.lastName_ar)}</b>\n\n📅 التوظيف: ${e.startDate}\n🏢 القسم: ${T(e.department_ar)}\n📜 العقد: ${e.contractType}` : `📋 <b>FICHE : ${T(e.lastName_fr)}</b>\n\n📅 Embauche: ${e.startDate}\n🏢 Dpt: ${T(e.department_fr)}\n📜 Contrat: ${e.contractType}`;
        return send(chatId, msg, { inline_keyboard: [[{ text: ar ? '🔙 رجوع' : '🔙 Retour', callback_data: 'select:' + e.id }]] });
    }
    if (data.startsWith('emp_docs:')) {
        states.set(chatId, { step: 'doc_select', empId: data.split(':')[1] });
        const kbd = { inline_keyboard: DOCS.map(d => [{ text: ar ? d.ar : d.fr, callback_data: 'doc:' + d.id }]) };
        return send(chatId, ar ? '📝 <b>اختر الوثيقة المطلوبة:</b>' : '📝 <b>Choisissez le document :</b>', kbd);
    }
    if (data.startsWith('doc:')) {
        const d = DOCS.find(x => x.id === +data.split(':')[1]);
        const state = states.get(chatId);
        states.set(chatId, { ...state, step: 'doc_motif', doc: ar ? d.ar : d.fr });
        return send(chatId, ar ? '❓ <b>ما هو الغرض من الطلب؟</b>' : '❓ <b>Motif de la demande ?</b>');
    }
    if (data.startsWith('emp_abs:')) {
        states.set(chatId, { step: 'abs_type', empId: data.split(':')[1] });
        const kbd = { inline_keyboard: [[{ text: ar ? '✅ مبرر' : '✅ Autorisé', callback_data: 'abstype:auth' }, { text: ar ? '❌ غير مبرر' : '❌ Non Autorisé', callback_data: 'abstype:unauth' }]] };
        return send(chatId, ar ? '🚨 <b>نوع الغياب:</b>' : '🚨 <b>Type d\'absence :</b>', kbd);
    }
    if (data.startsWith('abstype:')) {
        const state = states.get(chatId);
        states.set(chatId, { ...state, step: 'abs_date', absType: data.split(':')[1] });
        return send(chatId, ar ? '📅 <b>تاريخ الغياب:</b>' : '📅 <b>Date de l\'absence :</b>');
    }
    if (data.startsWith('emp_survey:')) {
        states.set(chatId, { step: 'survey_type', empId: data.split(':')[1] });
        const kbd = { inline_keyboard: FAUTES.map(f => [{ text: ar ? f.ar : f.fr, callback_data: 'faute:' + f.id }]) };
        return send(chatId, ar ? '📊 <b>اختر نوع المخالفة:</b>' : '📊 <b>Type de faute :</b>', kbd);
    }
    if (data.startsWith('faute:')) {
        const f = FAUTES.find(x => x.id === +data.split(':')[1]);
        const state = states.get(chatId);
        states.set(chatId, { ...state, step: 'survey_date', faute: ar ? f.ar : f.fr });
        return send(chatId, ar ? '📅 <b>تاريخ الواقعة:</b>' : '📅 <b>Date de l\'incident :</b>');
    }
};

const handleUpdate = async (u) => {
    const cbq = u.callback_query, msg = u.message || cbq?.message, from = u.message?.from || cbq?.from;
    if (!msg || !from) return;
    const chatId = msg.chat.id, fromId = String(from.id), txt = (msg.text || '').trim();
    if (cbq) await tgCall('answerCallbackQuery', { callback_query_id: cbq.id });

    const config = loadConfig();
    const user = config.authorized_users?.find(x => String(x.id) === fromId);
    if (!user) return send(chatId, `❌ Unauthorized. ID: ${fromId}`);

    const lang = langs.get(chatId) || 'ar';
    const state = states.get(chatId);

    if (cbq) return handleCb(chatId, fromId, cbq.data, user, lang);

    if (txt === '/start') return handleStart(chatId, user, lang);
    if (txt === '/menu') return showMenu(chatId, user, lang);
    if (txt === '/id') return send(chatId, `Your ID: <code>${fromId}</code>`);
    if (txt === '/sync') { const r = await syncFromDrive(); return send(chatId, r); }

    if (state) {
        if (state.step === 'search_query') {
            states.delete(chatId);
            const db = loadDatabase();
            const q = txt.toLowerCase();
            const results = (db.hr_employees || []).filter(e => e.status === 'active' && (String(e.clockingId).includes(q) || T(e.lastName_fr).toLowerCase().includes(q) || T(e.lastName_ar).includes(q)));
            if (results.length === 0) return send(chatId, '❌ No results.');
            if (results.length === 1) return showEmpCard(chatId, results[0].id, lang, user);
            const kbd = { inline_keyboard: results.slice(0, 8).map(e => [{ text: `👤 ${T(e.lastName_fr)} ${T(e.firstName_fr)}`, callback_data: 'select:' + e.id }]) };
            return send(chatId, '📂 Results:', kbd);
        }
        if (state.step === 'doc_motif') {
            saveRequest({ type: 'document', doc: state.doc, motif: txt, fromId, targetEmpId: state.empId });
            states.delete(chatId);
            return send(chatId, lang === 'ar' ? '✅ تم استلام طلبك.' : '✅ Demande reçue.');
        }
        if (state.step === 'abs_date') {
            saveRequest({ type: 'absence', absType: state.absType, date: txt, fromId, targetEmpId: state.empId });
            states.delete(chatId);
            return send(chatId, '✅ Received.');
        }
        if (state.step === 'survey_date') {
            saveRequest({ type: 'survey', faute: state.faute, date: txt, fromId, targetEmpId: state.empId });
            states.delete(chatId);
            return send(chatId, '✅ Received.');
        }
    }
};

// -- Server & Polling --------------------------------------
const server = http.createServer((req, res) => {
    res.writeHead(200);
    res.end('Bot is running');
});
server.listen(process.env.PORT || 8080);

let offset = 0;
try { offset = JSON.parse(fs.readFileSync(OFFSET_PATH, 'utf8')).offset || 0; } catch {}

const poll = async () => {
    const res = await tgCall('getUpdates', { offset, timeout: 30 });
    if (res.ok && res.result) {
        for (const u of res.result) {
            offset = u.update_id + 1;
            fs.writeFileSync(OFFSET_PATH, JSON.stringify({ offset }));
            await handleUpdate(u);
        }
    }
    setTimeout(poll, 1000);
};
poll();
log("Cloud Bot Started Successfully.");
