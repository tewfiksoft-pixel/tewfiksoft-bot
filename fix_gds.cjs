const fs = require('fs');
const path = 'g:/Application TEWFIK-SOFT/tewfiksoft/CloudBot/index.js';
let content = fs.readFileSync(path, 'utf8');

const target1 = `📦 <b>المواد المشحونة:</b>\\n\\n\\nيرجى`;
const replace1 = `📦 <b>المواد المشحونة:</b>\\n\${itemsListForGDS}\\n\\nيرجى`;
content = content.replace(target1, replace1);

const target2 = `👤 Par: \${newBva.commercialName}\\n\\nVeuillez`;
const replace2 = `👤 Par: \${newBva.commercialName}\\n\\n📦 <b>Articles à charger :</b>\\n\${itemsListForGDS}\\n\\nVeuillez`;
content = content.replace(target2, replace2);

const target3 = `// Notify GDS Role (Expedition)\\n      const notifyMsg = ar`;
const replace3 = `// Notify GDS Role (Expedition)\\n      const itemsListForGDS = newBva.articles.map(a => \`├ <code>\${a.code}</code> - \${a.prod} (<b>\${a.qty}</b>)\`).join('\\n');\\n      const notifyMsg = ar`;

// Wait, I already added itemsListForGDS declaration in the first replace!
// Let me verify if itemsListForGDS is there.
if (!content.includes('const itemsListForGDS')) {
    content = content.replace(
        `// Notify GDS Role (Expedition)\n      const notifyMsg = ar`,
        `// Notify GDS Role (Expedition)\n      const itemsListForGDS = newBva.articles.map(a => \`├ <code>\${a.code}</code> - \${a.prod} (<b>\${a.qty}</b>)\`).join('\\n');\n      const notifyMsg = ar`
    );
}

fs.writeFileSync(path, content, 'utf8');
console.log('Fixed');
