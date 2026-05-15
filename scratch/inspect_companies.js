import fs from 'fs';
import path from 'path';

const dbPath = './data/database.json';
const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));

console.log('Companies:', JSON.stringify(db.hr_companies, null, 2));
