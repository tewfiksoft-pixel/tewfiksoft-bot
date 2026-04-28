// ============================================================
// TewfikSoft HR Telegram Bot - Premium Cloud Edition
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
          try { reqs = JSON.parse(fs.readFileSync(REQUESTS_PATH, 'utf8')); } catch {}
          reqs.unshift({ ...data, id: Date.now().toString(), createdAt: new Date().toISOString(), status: 'pending' });
          fs.writeFileSync(REQUESTS_PATH, JSON.stringify(reqs.slice(0, 500)));
};

// -- Google Drive Sync -------------------------------------
const syncFromDrive = async () => {
          if (!DB_FILE_ID) return;
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
                      if (typeof data === 'string' && data.startsWith('U2FsdGVkX1')) {
                                    const bytes = CryptoJS.AES.decrypt(data, ENCRYPTION_KEY);
                                    data = bytes.toString(CryptoJS.enc.Utf8);
                      }

            fs.writeFileSync(DB_LOCAL_PATH, data);
                      log("Database synced.");
          } catch (err) { log("Sync error: " + err.message); }
};

const loadDatabase = () => {
          try { return JSON.parse(fs.readFileSync(DB_LOCAL_PATH, 'utf8')); } catch { return { hr_employees: [] }; }
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
        { id: 0, ar: '\u0633\u0646\u062F \u0639\u0637\u0644\u0629', fr: 'Titre de conges' },
        { id: 1, ar: '\u0634\u0647\u0627\u062F\u0629 \u0639\u0645\u0644', fr: 'Attestation de travail' },
        { id: 2, ar: '\u0643\u0634\u0641 \u0631\u0627\u062A\u0628', fr: 'Releve des emoluments' },
        { id: 3, ar: '\u0641\u064A\u0634 \u062F\u064A \u0628\u064A', fr: 'Fiche de paie' },
        { id: 4, ar: '\u0628\u0637\u0627\u0642\u0629 \u0634\u0641\u0627\u0621', fr: 'Activation carte Chifa' },
        { id: 5, ar: '\u062A\u0633\u0648\u064A\u0629 \u0631\u0627\u062A\u0628', fr: 'Regularisation de paie' },
        { id: 6, ar: '\u062A\u0642\u064A\u064A\u0645 \u0641\u062A\u0631\u0629 \u0627\u0644\u062A\u062C\u0631\u0628\u0629', fr: 'Evaluation Periode Essai' }
        ];

const MOTIFS = [
        { ar: '\u062A\u0623\u0645\u064A\u0646 \u0633\u064A\u0627\u0631\u0629', fr: 'Assurance Automobile' },
        { ar: '\u0641\u062A\u062D \u062D\u0633\u0627\u0628 \u0628\u0646\u0643\u064A', fr: 'Ouverture Compte Bancaire' },
        { ar: '\u0641\u062A\u062D \u062D\u0633\u0627\u0628 \u0628\u0631\u064A\u062F\u064A', fr: 'Ouverture Compte CCP' },
        { ar: '\u0645\u0644\u0641 \u0645\u0646\u062D\u0629', fr: 'Dossier Bourse' },
        { ar: '\u0645\u0644\u0641 \u0641\u064A\u0632\u0627', fr: 'Dossier Visa' },
        { ar: '\u0645\u0644\u0641 \u062C\u0648\u0627\u0632 \u0633\u0641\u0631', fr: 'Dossier Passeport' },
        { ar: '\u0634\u0631\u0627\u0621 \u0628\u0627\u0644\u062A\u0642\u0633\u064A\u0637', fr: 'Achat par facilite' },
        { ar: '\u0643\u0641\u0627\u0644\u0629 \u0639\u0627\u0626\u0644\u064A\u0629', fr: 'Dossier soutien de Famille' },
        { ar: '\u0645\u0644\u0641 \u0633\u0643\u0646', fr: 'Dossier Logement' },
        { ar: '\u0642\u0631\u0636 \u0628\u0646\u0643\u064A', fr: 'Credit Bancaire' }
        ];

// -- Logic -------------------------------------------------
const canViewStats = (role) => ['admin', 'general_manager'].includes(role);
const canViewEmployees = (role) => ['admin', 'general_manager', 'gestionnaire_rh', 'manager', 'supervisor'].includes(role);

const langs = new Map();
const states = new Map();

const getLang = (chatId) => langs.get(String(chatId)) || 'ar';
const setLang = (chatId, l) => langs.set(String(chatId), l);

