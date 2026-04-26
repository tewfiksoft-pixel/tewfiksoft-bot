// ============================================================
// TewfikSoft HR Telegram Bot - Cloud Edition (Google Drive Sync)
// ============================================================
import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import { google } from 'googleapis';
import CryptoJS from 'crypto-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// -- Config ------------------------------------------------
const CONFIG_PATH = path.join(__dirname, 'config.json');
const REQUESTS_PATH = path.join(__dirname, 'data', 'requests.json');
const OFFSET_PATH = path.join(__dirname, 'data', 'offset.json');
const GOOGLE_KEY_PATH = path.join(__dirname, 'google_drive_key.json');
const DB_LOCAL_PATH = path.join(__dirname, 'data', 'database.json');

const BOT_TOKEN = process.env.BOT_TOKEN || '';
const DB_FILE_ID = process.env.DB_FILE_ID || '';
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'tewfiksoft2026';

// -- Helpers -----------------------------------------------
const log = (msg) => console.log("[" + new Date().toISOString() + "] " + msg);

const ensureDataDir = () => {
        const dir = path.join(__dirname, 'data');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
};

const loadConfig = () => {
        try {
                      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        } catch {
                      return { is_enabled: true, authorized_users: [], display_settings: {}, allowed_documents: {} };
        }
};

const loadOffset = () => {
        try {
                      return JSON.parse(fs.readFileSync(OFFSET_PATH, 'utf8')).offset || 0;
        } catch {
                      return 0;
        }
};

const saveOffset = (n) => {
        ensureDataDir();
        fs.writeFileSync(OFFSET_PATH, JSON.stringify({ offset: n }));
};

const saveRequest = (data) => {
        ensureDataDir();
        let reqs = [];
        try {
                      reqs = JSON.parse(fs.readFileSync(REQUESTS_PATH, 'utf8'));
        } catch {}
        reqs.unshift({ ...data, id: Date.now().toString(), createdAt: new Date().toISOString(), status: 'pending' });
        fs.writeFileSync(REQUESTS_PATH, JSON.stringify(reqs.slice(0, 500)));
};

// -- Google Drive Sync -------------------------------------
const syncFromDrive = async () => {
        if (!DB_FILE_ID) {
                      log("DB_FILE_ID not set. Skipping sync.");
                      return;
        }
        try {
                      ensureDataDir();
                      const auth = new google.auth.GoogleAuth({
                                            keyFile: GOOGLE_KEY_PATH,
                                            scopes: ['https://www.googleapis.com/auth/drive.readonly'],
                      });
                      const drive = google.drive({ version: 'v3', auth });
                      log("Downloading database from Drive...");
                      const res = await drive.files.get({ fileId: DB_FILE_ID, alt: 'media' }, { responseType: 'text' });

          let data = res.data;
                      if (typeof data === 'string' && data.startsWith('U2FsdGVkX1')) { // Encrypted
                        log("Decrypting database...");
                                            const bytes = CryptoJS.AES.decrypt(data, ENCRYPTION_KEY);
                                            data = bytes.toString(CryptoJS.enc.Utf8);
                      }

          fs.writeFileSync(DB_LOCAL_PATH, data);
                      log("Database synced and saved locally.");
        } catch (err) {
                      log("Sync error: " + err.message);
        }
};

const loadDatabase = () => {
        try {
                      return JSON.parse(fs.readFileSync(DB_LOCAL_PATH, 'utf8'));
        } catch {
                      return { employees: [] };
        }
};

// -- Telegram API ------------------------------------------
const tgCall = (method, body = {}) => new Promise((resolve) => {
        const payload = JSON.stringify(body);
        const req = https.request({
                      hostname: 'api.telegram.org',
                      path: "/bot" + BOT_TOKEN + "/" + method,
                      method: 'POST',
                      rejectUnauthorized: false,
                      headers: {
                                            'Content-Type': 'application/json',
                                            'Content-Length': Buffer.byteLength(payload)
                      }
        }, (res) => {
                      let d = '';
                      res.on('data', c => d += c);
                      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } });
        });
        req.on('error', (e) => { log("[API Error] [" + method + "]: " + e.message); resolve(null); });
        req.write(payload);
        req.end();
});

