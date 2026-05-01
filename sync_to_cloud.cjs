// sync_to_cloud.cjs - Decrypt locally, send plain JSON to cloud
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const zlib = require('zlib');

const SALT = "tewfiksoft_hr_salt_2026";
const PASSWORD = "nouar2026";
const CLOUD_URL = "tewfiksoft-hr-bot.onrender.com";

function decrypt(ciphertext64, password) {
    const key = crypto.pbkdf2Sync(password, SALT, 100000, 32, 'sha256');
    const data = Buffer.from(ciphertext64, 'base64');
    const iv = data.slice(0, 12);
    const encryptedAndTag = data.slice(12);
    const encrypted = encryptedAndTag.slice(0, encryptedAndTag.length - 16);
    const tag = encryptedAndTag.slice(encryptedAndTag.length - 16);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(encrypted, 'binary', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

function postData(urlPath, body) {
    return new Promise((resolve, reject) => {
        const data = Buffer.from(body, 'utf8');
        console.log(`  Sending to ${urlPath}: ${data.length} bytes (plain JSON)`);
        const req = https.request({
            hostname: CLOUD_URL, path: urlPath, method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': data.length }
        }, (res) => {
            let d = ''; res.on('data', c => d += c);
            res.on('end', () => { console.log(`  Response: ${res.statusCode} ${d}`); resolve(res.statusCode); });
        });
        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

async function main() {
    console.log('=== TewfikSoft Cloud Sync Tool ===\n');

    // 1. Read and decrypt database
    const dbPath = path.join(__dirname, '..', 'HR_Manager_Professional_Edition', 'ServerData', 'database.json');
    console.log('1. Reading database from:', dbPath);
    const encryptedContent = fs.readFileSync(dbPath, 'utf8');
    console.log(`   Encrypted size: ${encryptedContent.length} bytes`);
    
    let dbJson;
    if (encryptedContent.trim().startsWith('{')) {
        dbJson = encryptedContent;
        console.log('   Database is already plain JSON.');
    } else {
        const decrypted = decrypt(encryptedContent, PASSWORD);
        if (!decrypted) { console.error('DECRYPT FAILED!'); process.exit(1); }
        dbJson = decrypted;
        const db = JSON.parse(decrypted);
        console.log(`   Decrypted OK! Found ${db.hr_employees?.length || 0} employees.`);
        
        // Show sample
        if (db.hr_employees?.length > 0) {
            const e = db.hr_employees[0];
            console.log(`   Sample: ${e.clockingId} - ${e.lastName_fr} ${e.firstName_fr}`);
        }
    }

    // 2. Read config
    const cfgPath = path.join(__dirname, '..', 'HR_Manager_Professional_Edition', 'telegram_config.json');
    console.log('\n2. Reading config from:', cfgPath);
    const cfgJson = fs.readFileSync(cfgPath, 'utf8');
    const cfg = JSON.parse(cfgJson);
    console.log(`   Found ${cfg.authorized_users?.length || 0} authorized users.`);

    // 3. Send config
    console.log('\n3. Sending config to cloud...');
    await postData('/api/config', cfgJson);

    // 4. Send decrypted database
    console.log('\n4. Sending decrypted database to cloud (Render)...');
    await postData('/api/database', dbJson);

    // 5. Send decrypted database to Google Drive (Persistent Storage)
    console.log('\n5. Sending decrypted database to Google Drive (Persistent Backup)...');
    const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxcj4K0p4FLgGGchC9oe4q95fLnHipbaUXN6hcQsCMDyR7ITH1ozIEF9Dk3SkEujt0njw/exec';
    try {
        const res = await fetch(GOOGLE_SCRIPT_URL, {
            method: 'POST',
            body: dbJson,
            headers: { 'Content-Type': 'application/json' }
        });
        console.log(`   Google Drive Response: ${res.status}`);
    } catch (e) {
        console.error('   Google Drive Sync Failed:', e.message);
    }

    console.log('\n=== SYNC COMPLETE ===');
}

main().catch(e => console.error('FATAL:', e));
