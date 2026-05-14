import nodemailer from 'nodemailer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { log } from './database.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function sendEmail(to, subject, text, attachments = []) {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8'));
    const s = config.email_settings || {};
    
    const host = s.smtp_host || 'smtp-relay.brevo.com';
    const user = s.smtp_user || 'ab23a7001@smtp-brevo.com';
    const pass = s.smtp_pass || 'K0QcwMtUqzhSgX75';

    const transporter = nodemailer.createTransport({
      host: host,
      port: 2525,
      secure: false,
      auth: { user, pass },
      debug: true,
      logger: true,
      connectionTimeout: 15000
    });

    const fromEmail = "tewfiksoft@gmail.com";

    const info = await transporter.sendMail({
      from: `"TewfikSoft HR" <${fromEmail}>`,
      to,
      subject,
      text,
      attachments
    });

    log(`[Email] SMTP Success: Sent to ${to} | ID: ${info.messageId}`);
    return true;
  } catch (error) {
    log(`[Email-Error] SMTP Exception: ${error.message}`);
    return false;
  }
}
