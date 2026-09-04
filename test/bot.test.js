'use strict';

/* Drives a whole Telegram conversation against a real server. */

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const test = require('node:test');
const assert = require('node:assert/strict');

const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'narrativemap-bot-'));
process.env.DATABASE_PATH = path.join(workdir, 'bot.db');
process.env.SESSION_SECRET = 'test-secret';
process.env.ADMIN_PASSWORD = 'test-password';
process.env.BOT_API_TOKEN = 'bot-shared-secret';
process.env.SUBMIT_LIMIT_PER_HOUR = '500';
process.env.LOGIN_LIMIT_PER_15_MIN = '500';
process.env.TELEGRAM_BOT_TOKEN = 'fake-telegram-token';

const app = require('../server');
const { createBot, sessions, languages } = require('../bot');
const { PROVINCES, citiesOf } = require('../bot/provinces');
const { QUESTIONS } = require('../src/questions');

let server;
let base;

test.before(async () => {
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  process.env.NARRATIVEMAP_API = base;
});

test.after(() => {
  server.close();
  fs.rmSync(workdir, { recursive: true, force: true });
});

/** Stands in for Telegram, recording what the bot would have sent. */
function fakeClient() {
  const sent = [];
  return {
    sent,
    last: () => sent[sent.length - 1],
    texts: () => sent.map((m) => m.text),
    sendMessage: async (chatId, text, extra) => {
      sent.push({ chatId, text, keyboard: extra && extra.reply_markup });
      return { message_id: sent.length };
    },
    answerCallbackQuery: async () => true,
    editMessageText: async () => true,
    deleteMessage: async () => true,
  };
}

const CHAT = 4242;
const message = (text) => ({ message: { chat: { id: CHAT }, text } });
const location = (latitude, longitude) => ({ message: { chat: { id: CHAT }, location: { latitude, longitude } } });
const tap = (data) => ({ callback_query: { id: '1', data, message: { chat: { id: CHAT } } } });

/** Finds the callback_data behind a button whose label matches. */
function buttonFor(keyboard, label) {
  for (const row of (keyboard || {}).inline_keyboard || []) {
    for (const button of row) if (button.text === label) return button.callback_data;
  }
  return null;
}

