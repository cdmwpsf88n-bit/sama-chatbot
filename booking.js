// Moteur de réservation : disponibilités, création, modification, annulation.
// Toute la logique métier est ici ; l'IA ne fait qu'appeler ces fonctions.

import crypto from 'node:crypto';
import { db, ensureSchema } from './db.js';
import {
  nowIn, isDateStr, normalizeTime, toMinutes, fromMinutes, weekdayOf,
  addDays, daysBetween, formatDateFr, WEEKDAY_FR,
} from './time.js';

export class BookingError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    Object.assign(this, extra);
  }
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans 0/O ni 1/I

function newCode() {
  const bytes = crypto.randomBytes(6);
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

export function normalizePhone(p) {
  const s = String(p || '').replace(/[^\d+]/g, '');
  return s.startsWith('00') ? '+' + s.slice(2) : s;
}

function phoneDigits(p) {
  return String(p || '').replace(/\D/g, '');
}

const EMAIL_RE = /^[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[a-z]{2,}$/i;

/** Contrôle les champs d'une réservation. Renvoie les valeurs nettoyées. */
export function validateCustomer({ name, phone, email, notes }) {
  const cleanName = String(name || '').trim().replace(/\s+/g, ' ');
  if (cleanName.length < 2 || cleanName.length > 100) throw new BookingError('invalid_name', 'Nom manquant ou invalide.');
  const cleanPhone = normalizePhone(phone);
  const digits = phoneDigits(cleanPhone);
  if (digits.length < 8 || digits.length > 15) throw new BookingError('invalid_phone', 'Numéro de téléphone invalide (8 à 15 chiffres).');
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(cleanEmail) || cleanEmail.length > 200) throw new BookingError('invalid_email', 'Adresse email invalide.');
  const cleanNotes = String(notes || '').trim().slice(0, 500);
  return { name: cleanName, phone: cleanPhone, email: cleanEmail, notes: cleanNotes };
}

function unitsFor(settings, partySize) {
  return settings.capacity_mode === 'people' ? partySize : 1;
}

/** Heures de début possibles pour une journée (selon les horaires d'ouverture). */
function candidateStarts(settings, date) {
  const ranges = settings.opening_hours?.[weekdayOf(date)] || [];
  const step = settings.slot_minutes;
  const dur = settings.booking_duration_minutes;
  const starts = [];
  for (const [open, close] of ranges) {
    for (let t = toMinutes(open); t + dur <= toMinutes(close); t += step) starts.push(t);
  }
  return starts;
}

/** Pourquoi une date n'est pas réservable (ou null si elle l'est). */
function dateProblem(settings, date) {
  const today = nowIn(settings.timezone).date;
  if (!isDateStr(date)) return { code: 'invalid_date', message: 'Date invalide (format attendu AAAA-MM-JJ).' };
  if (date < today) return { code: 'past_date', message: 'Cette date est déjà passée.' };
  if (daysBetween(today, date) > settings.max_days_ahead) {
    return { code: 'too_far', message: `On ne peut réserver que ${settings.max_days_ahead} jours à l'avance au maximum.` };
  }
  if ((settings.closed_dates || []).includes(date)) return { code: 'closed_date', message: `Fermé exceptionnellement le ${formatDateFr(date)}.` };
  if (candidateStarts(settings, date).length === 0) {
    return { code: 'closed_day', message: `Fermé le ${WEEKDAY_FR[weekdayOf(date)]}.` };
  }
  return null;
}

/**
 * Créneaux d'une journée avec la place restante.
 * `q` = connexion ou transaction ; `excludeId` = réservation à ignorer (modification).
 */
async function daySlots(q, settings, date, partySize, excludeId = null) {
  const rows = await q`
    select id, time, party_size from reservations
    where date = ${date} and status = 'confirmed' and id <> ${excludeId ?? -1}`;
  const step = settings.slot_minutes;
  const dur = settings.booking_duration_minutes;
  const cap = settings.capacity_per_slot;
  const need = unitsFor(settings, partySize);
  const now = nowIn(settings.timezone);
  const earliest = date === now.date ? now.minutes + settings.min_notice_minutes : -1;

  const load = (minute) => rows.reduce((sum, r) => {
    const s = toMinutes(r.time);
    return s <= minute && minute < s + dur ? sum + unitsFor(settings, r.party_size) : sum;
  }, 0);

  return candidateStarts(settings, date).map((start) => {
    let maxLoad = 0;
    for (let m = start; m < start + dur; m += step) maxLoad = Math.max(maxLoad, load(m));
    const remaining = cap - maxLoad;
    return {
      time: fromMinutes(start),
      remaining,
      available: start >= earliest && remaining >= need,
    };
  });
}

function nearest(slots, time, n = 3) {
  const target = toMinutes(time);
  return slots
    .filter((s) => s.available)
    .sort((a, b) => Math.abs(toMinutes(a.time) - target) - Math.abs(toMinutes(b.time) - target))
    .slice(0, n)
    .map((s) => s.time)
    .sort();
}

/** Premiers jours suivants qui ont de la place. */
async function nextOpenDays(q, settings, fromDate, partySize, days = 3) {
  const out = [];
  for (let i = 1; i <= 21 && out.length < days; i++) {
    const d = addDays(fromDate, i);
    if (dateProblem(settings, d)) continue;
    const free = (await daySlots(q, settings, d, partySize)).filter((s) => s.available).map((s) => s.time);
    if (free.length) out.push({ date: d, date_label: formatDateFr(d), first_times: free.slice(0, 4) });
  }
  return out;
}

function checkPartySize(settings, partySize) {
  const n = Number(partySize);
  if (!Number.isInteger(n) || n < 1) throw new BookingError('invalid_party_size', 'Nombre de personnes invalide.');
  if (n > settings.max_party_size) {
    throw new BookingError('party_too_large', `Au-delà de ${settings.max_party_size} personnes, merci de contacter directement l'entreprise.`);
  }
  if (settings.capacity_mode === 'people' && n > settings.capacity_per_slot) {
    throw new BookingError('party_too_large', `Le groupe dépasse la capacité d'un créneau (${settings.capacity_per_slot}).`);
  }
  return n;
}

/**
 * Disponibilités pour une date (et éventuellement une heure précise).
 * Renvoie toujours des alternatives quand la demande n'est pas possible.
 */
export async function checkAvailability(settings, { date, time, party_size = 1 }, q = null) {
  await ensureSchema();
  q = q || db();
  const partySize = checkPartySize(settings, party_size);
  const problem = dateProblem(settings, date);
  if (problem) {
    const today = nowIn(settings.timezone).date;
    // Chercher les prochains jours libres à partir de la date demandée (ou d'aujourd'hui si elle est passée/invalide).
    const from = ['past_date', 'invalid_date', 'too_far'].includes(problem.code) ? addDays(today, -1) : date;
    return {
      available: false, reason: problem.code, message: problem.message,
      next_open_days: await nextOpenDays(q, settings, from, partySize),
    };
  }
  const slots = await daySlots(q, settings, date, partySize);
  const free = slots.filter((s) => s.available).map((s) => s.time);
  const result = { date, date_label: formatDateFr(date), party_size: partySize, free_times: free };

  if (time !== undefined && time !== null && time !== '') {
    const t = normalizeTime(String(time));
    if (!t) return { ...result, available: false, reason: 'invalid_time', message: 'Heure invalide.' };
    const slot = slots.find((s) => s.time === t);
    if (slot?.available) return { ...result, time: t, available: true };
    const outside = !slot;
    return {
      ...result,
      time: t,
      available: false,
      reason: outside ? 'outside_hours' : (slot.remaining >= unitsFor(settings, partySize) ? 'too_soon' : 'full'),
      message: outside
        ? `${t} ne correspond pas à un créneau d'ouverture ce jour-là.`
        : slot.remaining >= unitsFor(settings, partySize)
          ? `Il faut réserver au moins ${settings.min_notice_minutes} minutes à l'avance.`
          : `Le créneau de ${t} est complet.`,
      alternatives_same_day: nearest(slots, t),
      next_open_days: free.length ? [] : await nextOpenDays(q, settings, date, partySize),
    };
  }
  if (!free.length) {
    return { ...result, available: false, reason: 'full', message: 'Plus aucun créneau libre ce jour-là.', next_open_days: await nextOpenDays(q, settings, date, partySize) };
  }
  return { ...result, available: true };
}

async function lockDate(tx, date) {
  await tx`select pg_advisory_xact_lock(hashtext(${'booking:' + date}))`;
}

async function assertSlotFree(tx, settings, date, time, partySize, excludeId = null) {
  const problem = dateProblem(settings, date);
  if (problem) throw new BookingError(problem.code, problem.message);
  const t = normalizeTime(String(time));
  if (!t) throw new BookingError('invalid_time', 'Heure invalide.');
  const slots = await daySlots(tx, settings, date, partySize, excludeId);
  const slot = slots.find((s) => s.time === t);
  if (!slot?.available) {
    throw new BookingError(slot ? 'full' : 'outside_hours', slot ? `Le créneau de ${t} n'est plus disponible.` : `${t} n'est pas un créneau d'ouverture.`, {
      alternatives_same_day: nearest(slots, t),
    });
  }
  return t;
}

function publicView(r) {
  return {
    code: r.code,
    name: r.name,
    phone: r.phone,
    email: r.email,
    date: r.date,
    date_label: formatDateFr(r.date),
    time: String(r.time).slice(0, 5),
    party_size: r.party_size,
    notes: r.notes,
    status: r.status,
  };
}

/** Crée une réservation (vérification de place à l'intérieur d'une transaction verrouillée). */
export async function createReservation(settings, input, { source = 'chat', ip = null } = {}) {
  await ensureSchema();
  const customer = validateCustomer(input);
  const partySize = checkPartySize(settings, input.party_size);
  const date = String(input.date || '');
  const sql = db();

  // Limite anti-abus : pas plus de 3 réservations à venir pour un même téléphone.
  const today = nowIn(settings.timezone).date;
  const [{ n }] = await sql`
    select count(*)::int as n from reservations
    where status = 'confirmed' and date >= ${today}
      and regexp_replace(phone, '\\D', '', 'g') = ${phoneDigits(customer.phone)}`;
  if (n >= 3) throw new BookingError('too_many', 'Ce numéro a déjà 3 réservations à venir. Contactez l\'entreprise pour en ajouter.');

  const row = await sql.begin(async (tx) => {
    await lockDate(tx, date);
    const time = await assertSlotFree(tx, settings, date, input.time, partySize);
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = newCode();
      const inserted = await tx`
        insert into reservations (code, name, phone, email, date, time, party_size, notes, source)
        values (${code}, ${customer.name}, ${customer.phone}, ${customer.email}, ${date}, ${time}, ${partySize}, ${customer.notes}, ${source})
        on conflict (code) do nothing
        returning *`;
      if (inserted.length) {
        await tx`insert into reservation_events (reservation_id, type, details)
                 values (${inserted[0].id}, 'created', ${tx.json({ source, ip })})`;
        return inserted[0];
      }
    }
    throw new Error('Impossible de générer un code de réservation.');
  });
  return publicView(row);
}

