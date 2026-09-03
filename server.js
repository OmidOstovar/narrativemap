'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');

/**
 * Without a password the admin queue would be wide open, so rather than ship a
 * guessable default we mint one on first run and print it once.
 */
function ensureAdminPassword() {
  if (process.env.ADMIN_PASSWORD) return null;
  const file = path.join(__dirname, 'data', '.admin-password');
  try {
    process.env.ADMIN_PASSWORD = fs.readFileSync(file, 'utf8').trim();
    return null;
  } catch {
    const generated = crypto.randomBytes(9).toString('base64url');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, generated, { mode: 0o600 });
    process.env.ADMIN_PASSWORD = generated;
    return generated;
  }
}

const generatedPassword = ensureAdminPassword();

const db = require('./src/db');
const auth = require('./src/auth');
const { QUESTIONS } = require('./src/questions');
const { PROVINCE_NAMES } = require('./src/geo');
const { validateSubmission, applyTrustedFields, MIN_YEAR, maxYear } = require('./src/validate');
const { detectSubmissionLanguage } = require('./src/translate');
const translations = require('./src/translation-queue');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', process.env.TRUST_PROXY === 'true');
app.use(express.json({ limit: '256kb' }));

const submitLimit = auth.createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: Number(process.env.SUBMIT_LIMIT_PER_HOUR || 10),
});
const loginLimit = auth.createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.LOGIN_LIMIT_PER_15_MIN || 10),
});
const botLimit = auth.createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: Number(process.env.SUBMIT_LIMIT_PER_HOUR || 10),
});

function clientKey(req) {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

/* ------------------------------- public API ------------------------------ */

app.get('/api/questions', (req, res) => {
  res.json({
    questions: QUESTIONS,
    provinces: PROVINCE_NAMES,
    yearRange: { min: MIN_YEAR, max: maxYear() },
  });
});

app.get('/api/narratives', (req, res) => {
  res.json({ narratives: db.listApproved() });
});

app.get('/api/narratives/:id', (req, res) => {
  const narrative = db.getApproved(req.params.id);
  if (!narrative) {
    res.status(404).json({ error: 'No published narrative with that id.' });
    return;
  }
  res.json({ narrative });
});

app.post('/api/submissions', (req, res) => {
  // The bot funnels many contributors through one address, so it carries its
  // own limit keyed by Telegram user rather than the per-visitor IP limit.
  const trusted = auth.isTrustedBot(req);
  const limit = trusted
    ? botLimit(String((req.body && req.body.botUserKey) || 'bot'))
    : submitLimit(clientKey(req));
  if (!limit.ok) {
    res.set('Retry-After', String(limit.retryAfter));
    res.status(429).json({
      error: 'That is a lot of submissions in one hour. Please try again later.',
    });
    return;
  }

  const { value, errors } = validateSubmission(req.body);
  if (!value) {
    res.status(400).json({ error: 'Some answers still need work.', errors });
    return;
  }

  const submission = trusted
    ? applyTrustedFields(value, req.body)
    : Object.assign({}, value, {
      source: 'web',
      place: Object.assign({}, value.place, { approximate: false }),
    });
  submission.originalLang = detectSubmissionLanguage(submission.answers);

  const id = db.createSubmission(submission);

  // Translate after replying: the contributor should not wait on a model, and
  // a translation outage must never cost a narrative.
  translations.enqueue(id).catch((error) => console.error('translation queue:', error));

  res.status(201).json({
    id,
    status: 'pending',
    message: 'Thank you. Your narrative is now waiting to be reviewed.',
  });
});

/* -------------------------------- admin API ------------------------------ */

app.get('/api/admin/session', (req, res) => {
  res.json({ authenticated: auth.isAuthenticated(req) });
});

app.post('/api/admin/login', (req, res) => {
  const limit = loginLimit(clientKey(req));
  if (!limit.ok) {
    res.set('Retry-After', String(limit.retryAfter));
    res.status(429).json({ error: 'Too many attempts. Wait a few minutes.' });
    return;
  }
  if (!auth.checkPassword(req.body && req.body.password)) {
    res.status(401).json({ error: 'Wrong password.' });
    return;
  }
  auth.setSessionCookie(res, auth.issueToken());
  res.json({ authenticated: true });
});

app.post('/api/admin/logout', (req, res) => {
  auth.clearSessionCookie(res);
  res.json({ authenticated: false });
});

app.get('/api/admin/submissions', auth.requireAdmin, (req, res) => {
  res.json({
    submissions: db.listForReview(req.query.status),
    counts: db.counts(),
  });
});

app.get('/api/admin/submissions/:id', auth.requireAdmin, (req, res) => {
  const submission = db.getAny(req.params.id);
  if (!submission) {
    res.status(404).json({ error: 'No submission with that id.' });
    return;
  }
  res.json({ submission });
});

app.post('/api/admin/submissions/:id/status', auth.requireAdmin, (req, res) => {
  const { status, note } = req.body || {};
  if (!db.STATUSES.includes(status)) {
    res.status(400).json({ error: `Status must be one of: ${db.STATUSES.join(', ')}.` });
    return;
  }
  if (!db.setStatus(req.params.id, status, typeof note === 'string' ? note.trim() : null)) {
    res.status(404).json({ error: 'No submission with that id.' });
    return;
  }
  res.json({ submission: db.getAny(req.params.id), counts: db.counts() });
});

app.put('/api/admin/submissions/:id', auth.requireAdmin, (req, res) => {
  if (!db.getAny(req.params.id)) {
    res.status(404).json({ error: 'No submission with that id.' });
    return;
  }
  const { value, errors } = validateSubmission(req.body);
  if (!value) {
    res.status(400).json({ error: 'The edited narrative is not valid.', errors });
    return;
  }
  const existing = db.getAny(req.params.id);
  const edited = req.body && req.body.translation;
  const translation = edited && typeof edited === 'object'
    ? {
      answers: sanitiseTranslation(edited.answers),
      placeName: typeof edited.placeName === 'string' ? edited.placeName.trim() || null : null,
      // Once a person has touched it, it is no longer the model's output.
      status: 'edited',
    }
    : {
      answers: existing.answersTranslated,
      placeName: existing.place.nameTranslated,
      status: (existing.private && existing.private.translationStatus) || 'pending',
    };

  db.updateNarrative(req.params.id, Object.assign({}, value, { translation }));
  res.json({ submission: db.getAny(req.params.id) });
});

app.post('/api/admin/submissions/:id/translate', auth.requireAdmin, async (req, res) => {
  if (!db.getAny(req.params.id)) {
    res.status(404).json({ error: 'No submission with that id.' });
    return;
  }
  const result = await translations.translateOne(req.params.id);
  res.json({ result, submission: db.getAny(req.params.id) });
});

app.delete('/api/admin/submissions/:id', auth.requireAdmin, (req, res) => {
  if (!db.deleteNarrative(req.params.id)) {
    res.status(404).json({ error: 'No submission with that id.' });
    return;
  }
  res.json({ deleted: true, counts: db.counts() });
});

/** Keeps only known question ids, with trimmed string values. */
function sanitiseTranslation(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const question of QUESTIONS) {
    const value = input[question.id];
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed) out[question.id] = trimmed.slice(0, 12000);
  }
  return Object.keys(out).length ? out : null;
}

