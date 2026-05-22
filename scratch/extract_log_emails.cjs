const fs = require('fs');
const path = require('path');

const logPath = path.join(__dirname, '..', 'bot_debug.log');
if (fs.existsSync(logPath)) {
  const content = fs.readFileSync(logPath, 'utf8');
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const matches = content.match(emailRegex) || [];
  const unique = [...new Set(matches)];
  console.log("Emails found in bot_debug.log:", unique.join(', '));
} else {
  console.log("bot_debug.log does not exist");
}
