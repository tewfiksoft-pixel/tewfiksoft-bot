export function getStatsMsg(db, ar) {
  const emps = db.hr_employees || [];
  const leaves = db.hr_leave_balances || [];
  
  let alver = 0, verre_tech = 0, male = 0, female = 0, cdi = 0, cdd = 0;
  let totalAge = 0, ageCount = 0;
  
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
  });
  
  const avgAge = ageCount > 0 ? Math.round(totalAge / ageCount) : 0;
  
  let totalLeaveDays = 0;
  leaves.forEach(l => {
    const r = parseFloat(l.remainingDays);
    if (!isNaN(r)) totalLeaveDays += r;
  });

  return ar
    ? `📊 <b>إحصائيات الإدارة العليا | ALVER & VERRE TECH</b>\n━━━━━━━━━━━━━━\n🏢 ALVER: <b>${alver}</b> 🟢\n🏢 VERRE TECH: <b>${verre_tech}</b> 🔵\n━━━━━━━━━━━━━━\n👥 إجمالي العمال: <b>${emps.length}</b>\n👦 رجال: <b>${male}</b> | 👧 نساء: <b>${female}</b>\n📜 العقود الدائمة (CDI/Titulaire): <b>${cdi}</b>\n⏱️ العقود المؤقتة (CDD): <b>${cdd}</b>\n━━━━━━━━━━━━━━\n🎂 متوسط العمر: <b>${avgAge} سنة</b>\n🏖️ إجمالي العطل المتبقية: <b>${totalLeaveDays} يوم</b>\n━━━━━━━━━━━━━━`
    : `📊 <b>STATS DIRECTION GÉNÉRALE | ALVER & VERRE TECH</b>\n━━━━━━━━━━━━━━\n🏢 ALVER: <b>${alver}</b> 🟢\n🏢 VERRE TECH: <b>${verre_tech}</b> 🔵\n━━━━━━━━━━━━━━\n👥 Effectif Total: <b>${emps.length}</b>\n👦 Hommes: <b>${male}</b> | 👧 Femmes: <b>${female}</b>\n📜 Contrats CDI/Titulaire: <b>${cdi}</b>\n⏱️ Contrats CDD: <b>${cdd}</b>\n━━━━━━━━━━━━━━\n🎂 Moyenne d'âge: <b>${avgAge} ans</b>\n🏖️ Total Congés Restants: <b>${totalLeaveDays} jours</b>\n━━━━━━━━━━━━━━`;
}
