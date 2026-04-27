import BaseRole from './BaseRole.js';

export default class AdminRole extends BaseRole {
    async handleStats(chatId, ar) {
        const db = this.loadDB();
        const emps = (db.hr_employees || []).filter(e => e.status === 'active');
        
        if (!emps.length) {
            return this.send(chatId, ar ? '❌ لا يوجد موظفين نشطين حالياً.' : '❌ Aucun employé actif.');
        }

        const now = new Date();
        const stats = {
            total: emps.length,
            companies: {},
            gender: { M: 0, F: 0 },
            age: { '20-30': 0, '30-40': 0, '40-50': 0, '50+': 0 },
            totalExpYears: 0,
            empsWithExp: 0
        };

        emps.forEach(e => {
            // Company
            const cId = e.companyId || 'Unknown';
            stats.companies[cId] = (stats.companies[cId] || 0) + 1;

            // Gender
            if (e.gender === 'M' || e.gender === 'H') stats.gender.M++;
            else if (e.gender === 'F') stats.gender.F++;

            // Age
            if (e.birthDate) {
                const birth = new Date(e.birthDate);
                const age = now.getFullYear() - birth.getFullYear();
                if (age <= 30) stats.age['20-30']++;
                else if (age <= 40) stats.age['30-40']++;
                else if (age <= 50) stats.age['40-50']++;
                else stats.age['50+']++;
            }

            // Experience
            if (e.startDate) {
                const start = new Date(e.startDate);
                const exp = (now - start) / (1000 * 60 * 60 * 24 * 365.25);
                if (exp >= 0) {
                    stats.totalExpYears += exp;
                    stats.empsWithExp++;
                }
            }
        });

        stats.avgExp = stats.empsWithExp > 0 ? (stats.totalExpYears / stats.empsWithExp).toFixed(1) : 0;

        const msg = ar ? this.formatStatsAr(stats) : this.formatStatsFr(stats);
        const kbd = { inline_keyboard: [[{ text: ar ? '⬅️ العودة' : '⬅️ Retour', callback_data: 'menu' }]] };
        
        return this.send(chatId, msg, kbd);
    }

    getProgressBar(percent) {
        const filled = Math.round(percent / 10);
        return '🟩'.repeat(filled) + '⬜'.repeat(10 - filled);
    }

    formatStatsAr(s) {
        const p = (v) => ((v / s.total) * 100).toFixed(1);
        let cText = '';
        for (const [id, count] of Object.entries(s.companies)) {
            const perc = p(count);
            cText += `🏢 <b>شركة ${id}</b>: ${count} موظف\n${this.getProgressBar(perc)} ${perc}%\n\n`;
        }

        return `📊 <b>لوحة تحكم المدير العام</b>\n` +
               `━━━━━━━━━━━━━━\n` +
               `👥 إجمالي الموظفين: <b>${s.total}</b>\n\n` +
               `<b>🏢 التوزيع حسب الشركة:</b>\n${cText}` +
               `<b>🚻 النوع الاجتماعي:</b>\n` +
               `👨 رجال: <b>${s.gender.M}</b>\n${this.getProgressBar(p(s.gender.M))} ${p(s.gender.M)}%\n` +
               `👩 نساء: <b>${s.gender.F}</b>\n${this.getProgressBar(p(s.gender.F))} ${p(s.gender.F)}%\n\n` +
               `<b>🎂 الفئات العمرية:</b>\n` +
               `🟢 20-30 سنة: <b>${s.age['20-30']}</b> (${p(s.age['20-30'])}%)\n` +
               `🟡 30-40 سنة: <b>${s.age['30-40']}</b> (${p(s.age['30-40'])}%)\n` +
               `🟠 40-50 سنة: <b>${s.age['40-50']}</b> (${p(s.age['40-50'])}%)\n` +
               `🔴 فوق 50 سنة: <b>${s.age['50+']}</b> (${p(s.age['50+'])}%)\n\n` +
               `<b>🎖️ الأقدمية والخبرة:</b>\n` +
               `📈 متوسط الخبرة في الشركة: <b>${s.avgExp} سنوات</b>\n` +
               `━━━━━━━━━━━━━━\n` +
               `☁️ <i>تم التحديث من السحابة</i>`;
    }

    formatStatsFr(s) {
        const p = (v) => ((v / s.total) * 100).toFixed(1);
        let cText = '';
        for (const [id, count] of Object.entries(s.companies)) {
            const perc = p(count);
            cText += `🏢 <b>Entreprise ${id}</b>: ${count} emp\n${this.getProgressBar(perc)} ${perc}%\n\n`;
        }

        return `📊 <b>DASHBOARD DG</b>\n` +
               `━━━━━━━━━━━━━━\n` +
               `👥 Total Employés: <b>${s.total}</b>\n\n` +
               `<b>🏢 Distribution par Entreprise:</b>\n${cText}` +
               `<b>🚻 Genre:</b>\n` +
               `👨 Hommes: <b>${s.gender.M}</b>\n${this.getProgressBar(p(s.gender.M))} ${p(s.gender.M)}%\n` +
               `👩 Femmes: <b>${s.gender.F}</b>\n${this.getProgressBar(p(s.gender.F))} ${p(s.gender.F)}%\n\n` +
               `<b>🎂 Tranches d'Âge:</b>\n` +
               `🟢 20-30 ans: <b>${s.age['20-30']}</b> (${p(s.age['20-30'])}%)\n` +
               `🟡 30-40 ans: <b>${s.age['30-40']}</b> (${p(s.age['30-40'])}%)\n` +
               `🟠 40-50 ans: <b>${s.age['40-50']}</b> (${p(s.age['40-50'])}%)\n` +
               `🔴 Plus de 50: <b>${s.age['50+']}</b> (${p(s.age['50+'])}%)\n\n` +
               `<b>🎖️ Ancienneté et Expérience:</b>\n` +
               `📈 Expérience moyenne: <b>${s.avgExp} ans</b>\n` +
               `━━━━━━━━━━━━━━\n` +
               `☁️ <i>Actualisé depuis le Cloud</i>`;
    }
}
