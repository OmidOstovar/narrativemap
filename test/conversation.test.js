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
  const question = QUESTIONS[session.questionIndex];
  if (skipOptional && !question.required) return convo.apply(session, { skip: true });
  if (question.type === 'select') {
    return convo.apply(session, { choice: question.options[0].value });
  }
  const length = Math.max(question.minLength || 0, 12) + 5;
  return convo.apply(session, { text: 'ب'.repeat(length) });
}

function runToQuestions(session, overrides = {}) {
  const steps = Object.assign({
    name: { text: 'آزمونگر' },
    province: { choice: 'گیلان' },
    city: { choice: 'رشت' },
    place: { text: 'کوچهٔ پشت بازار' },
    location: { location: { latitude: 37.2808, longitude: 49.5832 } },
    precision: { choice: 'year' },
  }, overrides);

  for (const key of ['name', 'province', 'city', 'place', 'location', 'precision']) {
    const result = convo.apply(session, steps[key]);
    assert.ok(result.ok, `step ${key} failed: ${result.error}`);
  }
}

test('a session walks the pre-questionnaire steps in order', () => {
  const session = convo.newSession('fa');
  assert.equal(session.step, 'name');
  runToQuestions(session);
  assert.equal(session.step, 'date');
  assert.equal(session.place.province, 'گیلان');
  assert.equal(session.place.provinceEn, 'Gilan');
  assert.match(session.place.name, /رشت/);
  assert.equal(session.place.approximate, false);
});

test('every step produces a prompt in both languages', () => {
  for (const lang of ['fa', 'en']) {
    const session = convo.newSession(lang);
    const seen = new Set();
    runToQuestions(session);
    convo.apply(session, { text: '1357' });
    convo.apply(session, { text: '1358' });
    while (session.step === 'question') {
      const { text } = convo.prompt(session);
      assert.ok(text && text.length > 4, `empty prompt at question ${session.questionIndex}`);
      assert.ok(!text.includes('undefined'), `prompt leaked undefined: ${text}`);
      seen.add(session.questionIndex);
      const result = answerCurrent(session);
      assert.ok(result.ok, result.error);
    }
    assert.equal(seen.size, QUESTIONS.length, 'every question was asked');
    assert.equal(session.step, 'review');
  }
});

test('years are accepted in either calendar and in Persian digits', () => {
  assert.deepEqual(convo.readYear('1357'), { calendar: 'jalali', year: 1357 });
  assert.deepEqual(convo.readYear('۱۳۵۷'), { calendar: 'jalali', year: 1357 });
  assert.deepEqual(convo.readYear('1979'), { calendar: 'gregorian', year: 1979 });
  assert.equal(convo.readYear('nope'), null);
  assert.equal(convo.readYear('99'), null);
});

test('a Solar Hijri year becomes the right Gregorian range', () => {
  const session = convo.newSession('fa');
  runToQuestions(session);
  convo.apply(session, { text: '۱۳۵۷' });
  convo.apply(session, { text: '۱۳۵۷' });

  const period = convo.resolvePeriod(session);
  assert.equal(period.precision, 'year');
  assert.equal(period.start, '1978-03-21');
  assert.equal(period.end, '1979-03-20');
});

test('a single day resolves to that exact date', () => {
  const session = convo.newSession('fa');
  runToQuestions(session, { precision: { choice: 'day' } });
  convo.apply(session, { text: '1357' });
  convo.apply(session, { choice: '11' });
  const result = convo.apply(session, { text: '22' });
  assert.ok(result.ok, result.error);

  const period = convo.resolvePeriod(session);
  assert.deepEqual(period, { start: '1979-02-11', end: '1979-02-11', precision: 'day' });
});

test('an impossible day is refused rather than stored', () => {
  const session = convo.newSession('fa');
  runToQuestions(session, { precision: { choice: 'day' } });
  convo.apply(session, { text: '1404' });
  convo.apply(session, { choice: '12' });

  const bad = convo.apply(session, { text: '30' }); // Esfand 1404 has 29 days
  assert.equal(bad.ok, false);
  assert.equal(session.period.day, null, 'the bad day must not be kept');

  const good = convo.apply(session, { text: '29' });
  assert.ok(good.ok);
});

