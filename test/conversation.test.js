'use strict';

/* The submission conversation, driven end to end without a network. */

const test = require('node:test');
const assert = require('node:assert/strict');

const convo = require('../bot/conversation');
const { QUESTIONS } = require('../src/questions');
const { provinceCentroid } = require('../src/geo');
const { validateSubmission } = require('../src/validate');

const centroidFor = (name) => provinceCentroid(name);

/** Answers whatever the session is currently asking, so tests stay short. */
function answerCurrent(session, { skipOptional = false } = {}) {
  const question = QUESTIONS.find((q) => q.id === session.questionId);
  if (!question) throw new Error(`not on a question: ${session.step}`);
  if (skipOptional && !question.required) return convo.apply(session, { skip: true });
  if (question.type === 'multiselect' || question.type === 'select') {
    convo.apply(session, { choice: question.options[0].value });
    return convo.apply(session, { choice: '__done' });
  }
  const length = Math.max(question.minLength || 0, 12) + 5;
  return convo.apply(session, { text: 'ب'.repeat(length) });
}

/**
 * Drives a session to whatever step is named, answering everything before it
 * the way a contributor would. The sequence lives in the questionnaire, so
 * tests follow it rather than hardcoding an order that can drift.
 */
function driveTo(session, target, overrides = {}) {
  const answers = Object.assign({
    province: { choice: 'گیلان' },
    city: { choice: 'رشت' },
    place: { text: 'کوچهٔ پشت بازار' },
    location: { location: { latitude: 37.2808, longitude: 49.5832 } },
    precision: { choice: 'year' },
    name: { text: 'آزمونگر' },
    email: { skip: true },
  }, overrides);

  for (let guard = 0; guard < 60; guard += 1) {
    if (session.step === target) return session;
    if (session.step === 'review') return session;

    if (session.step === 'question') {
      const result = answerCurrent(session);
      assert.ok(result.ok, `question ${session.questionId}: ${result.error}`);
      continue;
    }
    if (session.step === 'date') {
      convo.apply(session, { text: '1357' });
      if (session.step === 'date') convo.apply(session, { text: '1358' });
      continue;
    }
    const input = answers[session.step];
    assert.ok(input, `no scripted answer for step ${session.step}`);
    const result = convo.apply(session, input);
    assert.ok(result.ok, `step ${session.step}: ${result.error}`);
  }
  throw new Error(`never reached ${target}`);
}

/** Drives all the way to the review screen. */
function driveToReview(session, overrides = {}) {
  return driveTo(session, 'review', overrides);
}

test('a session walks the questionnaire in the order it declares', () => {
  const session = convo.newSession('fa');
  assert.equal(session.step, 'question', 'the first step is the first question');
  assert.equal(session.questionId, 'narrative_kind');

  driveTo(session, 'place');
  assert.equal(session.place.province, 'گیلان');
  assert.equal(session.place.provinceEn, 'Gilan');
  assert.deepEqual(session.answers.narrative_kind, ['chronicle']);
});

test('every step produces a prompt in both languages', () => {
  for (const lang of ['fa', 'en']) {
    const session = convo.newSession(lang);
    let guard = 0;
    while (session.step !== 'review' && guard++ < 60) {
      const { text } = convo.prompt(session);
      assert.ok(text && text.length > 4, `empty prompt at ${session.step}`);
      assert.ok(!text.includes('undefined'), `prompt leaked undefined: ${text}`);
      driveTo(session, '__never__');
      break;
    }
    const finished = driveToReview(convo.newSession(lang));
    assert.equal(finished.step, 'review');
    const review = convo.prompt(finished);
    assert.ok(!review.text.includes('undefined'));
  }
});

test('a multi-select keeps every option chosen, and toggles one back off', () => {
  const session = convo.newSession('fa');
  assert.equal(session.questionId, 'narrative_kind');

  convo.apply(session, { choice: 'chronicle' });
  convo.apply(session, { choice: 'impression' });
  assert.deepEqual(session.chosen.narrative_kind, ['chronicle', 'impression']);

  const toggled = convo.apply(session, { choice: 'chronicle' });
  assert.ok(toggled.stay, 'toggling stays on the same question');
  assert.deepEqual(session.chosen.narrative_kind, ['impression']);

  convo.apply(session, { choice: '__done' });
  assert.deepEqual(session.answers.narrative_kind, ['impression']);
  assert.equal(session.questionId, 'how_you_know', 'it moved on');
});

