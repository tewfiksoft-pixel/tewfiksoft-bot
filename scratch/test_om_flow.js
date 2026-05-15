import { handle } from '../index.js';
import fs from 'fs';
import path from 'path';

// Mock Telegram context
const mockUpdate = {
  callback_query: {
    id: '123',
    from: { id: 8626592284, first_name: 'Tewfik', username: 'tewfik' },
    message: { chat: { id: 8626592284 }, message_id: 1, text: 'Menu' },
    data: 'auth_menu'
  }
};

console.log('Testing auth_menu response...');
handle(mockUpdate).then(res => {
  console.log('Response sent (check logs/console).');
}).catch(err => {
  console.error('Error in handle:', err);
});