const handleStart = async (chatId, user, lang) => {
          const ar = lang === 'ar';
          const roleLabel = { 
                      admin:'\u0645\u062F\u064A\u0631 \u0627\u0644\u0646\u0638\u0627\u0645 \uD83D\uDEE1\uFE0F', 
                      general_manager:'\u0645\u062F\u064A\u0631 \u0639\u0627\u0645 \uD83D\uDC51', 
                      gestionnaire_rh:'\u0645\u0633\u064A\u0631 \u0645\u0648\u0627\u0631\u062F \u0628\u0634\u0631\u064A\u0629 \uD83D\uDCCB', 
                      manager:'\u0645\u062F\u064A\u0631 \uD83D\uDC68\u200D\uD83D\uDCBC', 
                      supervisor:'\u0645\u0634\u0631\u0641 \uD83D\uDD0D', 
                      employee:'\u0645\u0648\u0638\u0641 \uD83D\uDC64' 
          };
          const roleLabelFr = { 
                      admin:'Admin \uD83D\uDEE1\uFE0F', 
                      general_manager:'Manager General \uD83D\uDC51', 
                      gestionnaire_rh:'RH \uD83D\uDCCB', 
                      manager:'Manager \uD83D\uDC68\u200D\uD83D\uDCBC', 
                      supervisor:'Supervisor \uD83D\uDD0D', 
                      employee:'Employee \uD83D\uDC64' 
          };

          const msg = ar ? 
                      `\uD83D\uDC4B \u0623\u0647\u0644\u0627\u0641 \u0628\u0643 <b>${user.name || ''}</b> \u0641\u064A \u0646\u0638\u0627\u0645 TewfikSoft HR!\n` +
                      `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n` +
                      `\uD83C\uDD94 <b>\u0631\u0642\u0645\u0643:</b> <code>${user.id}</code>\n` +
                      `\uD83D\uDCCB <b>\u0627\u0644\u0631\u062A\u0628\u0629:</b> ${roleLabel[user.role] || user.role}\n\n` +
                      `\uD83D\uDCA1 <b>\u0627\u0644\u0623\u0648\u0627\u0645\u0631 \u0627\u0644\u0645\u062A\u0627\u062D\u0629:</b>\n` +
                      `\uD83D\uDC64 /me - \u0639\u0631\u0636 \u0628\u0637\u0627\u0642\u062A\u0643\n` +
                      `\uD83D\uDD0D /info - \u0627\u0644\u0628\u062D\u062B \u0639\u0646 \u0645\u0648\u0638\u0641\n` +
                      `\uD83D\uDCCB /menu - \u0627\u0644\u0642\u0627\u0626\u0645\u0629 \u0627\u0644\u0631\u0623\u064A\u0633\u064A\u0629` :
                      `\uD83D\uDC4B Bienvenue <b>${user.name || ''}</b> sur TewfikSoft HR!\n` +
                      `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n` +
                      `\uD83C\uDD94 <b>Votre ID:</b> <code>${user.id}</code>\n` +
                      `\uD83D\uDCCB <b>R\u00F4le:</b> ${roleLabelFr[user.role] || user.role}\n\n` +
                      `\uD83D\uDCA1 <b>Commandes:</b>\n` +
                      `\uD83D\uDC64 /me - Votre card\n` +
                      `\uD83D\uDD0D /info - Chercher un employ\u00E9\n` +
                      `\uD83D\uDCCB /menu - Menu Principal`;

          await send(chatId, msg);
};

