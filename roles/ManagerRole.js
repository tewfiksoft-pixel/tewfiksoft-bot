const BaseRole = require('./BaseRole.js');

class ManagerRole extends BaseRole {
    constructor(ctx) {
        super(ctx);
    }

    async handleTeamList(chatId, ar, user) {
        const db = this.loadDB();
        if (!db || !db.hr_employees) {
            return this.send(chatId, ar ? '❌ لا توجد بيانات مسجلة حالياً.' : '❌ Aucune donnée trouvée.');
        }

        // Get visible employees for this manager
        const visibleEmps = this.getVisibleEmployees(user, db);

        if (visibleEmps.length === 0) {
            return this.send(chatId, ar ? '⚠️ لا يوجد أي موظفين مبرمجين لك حالياً.' : '⚠️ Aucun employé ne vous est assigné.');
        }

        // If the list is too long, we might need pagination, but let's send them in batches of 20
        const chunkSize = 20;
        let count = 0;
        let kbd = [];

        // Title message
        const titleMsg = ar 
            ? `👥 <b>قائمة موظفي فريقي</b>\n━━━━━━━━━━━━━━\nالعدد الإجمالي: <b>${visibleEmps.length}</b> موظف\n\nاختر الموظف لعرض ملفه أو تقديم طلب:`
            : `👥 <b>Mon Équipe</b>\n━━━━━━━━━━━━━━\nTotal: <b>${visibleEmps.length}</b> employés\n\nChoisissez un employé :`;
        
        await this.send(chatId, titleMsg);

        for (const emp of visibleEmps) {
            const name = ar ? `${this.T(emp.firstName_ar)} ${this.T(emp.lastName_ar)}` : `${this.T(emp.firstName_fr)} ${this.T(emp.lastName_fr)}`;
            kbd.push([{text: `👤 ${name} (${emp.clockingId})`, callback_data: `emp:${emp.id}`}]);
            
            count++;
            // Send keyboard in chunks of 20 buttons to avoid Telegram limits
            if (count % chunkSize === 0 || count === visibleEmps.length) {
                await this.send(chatId, ar ? '👇 اختر من القائمة:' : '👇 Choisissez :', { inline_keyboard: kbd });
                kbd = [];
            }
        }
    }

    getVisibleEmployees(user, db) {
        if (user.role === 'general_manager' || user.role === 'admin') return (db.hr_employees||[]).filter(e=>e.status==='active');
        const myId = user.allowed_employees?.[0] || user.id;
        if (user.role === 'employee' || user.role === 'gestionnaire_rh' || user.scope === 'self') {
            return (db.hr_employees||[]).filter(e=>e.status==='active' && String(e.clockingId) === String(myId));
        }
        return (db.hr_employees||[]).filter(e => {
            if(e.status !== 'active') return false;
            if (user.scope === 'all') return true;
            if (user.scope === 'department') {
                const depts = user.allowed_departments || [];
                return depts.includes(e.department_fr) || depts.includes(e.department_ar);
            }
            if (user.scope === 'custom_employees') {
                const emps = user.allowed_employees || [];
                return emps.includes(String(e.clockingId));
            }
            return false;
        });
    }
}

module.exports = ManagerRole;
