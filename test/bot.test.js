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

/** Answers whatever question the bot is currently on. */
async function answerQuestions(bot, client) {
  let guard = 0;
  while (sessions.get(CHAT) && sessions.get(CHAT).step === 'question' && guard++ < 40) {
    const question = QUESTIONS[sessions.get(CHAT).questionIndex];
    if (question.type === 'select') {
      const label = question.options[0].fa;
      const data = buttonFor(client.last().keyboard, label);
      assert.ok(data, `no button for option ${label}`);
      await bot.handleUpdate(tap(data));
    } else {
      const length = Math.max(question.minLength || 0, 20) + 5;
      await bot.handleUpdate(message('ی'.repeat(length)));
    }
  }
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
  assert.equal(sessions.get(CHAT).step, 'name');

  await bot.handleUpdate(message('مهمان'));

  const gilan = PROVINCES.findIndex((p) => p.fa === 'گیلان');
  await bot.handleUpdate(tap(`p:${gilan}`));
  const rasht = citiesOf('گیلان').indexOf('رشت');
  await bot.handleUpdate(tap(`c:${rasht}`));

  await bot.handleUpdate(message('کوچهٔ پشت بازار ماهی‌فروش‌ها'));
  await bot.handleUpdate(location(37.2808, 49.5832));

  await bot.handleUpdate(tap('pr:year'));
  await bot.handleUpdate(message('۱۳۵۷'));
  await bot.handleUpdate(message('۱۳۵۸'));

  await answerQuestions(bot, client);

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
  assert.equal(submission.place.approximate, undefined, 'a shared pin is not approximate');

  const publicList = await (await fetch(`${base}/api/narratives`)).json();
  assert.ok(!publicList.narratives.some((n) => n.id === submission.id), 'it waits for review');
});

test('skipping the location marks the narrative approximate for the moderator', async () => {
  const client = fakeClient();
  const bot = createBot(client);

  await bot.handleUpdate(tap('go'));
  await bot.handleUpdate(tap('sk'));

  const yazd = PROVINCES.findIndex((p) => p.fa === 'یزد');
  await bot.handleUpdate(tap(`p:${yazd}`));
  await bot.handleUpdate(tap(`c:${citiesOf('یزد').indexOf('یزد')}`));
  await bot.handleUpdate(message('پشت‌بام خانهٔ قدیمی'));
  await bot.handleUpdate(tap('sk'));

  await bot.handleUpdate(tap('pr:day'));
  await bot.handleUpdate(message('1357'));
  await bot.handleUpdate(tap('m:11'));
  await bot.handleUpdate(message('22'));

  await answerQuestions(bot, client);
  await bot.handleUpdate(tap('rv:send'));

  const cookie = await signIn();
  const pending = await queue(cookie);
  const submission = pending.find((s) => s.place.name.includes('پشت‌بام'));

  assert.ok(submission, 'the narrative arrived');
  assert.equal(submission.place.approximate, true);
  assert.equal(submission.place.province, 'Yazd', 'the fallback sits in the chosen province');
  assert.equal(submission.contributor, null, 'a skipped name is anonymous');
  assert.equal(submission.period.start, '1979-02-11');
  assert.equal(submission.period.end, '1979-02-11');
});

test('an unusable answer is refused without losing the conversation', async () => {
  const client = fakeClient();
  const bot = createBot(client);

  await bot.handleUpdate(tap('go'));
  await bot.handleUpdate(tap('sk'));
  await bot.handleUpdate(tap(`p:${PROVINCES.findIndex((p) => p.fa === 'فارس')}`));
  await bot.handleUpdate(tap(`c:${citiesOf('فارس').indexOf('شیراز')}`));
  await bot.handleUpdate(message('پلهٔ سوم'));
  await bot.handleUpdate(tap('sk'));
  await bot.handleUpdate(tap('pr:year'));

  await bot.handleUpdate(message('نه یک سال'));
  assert.match(client.last().text, /سال/);
  assert.equal(sessions.get(CHAT).step, 'date', 'still on the same step');

  await bot.handleUpdate(message('1360'));
  await bot.handleUpdate(message('1359'));
  assert.equal(sessions.get(CHAT).period.endYear, null, 'an end before the start is refused');

  await bot.handleUpdate(message('1362'));
  assert.equal(sessions.get(CHAT).step, 'question');
});

test('a required question cannot be skipped from the keyboard', async () => {
  const client = fakeClient();
  const bot = createBot(client);

  await bot.handleUpdate(tap('go'));
  await bot.handleUpdate(tap('sk'));
  await bot.handleUpdate(tap(`p:${PROVINCES.findIndex((p) => p.fa === 'تهران')}`));
  await bot.handleUpdate(tap(`c:${citiesOf('تهران').indexOf('تهران')}`));
  await bot.handleUpdate(message('بازار بزرگ'));
  await bot.handleUpdate(tap('sk'));
  await bot.handleUpdate(tap('pr:year'));
  await bot.handleUpdate(message('1357'));
  await bot.handleUpdate(message('1357'));

  assert.equal(QUESTIONS[0].required, true);
  await bot.handleUpdate(tap('sk'));
  assert.equal(sessions.get(CHAT).questionIndex, 0, 'it did not move on');
});

test('cancelling clears the conversation', async () => {
  const client = fakeClient();
  const bot = createBot(client);
  await bot.handleUpdate(tap('go'));
  await bot.handleUpdate(message('کسی'));
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
  assert.match(client.last().text, /name should appear/);
  assert.equal(sessions.get(CHAT).lang, 'en');
});

test('a public submission cannot claim to be from Telegram or be approximate', async () => {
  const response = await fetch(`${base}/api/submissions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      answers: {
        title: 'Pretending to be the bot',
        what_happened: 'A submission from the open internet claiming privileges it was never granted, written long enough to clear the minimum length.',
        why_here: 'Because this is exactly the corner where it supposedly happened.',
        how_you_know: 'lived',
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
  const pending = await queue(cookie);
  const submission = pending.find((s) => s.id === id);

  assert.equal(submission.private.source, 'web', 'a claimed source is ignored');
  assert.equal(submission.place.approximate, undefined, 'a claimed approximate flag is ignored');
});

test('a wrong bot token is treated as an ordinary visitor', async () => {
  const response = await fetch(`${base}/api/submissions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Bot-Token': 'not-the-secret' },
    body: JSON.stringify({
      answers: {
        title: 'Wrong token',
        what_happened: 'This one carries a token that does not match the shared secret, so none of the privileges the bot is granted should apply to it, and it must be treated as an ordinary visitor.',
        why_here: 'Because the corner is where the whole thing is supposed to have taken place.',
        how_you_know: 'lived',
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
  const submission = (await queue(cookie)).find((s) => s.id === id);
  assert.equal(submission.private.source, 'web');
});

test('input after the session expires is answered, not dropped', async () => {
  const client = fakeClient();
  const bot = createBot(client);
  await bot.handleUpdate(message('some text with no session'));
  assert.match(client.last().text, /expired|منقضی/);
});
