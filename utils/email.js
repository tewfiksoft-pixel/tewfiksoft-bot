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
    
    const transporter = nodemailer.createTransport({
      host: s.smtp_host || process.env.SMTP_HOST || 'smtp.gmail.com',
      port: s.smtp_port || process.env.SMTP_PORT || 587,
      secure: s.smtp_port === 465,
      auth: {
        user: s.smtp_user || process.env.SMTP_USER || 'your-email@gmail.com',
        pass: s.smtp_pass || process.env.SMTP_PASS || 'your-password',
      },
    });

    const info = await transporter.sendMail({
      from: `"TewfikSoft HR" <${s.smtp_user || process.env.SMTP_USER || 'your-email@gmail.com'}>`,
      to,
      subject,
      text,
      attachments
    });

    log(`[Email] Message sent: ${info.messageId}`);
    return true;
  } catch (error) {
    log(`[Email-Error] ${error.message}`);
    return false;
  }
}