async function signIn() {
  const response = await fetch(`${base}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'test-password' }),
  });
  return response.headers.get('set-cookie');
}

async function queue(cookie, status = 'pending') {
  const response = await fetch(`${base}/api/admin/submissions?status=${status}`, { headers: { Cookie: cookie } });
  return (await response.json()).submissions;
}

/** Answers the question the bot is currently on, whatever kind it is. */
async function answerCurrentQuestion(bot, client) {
  const session = sessions.get(CHAT);
  const question = QUESTIONS.find((q) => q.id === session.questionId);
  assert.ok(question, `not on a question: ${session.step}`);

  if (question.type === 'multiselect' || question.type === 'select') {
    const label = question.options[0].fa;
    const data = buttonFor(client.last().keyboard, label)
      || buttonFor(client.last().keyboard, `☑ ${label}`);
    assert.ok(data, `no button for option ${label}`);
    await bot.handleUpdate(tap(data));
    if (question.type === 'multiselect') await bot.handleUpdate(tap('o:__done'));
    return;
  }
  const length = Math.max(question.minLength || 0, 20) + 5;
  await bot.handleUpdate(message('ی'.repeat(length)));
}

/**
 * Walks the whole conversation the way a contributor would, following the
 * sequence rather than a hardcoded order so the test survives a reordering.
 */
async function walkConversation(bot, client, overrides = {}) {
  const scripted = Object.assign({
    province: () => tap(`p:${PROVINCES.findIndex((p) => p.fa === 'گیلان')}`),
    city: () => tap(`c:${citiesOf('گیلان').indexOf('رشت')}`),
    location: () => location(37.2808, 49.5832),
    precision: () => tap('pr:year'),
    name: () => message('مهمان'),
    email: () => tap('sk'),
  }, overrides);

  for (let guard = 0; guard < 60; guard += 1) {
    const session = sessions.get(CHAT);
    if (!session || session.step === 'review') return;

    if (session.step === 'question') {
      await answerCurrentQuestion(bot, client);
      continue;
    }
    if (session.step === 'date') {
      await bot.handleUpdate(message('۱۳۵۷'));
      if (sessions.get(CHAT).step === 'date') await bot.handleUpdate(message('۱۳۵۸'));
      continue;
    }
    const make = scripted[session.step];
    assert.ok(make, `no scripted answer for step ${session.step}`);
    await bot.handleUpdate(make());
  }
  throw new Error('the conversation never reached the review');
}

test.beforeEach(() => { sessions.delete(CHAT); languages.delete(CHAT); });

test('/start offers to begin and does not open a session yet', async () => {
  const client = fakeClient();
  const bot = createBot(client);
  await bot.handleUpdate(message('/start'));

  assert.match(client.last().text, /روایت/);
  assert.ok(buttonFor(client.last().keyboard, '✍️ ثبت روایت تازه'));
  assert.equal(sessions.get(CHAT), undefined);
});

test('a full Telegram conversation reaches the review queue', async () => {
  const client = fakeClient();
  const bot = createBot(client);

  await bot.handleUpdate(message('/start'));
  await bot.handleUpdate(tap('go'));
  assert.equal(sessions.get(CHAT).step, 'question', 'it opens on the first question');

  await walkConversation(bot, client);
  assert.equal(sessions.get(CHAT).step, 'review');
  assert.match(client.last().text, /مرور/);

  await bot.handleUpdate(tap('rv:send'));
  assert.match(client.last().text, /کد پیگیری/);
  assert.equal(sessions.get(CHAT), undefined, 'the session closes once sent');

  const cookie = await signIn();
  const pending = await queue(cookie);
  assert.equal(pending.length, 1);

  const submission = pending[0];
  assert.equal(submission.private.source, 'telegram');
  assert.equal(submission.place.province, 'Gilan');
  assert.equal(submission.place.lat, 37.2808);
  assert.equal(submission.contributor, 'مهمان');
  assert.equal(submission.period.start, '1978-03-21');
  assert.ok(Array.isArray(submission.answers.narrative_kind));
  assert.equal(submission.place.approximate, undefined, 'a shared pin is not approximate');

  const publicList = await (await fetch(`${base}/api/narratives`)).json();
  assert.ok(!publicList.narratives.some((n) => n.id === submission.id), 'it waits for review');
});

test('skipping the location marks the narrative approximate for the moderator', async () => {
  const client = fakeClient();
  const bot = createBot(client);

  await bot.handleUpdate(tap('go'));
  await walkConversation(bot, client, {
    province: () => tap(`p:${PROVINCES.findIndex((p) => p.fa === 'یزد')}`),
    city: () => tap(`c:${citiesOf('یزد').indexOf('یزد')}`),
    location: () => tap('sk'),
    name: () => tap('sk'),
  });
  await bot.handleUpdate(tap('rv:send'));

  const cookie = await signIn();
  const submission = (await queue(cookie)).find((s) => s.place.province === 'Yazd');

  assert.ok(submission, 'the narrative arrived');
  assert.equal(submission.place.approximate, true);
  assert.equal(submission.place.province, 'Yazd', 'the fallback sits in the chosen province');
  assert.equal(submission.contributor, null, 'a skipped name is anonymous');
});

test('a multi-select shows what is already chosen and can be toggled', async () => {
  const client = fakeClient();
  const bot = createBot(client);
  await bot.handleUpdate(tap('go'));

  const question = QUESTIONS.find((q) => q.id === sessions.get(CHAT).questionId);
  assert.equal(question.type, 'multiselect');

  await bot.handleUpdate(tap(`o:${question.options[0].value}`));
  assert.deepEqual(sessions.get(CHAT).chosen[question.id], [question.options[0].value]);
  assert.ok(client.last().keyboard.inline_keyboard.flat().some((b) => b.text.startsWith('☑')),
    'the chosen option is ticked');

  await bot.handleUpdate(tap(`o:${question.options[0].value}`));
  assert.deepEqual(sessions.get(CHAT).chosen[question.id], [], 'tapping again removes it');

  const empty = sessions.get(CHAT).questionId;
  await bot.handleUpdate(tap('o:__done'));
  assert.equal(sessions.get(CHAT).questionId, empty, 'a required choice cannot be finished empty');

  await bot.handleUpdate(tap(`o:${question.options[1].value}`));
  await bot.handleUpdate(tap('o:__done'));
  assert.deepEqual(sessions.get(CHAT).answers[question.id], [question.options[1].value]);
});

test('an unusable answer is refused without losing the conversation', async () => {
  const client = fakeClient();
  const bot = createBot(client);
  await bot.handleUpdate(tap('go'));

  // Walk as far as the date, then give it something that is not a year.
  for (let guard = 0; guard < 40; guard += 1) {
    const session = sessions.get(CHAT);
    if (session.step === 'date') break;
    if (session.step === 'question') { await answerCurrentQuestion(bot, client); continue; }
    const make = {
      province: () => tap(`p:${PROVINCES.findIndex((p) => p.fa === 'فارس')}`),
      city: () => tap(`c:${citiesOf('فارس').indexOf('شیراز')}`),
      location: () => tap('sk'),
      precision: () => tap('pr:year'),
    }[session.step];
    assert.ok(make, `unexpected step ${session.step}`);
    await bot.handleUpdate(make());
  }

  await bot.handleUpdate(message('نه یک سال'));
  assert.match(client.last().text, /سال/);
  assert.equal(sessions.get(CHAT).step, 'date', 'still on the same step');

  await bot.handleUpdate(message('1360'));
  await bot.handleUpdate(message('1359'));
  assert.equal(sessions.get(CHAT).period.endYear, null, 'an end before the start is refused');

  await bot.handleUpdate(message('1362'));
  assert.equal(sessions.get(CHAT).step, 'question');
});

test('cancelling clears the conversation', async () => {
  const client = fakeClient();
  const bot = createBot(client);
  await bot.handleUpdate(tap('go'));
  assert.ok(sessions.get(CHAT));

  await bot.handleUpdate(message('/cancel'));
  assert.equal(sessions.get(CHAT), undefined);
  assert.match(client.last().text, /لغو/);
});

test('language switches the whole conversation to English', async () => {
  const client = fakeClient();
  const bot = createBot(client);
  await bot.handleUpdate(message('/language'));
  assert.match(client.last().text, /English/);

  await bot.handleUpdate(tap('go'));
  assert.equal(sessions.get(CHAT).lang, 'en');
  assert.match(client.last().text, /What kind of narrative/);
});

test('a public submission cannot claim to be from Telegram or be approximate', async () => {
  const response = await fetch(`${base}/api/submissions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      answers: {
        narrative_kind: ['chronicle'],
        how_you_know: ['lived'],
        narrative_title: 'Claimed privileges',
        what_happened: 'A submission from the open internet claiming privileges it was never granted, written long enough to clear the minimum length.',
      },
      place: { name: 'Somewhere', lat: 35.6892, lng: 51.389, approximate: true },
      period: { start: '1979-01-01', end: '1979-12-31', precision: 'year' },
      contributor: { name: 'Impostor' },
      source: 'telegram',
    }),
  });
  assert.equal(response.status, 201);
  const { id } = await response.json();

  const cookie = await signIn();
  const submission = (await queue(cookie)).find((s) => s.id === id);
  assert.equal(submission.private.source, 'web', 'a claimed source is ignored');
  assert.equal(submission.place.approximate, undefined, 'a claimed approximate flag is ignored');
});

test('a wrong bot token is treated as an ordinary visitor', async () => {
  const response = await fetch(`${base}/api/submissions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Bot-Token': 'not-the-secret' },
    body: JSON.stringify({
      answers: {
        narrative_kind: ['other'],
        how_you_know: ['other'],
        narrative_title: 'A mismatched token',
        what_happened: 'This one carries a token that does not match the shared secret, so none of the privileges the bot is granted should apply to it at all.',
      },
      place: { name: 'Somewhere', lat: 32.6546, lng: 51.668 },
      period: { start: '1990-01-01', end: '1990-12-31', precision: 'year' },
      contributor: {},
      source: 'telegram',
    }),
  });
  assert.equal(response.status, 201);
  const { id } = await response.json();
  const cookie = await signIn();
  assert.equal((await queue(cookie)).find((s) => s.id === id).private.source, 'web');
});

test('input after the session expires is answered, not dropped', async () => {
  const client = fakeClient();
  const bot = createBot(client);
  await bot.handleUpdate(message('some text with no session'));
  assert.match(client.last().text, /expired|منقضی/);
});