const handleMe = async (chatId, user, lang) => {
          const ar = lang === 'ar';
          const roleLabel = { 
                      admin:'\u0645\u062F\u064A\u0631 \u0627\u0644\u0646\u0638\u0627\u0645 \uD83D\uDEE1\uFE0F', 
                      general_manager:'\u0645\u062F\u064A\u0631 \u0639\u0627\u0645 \uD83D\uDC51', 
                      gestionnaire_rh:'\u0645\u0633\u064A\u0631 \u0645\u0648\u0627\u0631\u062F \u0628\u0634\u0631\u064A\u0629 \uD83D\uDCCB', 
                      manager:'\u0645\u062F\u064A\u0631 \uD83D\uDC68\u200D\uD83D\uDCBC', 
                      supervisor:'\u0645\u0634\u0631\u0641 \uD83D\uDD0D', 
                      employee:'\u0645\u0648\u0638\u0641 \uD83D\uDC64' 
          };
          const roleLabelFr = { 
                      admin:'Admin \uD83D\uDEE1\uFE0F', 
                      general_manager:'Manager General \uD83D\uDC51', 
                      gestionnaire_rh:'RH \uD83D\uDCCB', 
                      manager:'Manager \uD83D\uDC68\u200D\uD83D\uDCBC', 
                      supervisor:'Supervisor \uD83D\uDD0D', 
                      employee:'Employee \uD83D\uDC64' 
          };

          const msg = ar ? 
                      `\uD83D\uDC64 <b>\u0628\u0637\u0627\u0642\u0629 \u0627\u0644\u0647\u0648\u064A\u0629 \u0627\u0644\u0645\u0647\u0646\u064A\u0629</b>\n` +
                      `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n` +
                      `\uD83C\uDD94 <b>\u0627\u0644\u0631\u0642\u0645:</b> <code>${user.id}</code>\n` +
                      `\uD83D\uDC51 <b>\u0627\u0644\u0627\u0633\u0645:</b> ${user.name || '-'}\n` +
                      `\uD83D\uDCCB <b>\u0627\u0644\u0631\u062A\u0628\u0629:</b> ${roleLabel[user.role] || user.role}` :
                      `\uD83D\uDC64 <b>Carte d'Identit\u00E9 Professionnelle</b>\n` +
                      `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n` +
                      `\uD83C\uDD94 <b>ID:</b> <code>${user.id}</code>\n` +
                      `\uD83D\uDC51 <b>Nom:</b> ${user.name || '-'}\n` +
                      `\uD83D\uDCCB <b>R\u00F4le:</b> ${roleLabelFr[user.role] || user.role}`;

          await send(chatId, msg);
};

const handleMenu = async (chatId, user, lang) => {
          const ar = lang === 'ar';
          const kbd = { inline_keyboard: [] };
          if (canViewEmployees(user.role)) {
                      kbd.inline_keyboard.push([{ text: ar ? '\uD83D\uDD0D \u0628\u062D\u062B \u0639\u0646 \u0645\u0648\u0638\u0641' : '\uD83D\uDD0D Chercher employ\u00E9', callback_data: 'emp_search' }]);
          }
          kbd.inline_keyboard.push([{ text: ar ? '\uD83D\uDCC4 \u0637\u0644\u0628 \u0648\u062b\u064a\u0642\u0629' : '\uD83D\uDCC4 Demander document', callback_data: 'show_docs' }]);
          if (canViewStats(user.role)) {
                      kbd.inline_keyboard.push([{ text: ar ? '\uD83D\uDCCA \u0627\u0644\u0625\u062D\u0635\u0627\u0626\u064A\u0627\u062A' : '\uD83D\uDCCA Statistiques', callback_data: 'stats' }]);
          }
          if (user.role === 'admin') {
                      kbd.inline_keyboard.push([{ text: ar ? '\uD83D\uDD04 \u062A\u062D\u062F\u064A\u062b \u0627\u0644\u0628\u064A\u0627\u0646\u0627\u062A' : '\uD83D\uDD04 Sync Database', callback_data: 'sync_db' }]);
          }
          kbd.inline_keyboard.push([{ text: ar ? '\u062A\u063a\u064a\u064a\u0631 \u0627\u0644\u0644\u063a\u0629 \uD83C\uDF10' : 'Changer Langue \uD83C\uDF10', callback_data: 'choose_lang' }]);
          await send(chatId, ar ? '\uD83D\uDCCB <b>\u0627\u0644\u0642\u0627\u0626\u0645\u0629 \u0627\u0644\u0631\u0623\u064A\u0633\u064A\u0629</b>' : '\uD83D\uDCCB <b>Menu Principal</b>', kbd);
};

