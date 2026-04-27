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
            exp: { '0-5y': 0, '5-10y': 0, '10-20y': 0, '20y+': 0 }
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
                const exp = now.getFullYear() - start.getFullYear();
                if (exp <= 5) stats.exp['0-5y']++;
                else if (exp <= 10) stats.exp['5-10y']++;
                else if (exp <= 20) stats.exp['10-20y']++;
                else stats.exp['20y+']++;
            }
        });

        const msg = ar ? this.formatStatsAr(stats) : this.formatStatsFr(stats);
        const kbd = { inline_keyboard: [[{ text: ar ? '⬅️ العودة' : '⬅️ Retour', callback_data: 'menu' }]] };
        
        return this.send(chatId, msg, kbd);
    }

    formatStatsAr(s) {
        const p = (v) => ((v / s.total) * 100).toFixed(1);
        let cText = '';
        for (const [id, count] of Object.entries(s.companies)) {
            cText += `🏢 شركة ${id}: <b>${count}</b> (${p(count)}%)\n`;
        }

        return `📊 <b>لوحة تحكم المدير العام</b>\n` +
               `━━━━━━━━━━━━━━\n` +
               `👥 إجمالي الموظفين: <b>${s.total}</b>\n\n` +
               `<b>🏢 التوزيع حسب الشركة:</b>\n${cText}\n` +
               `<b>🚻 النوع الاجتماعي:</b>\n` +
               `👨 رجال: <b>${s.gender.M}</b> (${p(s.gender.M)}%)\n` +
               `👩 نساء: <b>${s.gender.F}</b> (${p(s.gender.F)}%)\n\n` +
               `<b>🎂 الفئات العمرية:</b>\n` +
               `🟢 20-30 سنة: <b>${s.age['20-30']}</b>\n` +
               `🟡 30-40 سنة: <b>${s.age['30-40']}</b>\n` +
               `🟠 40-50 سنة: <b>${s.age['40-50']}</b>\n` +
               `🔴 فوق 50 سنة: <b>${s.age['50+']}</b>\n\n` +
               `<b>🎖️ سنوات الخبرة:</b>\n` +
               `🥉 حديث (0-5): <b>${s.exp['0-5y']}</b>\n` +
               `🥈 متوسط (5-10): <b>${s.exp['5-10y']}</b>\n` +
               `🥇 خبير (10-20): <b>${s.exp['10-20y']}</b>\n` +
               `🏆 أقدمية (20+): <b>${s.exp['20y+']}</b>\n` +
               `━━━━━━━━━━━━━━\n` +
               `☁️ <i>تم التحديث من السحابة</i>`;
    }

    formatStatsFr(s) {
        const p = (v) => ((v / s.total) * 100).toFixed(1);
        let cText = '';
        for (const [id, count] of Object.entries(s.companies)) {
            cText += `🏢 Entreprise ${id}: <b>${count}</b> (${p(count)}%)\n`;
        }

        return `📊 <b>DASHBOARD DG</b>\n` +
               `━━━━━━━━━━━━━━\n` +
               `👥 Total Employés: <b>${s.total}</b>\n\n` +
               `<b>🏢 Distribution par Entreprise:</b>\n${cText}\n` +
               `<b>🚻 Genre:</b>\n` +
               `👨 Hommes: <b>${s.gender.M}</b> (${p(s.gender.M)}%)\n` +
               `👩 Femmes: <b>${s.gender.F}</b> (${p(s.gender.F)}%)\n\n` +
               `<b>🎂 Tranches d'Âge:</b>\n` +
               `🟢 20-30 ans: <b>${s.age['20-30']}</b>\n` +
               `🟡 30-40 ans: <b>${s.age['30-40']}</b>\n` +
               `🟠 40-50 ans: <b>${s.age['40-50']}</b>\n` +
               `🔴 Plus de 50: <b>${s.age['50+']}</b>\n\n` +
               `<b>🎖️ Expérience:</b>\n` +
               `🥉 Junior (0-5): <b>${s.exp['0-5y']}</b>\n` +
               `🥈 Intermédiaire: <b>${s.exp['5-10y']}</b>\n` +
               `🥇 Expert: <b>${s.exp['10-20y']}</b>\n` +
               `🏆 Senior (20+): <b>${s.exp['20y+']}</b>\n` +
               `━━━━━━━━━━━━━━\n` +
               `☁️ <i>Actualisé depuis le Cloud</i>`;
    }
}
