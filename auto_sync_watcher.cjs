// auto_sync_watcher.cjs
// يراقب قاعدة البيانات ويزامنها مع البوت تلقائياً عند أي تغيير
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const DB_PATH = path.join(__dirname, '..', 'HR_Manager_Professional_Edition', 'ServerData', 'database.json');
const SYNC_SCRIPT = path.join(__dirname, 'sync_to_cloud.cjs');

let syncTimeout = null;
let lastSize = 0;

console.log('🔄 TewfikSoft Auto-Sync Watcher Started');
console.log(`📁 Watching: ${DB_PATH}`);
console.log('⏳ Will sync 5 seconds after any change...\n');

function runSync() {
  console.log(`[${new Date().toLocaleTimeString()}] 🚀 Change detected! Starting sync...`);
  try {
    execSync(`node "${SYNC_SCRIPT}"`, { stdio: 'inherit' });
    console.log(`[${new Date().toLocaleTimeString()}] ✅ Sync complete!\n`);
  } catch (e) {
    console.error(`[${new Date().toLocaleTimeString()}] ❌ Sync failed: ${e.message}\n`);
  }
}

if (!fs.existsSync(DB_PATH)) {
  console.error(`❌ Database not found at: ${DB_PATH}`);
  process.exit(1);
}

// Watch with polling (more reliable on Windows)
fs.watchFile(DB_PATH, { interval: 3000 }, (curr, prev) => {
  if (curr.mtime > prev.mtime || curr.size !== prev.size) {
    if (syncTimeout) clearTimeout(syncTimeout);
    syncTimeout = setTimeout(runSync, 5000); // wait 5s after last change
    console.log(`[${new Date().toLocaleTimeString()}] 📝 Database modified, syncing in 5s...`);
  }
});

// Also run initial sync on startup
console.log('▶️  Running initial sync...');
runSync();
