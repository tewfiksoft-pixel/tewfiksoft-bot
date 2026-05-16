import nodemailer from 'nodemailer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8'));
const s = config.email_settings || {};

const host = 'smtp-relay.brevo.com';
const user = 'ab23a7001@smtp-brevo.com';
const pass = 'K0QcwMtUqzhSgX75';
const port = 465;

console.log(`Testing SMTP with:
Host: ${host}
Port: ${port}
User: ${user}
Pass: ${pass.substring(0, 3)}...`);

async function test() {
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: true,
    auth: { user, pass },
    debug: true,
    logger: true
  });

  try {
    const info = await transporter.sendMail({
      from: '"Test" <tewfiksoft@gmail.com>',
      to: 'tewfiksoft@gmail.com',
      subject: 'SMTP Test from Antigravity',
      text: 'This is a test to verify Brevo SMTP credentials.'
    });
    console.log('SUCCESS!', info.messageId);
  } catch (err) {
    console.error('FAILED!', err.message);
    if (err.response) console.error('Response:', err.response);
  }
}

test();
