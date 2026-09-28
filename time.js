// Petites fonctions de fuseau horaire et de dates, sans dépendance.

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
export const WEEKDAY_FR = { mon: 'lundi', tue: 'mardi', wed: 'mercredi', thu: 'jeudi', fri: 'vendredi', sat: 'samedi', sun: 'dimanche' };
const MONTHS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/** Date et heure actuelles dans le fuseau de l'entreprise. */
export function nowIn(timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date()).map((p) => [p.type, p.value]),
  );
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  return { date, minutes, time: fromMinutes(minutes), weekday: weekdayOf(date) };
}

export function isDateStr(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T12:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function isTimeStr(s) {
  return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

/** "10:30" ou "10:30:00" → 630 */
export function toMinutes(t) {
  const [h, m] = String(t).split(':').map(Number);
  return h * 60 + m;
}

export function fromMinutes(n) {
  return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
}

/** Accepte "10h", "10h30", "10:30", "10:30:00" → "10:30" (ou null). */
export function normalizeTime(t) {
  if (typeof t !== 'string') return null;
  const m = /^\s*(\d{1,2})\s*[h:]\s*(\d{2})?(?::\d{2})?\s*$/i.exec(t);
  if (!m) return null;
  const s = `${m[1].padStart(2, '0')}:${m[2] || '00'}`;
  return isTimeStr(s) ? s : null;
}

export function weekdayOf(dateStr) {
  return WEEKDAYS[new Date(dateStr + 'T12:00:00Z').getUTCDay()];
}

export function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a, b) {
  return Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 86400000);
}

/** "2026-10-03" → "samedi 3 octobre 2026" */
export function formatDateFr(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  return `${WEEKDAY_FR[weekdayOf(dateStr)]} ${d.getUTCDate()} ${MONTHS_FR[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "10:30:00" → "10h30" */
export function formatTimeFr(t) {
  const [h, m] = String(t).split(':');
  return `${Number(h)}h${m}`;
}
