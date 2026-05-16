import nodemailer from 'nodemailer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { log } from './database.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function sendEmail(targetRecipients, subject, textContent, attachments = []) {
  try {
    const configPath = path.join(__dirname, '..', 'config.json');
    if (!fs.existsSync(configPath)) {
        log(`[Email-Error] config.json not found at ${configPath}`);
        return false;
    }
    
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const s = config.email_settings || {};
    
    const host = s.smtp_host || 'smtp-relay.brevo.com';
    const user = s.smtp_user || 'ab23a7001@smtp-brevo.com';
    const pass = s.smtp_pass || 'K0QcwMtUqzhSgX75';

    const transporter = nodemailer.createTransport({
      host,
      port: s.smtp_port || 2525,
      secure: false,
      auth: { user, pass },
      tls: { rejectUnauthorized: false }
    });

    const fromEmail = user;
    const finalTo = Array.isArray(targetRecipients) ? targetRecipients.join(', ') : targetRecipients;
    
    log(`[SMTP-Debug] Connecting to ${host}:${s.smtp_port || 587} (user: ${user})...`);
    
    const info = await transporter.sendMail({
      from: `"TewfikSoft HR" <${fromEmail}>`,
      to: finalTo,
      subject,
      text: textContent,
      attachments
    });

    log(`[Email-Success] ID: ${info.messageId} | Response: ${info.response}`);
    return true;
  } catch (e) {
    log(`[Email-Error] Failed to send: ${e.message}`);
    return false;
  }
}