const send = (chatId, text, kbd = null) => {
        const body = { chat_id: chatId, text, parse_mode: 'HTML' };
        if (kbd) body.reply_markup = kbd;
        log("-> " + chatId + ": " + text.substring(0, 60).replace(/\n/g,' ') + "...");
        return tgCall('sendMessage', body);
};

// -- Data --------------------------------------------------
const DOCS = [
    { id: 0, ar: 'Sanad Otla', fr: 'Titre de conges' },
    { id: 1, ar: 'Shahadat Amal', fr: 'Attestation de travail' },
    { id: 2, ar: 'Kachf Ratib', fr: 'Releve des emoluments' },
    { id: 3, ar: 'Fich de Paie', fr: 'Fiche de paie' },
    { id: 4, ar: 'Carte Chifa', fr: 'Activation carte Chifa' },
    { id: 5, ar: 'Regularisation Ratib', fr: 'Regularisation de paie' },
    { id: 6, ar: 'Evaluation Period', fr: 'Evaluation Periode Essai' }
    ];

const MOTIFS = [
    { ar: 'Assurance Voiture', fr: 'Assurance Automobile' },
    { ar: 'Compte Bancaire', fr: 'Ouverture Compte Bancaire' },
    { ar: 'Compte CCP', fr: 'Ouverture Compte CCP' },
    { ar: 'Dossier Bourse', fr: 'Dossier Bourse' },
    { ar: 'Dossier Visa', fr: 'Dossier Visa' },
    { ar: 'Dossier Passeport', fr: 'Dossier Passeport' },
    { ar: 'Achat Facilite', fr: 'Achat par facilite' },
    { ar: 'Kafala Family', fr: 'Dossier soutien de Famille' },
    { ar: 'Dossier Logement', fr: 'Dossier Logement' },
    { ar: 'Credit Bancaire', fr: 'Credit Bancaire' }
    ];

// -- Logic -------------------------------------------------
const canViewStats = (role) => ['admin', 'general_manager'].includes(role);
const canViewEmployees = (role) => ['admin', 'general_manager', 'gestionnaire_rh', 'manager', 'supervisor'].includes(role);
const isEmployee = (role) => role === 'employee';

const langs = new Map();
const states = new Map();
const getLang = (chatId) => langs.get(String(chatId)) || 'ar';
const setLang = (chatId, l) => langs.set(String(chatId), l);

const handleStart = async (chatId, user, lang) => {
        const ar = lang === 'ar';
        const roleLabel = { admin:'Admin', general_manager:'Manager General', gestionnaire_rh:'RH', manager:'Manager', supervisor:'Supervisor', employee:'Employee' };
        const msg = ar ? 
                      `
                                `* Ahlan bek ${(user.name || 'bek')}! *\n` +
                                          `------------------\n` +
                                                    `ID: <code>${user.id}</code>\n` +
          `Role: ${roleLabel[user.role] || user.role}\n\n` +
              `Commands:\n` +
              `/me - Info\n` +
              `/info - Search\n` +
              `/menu - Menu` : 
          `* Welcome ${(user.name || '')}! *\n` +
              `------------------\n` +
              `ID: <code>${user.id}</code>\n` +
              `Role: ${roleLabel[user.role] || user.role}\n\n` +
              `Commands:\n` +
              `/me - Your card\n` +
              `/info - Search\n` +
              `/menu - Main menu`;
    await send(chatId, msg);
};

const handleMe = async (chatId, user, lang) => {
        const ar = lang === 'ar';
        const msg = ar ? 
                      `[ ID Card ]\n` +
                      `------------------\n` +
                      `ID: <code>${user.id}</code>\n` +
                      `Name: ${user.name || '-'}\n` +
                      `Role: ${user.role}` : 
                      `[ ID Card ]\n` +
                      `------------------\n` +
                      `ID: <code>${user.id}</code>\n` +
                      `Name: ${user.name || '-'}\n` +
                      `Role: ${user.role}`;
        await send(chatId, msg);
};

const handleMenu = async (chatId, user, lang) => {
        const ar = lang === 'ar';
        const kbd = { inline_keyboard: [] };
        if (!isEmployee(user.role)) {
                      kbd.inline_keyboard.push([{ text: ar ? 'Search' : 'Search', callback_data: 'emp_search' }]);
                      kbd.inline_keyboard.push([{ text: ar ? 'Document' : 'Document', callback_data: 'show_docs' }]);
        }
        if (canViewStats(user.role)) kbd.inline_keyboard.push([{ text: ar ? 'Stats' : 'Stats', callback_data: 'stats' }]);
        if (user.role === 'admin' || user.role === 'general_manager') kbd.inline_keyboard.push([{ text: ar ? 'Sync' : 'Sync', callback_data: 'sync_db' }]);
        kbd.inline_keyboard.push([{ text: ar ? 'Language' : 'Language', callback_data: 'choose_lang' }]);
        await send(chatId, ar ? '<b>Menu</b>' : '<b>Menu</b>', kbd);
};

const handleInfoSearch = async (chatId, user, lang, query) => {
        const ar = lang === 'ar';
        const db = loadDatabase();
        const q = query.toLowerCase();
        const results = (db.employees || []).filter(e => String(e.id).toLowerCase().includes(q) || String(e.name).toLowerCase().includes(q)).slice(0, 5);

        if (results.length === 0) {
                      return send(chatId, ar ? "Search failed." : "No results.");
        }

        for (const emp of results) {
                      const msg = ar ? 
                                            `* Employee Card *\n` +
                                            `
                                                              `* Employee Card *\n` +
                                                                                `------------------\n` +
                                                                                                  `ID: <code>${emp.id}</code>\n` +
                  `Name: ${emp.name}\n` +
                                            `Job: ${emp.job || '-'}\n` +
                                            `Dept: ${emp.dept || '-'}\n` +
                                            `------------------` :
                              `* Fiche Employe *\n` +
                                                    `------------------\n` +
                                                    `ID: <code>${emp.id}</code>\n` +
                                                    `Name: ${emp.name}\n` +
                                                    `Job: ${emp.job || '-'}\n` +
                                                    `Dept: ${emp.dept || '-'}\n` +
                                                    `------------------`;
                      await send(chatId, msg);
        }
};