test('a required multi-select cannot be finished empty', () => {
  const session = convo.newSession('fa');
  const result = convo.apply(session, { choice: '__done' });
  assert.equal(result.ok, false);
  assert.equal(session.questionId, 'narrative_kind', 'it did not move on');
});

test('years are accepted in either calendar and in Persian digits', () => {
  assert.deepEqual(convo.readYear('1357'), { calendar: 'jalali', year: 1357 });
  assert.deepEqual(convo.readYear('۱۳۵۷'), { calendar: 'jalali', year: 1357 });
  assert.deepEqual(convo.readYear('1979'), { calendar: 'gregorian', year: 1979 });
  assert.equal(convo.readYear('nope'), null);
  assert.equal(convo.readYear('99'), null);
});

test('times are read in either script and in loose formats', () => {
  assert.equal(convo.readTime('14:30'), '14:30');
  assert.equal(convo.readTime('۱۴:۳۰'), '14:30');
  assert.equal(convo.readTime('9:05'), '09:05');
  assert.equal(convo.readTime('1430'), '14:30');
  assert.equal(convo.readTime('14.30'), '14:30');
  assert.equal(convo.readTime('25:00'), null);
  assert.equal(convo.readTime('later'), null);
});

test('a Solar Hijri year becomes the right Gregorian range', () => {
  const session = convo.newSession('fa');
  driveTo(session, 'date');
  convo.apply(session, { text: '۱۳۵۷' });
  convo.apply(session, { text: '۱۳۵۷' });

  const period = convo.resolvePeriod(session);
  assert.equal(period.precision, 'year');
  assert.equal(period.start, '1978-03-21');
  assert.equal(period.end, '1979-03-20');
});

test('a single day resolves to that exact date', () => {
  const session = convo.newSession('fa');
  driveTo(session, 'date', { precision: { choice: 'day' } });
  convo.apply(session, { text: '1357' });
  convo.apply(session, { choice: '11' });
  const result = convo.apply(session, { text: '22' });
  assert.ok(result.ok, result.error);
  assert.deepEqual(convo.resolvePeriod(session), { start: '1979-02-11', end: '1979-02-11', precision: 'day' });
});

test('an hour-precision narrative carries the time through to the API', () => {
  const session = convo.newSession('fa');
  driveTo(session, 'date', { precision: { choice: 'hour' } });
  convo.apply(session, { text: '1357' });
  convo.apply(session, { choice: '11' });
  convo.apply(session, { text: '22' });
  assert.ok(convo.apply(session, { text: '۱۴:۰۰' }).ok);
  assert.ok(convo.apply(session, { text: '۱۶:۳۰' }).ok);

  assert.deepEqual(convo.resolvePeriod(session), {
    start: '1979-02-11', end: '1979-02-11', precision: 'hour',
    startTime: '14:00', endTime: '16:30',
  });
});

test('an hour range crossing midnight lands on the next day', () => {
  const session = convo.newSession('fa');
  driveTo(session, 'date', { precision: { choice: 'hour' } });
  convo.apply(session, { text: '1357' });
  convo.apply(session, { choice: '11' });
  convo.apply(session, { text: '22' });
  convo.apply(session, { text: '23:00' });
  convo.apply(session, { text: '02:00' });

  const period = convo.resolvePeriod(session);
  assert.equal(period.start, '1979-02-11');
  assert.equal(period.end, '1979-02-12');
});

test('an impossible day is refused rather than stored', () => {
  const session = convo.newSession('fa');
  driveTo(session, 'date', { precision: { choice: 'day' } });
  convo.apply(session, { text: '1404' });
  convo.apply(session, { choice: '12' });

  const bad = convo.apply(session, { text: '30' }); // Esfand 1404 has 29 days
  assert.equal(bad.ok, false);
  assert.equal(session.period.day, null);
  assert.ok(convo.apply(session, { text: '29' }).ok);
});

test('an end year before the start year is refused', () => {
  const session = convo.newSession('fa');
  driveTo(session, 'date');
  convo.apply(session, { text: '1360' });
  const result = convo.apply(session, { text: '1350' });
  assert.equal(result.ok, false);
  assert.equal(session.period.endYear, null);
});