test('an end year before the start year is refused', () => {
  const session = convo.newSession('fa');
  runToQuestions(session);
  convo.apply(session, { text: '1360' });
  const result = convo.apply(session, { text: '1350' });
  assert.equal(result.ok, false);
  assert.equal(session.period.endYear, null);
});

test('a required question cannot be skipped', () => {
  const session = convo.newSession('fa');
  runToQuestions(session);
  convo.apply(session, { text: '1357' });
  convo.apply(session, { text: '1357' });

  assert.equal(QUESTIONS[0].required, true);
  const result = convo.apply(session, { skip: true });
  assert.equal(result.ok, false);
  assert.equal(session.questionIndex, 0, 'the session did not move on');
});

test('an answer below the minimum length is refused', () => {
  const session = convo.newSession('fa');
  runToQuestions(session);
  convo.apply(session, { text: '1357' });
  convo.apply(session, { text: '1357' });
  convo.apply(session, { text: 'یک عنوان' });

  const long = QUESTIONS.find((q) => q.minLength);
  assert.equal(QUESTIONS[session.questionIndex].id, long.id);
  const result = convo.apply(session, { text: 'کوتاه' });
  assert.equal(result.ok, false);
  assert.match(result.error, /\d/);
});

test('a completed session becomes a submission the API accepts', () => {
  const session = convo.newSession('fa');
  runToQuestions(session);
  convo.apply(session, { text: '1357' });
  convo.apply(session, { text: '1358' });
  while (session.step === 'question') answerCurrent(session);

  const body = convo.toSubmission(session, { centroidFor });
  assert.ok(body);
  assert.equal(body.source, 'telegram');
  assert.equal(body.place.approximate, false);
  assert.equal(body.place.lat, 37.2808);

  const { value, errors } = validateSubmission(body);
  assert.deepEqual(errors, [], 'the bot must not build a submission the API rejects');
  assert.equal(value.place.province, 'Gilan');
});

test('skipping the location falls back to the province centre and says so', () => {
  const session = convo.newSession('fa');
  runToQuestions(session, { location: { skip: true } });
  assert.equal(session.place.approximate, true);

  convo.apply(session, { text: '1357' });
  convo.apply(session, { text: '1357' });
  while (session.step === 'question') answerCurrent(session, { skipOptional: true });

  const body = convo.toSubmission(session, { centroidFor });
  assert.equal(body.place.approximate, true);

  const { value, errors } = validateSubmission(body);
  assert.deepEqual(errors, []);
  assert.equal(value.place.province, 'Gilan', 'the fallback point is inside the chosen province');

  const review = convo.reviewText(session);
  assert.match(review, /مرکز استان/, 'the contributor is told the point is approximate');
});

test('optional questions may be skipped and are simply absent', () => {
  const session = convo.newSession('en');
  runToQuestions(session);
  convo.apply(session, { text: '1979' });
  convo.apply(session, { text: '1979' });
  while (session.step === 'question') answerCurrent(session, { skipOptional: true });

  const optional = QUESTIONS.filter((q) => !q.required).map((q) => q.id);
  for (const id of optional) assert.equal(session.answers[id], undefined);
  const { errors } = validateSubmission(convo.toSubmission(session, { centroidFor }));
  assert.deepEqual(errors, []);
});

test('going back from the city step returns to the province list', () => {
  const session = convo.newSession('fa');
  convo.apply(session, { text: 'کسی' });
  convo.apply(session, { choice: 'فارس' });
  assert.equal(session.step, 'city');
  convo.apply(session, { choice: '__back' });
  assert.equal(session.step, 'province');
});

test('a Gregorian year entered directly also resolves', () => {
  const session = convo.newSession('en');
  runToQuestions(session);
  convo.apply(session, { text: '1979' });
  convo.apply(session, { text: '1981' });
  const period = convo.resolvePeriod(session);
  assert.equal(period.start, '1979-01-01');
  assert.equal(period.end, '1981-12-31');
});