const handleInfoSearch = async (chatId, user, lang, query) => {
          const ar = lang === 'ar';
          const db = loadDatabase();
          const q = query.toLowerCase().trim();
          const emps = db.hr_employees || db.employees || [];
          const results = emps.filter(e => {
                      const id = String(e.clockingId || e.id || '').toLowerCase();
                      const nameFr = (String(e.lastName_fr || '') + ' ' + String(e.firstName_fr || '')).toLowerCase();
                      const nameAr = (String(e.lastName_ar || '') + ' ' + String(e.firstName_ar || '')).toLowerCase();
                      const job = String(e.jobTitle_fr || e.jobTitle_ar || e.job || '').toLowerCase();
                      return id.includes(q) || nameFr.includes(q) || nameAr.includes(q) || job.includes(q);
          }).slice(0, 5);
          if (!results.length) return send(chatId, ar ? '\u274C \u0644\u0645 \u064A\u062A\u0645 \u0627\u0644\u0639\u062b\u0648\u0631 \u0639\u0644\u0649 \u0623\u064a \u0645\u0648\u0638\u0641.' : '\u274C Aucun employ\u00E9 trouv\u00E9.');
          for (const emp of results) {
                      const nomAr = (emp.lastName_ar || '') + ' ' + (emp.firstName_ar || '');
                      const nomFr = (emp.lastName_fr || '') + ' ' + (emp.firstName_fr || '');
                      const poste = ar ? (emp.jobTitle_ar || '-') : (emp.jobTitle_fr || '-');
                      const dept = ar ? (emp.department_ar || '-') : (emp.department_fr || '-');
                      const msg = ar
                                    ? `\uD83D\uDC64 <b>\u0646\u062A\u0627\u0626\u062C \u0627\u0644\u0628\u062D\u062B</b>\n\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n\uD83C\uDD94 <b>\u0627\u0644\u0631\u0642\u0645:</b> <code>${emp.clockingId || emp.id}</code>\n\uD83D\uDC51 <b>\u0627\u0644\u0627\u0633\u0645:</b> ${nomAr.trim() || nomFr.trim()}\n\uD83D\uDCBC <b>\u0627\u0644\u0645\u0646\u0635\u0628:</b> ${poste}\n\uD83C\uDFE2 <b>\u0627\u0644\u0642\u0633\u0645:</b> ${dept}\n\uD83C\uDFE2 <b>\u0627\u0644\u0634\u0631\u0643\u0629:</b> ${emp.companyId || '-'}\n\u2705 <b>\u0627\u0644\u062D\u0627\u0644\u0629:</b> \u0646\u0634\u0637`
                                    : `\uD83D\uDC64 <b>R\u00E9sultat</b>\n\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n\uD83C\uDD94 <b>ID:</b> <code>${emp.clockingId || emp.id}</code>\n\uD83D\uDC51 <b>Nom:</b> ${nomFr.trim() || nomAr.trim()}\n\uD83D\uDCBC <b>Poste:</b> ${poste}\n\uD83C\uDFE2 <b>D\u00E9pt:</b> ${dept}\n\uD83C\uDFE2 <b>Soci\u00E9t\u00E9:</b> ${emp.companyId || '-'}\n\u2705 <b>Statut:</b> Actif`;
                      await send(chatId, msg);
          }
};

const handleInfo = async (chatId, user, lang) => {
          const ar = lang === 'ar';
          if (!canViewEmployees(user.role)) return send(chatId, ar ? '\u26A0\uFE0F \u0644\u064a\u0633 \u0644\u062f\u064a\u0643 \u0635\u0644\u0627\u062d\u064a\u0629.' : '\u26A0\uFE0F Pas de permission.');
          states.set(chatId, { step: 'search_query' });
          await send(chatId, ar ? '\uD83D\uDD0D \u0623\u062F\u062e\u0644 \u0627\u0644\u0627\u0633\u0645 \u0623\u0648 \u0631\u0642\u0645 \u0627\u0644\u0645\u0648\u0638\u0641:' : '\uD83D\uDD0D Nom ou ID:');
};

const handleDocRequest = async (chatId, user, lang, config) => {
          const ar = lang === 'ar';
          const allowed = config.allowed_documents || {};
          const docs = DOCS.filter(d => allowed["doc_" + d.id] !== false);
          const kbd = { inline_keyboard: docs.map(d => [{ text: ar ? d.ar : d.fr, callback_data: "doc:" + d.id }]) };
          await send(chatId, ar ? '\uD83D\uDCC4 \u0627\u062e\u062A\u0631 \u0627\u0644\u0648\u062b\u064a\u0642\u0629:' : '\uD83D\uDCC4 Document:', kbd);
};

const handleMotifs = async (chatId, lang) => {
          const ar = lang === 'ar';
          const kbd = { inline_keyboard: [] };
          for (let i = 0; i < MOTIFS.length; i += 2) {
                      const row = [{ text: ar ? MOTIFS[i].ar : MOTIFS[i].fr, callback_data: "motif:" + i }];
                      if (MOTIFS[i+1]) row.push({ text: ar ? MOTIFS[i+1].ar : MOTIFS[i+1].fr, callback_data: "motif:" + (i+1) });
                      kbd.inline_keyboard.push(row);
          }
          await send(chatId, ar ? '\u2753 \u0627\u0630\u0643\u0631 \u0633\u0628\u0628 \u0627\u0644\u0637\u0644\u0628:' : '\u2753 Motif:', kbd);
};