test('a required question cannot be skipped', () => {
  const session = convo.newSession('fa');
  driveTo(session, 'question');
  const question = QUESTIONS.find((q) => q.id === session.questionId);
  assert.equal(question.required, true);
  const result = convo.apply(session, { skip: true });
  assert.equal(result.ok, false);
});

test('an answer below the minimum length is refused', () => {
  const session = convo.newSession('fa');
  driveTo(session, 'date');
  convo.apply(session, { text: '1357' });
  convo.apply(session, { text: '1357' });

  assert.equal(session.questionId, 'what_happened');
  const result = convo.apply(session, { text: 'کوتاه' });
  assert.equal(result.ok, false);
  assert.match(result.error, /\d/);
});

test('a completed session becomes a submission the API accepts', () => {
  const session = driveToReview(convo.newSession('fa'));
  const body = convo.toSubmission(session, { centroidFor });
  assert.ok(body);
  assert.equal(body.source, 'telegram');
  assert.equal(body.place.approximate, false);
  assert.equal(body.place.lat, 37.2808);

  const { value, errors } = validateSubmission(body);
  assert.deepEqual(errors, [], 'the bot must not build a submission the API rejects');
  assert.equal(value.place.province, 'Gilan');
  assert.ok(Array.isArray(value.answers.narrative_kind));
});

test('skipping the location falls back to the province centre and says so', () => {
  const session = driveToReview(convo.newSession('fa'), { location: { skip: true } });
  assert.equal(session.place.approximate, true);

  const body = convo.toSubmission(session, { centroidFor });
  assert.equal(body.place.approximate, true);
  const { value, errors } = validateSubmission(body);
  assert.deepEqual(errors, []);
  assert.equal(value.place.province, 'Gilan');
  assert.match(convo.reviewText(session), /مرکز استان/);
});

test('optional questions may be skipped and are simply absent', () => {
  const session = convo.newSession('en');
  const scripted = {
    province: { choice: 'گیلان' },
    city: { choice: 'رشت' },
    place: { text: 'a lane behind the market' },
    location: { location: { latitude: 37.2808, longitude: 49.5832 } },
    precision: { choice: 'year' },
    name: { skip: true },
    email: { skip: true },
  };

  for (let guard = 0; guard < 60 && session.step !== 'review'; guard += 1) {
    if (session.step === 'question') {
      const result = answerCurrent(session, { skipOptional: true });
      assert.ok(result.ok, result.error);
      continue;
    }
    if (session.step === 'date') {
      convo.apply(session, { text: '1979' });
      if (session.step === 'date') convo.apply(session, { text: '1979' });
      continue;
    }
    const result = convo.apply(session, scripted[session.step]);
    assert.ok(result.ok, `${session.step}: ${result.error}`);
  }

  assert.equal(session.step, 'review');
  for (const question of QUESTIONS.filter((q) => !q.required)) {
    assert.equal(session.answers[question.id], undefined, `${question.id} was skipped`);
  }
  assert.deepEqual(validateSubmission(convo.toSubmission(session, { centroidFor })).errors, []);
});

test('the pseudonym and email are asked at the end, and both may be skipped', () => {
  const session = driveToReview(convo.newSession('fa'), {
    name: { skip: true },
    email: { skip: true },
  });
  assert.equal(session.contributor, null);
  assert.equal(session.email, null);
  const body = convo.toSubmission(session, { centroidFor });
  assert.equal(body.contributor.name, null);
  assert.equal(body.contributor.email, null);
});

test('an email is kept when given, and a malformed one is refused', () => {
  const session = convo.newSession('fa');
  driveTo(session, 'email');
  assert.equal(convo.apply(session, { text: 'not-an-email' }).ok, false);
  assert.ok(convo.apply(session, { text: 'someone@example.com' }).ok);
  assert.equal(session.email, 'someone@example.com');
});

test('going back from the city step returns to the province list', () => {
  const session = convo.newSession('fa');
  driveTo(session, 'city');
  assert.equal(session.step, 'city');
  convo.apply(session, { choice: '__back' });
  assert.equal(session.step, 'province');
});

test('a Gregorian year entered directly also resolves', () => {
  const session = convo.newSession('en');
  driveTo(session, 'date');
  convo.apply(session, { text: '1979' });
  convo.apply(session, { text: '1981' });
  const period = convo.resolvePeriod(session);
  assert.equal(period.start, '1979-01-01');
  assert.equal(period.end, '1981-12-31');
});
