export default class BaseRole {
    constructor(botContext) {
        this.ctx = botContext;
    }

    T(s) { return String(s || '').trim() || '—'; }

    async send(chatId, text, keyboard) {
        return this.ctx.send(chatId, text, keyboard);
    }

    loadDB() { return this.ctx.loadDB(); }
    loadConfig() { return this.ctx.loadConfig(); }
}
