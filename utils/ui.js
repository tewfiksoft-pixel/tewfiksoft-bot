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
  const empMap = {};
  emps.forEach(e => { empMap[String(e.id)] = e; });

  const stats = {
    alver: { total: 0, cdi: 0, cdd: 0, male: 0, female: 0, totalAge: 0, ageCount: 0, leave: 0 },
    vt: { total: 0, cdi: 0, cdd: 0, male: 0, female: 0, totalAge: 0, ageCount: 0, leave: 0 }
  };

  const curYear = new Date().getFullYear();

  emps.forEach(e => {
    const s = isVerreTech(e.companyId) ? stats.vt : stats.alver;
    s.total++;
    const ct = String(e.contractType || '').toLowerCase();
    if (ct.includes('tit') || ct === 'cdi') s.cdi++; else s.cdd++;
    
    if (String(e.gender || '').toUpperCase() === 'M') s.male++; else s.female++;

    if (e.birthDate) {
      const parts = e.birthDate.split(/[-/]/);
      let year = null;
      if (parts.length === 3) { year = parts[2].length === 4 ? parseInt(parts[2]) : parseInt(parts[0]); }
      else if (parts.length === 1 && parts[0].length === 4) { year = parseInt(parts[0]); }
      if (year && year > 1900 && year <= curYear) {
        s.totalAge += (curYear - year);
        s.ageCount++;
      }
    }
  });

  const seen = new Set();
  (db.hr_leave_balances || []).forEach(l => {
    const emp = empMap[String(l.employeeId)];
    if (!emp) return;
    const s = isVerreTech(emp.companyId) ? stats.vt : stats.alver;
    s.leave += parseFloat(l.remainingDays || 0);
    seen.add(String(emp.id));
  });

  emps.forEach(emp => {
    if (seen.has(String(emp.id))) return;
    const s = isVerreTech(emp.companyId) ? stats.vt : stats.alver;
    s.leave += calculateAutoLeave(emp.startDate, activeEx);
    seen.add(String(emp.id));
  });

  let msg = ar
    ? `📊 <b>لوحة القيادة الإستراتيجية</b>\n━━━━━━━━━━━━━━\n`
    : `📊 <b>TABLEAU DE BORD STRATÉGIQUE</b>\n━━━━━━━━━━━━━━\n`;

  const buildCompSection = (s, label) => {
    const avgAge = s.ageCount > 0 ? Math.round(s.totalAge / s.ageCount) : 0;
    return ar
      ? `${label}\n  ├ التعداد: <b>${s.total}</b>\n  ├ الجنس: <b>${s.male} رجال | ${s.female} نساء</b>\n  ├ العقود: <b>${s.cdi} CDI | ${s.cdd} CDD</b>\n  └ متوسط العمر: <b>${avgAge} سنة</b>\n\n`
      : `${label}\n  ├ Effectif: <b>${s.total}</b>\n  ├ Genre: <b>${s.male} H | ${s.female} F</b>\n  ├ Contrats: <b>${s.cdi} CDI | ${s.cdd} CDD</b>\n  └ Âge Moyen: <b>${avgAge} ans</b>\n\n`;
  };

  msg += buildCompSection(stats.alver, ar ? '🟢 <b>مجموعة ALVER</b>' : '🟢 <b>GROUPE ALVER</b>');
  msg += buildCompSection(stats.vt, ar ? '🔵 <b>VERRE TECH</b>' : '🔵 <b>VERRE TECH</b>');

  msg += `━━━━━━━━━━━━━━\n`;
  msg += ar 
    ? `📊 <b>الحصيلة المجمعة</b>\n  ├ إجمالي العمال: <b>${emps.length}</b>\n  ├ رجال: <b>${stats.alver.male + stats.vt.male}</b> | نساء: <b>${stats.alver.female + stats.vt.female}</b>\n  └ ديون العطل: <b>${(stats.alver.leave + stats.vt.leave).toFixed(1)} يوم</b>\n`
    : `📊 <b>BILAN CONSOLIDÉ</b>\n  ├ Effectif Global: <b>${emps.length}</b>\n  ├ Hommes: <b>${stats.alver.male + stats.vt.male}</b> | Femmes: <b>${stats.alver.female + stats.vt.female}</b>\n  └ Dette Congés: <b>${(stats.alver.leave + stats.vt.leave).toFixed(1)} j</b>\n`;

  msg += `━━━━━━━━━━━━━━\n`;
  msg += ar ? `📡 بيانات حية ومؤمنة 🔐` : `📡 Données en Temps Réel 🔐`;
  return msg;
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
