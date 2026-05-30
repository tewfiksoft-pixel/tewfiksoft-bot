const fs = require('fs');
let c = fs.readFileSync('utils/database.js', 'utf8');

c = c.replace('export const loadDB = () => {', 'let _dbCache = null;\nlet _dbMtime = 0;\n\nexport const loadDB = () => {');
c = c.replace("const raw = fs.readFileSync(DB_PATH, 'utf8');", "const mtime = fs.statSync(DB_PATH).mtimeMs;\n    if (_dbCache && mtime === _dbMtime) return _dbCache;\n    const raw = fs.readFileSync(DB_PATH, 'utf8');");
c = c.replace('return JSON.parse(plain);', '_dbCache = JSON.parse(plain);\n    _dbMtime = mtime;\n    return _dbCache;');

fs.writeFileSync('utils/database.js', c);
console.log('Done replacing loadDB');
