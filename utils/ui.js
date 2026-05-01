// ─── حساب السنة الجارية (دورة يوليو ─ يونيو) ───
function getCurrentExercice() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1; // 1-12
  if (month >= 7) return `${year}/${year + 1}`;
  return `${year - 1}/${year}`;
}

export function getStatsMsg(db, ar) {
  const activeEx = getCurrentExercice();
  const emps = (db.hr_employees || []).filter(e => e.status === 'active');
  // فلترة أرصدة السنة الجارية فقط
  const currentLeaves = (db.hr_leave_balances || []).filter(l => l.exercice === activeEx);

  let alver = 0, verre_tech = 0, male = 0, female = 0, cdi = 0, cdd = 0;
  let totalAge = 0, ageCount = 0;
  let totalSeniority = 0, senCount = 0;

  emps.forEach(e => {
    const comp = String(e.companyId || '').toLowerCase();
    if (comp.includes('verre') || comp.includes('tech')) verre_tech++; else alver++;
    if (String(e.gender || '').toUpperCase() === 'M') male++; else female++;
    const ct = String(e.contractType || '').toLowerCase();
    if (ct.includes('tit') || ct === 'cdi') cdi++; else cdd++;

    if (e.birthDate) {
      const parts = e.birthDate.split(/[-/]/);
      let year = null;
      if (parts.length === 3) { year = parts[2].length === 4 ? parseInt(parts[2]) : parseInt(parts[0]); }
      else if (parts.length === 1 && parts[0].length === 4) { year = parseInt(parts[0]); }
      if (year && year > 1900 && year <= new Date().getFullYear()) {
        totalAge += (new Date().getFullYear() - year);
        ageCount++;
      }
    }

    if (e.startDate) {
      const parts = e.startDate.split(/[-/]/);
      let sYear = null;
      if (parts.length === 3) { sYear = parts[2].length === 4 ? parseInt(parts[2]) : parseInt(parts[0]); }
      else if (parts.length === 1 && parts[0].length === 4) { sYear = parseInt(parts[0]); }
      if (sYear && sYear > 1900 && sYear <= new Date().getFullYear()) {
        totalSeniority += (new Date().getFullYear() - sYear);
        senCount++;
      }
    }
  });

  const avgAge = ageCount > 0 ? Math.round(totalAge / ageCount) : 0;
  const avgExp = senCount > 0 ? (totalSeniority / senCount).toFixed(1) : 0;

  // أرصدة العطل للسنة الجارية فقط
  let alLeave = 0, vtLeave = 0, alLeaveCount = 0, vtLeaveCount = 0;
  currentLeaves.forEach(l => {
    const r = parseFloat(l.remainingDays || 0);
    const comp = String(l.companyId || '').toLowerCase();
    if (comp.includes('verre') || comp.includes('tech')) { vtLeave += r; vtLeaveCount++; }
    else { alLeave += r; alLeaveCount++; }
  });

  return ar
    ? `📊 <b>إحصائيات الإدارة العليا | ALVER & VERRE TECH</b>\n━━━━━━━━━━━━━━\n🏢 ALVER: <b>${alver}</b> 🟢\n🏢 VERRE TECH: <b>${verre_tech}</b> 🔵\n━━━━━━━━━━━━━━\n👥 إجمالي العمال النشطين: <b>${emps.length}</b>\n👦 رجال: <b>${male}</b> | 👧 نساء: <b>${female}</b>\n📜 عقود دائمة (CDI/Titulaire): <b>${cdi}</b>\n⏱️ عقود مؤقتة (CDD): <b>${cdd}</b>\n━━━━━━━━━━━━━━\n🏖️ <b>أرصدة العطل السنوية (${activeEx}):</b>\n├ 🟢 ALVER: <b>${alLeave.toFixed(1)} يوم</b> (${alLeaveCount} موظف)\n└ 🔵 Verre Tech: <b>${vtLeave.toFixed(1)} يوم</b> (${vtLeaveCount} موظف)\n━━━━━━━━━━━━━━\n🎂 متوسط العمر: <b>${avgAge} سنة</b>\n⏳ متوسط الأقدمية: <b>${avgExp} سنة</b>\n━━━━━━━━━━━━━━`
    : `📊 <b>STATS DIRECTION GÉNÉRALE | ALVER & VERRE TECH</b>\n━━━━━━━━━━━━━━\n🏢 ALVER: <b>${alver}</b> 🟢\n🏢 VERRE TECH: <b>${verre_tech}</b> 🔵\n━━━━━━━━━━━━━━\n👥 Effectif Total Actif: <b>${emps.length}</b>\n👦 Hommes: <b>${male}</b> | 👧 Femmes: <b>${female}</b>\n📜 Contrats CDI/Titulaire: <b>${cdi}</b>\n⏱️ Contrats CDD: <b>${cdd}</b>\n━━━━━━━━━━━━━━\n🏖️ <b>Soldes Congés (${activeEx}):</b>\n├ 🟢 ALVER: <b>${alLeave.toFixed(1)} j</b> (${alLeaveCount} employés)\n└ 🔵 Verre Tech: <b>${vtLeave.toFixed(1)} j</b> (${vtLeaveCount} employés)\n━━━━━━━━━━━━━━\n🎂 Moyenne d'âge: <b>${avgAge} ans</b>\n⏳ Expérience Moyenne: <b>${avgExp} ans</b>\n━━━━━━━━━━━━━━`;
}

