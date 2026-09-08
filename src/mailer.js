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

let cached = null;
function transport() {
  if (!cached) {
    // Required here rather than at the top so the module loads without the
    // dependency present, which keeps the server startable either way.
    const nodemailer = require('nodemailer');
    cached = nodemailer.createTransport(setting('SMTP_URL'));
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

module.exports = { backup, compose, isConfigured, senderAddress };
