import nodemailer from 'nodemailer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { log } from './database.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function sendEmail(to, subject, text, attachments = []) {
  const recipients = Array.isArray(to) ? to.join(', ') : to;
  try {
    const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8'));
    const s = config.email_settings || {};
    
    const host = s.smtp_host || 'smtp-relay.brevo.com';
    const user = s.smtp_user || 'ab23a7001@smtp-brevo.com';
    const pass = s.smtp_pass || 'K0QcwMtUqzhSgX75';

    const transporter = nodemailer.createTransport({
      host: host,
      port: s.smtp_port || 465, 
      secure: s.smtp_port ? (s.smtp_port === 465) : true, 
      auth: { user, pass },
      debug: true,
      logger: true,
      connectionTimeout: 15000
    });

    const fromEmail = "tewfiksoft@gmail.com";

    log(`[SMTP-Debug] Connecting to ${host}:${s.smtp_port || 465} (user: ${user})...`);
    
    const info = await transporter.sendMail({
      from: `"TewfikSoft HR" <${fromEmail}>`,
      to: recipients,
      subject,
      text,
      attachments
    });

    log(`[Email] SMTP Success: Sent to [${recipients}] | ID: ${info.messageId}`);
    return true;
  } catch (error) {
    log(`[Email-Error] SMTP Exception for [${recipients}]: ${error.message}`);
    if (error.response) log(`[Email-Error-Response] ${error.response}`);
    return false;
  }
}
