'use strict';

/**
 * Translates submissions in the background.
 *
 * Translation must not hold up a submission: a contributor pressing send should
 * get their confirmation immediately, whether or not a model is reachable. So
 * the narrative is stored first and translated after, and a failure leaves a
 * status the moderator can see and retry rather than losing anything.
 *
 * Work runs one at a time. Submissions arrive slowly and a queue of one keeps
 * the failure modes simple and the API usage predictable.
 */

const db = require('./db');
const { QUESTIONS } = require('./questions');
const {
  translateSubmission, isConfigured, TranslationError,
} = require('./translate');

const queue = [];
let running = false;
let translator = translateSubmission;

// The current pass over the queue, so callers that did not enqueue the work
// themselves — a request handler, a test — can still wait for it to settle.
let currentDrain = Promise.resolve();

/** Swapped in tests so the queue can be exercised without calling the API. */
function setTranslator(fn) {
  translator = fn || translateSubmission;
}

function targetLanguage(originalLang) {
  return originalLang === 'fa' ? 'en' : 'fa';
}

/** True when a narrative has nothing worth sending to a model. */
function hasTranslatableText(answers) {
  return QUESTIONS.some((q) => (
    q.type !== 'select' && q.type !== 'multiselect' && answers[q.id]
  ));
}

async function translateOne(publicId) {
  const narrative = db.getAny(publicId);
  if (!narrative) return { status: 'missing' };

  if (!hasTranslatableText(narrative.answers)) {
    db.setTranslation(publicId, { status: 'skipped', error: null });
    return { status: 'skipped' };
  }

  if (!isConfigured()) {
    db.setTranslation(publicId, {
      status: 'skipped',
      error: 'No translation credentials configured.',
    });
    return { status: 'skipped' };
  }

  const from = narrative.originalLang;
  const to = targetLanguage(from);

  try {
    const result = await translator({
      answers: narrative.answers,
      placeName: narrative.place.name,
      from,
      to,
    });
    db.setTranslation(publicId, {
      answers: result.answers,
      placeName: result.placeName,
      status: 'done',
      model: result.model,
      error: null,
    });
    return { status: 'done' };
  } catch (error) {
    const message = error instanceof TranslationError
      ? error.message
      : `Unexpected translation failure: ${error.message}`;
    console.error(`translation failed for ${publicId}:`, message);
    db.setTranslation(publicId, { status: 'failed', error: message });
    return { status: 'failed', error: message };
  }
}

function drain() {
  if (running) return currentDrain;
  running = true;
  currentDrain = (async () => {
    try {
      while (queue.length) {
        const publicId = queue.shift();
        // One failure must not stop the queue for everything behind it.
        await translateOne(publicId).catch((error) => {
          console.error('translation queue error:', error);
        });
      }
    } finally {
      running = false;
    }
  })();
  return currentDrain;
}

/** Resolves once the queue has finished whatever it is working through. */
function whenIdle() {
  return currentDrain;
}

/** Queues a narrative for translation. Returns a promise for tests to await. */
function enqueue(publicId) {
  if (!queue.includes(publicId)) queue.push(publicId);
  return drain();
}

/** Picks up anything left unfinished, e.g. after a restart or an outage. */
function resumePending(limit = 20) {
  for (const narrative of db.listAwaitingTranslation(limit)) {
    if (!queue.includes(narrative.id)) queue.push(narrative.id);
  }
  return drain();
}

function pendingCount() {
  return queue.length;
}

module.exports = {
  enqueue, resumePending, translateOne, setTranslator, pendingCount, whenIdle,
  hasTranslatableText, targetLanguage,
};
