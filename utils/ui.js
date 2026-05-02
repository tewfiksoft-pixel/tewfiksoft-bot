// ─── حساب السنة الجارية (دورة يوليو ─ يونيو) ───
function getCurrentExercice() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1; // 1-12
  if (month >= 7) return `${year}/${year + 1}`;
  return `${year - 1}/${year}`;
}

// ─── مساعد: تحديد الشركة بشكل صحيح ───
function isVerreTech(companyId) {
  const c = String(companyId || '').toLowerCase().replace(/[_\s-]/g, '');
  return c.includes('verre') || c.includes('tech') || c === 'verretech' || c === 'vt';
}

function parseDateRobust(dateStr) {
  if (!dateStr) return new Date(NaN);
  const cleaned = dateStr.trim();
  if (cleaned.includes('/') || (cleaned.includes('-') && cleaned.split('-')[0].length < 4)) {
    const separator = cleaned.includes('/') ? '/' : '-';
    const parts = cleaned.split(separator);
    if (parts.length === 3) {
      const d = parts[0].padStart(2, '0');
      const m = parts[1].padStart(2, '0');
      const y = parts[2];
      return new Date(`${y}-${m}-${d}T00:00:00Z`);
    }
  }
  return new Date(cleaned.includes('T') ? cleaned : `${cleaned}T00:00:00Z`);
}

export function calculateAutoLeave(recruitmentDate, exercice) {
  try {
    const [startYearStr, endYearStr] = exercice.split('/');
    const exStart = new Date(`${startYearStr}-07-01T00:00:00Z`);
    const exEnd = new Date(`${endYearStr}-06-30T23:59:59Z`);
    const hireDate = parseDateRobust(recruitmentDate);
    if (isNaN(hireDate.getTime())) return 0;
    if (hireDate > exEnd) return 0;
    const now = new Date();
    const nowUTC = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    if (nowUTC < exStart) return 0;
    const effectiveStart = hireDate > exStart ? hireDate : exStart;
    const effectiveEnd = nowUTC < exEnd ? nowUTC : exEnd;
    if (effectiveStart > effectiveEnd) return 0;
    let curM = effectiveStart.getUTCMonth();
    let curY = effectiveStart.getUTCFullYear();
    if (hireDate > exStart && hireDate.getUTCDate() >= 16) {
      curM++; if (curM > 11) { curM = 0; curY++; }
    }
    let workMonths = 0;
    const targetM = effectiveEnd.getUTCMonth();
    const targetY = effectiveEnd.getUTCFullYear();
    while (curY < targetY || (curY === targetY && curM <= targetM)) {
      workMonths++; curM++; if (curM > 11) { curM = 0; curY++; }
    }
    return Math.min(30, Math.min(12, workMonths) * 2.5);
  } catch { return 0; }
}

