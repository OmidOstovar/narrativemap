'use strict';

const { QUESTIONS, SELECT_TYPES, toArray } = require('./questions');

/**
 * A copy of every narrative, posted out as it arrives.
 *
 * The review queue is the working copy; this is the second one, kept somewhere
 * the application cannot reach and so cannot lose. It goes out on submission
 * rather than on approval, because the point is to survive whatever might
 * happen between the two.
 *
 * Sending must never cost a narrative: a refused or unreachable mail server
 * leaves the submission stored and the contributor thanked, and says so in the
 * log. With nothing configured this does nothing at all, which is what a
 * laptop and the test suite want.
 *
 *   SMTP_URL          smtps://user%40gmail.com:app-password@smtp.gmail.com:465
 *   BACKUP_EMAIL_TO   where the copies go
 *   BACKUP_EMAIL_FROM optional; defaults to the account SMTP_URL signs in as
 */

function setting(name) {
  return (process.env[name] || '').trim();
}

function isConfigured() {
  return Boolean(setting('SMTP_URL') && setting('BACKUP_EMAIL_TO'));
}

/** Gmail and most others insist the sender be the account that signed in. */
function senderAddress() {
  const explicit = setting('BACKUP_EMAIL_FROM');
  if (explicit) return explicit;
  try {
    const user = decodeURIComponent(new URL(setting('SMTP_URL')).username);
    return user.includes('@') ? user : setting('BACKUP_EMAIL_TO');
  } catch {
    return setting('BACKUP_EMAIL_TO');
  }
}

/**
 * Turns SMTP_URL into explicit settings.
 *
 * Two things are worth doing by hand rather than leaving to the library.
 *
 * IPv4 is forced. A container is often given a DNS answer holding an IPv6
 * address it cannot actually route, and the connection then hangs until it
 * times out — which reads as "nothing happened" rather than as a fault, since
 * the credentials are never even offered.
 *
 * The timeouts are short. The default is minutes; a mail server that has not
 * answered in twenty seconds is not going to, and a moderator pressing a test
 * button deserves an answer while they are still looking at it.
 *
 * Google also shows an app password as four groups of four, and it gets copied
 * that way. Gmail then refuses it: the grouping is for reading. Those spaces
 * are dropped for Gmail's own server and nowhere else, since elsewhere a space
 * in a password is a character like any other.
 */
function transportOptions(raw) {
  const url = new URL(raw);
  const port = Number(url.port) || (url.protocol === 'smtps:' ? 465 : 587);
  let pass = decodeURIComponent(url.password);
  if (url.hostname === 'smtp.gmail.com') pass = pass.replace(/\s+/g, '');

  return {
    host: url.hostname,
    port,
    secure: url.protocol === 'smtps:' || port === 465,
    auth: { user: decodeURIComponent(url.username), pass },
    family: Number(process.env.SMTP_FAMILY || 4),
    connectionTimeout: 20000,
    greetingTimeout: 20000,
    socketTimeout: 30000,
  };
}

/** Kept for the tests: the password as it will actually be presented. */
function normaliseUrl(raw) {
  try {
    const { auth } = transportOptions(raw);
    const url = new URL(raw);
    url.password = encodeURIComponent(auth.pass);
    return url.toString();
  } catch {
    return raw;
  }
}

let cached = null;
function transport() {
  if (!cached) {
    // Required here rather than at the top so the module loads without the
    // dependency present, which keeps the server startable either way.
    const nodemailer = require('nodemailer');
    cached = nodemailer.createTransport(transportOptions(setting('SMTP_URL')));
  }
  return cached;
}

/* ------------------------------- the letter ------------------------------ */

function labelFor(question, lang) {
  return question.label[lang] || question.label.fa || question.id;
}

function answerText(question, value, lang) {
  if (!SELECT_TYPES.has(question.type)) return String(value);
  return toArray(value)
    .map((code) => {
      const option = (question.options || []).find((o) => o.value === code);
      return option ? (option[lang] || option.fa || code) : code;
    })
    .join('، ');
}

function describePlace(place) {
  const parts = [];
  if (place.name) parts.push(place.name);
  if (place.province) parts.push(place.province);
  const where = parts.join(' — ') || '—';
  const point = `${Number(place.lat).toFixed(5)}, ${Number(place.lng).toFixed(5)}`;
  return place.approximate ? `${where}\n${point} (approximate)` : `${where}\n${point}`;
}

function describePeriod(period) {
  const span = period.start === period.end ? period.start : `${period.start} → ${period.end}`;
  const times = period.startTime ? ` ${period.startTime}–${period.endTime || period.startTime}` : '';
  return `${span}${times} (${period.precision})`;
}

/**
 * The whole narrative in plain text. Nothing is trimmed: a backup that shortens
 * what it stores is not a backup.
 */
function compose(id, submission) {
  const lang = submission.originalLang === 'en' ? 'en' : 'fa';
  const title = (submission.answers.narrative_title || '').trim();
  const contributor = submission.contributor || {};

  const lines = [
    `Reference: ${id}`,
    `Received:  ${new Date().toISOString()}`,
    `Source:    ${submission.source || 'web'}`,
    `Language:  ${lang}`,
    '',
    `Place:     ${describePlace(submission.place)}`,
    `When:      ${describePeriod(submission.period)}`,
    `Told by:   ${contributor.name || '—'}`,
    `Email:     ${contributor.email || '—'}`,
    '',
    '─'.repeat(60),
    '',
  ];

  for (const question of QUESTIONS) {
    const value = submission.answers[question.id];
    if (value === undefined || value === '' || (Array.isArray(value) && !value.length)) continue;
    lines.push(labelFor(question, lang));
    lines.push(answerText(question, value, lang));
    lines.push('');
  }

  return {
    subject: title ? `[${id}] ${title}` : `[${id}] narrative received`,
    text: lines.join('\n'),
  };
}

/* -------------------------------- sending -------------------------------- */

/**
 * Posts one copy. Resolves either way — the caller is answering a contributor
 * and must not be held up, still less made to fail, by a mail server.
 */
async function backup(id, submission, options = {}) {
  const send = options.transport || (isConfigured() ? transport() : null);
  if (!send) return { sent: false, reason: 'not configured' };

  const { subject, text } = compose(id, submission);
  await send.sendMail({
    from: options.from || senderAddress(),
    to: options.to || setting('BACKUP_EMAIL_TO'),
    subject,
    text,
  });
  return { sent: true, subject };
}

/**
 * Proves the settings work, without needing a narrative to test with. Errors
 * are thrown rather than swallowed: here, unlike a real submission, the whole
 * point is to hear what went wrong.
 */
async function sendTest(options = {}) {
  const send = options.transport || transport();
  await send.sendMail({
    from: options.from || senderAddress(),
    to: options.to || setting('BACKUP_EMAIL_TO'),
    subject: 'Backup is working',
    text: [
      'This is the archive checking that it can reach you.',
      '',
      'From here on, every narrative arrives in this mailbox as it is submitted,',
      'whether or not the contributor left an address of their own.',
    ].join('\n'),
  });
  return { sent: true };
}

module.exports = { backup, compose, isConfigured, senderAddress, normaliseUrl, transportOptions, sendTest };
