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
    const apiKey = s.smtp_pass || process.env.BREVO_API_KEY;

    if (!apiKey) {
      log("[Email-Error] Brevo API Key (smtp_pass) is missing.");
      return false;
    }

    const payload = {
      sender: { name: "TewfikSoft HR", email: "tewfiksoft@gmail.com" },
      to: [{ email: to }],
      subject: subject,
      textContent: text,
      attachment: attachments.map(a => ({
        content: fs.readFileSync(a.path).toString('base64'),
        name: a.filename
      }))
    };

    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': apiKey,
        'content-type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const result = await response.json();
    if (response.ok) {
      log(`[Email] API Success: Sent to ${to} | MsgID: ${result.messageId}`);
      return true;
    } else {
      log(`[Email-API-Error] ${JSON.stringify(result)}`);
      return false;
    }
  } catch (error) {
    log(`[Email-Error] API Exception: ${error.message}`);
    return false;
  }
}