export function getStatsMsg(db, ar) {
  const activeEx = getCurrentExercice();
  const allEmps = (db.hr_employees || []);
  const emps = allEmps.filter(e => e.status === 'active');

  // خريطة: empId → employee (للبحث السريع)
  const empMap = {};
  emps.forEach(e => { empMap[String(e.id)] = e; });

  let alver = 0, verre_tech = 0, male = 0, female = 0, cdi = 0, cdd = 0;
  let totalAge = 0, ageCount = 0;
  let totalSeniority = 0, senCount = 0;

  emps.forEach(e => {
    if (isVerreTech(e.companyId)) verre_tech++; else alver++;
    if (String(e.gender || '').toUpperCase() === 'M') male++; else female++;
    const ct = String(e.contractType || '').toLowerCase();
    if (ct.includes('tit') || ct === 'cdi') cdi++; else cdd++;

    if (e.birthDate) {
      const parts = e.birthDate.split(/[-/]/);
      let year = null;
      if (parts.length === 3) { year = parts[2].length === 4 ? parseInt(parts[2]) : parseInt(parts[0]); }
      else if (parts.length === 1 && parts[0].length === 4) { year = parseInt(parts[0]); }
      if (year && year > 1900 && year <= new Date().getFullYear()) {
        totalAge += (new Date().getFullYear() - year); ageCount++;
      }
    }

    if (e.startDate) {
      const parts = e.startDate.split(/[-/]/);
      let sYear = null;
      if (parts.length === 3) { sYear = parts[2].length === 4 ? parseInt(parts[2]) : parseInt(parts[0]); }
      else if (parts.length === 1 && parts[0].length === 4) { sYear = parseInt(parts[0]); }
      if (sYear && sYear > 1900 && sYear <= new Date().getFullYear()) {
        totalSeniority += (new Date().getFullYear() - sYear); senCount++;
      }
    }
  });

  const avgAge = ageCount > 0 ? Math.round(totalAge / ageCount) : 0;
  const avgExp = senCount > 0 ? (totalSeniority / senCount).toFixed(1) : 0;

  // ─── أرصدة العطل: الإجمالي التراكمي لكل السنوات ───
  const seenAlver = new Set();
  const seenVt = new Set();
  let alLeave = 0, vtLeave = 0;

  // 1. جمع الأرصدة اليدوية من قاعدة البيانات (لكل السنوات المتاحة)
  (db.hr_leave_balances || []).forEach(l => {
    const empId = String(l.employeeId);
    const emp = empMap[empId];
    if (!emp) return;

    const r = parseFloat(l.remainingDays || 0);
    if (isVerreTech(emp.companyId)) {
      vtLeave += r;
      seenVt.add(empId);
    } else {
      alLeave += r;
      seenAlver.add(empId);
    }
  });

  // 2. إضافة الرصيد التلقائي للسنة الجارية للموظفين الذين لم يسبق لهم الحصول على رصيد يدوي أبداً
  emps.forEach(emp => {
    const empId = String(emp.id);
    if (isVerreTech(emp.companyId)) {
      if (!seenVt.has(empId)) {
        const auto = calculateAutoLeave(emp.startDate, activeEx);
        vtLeave += auto;
        seenVt.add(empId);
      }
    } else {
      if (!seenAlver.has(empId)) {
        const auto = calculateAutoLeave(emp.startDate, activeEx);
        alLeave += auto;
        seenAlver.add(empId);
      }
    }
  });

  return ar
    ? `📊 <b>إحصائيات الإدارة العليا | ALVER & VERRE TECH</b>\n━━━━━━━━━━━━━━\n🏢 ALVER: <b>${alver}</b> 🟢\n🏢 VERRE TECH: <b>${verre_tech}</b> 🔵\n━━━━━━━━━━━━━━\n👥 إجمالي العمال النشطين: <b>${emps.length}</b>\n👦 رجال: <b>${male}</b> | 👧 نساء: <b>${female}</b>\n📜 عقود دائمة (CDI/Titulaire): <b>${cdi}</b>\n⏱️ عقود مؤقتة (CDD): <b>${cdd}</b>\n━━━━━━━━━━━━━━\n🏖️ <b>أرصدة العطل الإجمالية (تراكمي):</b>\n├ 🟢 ALVER: <b>${alLeave.toFixed(1)} يوم</b> (${seenAlver.size} موظف)\n└ 🔵 Verre Tech: <b>${vtLeave.toFixed(1)} يوم</b> (${seenVt.size} موظف)\n━━━━━━━━━━━━━━\n🎂 متوسط العمر: <b>${avgAge} سنة</b>\n⏳ متوسط الأقدمية: <b>${avgExp} سنة</b>\n━━━━━━━━━━━━━━`
    : `📊 <b>STATS DIRECTION GÉNÉRALE | ALVER & VERRE TECH</b>\n━━━━━━━━━━━━━━\n🏢 ALVER: <b>${alver}</b> 🟢\n🏢 VERRE TECH: <b>${verre_tech}</b> 🔵\n━━━━━━━━━━━━━━\n👥 Effectif Total Actif: <b>${emps.length}</b>\n👦 Hommes: <b>${male}</b> | 👧 Femmes: <b>${female}</b>\n📜 Contrats CDI/Titulaire: <b>${cdi}</b>\n⏱️ Contrats CDD: <b>${cdd}</b>\n━━━━━━━━━━━━━━\n🏖️ <b>Soldes Congés (Global Cumulé):</b>\n├ 🟢 ALVER: <b>${alLeave.toFixed(1)} j</b> (${seenAlver.size} emp.)\n└ 🔵 Verre Tech: <b>${vtLeave.toFixed(1)} j</b> (${seenVt.size} emp.)\n━━━━━━━━━━━━━━\n🎂 Moyenne d'âge: <b>${avgAge} ans</b>\n⏳ Expérience Moyenne: <b>${avgExp} ans</b>\n━━━━━━━━━━━━━━`;
}

