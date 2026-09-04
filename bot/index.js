'use strict';

/**
 * The Telegram bot.
 *
 * It collects a narrative through the same questionnaire the website uses, then
 * posts it to the website's API, where it lands in the same review queue. The
 * bot never touches the database directly — it is a separate process, possibly
 * on a separate machine, and the API is the one way in.
 */

const { createClient, escapeHtml, inlineKeyboard } = require('./telegram');
const convo = require('./conversation');
const { PROVINCES, citiesOf } = require('./provinces');
const { t, PERSIAN_MONTHS } = require('./strings');
const { QUESTIONS } = require('../src/questions');
const { provinceCentroid } = require('../src/geo');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const POLL_SECONDS = Number(process.env.BOT_POLL_SECONDS || 30);

// Read at call time rather than at load, so the address can be set by whatever
// starts the process — and so tests can point it at a server on a random port.
const apiBase = () => (process.env.NARRATIVEMAP_API || 'http://localhost:3000').replace(/\/$/, '');
const botToken = () => process.env.BOT_API_TOKEN || '';
const SESSION_TTL_MS = Number(process.env.BOT_SESSION_TTL_MIN || 120) * 60 * 1000;

/* -------------------------------- sessions -------------------------------- */

const sessions = new Map();

function getSession(chatId) {
  const session = sessions.get(chatId);
  if (!session) return null;
  if (Date.now() - session.updatedAt > SESSION_TTL_MS) {
    sessions.delete(chatId);
    return null;
  }
  return session;
}

/** Language survives an abandoned conversation, so it is remembered separately. */
const languages = new Map();

function langFor(chatId) {
  return languages.get(chatId) || 'fa';
}

function sweepSessions() {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [chatId, session] of sessions) {
    if (session.updatedAt < cutoff) sessions.delete(chatId);
  }
}

/* -------------------------------- keyboards ------------------------------- */

function buildKeyboard(kind, session) {
  const lang = session ? session.lang : 'fa';

  switch (kind) {
    case 'skip':
      return inlineKeyboard([{ text: t('skip', lang), callback_data: 'sk' }], 1);

    case 'provinces':
      return inlineKeyboard(
        PROVINCES.map((p, i) => ({ text: p.fa, callback_data: `p:${i}` })),
        2,
      );

    case 'cities': {
      const cities = citiesOf(session.place.province);
      const buttons = cities.map((c, i) => ({ text: c, callback_data: `c:${i}` }));
      buttons.push({ text: t('back', lang), callback_data: 'bk' });
      return inlineKeyboard(buttons, 2);
    }

    case 'precision':
      return inlineKeyboard(['year', 'month', 'day'].map((p) => ({
        text: t(`precision.${p}`, lang),
        callback_data: `pr:${p}`,
      })), 1);

    case 'months': {
      const names = session.period.calendar === 'jalali'
        ? PERSIAN_MONTHS[lang]
        : ['January', 'February', 'March', 'April', 'May', 'June',
          'July', 'August', 'September', 'October', 'November', 'December'];
      return inlineKeyboard(names.map((name, i) => ({
        text: name, callback_data: `m:${i + 1}`,
      })), 3);
    }

    case 'options': {
      const question = QUESTIONS.find((q) => q.id === session.questionId);
      if (!question) return undefined;
      const chosen = session.chosen[question.id] || [];
      const buttons = question.options.map((o) => ({
        // A tick shows what is already on the list, since a chat has no
        // checkboxes and the message above may have scrolled away.
        text: `${chosen.includes(o.value) ? '☑ ' : ''}${o[lang] || o.fa}`,
        callback_data: `o:${o.value}`,
      }));
      if (question.type === 'multiselect') {
        buttons.push({ text: t('choice.done', lang), callback_data: 'o:__done' });
      }
      return inlineKeyboard(buttons, 1);
    }

    case 'review':
      return inlineKeyboard([
        { text: t('review.confirm', lang), callback_data: 'rv:send' },
        { text: t('review.restart', lang), callback_data: 'rv:restart' },
        { text: t('review.cancel', lang), callback_data: 'rv:cancel' },
      ], 1);

    default:
      return undefined;
  }
}

