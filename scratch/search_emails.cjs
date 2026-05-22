const fs = require('fs');
const path = require('path');

function searchFiles(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (file === 'node_modules' || file === '.git' || file === 'dist' || file === 'scratch' || file === 'CloudBot') continue;
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      searchFiles(fullPath);
    } else if (file.endsWith('.js') || file.endsWith('.ts') || file.endsWith('.json') || file.endsWith('.tsx')) {
      try {
        const content = fs.readFileSync(fullPath, 'utf8');
        const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
        const matches = content.match(emailRegex);
        if (matches) {
          const unique = [...new Set(matches)];
          console.log(`${fullPath}: ${unique.join(', ')}`);
        }
      } catch (err) {
        // ignore
      }
    }
  }
}

searchFiles(path.join(__dirname, '..', '..'));
