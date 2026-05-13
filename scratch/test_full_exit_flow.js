import { generateAndSendExitAuth } from '../index.js';
import { loadConfig } from '../utils/database.js';

async function testFullFlow() {
  console.log('--- SIMULATING FULL EXIT FLOW ---');
  
  const dummyRequest = {
    id: 'test-' + Date.now(),
    empName: 'MOHAMED BENALI',
    companyName: 'Algérienne des Verres (ALVER)',
    exitType: 'Service',
    reason: 'Mission de travail à la banque',
    exitTime: '10:00',
    createdAt: new Date().toISOString(),
    managerName: 'Tewfik Nouar',
    adminApprovedBy: 'RH Administration',
    guardConfirmedBy: 'Agent Sécurité',
    guardConfirmedAt: new Date().toISOString(),
    managerId: null,
    status: 'out'
  };

  const config = {
    email_settings: {
        smtp_host: "smtp-relay.brevo.com",
        smtp_port: 587,
        smtp_user: "ab23a7001@smtp-brevo.com",
        smtp_pass: "K0QcwMtUqzhSgX75",
        hr_notification_email: "tewfik.nouar@alver.dz"
    }
  };

  console.log('Generating PDF and sending email to tewfik.nouar@alver.dz...');
  try {
    await generateAndSendExitAuth(dummyRequest, config);
    console.log('✅ SUCCESS! Check your email for the premium report and PDF.');
  } catch (e) {
    console.error('❌ FAILED:', e.message);
  }
}

testFullFlow();
