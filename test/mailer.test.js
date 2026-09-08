'use strict';

/**
 * The backup copy. What matters is that it carries the whole narrative, and
 * that a mail server having a bad day cannot cost the archive a submission.
 */

const test = require('node:test');
const assert = require('node:assert');

const mailer = require('../src/mailer');

const SUBMISSION = {
  answers: {
    narrative_title: 'شبی که برق رفت',
    narrative_kind: ['chronicle', 'impression'],
    how_you_know: ['lived'],
    what_happened: 'متن کاملِ روایت، که باید بی‌کم‌وکاست در نسخهٔ پشتیبان بیاید.',
    what_it_left: 'آنچه بر جا ماند.',
  },
  place: { name: 'کوچه‌ای پشت بازار', province: 'Gilan', lat: 37.2808, lng: 49.5832 },
  period: { start: '2026-01-08', end: '2026-01-08', precision: 'hour', startTime: '21:00', endTime: '23:30' },
  contributor: { name: 'ناشناس', email: 'someone@example.com' },
  originalLang: 'fa',
  source: 'web',
};

function fakeTransport() {
  const sent = [];
  return {
    sent,
    sendMail(message) { sent.push(message); return Promise.resolve({ messageId: 'x' }); },
  };
}

test('the letter carries the narrative whole', () => {
  const { subject, text } = mailer.compose('abc123', SUBMISSION);

  assert.match(subject, /abc123/, 'the reference is in the subject');
  assert.match(subject, /شبی که برق رفت/, 'and so is the title, to make it findable');

  assert.match(text, /متن کاملِ روایت، که باید بی‌کم‌وکاست در نسخهٔ پشتیبان بیاید\./);
  assert.match(text, /آنچه بر جا ماند\./, 'every answered question travels');
  assert.match(text, /کوچه‌ای پشت بازار/);
  assert.match(text, /37\.28080, 49\.58320/);
  assert.match(text, /2026-01-08 21:00–23:30/);
  assert.match(text, /someone@example\.com/, 'so a moderator can reply if they need to');
});

test('choices are written out, not left as codes', () => {
  const { text } = mailer.compose('abc123', SUBMISSION);
  assert.ok(!text.includes('chronicle'), 'the stored code is meaningless in a mailbox');
  assert.match(text, /واقعه‌نگاری/);
});

test('an English narrative is labelled in English', () => {
  const { text } = mailer.compose('abc123', Object.assign({}, SUBMISSION, {
    originalLang: 'en',
    answers: { what_happened: 'Told in English.', how_you_know: ['lived'] },
  }));
  assert.match(text, /How do you know this\?/);
  assert.match(text, /I lived through it myself\./);
});

test('an approximate pin says so', () => {
  const { text } = mailer.compose('abc123', Object.assign({}, SUBMISSION, {
    place: Object.assign({}, SUBMISSION.place, { approximate: true }),
  }));
  assert.match(text, /\(approximate\)/);
});

test('with nothing configured it stays quiet', async () => {
  const result = await mailer.backup('abc123', SUBMISSION);
  assert.deepEqual(result, { sent: false, reason: 'not configured' });
});

test('a configured transport receives the copy', async () => {
  const transport = fakeTransport();
  const result = await mailer.backup('abc123', SUBMISSION, {
    transport, to: 'keeper@example.com', from: 'archive@example.com',
  });

  assert.equal(result.sent, true);
  assert.equal(transport.sent.length, 1);
  const [message] = transport.sent;
  assert.equal(message.to, 'keeper@example.com');
  assert.equal(message.from, 'archive@example.com');
  assert.match(message.text, /شبی که برق رفت|متن کاملِ روایت/);
});

test('the sender defaults to the account the server signs in as', () => {
  const saved = process.env.SMTP_URL;
  process.env.SMTP_URL = 'smtps://keeper%40gmail.com:secret@smtp.gmail.com:465';
  try {
    assert.equal(mailer.senderAddress(), 'keeper@gmail.com');
  } finally {
    if (saved === undefined) delete process.env.SMTP_URL; else process.env.SMTP_URL = saved;
  }
});

test('a Gmail app password copied with its spaces still works', () => {
  const spaced = 'smtps://you%40gmail.com:abcd efgh ijkl mnop@smtp.gmail.com:465';
  assert.equal(
    decodeURIComponent(new URL(mailer.normaliseUrl(spaced)).password),
    'abcdefghijklmnop',
    'Google prints it in fours; the spaces are not part of it',
  );
});

test('a space in any other password is left alone', () => {
  const elsewhere = 'smtp://user:one%20two@smtp.example.com:587';
  assert.equal(
    decodeURIComponent(new URL(mailer.normaliseUrl(elsewhere)).password),
    'one two',
    'only Gmail makes this promise',
  );
});