const handle = async (update, config) => {
          const cbq = update.callback_query;
          const msg = update.message || cbq?.message;
          const from = update.message?.from || cbq?.from;
          if (!msg || !from) return;
          const chatId = String(msg.chat.id), fromId = String(from.id), txt = (msg.text || '').trim().toLowerCase(), lang = getLang(chatId), ar = lang === 'ar';
          const user = config.authorized_users?.find(u => String(u.id) === fromId);
          if (!user) {
                      if (txt === '/start') return send(chatId, `\u26A0\uFE0F <b>\u062F\u062E\u0648\u0644 \u0645\u0631\u0641\u0648\u0636</b>\n\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\nID: <code>${fromId}</code>`);
                      return;
          }
          if (cbq) {
                      await tgCall('answerCallbackQuery', { callback_query_id: cbq.id });
                      const data = cbq.data;
                      if (data === 'choose_lang') return send(chatId, 'Language?', { inline_keyboard: [[{ text: 'AR', callback_data: 'lang:ar' }, { text: 'FR', callback_data: 'lang:fr' }]] });
                      if (data.startsWith('lang:')) { setLang(chatId, data.split(':')[1]); return handleMenu(chatId, user, getLang(chatId)); }
                      if (data === 'emp_search') return handleInfo(chatId, user, lang);
                      if (data === 'show_docs') return handleDocRequest(chatId, user, lang, config);
                      if (data === 'sync_db') { await syncFromDrive(); return send(chatId, "\u2705 Done"); }
                      if (data.startsWith('doc:')) {
                                    const doc = DOCS.find(d => d.id === parseInt(data.split(':')[1]));
                                    states.set(chatId, { step: 'doc_motif', doc });
                                    return handleMotifs(chatId, lang);
                      }
                      if (data.startsWith('motif:')) {
                                    const m = MOTIFS[parseInt(data.split(':')[1])];
                                    saveRequest({ type: 'document', doc: states.get(chatId)?.doc?.fr, motif: ar ? m.ar : m.fr, fromId, fromName: user.name, lang });
                                    states.delete(chatId);
                                    return send(chatId, ar ? '\u2705 \u062A\u0645 \u0627\u0644\u0627\u0633\u062A\u0644\u0627\u0645.' : '\u2705 Re\u00E7u.');
                      }
          }
          if (states.has(chatId) && txt) {
                      const st = states.get(chatId);
                      if (st.step === 'search_query') { states.delete(chatId); return handleInfoSearch(chatId, user, lang, txt); }
          }
          if (txt === '/start') return handleStart(chatId, user, lang);
          if (txt === '/me' || txt === '/id') return handleMe(chatId, user, lang);
          if (txt === '/menu') return handleMenu(chatId, user, lang);
          if (txt === '/info') return handleInfo(chatId, user, lang);
};

let offset = loadOffset();
const poll = async () => {
          const config = loadConfig();
          try {
                      const res = await tgCall('getUpdates', { offset, timeout: 25 });
                      if (res?.ok) {
                                    for (const u of res.result || []) { offset = u.update_id + 1; saveOffset(offset); await handle(u, config); }
                      }
                      setTimeout(poll, 500);
          } catch (e) { setTimeout(poll, 5000); }
};

// -- HTTP Server with API endpoints for data push ----------
http.createServer((req, res) => {
          if (req.method === 'GET') { res.writeHead(200); return res.end('TewfikSoft Bot OK'); }
          if (req.method === 'POST' && (req.url === '/api/database' || req.url === '/api/config')) {
                      let body = [];
                      req.on('data', chunk => body.push(chunk));
                      req.on('end', () => {
                                    try {
                                                  ensureDataDir();
                                                  const raw = Buffer.concat(body).toString('utf8');
                                                  JSON.parse(raw); // validate JSON
                                                  const filePath = req.url === '/api/database' ? DB_LOCAL_PATH : CONFIG_PATH;
                                                  fs.writeFileSync(filePath, raw, 'utf8');
                                                  const label = req.url === '/api/database' ? 'database' : 'config';
                                                  log('[API] ' + label + ' updated via POST (' + raw.length + ' bytes)');
                                                  res.writeHead(200, { 'Content-Type': 'application/json' });
                                                  res.end(JSON.stringify({ ok: true, label }));
                                    } catch (e) {
                                                  log('[API] Error saving: ' + e.message);
                                                  res.writeHead(400); res.end(JSON.stringify({ ok: false, error: e.message }));
                                    }
                      });
                      return;
          }
          res.writeHead(404); res.end('Not Found');
}).listen(process.env.PORT || 3000, () => log('HTTP server on port ' + (process.env.PORT || 3000)));

syncFromDrive().then(() => poll());