/** Retrouve une réservation par son code + le téléphone OU l'email du client. */
export async function findReservation(code, contact) {
  await ensureSchema();
  const c = String(code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (c.length < 4) throw new BookingError('invalid_code', 'Code de réservation invalide.');
  const rows = await db()`select * from reservations where code = ${c}`;
  const r = rows[0];
  const ct = String(contact || '').trim().toLowerCase();
  const digits = phoneDigits(ct);
  const ok = r && (
    (ct.includes('@') && ct === r.email) ||
    (digits.length >= 8 && phoneDigits(r.phone).endsWith(digits.slice(-8)))
  );
  // Même message dans les deux cas : on ne révèle pas si le code existe.
  if (!ok) throw new BookingError('not_found', 'Aucune réservation ne correspond à ce code et à ce contact.');
  return r;
}

export async function getReservationForCustomer(code, contact) {
  return publicView(await findReservation(code, contact));
}

/** Modifie date, heure, nombre de personnes ou remarques. */
export async function modifyReservation(settings, code, contact, changes) {
  const current = await findReservation(code, contact);
  if (current.status !== 'confirmed') throw new BookingError('not_active', 'Cette réservation n\'est plus active.');
  const date = changes.date ? String(changes.date) : current.date;
  const time = changes.time ? changes.time : String(current.time).slice(0, 5);
  const partySize = changes.party_size ? checkPartySize(settings, changes.party_size) : current.party_size;
  const notes = changes.notes !== undefined && changes.notes !== null ? String(changes.notes).trim().slice(0, 500) : current.notes;

  const before = publicView(current);
  const row = await db().begin(async (tx) => {
    await lockDate(tx, date);
    const t = await assertSlotFree(tx, settings, date, time, partySize, current.id);
    const [updated] = await tx`
      update reservations set date = ${date}, time = ${t}, party_size = ${partySize}, notes = ${notes}, updated_at = now()
      where id = ${current.id} and status = 'confirmed'
      returning *`;
    if (!updated) throw new BookingError('not_active', 'Cette réservation n\'est plus active.');
    await tx`insert into reservation_events (reservation_id, type, details)
             values (${current.id}, 'modified', ${tx.json({ before: { date: before.date, time: before.time, party_size: before.party_size, notes: before.notes } })})`;
    return updated;
  });
  return { before, after: publicView(row) };
}

export async function cancelReservation(code, contact, { by = 'customer' } = {}) {
  const current = await findReservation(code, contact);
  if (current.status === 'cancelled') throw new BookingError('already_cancelled', 'Cette réservation est déjà annulée.');
  if (current.status !== 'confirmed') throw new BookingError('not_active', 'Cette réservation n\'est plus active.');
  const [row] = await db()`
    update reservations set status = 'cancelled', cancelled_at = now(), updated_at = now()
    where id = ${current.id} returning *`;
  await db()`insert into reservation_events (reservation_id, type, details) values (${row.id}, 'cancelled', ${db().json({ by })})`;
  return publicView(row);
}

// ---------- Fonctions du tableau de bord ----------

export async function listReservations({ from, to, status, q } = {}) {
  await ensureSchema();
  const sql = db();
  const conds = [];
  if (from && isDateStr(from)) conds.push(sql`date >= ${from}`);
  if (to && isDateStr(to)) conds.push(sql`date <= ${to}`);
  if (status && ['confirmed', 'cancelled', 'completed', 'no_show'].includes(status)) conds.push(sql`status = ${status}`);
  if (q) {
    const like = '%' + String(q).trim().slice(0, 100).replace(/[%_\\]/g, (m) => '\\' + m) + '%';
    conds.push(sql`(name ilike ${like} or phone ilike ${like} or email ilike ${like} or code ilike ${like} or notes ilike ${like})`);
  }
  const where = conds.length ? conds.reduce((acc, c, i) => (i === 0 ? sql`where ${c}` : sql`${acc} and ${c}`), sql``) : sql``;
  const rows = await sql`select * from reservations ${where} order by date, time, id limit 500`;
  return rows.map((r) => ({ ...publicView(r), id: Number(r.id), source: r.source, created_at: r.created_at }));
}

export async function adminSetStatus(id, status) {
  if (!['confirmed', 'cancelled', 'completed', 'no_show'].includes(status)) throw new BookingError('invalid_status', 'Statut invalide.');
  const sql = db();
  const [row] = await sql`
    update reservations set status = ${status}, updated_at = now(),
      cancelled_at = case when ${status}::text = 'cancelled' then now() else null end
    where id = ${id} returning *`;
  if (!row) throw new BookingError('not_found', 'Réservation introuvable.');
  await sql`insert into reservation_events (reservation_id, type, details) values (${row.id}, ${'status:' + status}, ${sql.json({ by: 'admin' })})`;
  return publicView(row);
}