const handleInfo = async (chatId, user, lang) => {
        if (!canViewEmployees(user.role)) {
                      const ar = lang === 'ar';
                      return send(chatId, ar ? 'Permission denied.' : 'Permission denied.');
        }
        const ar = lang === 'ar';
        states.set(String(chatId), { step: 'search_query' });
        await send(chatId, ar ? 'Search query:' : 'Search query:');
};

const handleDocRequest = async (chatId, user, lang, config) => {
        const ar = lang === 'ar';
        const allowed = config.allowed_documents || {};
        const docs = DOCS.filter(d => allowed["doc_" + d.id] !== false);
        if (!docs.length) return send(chatId, ar ? 'No documents.' : 'No documents.');
        const kbd = { inline_keyboard: docs.map(d => [{ text: ar ? d.ar : d.fr, callback_data: "doc:" + d.id }]) };
        await send(chatId, ar ? 'Choose doc:' : 'Choose doc:', kbd);
};

const handleMotifs = async (chatId, lang) => {
        const ar = lang === 'ar';
        const kbd = { inline_keyboard: [] };
        for (let i = 0; i < MOTIFS.length; i += 2) {
                      const row = [{ text: ar ? MOTIFS[i].ar : MOTIFS[i].fr, callback_data: "motif:" + i }];
                      if (MOTIFS[i+1]) row.push({ text: ar ? MOTIFS[i+1].ar : MOTIFS[i+1].fr, callback_data: "motif:" + (i+1) });
                      kbd.inline_keyboard.push(row);
        }
        await send(chatId, ar ? 'Motif?' : 'Motif?', kbd);
};

const handleConfirmation = async (chatId, lang) => {
        const ar = lang === 'ar';
        await send(chatId, ar ? 'Success.' : 'Success.');
};

