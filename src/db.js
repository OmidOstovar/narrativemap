'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = process.env.DATABASE_PATH
  || path.join(__dirname, '..', 'data', 'narrativemap.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS narratives (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id         TEXT    NOT NULL UNIQUE,
    status            TEXT    NOT NULL DEFAULT 'pending',
    answers           TEXT    NOT NULL,
    place_name        TEXT    NOT NULL,
    province          TEXT,
    lat               REAL    NOT NULL,
    lng               REAL    NOT NULL,
    period_start      TEXT    NOT NULL,
    period_end        TEXT    NOT NULL,
    period_precision  TEXT    NOT NULL DEFAULT 'day',
    contributor_name  TEXT,
    contributor_email TEXT,
    submitted_at      TEXT    NOT NULL,
    reviewed_at       TEXT,
    review_note       TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_narratives_status ON narratives (status);
  CREATE INDEX IF NOT EXISTS idx_narratives_period ON narratives (period_start, period_end);
`);

/**
 * Columns added after the first release. SQLite has no "ADD COLUMN IF NOT
 * EXISTS", so check the table first — this runs against databases that already
 * hold narratives.
 */
function addColumnIfMissing(column, definition) {
  const existing = db.prepare('PRAGMA table_info(narratives)').all();
  if (existing.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE narratives ADD COLUMN ${column} ${definition}`);
}

addColumnIfMissing('source', "TEXT NOT NULL DEFAULT 'web'");
addColumnIfMissing('approximate', 'INTEGER NOT NULL DEFAULT 0');

// A narrative is kept in both languages: `answers` as written, and the
// translated half beside it. Which one is the original is recorded rather than
// guessed at read time.
addColumnIfMissing('original_lang', "TEXT NOT NULL DEFAULT 'fa'");
addColumnIfMissing('answers_translated', 'TEXT');
addColumnIfMissing('place_name_translated', 'TEXT');
addColumnIfMissing('translation_status', "TEXT NOT NULL DEFAULT 'pending'");
addColumnIfMissing('translation_model', 'TEXT');
addColumnIfMissing('translation_error', 'TEXT');
addColumnIfMissing('translated_at', 'TEXT');

const STATUSES = ['pending', 'approved', 'rejected'];

/** Where a submission came from. */
const SOURCES = ['web', 'telegram'];

/**
 * pending  — queued, not attempted yet
 * done     — translated by the model, untouched since
 * edited   — a moderator has corrected the translation
 * failed   — the attempt errored; the moderator can retry
 * skipped  — no translation configured, or nothing to translate
 */
const TRANSLATION_STATUSES = ['pending', 'done', 'edited', 'failed', 'skipped'];

/** URL-safe id with no ambiguous characters. */
function newPublicId() {
  const alphabet = '23456789abcdefghijkmnpqrstuvwxyz';
  const bytes = crypto.randomBytes(10);
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
}

/** Shapes a database row into the object the API returns. */
function toNarrative(row, { includePrivate = false } = {}) {
  if (!row) return null;
  const narrative = {
    id: row.public_id,
    status: row.status,
    answers: JSON.parse(row.answers),
    place: {
      name: row.place_name,
      province: row.province,
      lat: row.lat,
      lng: row.lng,
    },
    period: {
      start: row.period_start,
      end: row.period_end,
      precision: row.period_precision,
    },
    contributor: row.contributor_name || null,
    submittedAt: row.submitted_at,
  };
  // A pin the contributor could not place exactly; the moderator moves it.
  if (row.approximate) narrative.place.approximate = true;

  narrative.originalLang = row.original_lang || 'fa';
  const translated = row.answers_translated ? JSON.parse(row.answers_translated) : null;
  narrative.answersTranslated = translated;
  narrative.place.nameTranslated = row.place_name_translated || null;
  narrative.hasTranslation = Boolean(translated && Object.keys(translated).length);
  if (includePrivate) {
    narrative.private = {
      rowId: row.id,
      source: row.source || 'web',
      translationStatus: row.translation_status || 'pending',
      translationModel: row.translation_model || null,
      translationError: row.translation_error || null,
      translatedAt: row.translated_at || null,
      email: row.contributor_email || null,
      reviewedAt: row.reviewed_at || null,
      reviewNote: row.review_note || null,
    };
  }
  return narrative;
}

