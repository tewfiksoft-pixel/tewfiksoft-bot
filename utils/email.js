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
    
    const host = s.smtp_host || process.env.SMTP_HOST || 'smtp-relay.brevo.com';
    const port = parseInt(s.smtp_port || process.env.SMTP_PORT || 587);
    const user = s.smtp_user || process.env.SMTP_USER;
    const pass = s.smtp_pass || process.env.SMTP_PASS;

    if (!user || !pass) {
      log(`[Email-Error] SMTP credentials missing (User: ${user ? 'OK' : 'MISSING'}, Pass: ${pass ? 'OK' : 'MISSING'})`);
      return false;
    }

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
      tls: {
        rejectUnauthorized: false // Helps with some shared hosting environments
      }
    });

    const fromName = "TewfikSoft HR";
    const fromEmail = "tewfiksoft@gmail.com";

    const info = await transporter.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to,
      subject,
      text,
      attachments
    });

    log(`[Email] Success: Sent to ${to} | ID: ${info.messageId}`);
    return true;
  } catch (error) {
    log(`[Email-Error] Failed to send to ${to}: ${error.message}`);
    return false;
  }
}