export function getEffectifsDirMsg(db, ar) {
  const emps = (db.hr_employees || []).filter(e => e.status === 'active');
  const activeEx = getCurrentExercice();
  const currentLeaves = (db.hr_leave_balances || []).filter(l => l.exercice === activeEx);

  // بناء قاموس الموظف → مبلغ العطل المتبقي
  const leaveByEmp = {};
  currentLeaves.forEach(l => {
    leaveByEmp[String(l.employeeId)] = parseFloat(l.remainingDays || 0);
  });

  const dirs = {};
  emps.forEach(e => {
    let dir = ar ? (e.direction_ar || e.direction_fr || 'أخرى') : (e.direction_fr || e.direction_ar || 'Autre');
    dir = dir.trim().toUpperCase();
    if (!dir) dir = ar ? 'أخرى' : 'Autre';

    if (!dirs[dir]) dirs[dir] = { cdi: 0, cdd: 0, total: 0, totalLeave: 0 };

    const ct = String(e.contractType || '').toLowerCase();
    if (ct.includes('tit') || ct === 'cdi') dirs[dir].cdi++; else dirs[dir].cdd++;
    dirs[dir].total++;

    const empLeave = leaveByEmp[String(e.id)] || 0;
    dirs[dir].totalLeave += empLeave;
  });

  const sortedDirs = Object.keys(dirs).sort((a, b) => dirs[b].total - dirs[a].total);

  let totalAll = 0;
  let msg = ar
    ? `👥 <b>تعداد العمال النشطين حسب المديرية</b>\n<code>الدورة: ${activeEx}</code>\n━━━━━━━━━━━━━━\n`
    : `👥 <b>EFFECTIFS ACTIFS PAR DIRECTION</b>\n<code>Exercice: ${activeEx}</code>\n━━━━━━━━━━━━━━\n`;

  for (const d of sortedDirs) {
    const s = dirs[d];
    totalAll += s.total;
    const leaveStr = s.totalLeave > 0
      ? ` | 🏖️ <b>${s.totalLeave.toFixed(0)}</b>${ar ? ' يوم' : 'j'}`
      : '';
    msg += `🏢 <b>${d}</b>: ${s.total} ${ar ? 'عامل' : 'emp.'}${leaveStr}\n`;
    msg += `   ├ 📜 CDI: <b>${s.cdi}</b>  ⏱️ CDD: <b>${s.cdd}</b>\n\n`;
  }
  msg += `━━━━━━━━━━━━━━\n`;
  msg += ar
    ? `📌 <b>المجموع: ${totalAll} عامل نشط</b>`
    : `📌 <b>TOTAL: ${totalAll} employés actifs</b>`;
  return msg;
}