/* ------------------------------- submission ------------------------------- */

async function submit(session) {
  const body = convo.toSubmission(session, { centroidFor: provinceCentroid });
  if (!body) return { ok: false };

  // Keyed per contributor so one person cannot use up everyone's allowance.
  body.botUserKey = `tg:${session.chatId}`;

  const token = botToken();
  const response = await fetch(`${apiBase()}/api/submissions`, {
    method: 'POST',
    headers: Object.assign(
      { 'Content-Type': 'application/json' },
      token ? { 'X-Bot-Token': token } : {},
    ),
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    return { ok: false, status: response.status, payload };
  }
  return { ok: true, id: payload.id };
}

/* --------------------------------- driving -------------------------------- */

function createBot(client) {
  async function askCurrent(chatId, session) {
    const { text, keyboard } = convo.prompt(session);
    await client.sendMessage(chatId, text, {
      reply_markup: buildKeyboard(keyboard, session),
    });
  }

  async function start(chatId) {
    const lang = langFor(chatId);
    const session = convo.newSession(lang);
    session.chatId = chatId;
    sessions.set(chatId, session);
    await askCurrent(chatId, session);
  }

  async function handleInput(chatId, input) {
    const session = getSession(chatId);
    if (!session) {
      await client.sendMessage(chatId, t('expired', langFor(chatId)));
      return;
    }

    const result = convo.apply(session, input);
    if (result.ok && result.stay) {
      // The choice list changed but the question has not been answered yet.
      await askCurrent(chatId, session);
      return;
    }
    if (!result.ok) {
      await client.sendMessage(chatId, result.error, {
        reply_markup: buildKeyboard(convo.prompt(session).keyboard, session),
      });
      return;
    }

    if (session.step === 'review') {
      const { text, keyboard } = convo.prompt(session);
      await client.sendMessage(chatId, text, { reply_markup: buildKeyboard(keyboard, session) });
      return;
    }
    await askCurrent(chatId, session);
  }

  async function handleMessage(message) {
    const chatId = message.chat.id;
    const text = (message.text || '').trim();

    if (text.startsWith('/start')) {
      const lang = langFor(chatId);
      await client.sendMessage(chatId, t('welcome', lang), {
        reply_markup: inlineKeyboard([
          { text: t('welcome.start', lang), callback_data: 'go' },
          { text: t('welcome.language', lang), callback_data: 'lang' },
        ], 1),
      });
      return;
    }
    if (text.startsWith('/cancel')) {
      sessions.delete(chatId);
      await client.sendMessage(chatId, t('cancelled', langFor(chatId)));
      return;
    }
    if (text.startsWith('/language')) {
      const next = langFor(chatId) === 'fa' ? 'en' : 'fa';
      languages.set(chatId, next);
      const session = getSession(chatId);
      if (session) session.lang = next;
      await client.sendMessage(chatId, t('language.changed', next));
      return;
    }
    if (text.startsWith('/help')) {
      await client.sendMessage(chatId, t('help', langFor(chatId)));
      return;
    }

    const location = message.location || (message.venue && message.venue.location);
    if (location) {
      await handleInput(chatId, { location });
      return;
    }
    if (!text) return;
    await handleInput(chatId, { text });
  }

  async function handleCallback(query) {
    const chatId = query.message.chat.id;
    const data = query.data || '';
    await client.answerCallbackQuery(query.id).catch(() => {});

    if (data === 'go') { await start(chatId); return; }
    if (data === 'lang') {
      const next = langFor(chatId) === 'fa' ? 'en' : 'fa';
      languages.set(chatId, next);
      await client.sendMessage(chatId, t('welcome', next), {
        reply_markup: inlineKeyboard([
          { text: t('welcome.start', next), callback_data: 'go' },
          { text: t('welcome.language', next), callback_data: 'lang' },
        ], 1),
      });
      return;
    }

    const session = getSession(chatId);
    if (!session) {
      await client.sendMessage(chatId, t('expired', langFor(chatId)));
      return;
    }

    if (data === 'sk') { await handleInput(chatId, { skip: true }); return; }
    if (data === 'bk') { await handleInput(chatId, { choice: '__back' }); return; }

    if (data.startsWith('p:')) {
      const province = PROVINCES[Number(data.slice(2))];
      await handleInput(chatId, { choice: province && province.fa });
      return;
    }
    if (data.startsWith('c:')) {
      const city = citiesOf(session.place.province)[Number(data.slice(2))];
      await handleInput(chatId, { choice: city });
      return;
    }
    if (data.startsWith('pr:')) { await handleInput(chatId, { choice: data.slice(3) }); return; }
    if (data.startsWith('m:')) { await handleInput(chatId, { choice: data.slice(2) }); return; }
    if (data.startsWith('o:')) { await handleInput(chatId, { choice: data.slice(2) }); return; }

    if (data === 'rv:cancel') {
      sessions.delete(chatId);
      await client.sendMessage(chatId, t('cancelled', session.lang));
      return;
    }
    if (data === 'rv:restart') { await start(chatId); return; }
    if (data === 'rv:send') {
      const result = await submit(session);
      if (result.ok) {
        sessions.delete(chatId);
        await client.sendMessage(chatId, t('sent', session.lang, { id: escapeHtml(result.id) }));
      } else if (result.status === 429) {
        await client.sendMessage(chatId, t('error.rateLimited', session.lang));
      } else {
        console.error('submission rejected', result.status, JSON.stringify(result.payload));
        await client.sendMessage(chatId, t('error.send', session.lang));
      }
    }
  }

  async function handleUpdate(update) {
    if (update.message) await handleMessage(update.message);
    else if (update.callback_query) await handleCallback(update.callback_query);
  }

  return { handleUpdate, handleMessage, handleCallback, start };
}

/* ---------------------------------- loop ---------------------------------- */

async function run() {
  const client = createClient(TOKEN);
  const bot = createBot(client);

  const me = await client.getMe();
  console.log(`Narrative bot running as @${me.username}`);
  console.log(`Posting narratives to ${apiBase()}`);
  if (!botToken()) {
    console.warn('BOT_API_TOKEN is not set — submissions will be held to the public per-address limit.');
  }

  let offset;
  let failures = 0;
  let stopping = false;

  const stop = () => { stopping = true; };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  const sweeper = setInterval(sweepSessions, 10 * 60 * 1000);
  sweeper.unref();

  while (!stopping) {
    try {
      const updates = await client.getUpdates(offset, POLL_SECONDS);
      failures = 0;
      for (const update of updates) {
        offset = update.update_id + 1;
        try {
          await bot.handleUpdate(update);
        } catch (error) {
          // One malformed conversation must not stop the bot for everyone else.
          console.error('update failed', update.update_id, error);
        }
      }
    } catch (error) {
      failures += 1;
      const wait = Math.min(30000, 1000 * 2 ** Math.min(failures, 5));
      console.error(`poll failed (${failures}), retrying in ${wait}ms:`, error.message);
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
  console.log('Narrative bot stopped.');
}

if (require.main === module) {
  run().catch((error) => {
    // A missing token or an unreachable site is a setup problem, not a crash to
    // read a stack trace for.
    if (!TOKEN) {
      console.error('\n  TELEGRAM_BOT_TOKEN is not set.');
      console.error('  Create a bot with @BotFather on Telegram, then set the token it gives you.');
      console.error('  See the Telegram bot section of the README.\n');
    } else if (error && error.name === 'TelegramError') {
      console.error(`\n  ${error.message}`);
      console.error('  Check that TELEGRAM_BOT_TOKEN is the full token from @BotFather.\n');
    } else {
      console.error(error);
    }
    process.exit(1);
  });
}

module.exports = { createBot, buildKeyboard, submit, sessions, languages, getSession };