/* --------------------------------- pages --------------------------------- */

/**
 * Everything the browser holds must revalidate on each load.
 *
 * The pages and the API are two halves of one program: the API's shape changes
 * with the client that reads it. Letting a browser keep a script for an hour
 * means a deploy can pair yesterday's JavaScript with today's API, which
 * renders as broken text rather than as an error anyone would notice. ETags
 * make revalidation a 304 with no body, so the cost is one small round trip
 * and the guarantee is that a deploy is never half-applied.
 */
const STATIC_OPTIONS = { etag: true, lastModified: true, maxAge: 0, cacheControl: true };

// Leaflet is a dependency rather than a checked-in copy, so it is served
// straight out of node_modules at the path the pages reference.
app.use('/vendor/leaflet', express.static(
  path.join(__dirname, 'node_modules', 'leaflet', 'dist'),
  STATIC_OPTIONS,
));

app.use(express.static(
  path.join(__dirname, 'public'),
  Object.assign({ extensions: ['html'] }, STATIC_OPTIONS),
));

app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    res.status(404).json({ error: 'Unknown endpoint.' });
    return;
  }
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err && err.type === 'entity.too.large') {
    res.status(413).json({ error: 'That submission is too large.' });
    return;
  }
  if (err && err.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Malformed request body.' });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on our side.' });
});

const PORT = Number(process.env.PORT || 3000);

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n  Narrative Map running at http://localhost:${PORT}`);
    console.log(`  Review queue:            http://localhost:${PORT}/admin`);
    console.log(`  Database:                ${db.DB_PATH}`);
    if (generatedPassword) {
      console.log('\n  ─────────────────────────────────────────────────');
      console.log(`  Admin password (generated): ${generatedPassword}`);
      console.log('  Saved to data/.admin-password. Set ADMIN_PASSWORD to');
      console.log('  choose your own.');
      console.log('  ─────────────────────────────────────────────────');
    }
    console.log('');
    // Anything a restart or an outage left unfinished.
    translations.resumePending().catch((error) => console.error('translation resume:', error));
  });
}

module.exports = app;
