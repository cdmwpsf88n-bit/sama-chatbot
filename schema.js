// Structure de la base de données. Créée automatiquement au premier démarrage
// (ou manuellement avec `npm run db:setup`).

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS settings (
  id          integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  data        jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reservations (
  id            bigserial PRIMARY KEY,
  code          text NOT NULL UNIQUE,
  name          text NOT NULL,
  phone         text NOT NULL,
  email         text NOT NULL,
  date          date NOT NULL,
  time          time NOT NULL,
  party_size    integer NOT NULL CHECK (party_size > 0),
  notes         text NOT NULL DEFAULT '',
  status        text NOT NULL DEFAULT 'confirmed'
                CHECK (status IN ('confirmed', 'cancelled', 'completed', 'no_show')),
  source        text NOT NULL DEFAULT 'chat',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  cancelled_at  timestamptz
);
CREATE INDEX IF NOT EXISTS reservations_date_status_idx ON reservations (date, status);
CREATE INDEX IF NOT EXISTS reservations_phone_idx ON reservations (phone);

CREATE TABLE IF NOT EXISTS reservation_events (
  id              bigserial PRIMARY KEY,
  reservation_id  bigint NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  type            text NOT NULL,
  details         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reservation_events_res_idx ON reservation_events (reservation_id);

CREATE TABLE IF NOT EXISTS email_log (
  id          bigserial PRIMARY KEY,
  to_email    text NOT NULL,
  subject     text NOT NULL,
  kind        text NOT NULL,
  provider    text NOT NULL,
  status      text NOT NULL,
  error       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rate_limits (
  key           text NOT NULL,
  window_start  timestamptz NOT NULL,
  count         integer NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);

-- Supabase expose automatiquement les tables via son API publique.
-- Activer la sécurité par ligne SANS règle bloque cet accès public ;
-- l'application, elle, se connecte directement et garde l'accès.
ALTER TABLE settings            ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservation_events  ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_log           ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limits         ENABLE ROW LEVEL SECURITY;
`;
