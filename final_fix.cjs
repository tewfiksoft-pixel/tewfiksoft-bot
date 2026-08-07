const fs = require('fs');
const path = 'g:/Application TEWFIK-SOFT/tewfiksoft/CloudBot/index.js';
let content = fs.readFileSync(path, 'utf8');

const badLine = `const itemsListForGDS = newBva.articles.map(a => ├ <code></code> -  (<b></b>)).join('\\n');\\n      const notifyMsg = ar`;
const goodLine = `const itemsListForGDS = newBva.articles.map(a => \`├ <code>\${a.code}</code> - \${a.prod} (<b>\${a.qty}</b>)\`).join('\\n');\n      const notifyMsg = ar`;

content = content.replace(badLine, goodLine);

fs.writeFileSync(path, content, 'utf8');
console.log('Final fix applied');