const insertStatement = db.prepare(`
  INSERT INTO narratives (
    public_id, status, answers, place_name, province, lat, lng,
    period_start, period_end, period_precision,
    contributor_name, contributor_email, submitted_at, source, approximate,
    original_lang
  ) VALUES (?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

function createSubmission(input) {
  const publicId = newPublicId();
  insertStatement.run(
    publicId,
    JSON.stringify(input.answers),
    input.place.name,
    input.place.province,
    input.place.lat,
    input.place.lng,
    input.period.start,
    input.period.end,
    input.period.precision,
    input.contributor.name || null,
    input.contributor.email || null,
    new Date().toISOString(),
    SOURCES.includes(input.source) ? input.source : 'web',
    input.place.approximate ? 1 : 0,
    input.originalLang === 'en' ? 'en' : 'fa',
  );
  return publicId;
}

const setTranslationStatement = db.prepare(`
  UPDATE narratives SET
    answers_translated = ?, place_name_translated = ?,
    translation_status = ?, translation_model = ?, translation_error = ?,
    translated_at = ?
  WHERE public_id = ?
`);

/** Records a translation attempt, successful or not. */
function setTranslation(publicId, { answers, placeName, status, model, error }) {
  if (!TRANSLATION_STATUSES.includes(status)) {
    throw new Error(`Unknown translation status: ${status}`);
  }
  const result = setTranslationStatement.run(
    answers ? JSON.stringify(answers) : null,
    placeName || null,
    status,
    model || null,
    error || null,
    new Date().toISOString(),
    publicId,
  );
  return result.changes > 0;
}

const pendingTranslationsStatement = db.prepare(`
  SELECT * FROM narratives WHERE translation_status IN ('pending', 'failed')
  ORDER BY id ASC LIMIT ?
`);

/** Narratives still waiting on a translation, for retrying after an outage. */
function listAwaitingTranslation(limit = 20) {
  return pendingTranslationsStatement.all(limit).map((row) => toNarrative(row, { includePrivate: true }));
}

const listApprovedStatement = db.prepare(`
  SELECT * FROM narratives WHERE status = 'approved'
  ORDER BY period_start ASC, id ASC
`);

function listApproved() {
  return listApprovedStatement.all().map((row) => toNarrative(row));
}

const getApprovedStatement = db.prepare(
  `SELECT * FROM narratives WHERE public_id = ? AND status = 'approved'`,
);

function getApproved(publicId) {
  return toNarrative(getApprovedStatement.get(publicId));
}

const listByStatusStatement = db.prepare(`
  SELECT * FROM narratives WHERE status = ?
  ORDER BY submitted_at DESC, id DESC
`);
const listAllStatement = db.prepare(
  'SELECT * FROM narratives ORDER BY submitted_at DESC, id DESC',
);

function listForReview(status) {
  const rows = STATUSES.includes(status)
    ? listByStatusStatement.all(status)
    : listAllStatement.all();
  return rows.map((row) => toNarrative(row, { includePrivate: true }));
}

const getAnyStatement = db.prepare('SELECT * FROM narratives WHERE public_id = ?');

function getAny(publicId) {
  return toNarrative(getAnyStatement.get(publicId), { includePrivate: true });
}

const countsStatement = db.prepare(
  'SELECT status, COUNT(*) AS n FROM narratives GROUP BY status',
);

function counts() {
  const result = { pending: 0, approved: 0, rejected: 0 };
  for (const row of countsStatement.all()) result[row.status] = row.n;
  return result;
}

const setStatusStatement = db.prepare(`
  UPDATE narratives SET status = ?, reviewed_at = ?, review_note = ?
  WHERE public_id = ?
`);

function setStatus(publicId, status, reviewNote) {
  if (!STATUSES.includes(status)) throw new Error(`Unknown status: ${status}`);
  const result = setStatusStatement.run(
    status,
    new Date().toISOString(),
    reviewNote || null,
    publicId,
  );
  return result.changes > 0;
}

const updateStatement = db.prepare(`
  UPDATE narratives SET
    answers = ?, place_name = ?, province = ?, lat = ?, lng = ?,
    period_start = ?, period_end = ?, period_precision = ?, contributor_name = ?,
    approximate = ?, answers_translated = ?, place_name_translated = ?,
    translation_status = ?
  WHERE public_id = ?
`);

/** Lets the moderator fix typos and misplaced pins before publishing. */
function updateNarrative(publicId, input) {
  const result = updateStatement.run(
    JSON.stringify(input.answers),
    input.place.name,
    input.place.province,
    input.place.lat,
    input.place.lng,
    input.period.start,
    input.period.end,
    input.period.precision,
    input.contributor.name || null,
    input.place.approximate ? 1 : 0,
    input.translation && input.translation.answers
      ? JSON.stringify(input.translation.answers) : null,
    (input.translation && input.translation.placeName) || null,
    (input.translation && input.translation.status) || 'pending',
    publicId,
  );
  return result.changes > 0;
}

const deleteStatement = db.prepare('DELETE FROM narratives WHERE public_id = ?');

function deleteNarrative(publicId) {
  return deleteStatement.run(publicId).changes > 0;
}

module.exports = {
  db,
  DB_PATH,
  STATUSES,
  SOURCES,
  TRANSLATION_STATUSES,
  setTranslation,
  listAwaitingTranslation,
  createSubmission,
  listApproved,
  getApproved,
  listForReview,
  getAny,
  counts,
  setStatus,
  updateNarrative,
  deleteNarrative,
};