const handle = async (update, config) => {
        const cbq = update.callback_query;
        const msg = update.message || cbq?.message;
        const from = update.message?.from || cbq?.from;
        if (!msg || !from) return;

        const chatId = String(msg.chat.id);
        const fromId = String(from.id);
        const txt = (msg.text || '').trim();
        const txtL = txt.toLowerCase();
        const lang = getLang(chatId);
        const ar = lang === 'ar';

        log("From:" + fromId + " | Text:\"" + (txtL || cbq?.data || 'N/A') + "\"");

        const user = config.authorized_users?.find(u => String(u.id) === fromId);
        if (!user) {
                      if (txtL === '/start' || txtL === '/me' || txtL === '/id') {
                                            return send(chatId, "Access Denied.\nID: " + fromId);
                      }
                      return;
        }

        if (cbq) await tgCall('answerCallbackQuery', { callback_query_id: cbq.id });
        const state = states.get(chatId);

        if (cbq) {
                      const data = cbq.data;
                      if (data === 'choose_lang' || data === 'menu') return handleMenu(chatId, user, lang);
                      if (data.startsWith('lang:')) {
                                            setLang(chatId, data.split(':')[1]);
                                            return handleMenu(chatId, user, data.split(':')[1]);
                      }
                      if (data === 'emp_search') return handleInfo(chatId, user, lang);
                      if (data === 'show_docs') return handleDocRequest(chatId, user, lang, config);
                      if (data === 'sync_db') {
                                            if (user.role !== 'admin' && user.role !== 'general_manager') return send(chatId, "No Permission.");
                                            await send(chatId, "Syncing...");
                                            await syncFromDrive();
                                            return send(chatId, "Sync Complete.");
                      }
                      if (data === 'stats') {
                                            if (!canViewStats(user.role)) return send(chatId, 'Permission denied.');
                                            return send(chatId, 'Stats: Use dashboard.');
                      }
                      if (data.startsWith('doc:')) {
                                            const docId = parseInt(data.split(':')[1]);
                                            const doc = DOCS.find(d => d.id === docId);
                                            if (!doc) return;
                                            states.set(chatId, { step: 'doc_motif', doc: doc });
                                            if (docId === 1 || docId === 2) return handleMotifs(chatId, lang);
                                            return send(chatId, ar ? 'Purpose?' : 'Motif?');
                      }
                      if (data.startsWith('motif:')) {
                                            const m = MOTIFS[parseInt(data.split(':')[1])];
                                            const st = states.get(chatId);
                                            if (!st?.doc) return;
                                            saveRequest({ type: 'document', doc: st.doc.fr, motif: ar ? m.ar : m.fr, fromId, fromName: user.name, lang });
                                            states.delete(chatId);
                                            return handleConfirmation(chatId, lang);
                      }
                      return;
        }

        if (state) {
                      if (state.step === 'search_query') {
                                            states.delete(chatId);
                                            return handleInfoSearch(chatId, user, lang, txt);
                      }
                      if (state.step === 'doc_motif') {
                                            saveRequest({ type: 'document', doc: state.doc?.fr, motif: txt, fromId, fromName: user.name, lang });
                                            states.delete(chatId);
                                            return handleConfirmation(chatId, lang);
                      }
        }

        if (txtL.startsWith('/start')) return handleStart(chatId, user, lang);
        if (txtL.startsWith('/me') || txtL.startsWith('/id')) return handleMe(chatId, user, lang);
        if (txtL.startsWith('/menu')) return handleMenu(chatId, user, lang);
        if (txtL.startsWith('/info')) return handleInfo(chatId, user, lang);
        if (txtL.startsWith('/lang')) {
                      const kbd = { inline_keyboard: [[{ text: 'AR', callback_data: 'lang:ar' }, { text: 'FR', callback_data: 'lang:fr' }]] };
                      return send(chatId, 'Language', kbd);
        }
        if (txtL === '/sync' && (user.role === 'admin' || user.role === 'general_manager')) {
                  await send(chatId, "Syncing...");
                  await syncFromDrive();
                  return send(chatId, "Sync Complete.");
        }
};

let offset = loadOffset();
let isPolling = true;

const poll = async () => {
        if (!isPolling) return;
        const config = loadConfig();
        if (!config.is_enabled) {
                      setTimeout(poll, 10000);
                      return;
        }
        try {
                      const data = await tgCall('getUpdates', { offset, timeout: 25 });
                      if (data?.ok) {
                                            for (const update of data.result || []) {
                                                                            offset = update.update_id + 1;
                                                                            saveOffset(offset);
                                                                            try { await handle(update, config); } catch (e) { log("Error: " + e.message); }
                                            }
                      }
                      setTimeout(poll, 300);
        } catch (err) {
                      log("Poll error: " + err.message);
                      setTimeout(poll, 5000);
        }
};

const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', time: new Date().toISOString() }));
}).listen(PORT, () => log("Health check on port " + PORT));

tgCall('deleteWebhook', { drop_pending_updates: false }).then(() => {
        syncFromDrive().then(() => poll());
});
