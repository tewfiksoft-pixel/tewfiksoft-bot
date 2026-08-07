const fs = require('fs');
const path = 'g:/Application TEWFIK-SOFT/tewfiksoft/CloudBot/index.js';
let content = fs.readFileSync(path, 'utf8');

// Insert itemsListForGDS before `const notifyMsg = ar`
if (!content.includes('const itemsListForGDS = newBva.articles.map')) {
    content = content.replace(
        '// Notify GDS Role (Expedition)\n      const notifyMsg = ar',
        '// Notify GDS Role (Expedition)\n      const itemsListForGDS = newBva.articles.map(a => `├ <code>${a.code}</code> - ${a.prod} (<b>${a.qty}</b>)`).join(\'\\n\');\n      const notifyMsg = ar'
    );
    fs.writeFileSync(path, content, 'utf8');
    console.log('Fixed variable declaration');
} else {
    console.log('Variable already declared');
}
