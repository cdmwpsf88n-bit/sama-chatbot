import { db, ensureSchema } from './db.js';
import { isDateStr, isTimeStr, toMinutes } from './time.js';

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

/** Réglages de départ. Tous modifiables dans le tableau de bord admin. */
export const DEFAULT_SETTINGS = {
  business_name: 'Sama Billet Voyages',
  activity: "Agence de billetterie aérienne à Dakar : vente de billets d'avion toutes compagnies, assurance voyage, modification et annulation de billets.",
  booking_label: "rendez-vous à l'agence",
  address: 'Dakar, Sénégal (adresse à compléter)',
  phone: '+221 XX XXX XX XX',
  website: '',
  languages: ['français', 'English', 'Wolof'],
  timezone: 'Africa/Dakar',
  slot_minutes: 30,
  booking_duration_minutes: 30,
  capacity_per_slot: 2,
  capacity_mode: 'bookings', // "bookings" = nombre de réservations par créneau ; "people" = nombre de personnes
  max_party_size: 4,
  min_notice_minutes: 60,
  max_days_ahead: 60,
  opening_hours: {
    mon: [['09:00', '19:00']],
    tue: [['09:00', '19:00']],
    wed: [['09:00', '19:00']],
    thu: [['09:00', '19:00']],
    fri: [['09:00', '19:00']],
    sat: [['09:00', '19:00']],
    sun: [],
  },
  closed_dates: [],
  knowledge: [
    "Services : billets d'avion toutes compagnies (Air Sénégal, Air France, Royal Air Maroc, Turkish Airlines, Emirates, compagnies low-cost), assurance voyage, modification et annulation de billets, conseils bagages et documents de voyage.",
    "Frais de service de l'agence : à partir de 10 000 FCFA par billet (15 000 à 25 000 FCFA pour les vols long-courriers).",
    "Prix des billets : ils dépendent de la compagnie, de la date et des places restantes. Un agent donne le prix exact au rendez-vous ou par WhatsApp. Le chatbot ne donne jamais de prix de billet.",
    'Paiement : Wave, Orange Money, espèces ou carte bancaire. Le billet est émis après paiement complet.',
    "À apporter au rendez-vous : passeport (valide au moins 6 mois après le retour) ou carte d'identité, et le visa si la destination l'exige.",
    "L'agence ne vend pas de voyages organisés, ni de Hajj ou d'Oumra.",
  ].join('\n'),
  welcome_message:
    "Bonjour ! Je suis l'assistant de Sama Billet Voyages. Je peux répondre à vos questions ou réserver un rendez-vous à l'agence pour votre billet d'avion. Comment puis-je vous aider ?",
};

let cache = null;
let cacheAt = 0;

export async function getSettings({ fresh = false } = {}) {
  if (!fresh && cache && Date.now() - cacheAt < 30_000) return cache;
  await ensureSchema();
  const sql = db();
  const rows = await sql`select data from settings where id = 1`;
  let data;
  if (rows.length === 0) {
    await sql`insert into settings (id, data) values (1, ${sql.json(DEFAULT_SETTINGS)}) on conflict (id) do nothing`;
    data = DEFAULT_SETTINGS;
  } else {
    data = { ...DEFAULT_SETTINGS, ...rows[0].data };
  }
  cache = data;
  cacheAt = Date.now();
  return data;
}

function int(v, min, max, field) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${field} : nombre entier entre ${min} et ${max} attendu.`);
  return n;
}

function str(v, max, field, { required = false } = {}) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (required && !s) throw new Error(`${field} est obligatoire.`);
  if (s.length > max) throw new Error(`${field} : ${max} caractères maximum.`);
  return s;
}

/** Vérifie et nettoie les réglages envoyés par le tableau de bord. */
export function validateSettings(input) {
  const out = {};
  out.business_name = str(input.business_name, 120, "Le nom de l'entreprise", { required: true });
  out.activity = str(input.activity, 1000, "L'activité");
  out.booking_label = str(input.booking_label, 80, 'Le type de réservation') || 'réservation';
  out.address = str(input.address, 300, "L'adresse");
  out.phone = str(input.phone, 60, 'Le téléphone');
  out.website = str(input.website, 200, 'Le site web');
  const langs = Array.isArray(input.languages) ? input.languages : String(input.languages || '').split(',');
  out.languages = langs.map((l) => String(l).trim()).filter(Boolean).slice(0, 10);
  if (out.languages.length === 0) out.languages = ['français'];
  out.timezone = str(input.timezone, 60, 'Le fuseau horaire') || 'Africa/Dakar';
  try { new Intl.DateTimeFormat('fr', { timeZone: out.timezone }); } catch { throw new Error(`Fuseau horaire inconnu : ${out.timezone}`); }
  out.slot_minutes = int(input.slot_minutes, 5, 240, 'La durée du créneau');
  out.booking_duration_minutes = int(input.booking_duration_minutes, 5, 720, 'La durée d\'une réservation');
  out.capacity_per_slot = int(input.capacity_per_slot, 1, 10000, 'La capacité par créneau');
  out.capacity_mode = input.capacity_mode === 'people' ? 'people' : 'bookings';
  out.max_party_size = int(input.max_party_size, 1, 1000, 'Le nombre maximum de personnes');
  out.min_notice_minutes = int(input.min_notice_minutes, 0, 20160, 'Le délai minimum');
  out.max_days_ahead = int(input.max_days_ahead, 1, 730, 'La réservation à l\'avance');
  out.opening_hours = {};
  for (const d of DAYS) {
    const ranges = Array.isArray(input.opening_hours?.[d]) ? input.opening_hours[d] : [];
    out.opening_hours[d] = ranges.map((r) => {
      if (!Array.isArray(r) || !isTimeStr(r[0]) || !isTimeStr(r[1]) || toMinutes(r[0]) >= toMinutes(r[1])) {
        throw new Error(`Horaires invalides pour ${d} : utilisez le format 09:00-13:00.`);
      }
      return [r[0], r[1]];
    });
  }
  const closed = Array.isArray(input.closed_dates) ? input.closed_dates : String(input.closed_dates || '').split(/[\s,]+/);
  out.closed_dates = closed.map((s) => String(s).trim()).filter(Boolean);
  for (const d of out.closed_dates) if (!isDateStr(d)) throw new Error(`Date de fermeture invalide : ${d} (format AAAA-MM-JJ).`);
  out.knowledge = str(input.knowledge, 20000, 'La base d\'informations');
  out.welcome_message = str(input.welcome_message, 1000, "Le message d'accueil") || DEFAULT_SETTINGS.welcome_message;
  return out;
}

export async function saveSettings(input) {
  const data = validateSettings(input);
  await ensureSchema();
  const sql = db();
  await sql`
    insert into settings (id, data, updated_at) values (1, ${sql.json(data)}, now())
    on conflict (id) do update set data = excluded.data, updated_at = now()`;
  cache = data;
  cacheAt = Date.now();
  return data;
}
