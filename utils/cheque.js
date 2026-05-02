import writtenNumber from 'written-number';

export function convertAmountToWords(amountStr, lang = 'ar') {
  // Replace comma with dot and remove non-digit characters except dot
  let str = String(amountStr).replace(',', '.').replace(/[^\d.]/g, '');
  if (!str) return null;

  const parts = str.split('.');
  const dinars = parseInt(parts[0] || '0', 10);
  // Get max 2 digits for centimes
  let centimesStr = parts.length > 1 ? parts[1].substring(0, 2) : '0';
  if (centimesStr.length === 1) centimesStr += '0';
  const centimes = parseInt(centimesStr, 10);

  if (isNaN(dinars)) return null;

  try {
    let result = '';
    const dWords = writtenNumber(dinars, { lang });
    const cWords = writtenNumber(centimes, { lang });

    if (lang === 'ar') {
      result = `<b>${dWords}</b> دينار جزائري`;
      if (centimes > 0) {
        result += ` و <b>${cWords}</b> سنتيما`;
      }
    } else {
      result = `<b>${dWords}</b> dinars algériens`;
      if (centimes > 0) {
        result += ` et <b>${cWords}</b> centimes`;
      }
    }
    return result;
  } catch (e) {
    return null;
  }
}