export function getEffectifsDirMsg(db, ar) {
  const emps = (db.hr_employees || []).filter(e => e.status === 'active');

  // ─── تجميع حسب الشركة ثم المديرية ───
  const companies = {
    alver:  { label: '🟢 ALVER',      dirs: {}, total: 0 },
    vt:     { label: '🔵 VERRE TECH', dirs: {}, total: 0 },
  };

  emps.forEach(e => {
    const bucket = isVerreTech(e.companyId) ? companies.vt : companies.alver;

    let dir = ar
      ? (e.direction_ar || e.direction_fr || (ar ? 'أخرى' : 'Autre'))
      : (e.direction_fr || e.direction_ar || 'Autre');
    dir = dir.trim().toUpperCase() || (ar ? 'أخرى' : 'AUTRE');

    if (!bucket.dirs[dir]) bucket.dirs[dir] = { cdi: 0, cdd: 0, total: 0 };
    const ct = String(e.contractType || '').toLowerCase();
    if (ct.includes('tit') || ct === 'cdi') bucket.dirs[dir].cdi++; else bucket.dirs[dir].cdd++;
    bucket.dirs[dir].total++;
    bucket.total++;
  });

  const buildSection = (comp) => {
    const sorted = Object.keys(comp.dirs).sort((a, b) => comp.dirs[b].total - comp.dirs[a].total);
    let s = '';
    for (const d of sorted) {
      const st = comp.dirs[d];
      s += `  🏢 <b>${d}</b>: <b>${st.total}</b> ${ar ? 'عامل' : 'emp.'}\n`;
      s += `     ├ 📜 CDI: <b>${st.cdi}</b>  ⏱️ CDD: <b>${st.cdd}</b>\n`;
    }
    return s;
  };

  let msg = ar
    ? `👥 <b>تعداد العمال النشطين حسب المديرية</b>\n━━━━━━━━━━━━━━\n`
    : `👥 <b>EFFECTIFS ACTIFS PAR DIRECTION</b>\n━━━━━━━━━━━━━━\n`;

  for (const key of ['alver', 'vt']) {
    const comp = companies[key];
    if (comp.total === 0) continue;
    msg += `\n${comp.label} — <b>${comp.total} ${ar ? 'عامل' : 'employés'}</b>\n`;
    msg += buildSection(comp);
  }

  msg += `\n━━━━━━━━━━━━━━\n`;
  msg += ar
    ? `📌 <b>المجموع الكلي: ${emps.length} عامل نشط</b>`
    : `📌 <b>TOTAL GÉNÉRAL: ${emps.length} employés actifs</b>`;
  return msg;
}

export function getEffectifsCompanyMsg(db, ar, companyType) {
  const emps = (db.hr_employees || []).filter(e => e.status === 'active');
  const isVt = companyType === 'vt';
  const companyLabel = isVt ? (ar ? '🔵 شركة فارتك (VERRE TECH)' : '🔵 VERRE TECH') : (ar ? '🟢 شركة الفار (ALVER)' : '🟢 ALVER');

  // Filter emps by company
  const compEmps = emps.filter(e => isVerreTech(e.companyId) === isVt);

  // Group by direction
  const dirs = {};
  let total = 0;

  compEmps.forEach(e => {
    let dir = ar
      ? (e.direction_ar || e.direction_fr || (ar ? 'أخرى' : 'Autre'))
      : (e.direction_fr || e.direction_ar || 'Autre');
    dir = dir.trim().toUpperCase() || (ar ? 'أخرى' : 'AUTRE');

    if (!dirs[dir]) dirs[dir] = { cdi: 0, cdd: 0, total: 0 };
    const ct = String(e.contractType || '').toLowerCase();
    if (ct.includes('tit') || ct === 'cdi') dirs[dir].cdi++; else dirs[dir].cdd++;
    dirs[dir].total++;
    total++;
  });

  const sorted = Object.keys(dirs).sort((a, b) => dirs[b].total - dirs[a].total);

  let msg = ar
    ? `✨ <b>إحصائيات الموظفين | ${companyLabel}</b> ✨\n━━━━━━━━━━━━━━━━━━━━\n`
    : `✨ <b>STATISTIQUES DÉTAILLÉES | ${companyLabel}</b> ✨\n━━━━━━━━━━━━━━━━━━━━\n`;

  if (total === 0) {
    msg += ar ? `⚠️ لا يوجد عمال نشطين مسجلين.\n` : `⚠️ Aucun employé actif enregistré.\n`;
    return msg;
  }

  for (const d of sorted) {
    const st = dirs[d];
    msg += `🏛️ <b>${d}</b>\n`;
    msg += `   └ 👥 ${ar ? 'الإجمالي:' : 'Total:'} <b>${st.total}</b> ${ar ? 'عامل' : 'emp.'}\n`;
    msg += `       ├ 🌟 CDI ${ar ? '(دائم)' : '(Permanent)'}: <b>${st.cdi}</b>\n`;
    msg += `       └ ⏳ CDD ${ar ? '(مؤقت)' : '(Temporaire)'}: <b>${st.cdd}</b>\n`;
    msg += `┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈\n`;
  }

  msg += ar
    ? `📈 <b>المجموع الكلي: ${total} عامل نشط</b>\n━━━━━━━━━━━━━━━━━━━━`
    : `📈 <b>TOTAL GÉNÉRAL: ${total} employés actifs</b>\n━━━━━━━━━━━━━━━━━━━━`;

  return msg;
}
