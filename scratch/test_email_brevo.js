import { sendEmail } from '../utils/email.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function runTest() {
  console.log('--- TEST EMAIL BREVO ---');
  const to = 'tewfik.nouar@alver.dz';
  const subject = 'Test Email from TewfikSoft HR Bot';
  const text = 'Hello! This is a test email to verify the Brevo SMTP configuration.\n\nIf you receive this, it means the connection is working correctly.';
  
  console.log(`Sending test email to: ${to}...`);
  const success = await sendEmail(to, subject, text);
  
  if (success) {
    console.log('✅ TEST SUCCESSFUL! Please check your inbox.');
  } else {
    console.log('❌ TEST FAILED. Check the logs/console for errors.');
  }
}

runTest();
