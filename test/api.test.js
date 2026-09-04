'use strict';

/* End-to-end API tests over a throwaway database. */

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const test = require('node:test');
const assert = require('node:assert/strict');

const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'narrativemap-test-'));
process.env.DATABASE_PATH = path.join(workdir, 'test.db');
process.env.SESSION_SECRET = 'test-secret';
process.env.ADMIN_PASSWORD = 'test-password';
// The suite deliberately posts far more than a real visitor would.
process.env.SUBMIT_LIMIT_PER_HOUR = '1000';
process.env.LOGIN_LIMIT_PER_15_MIN = '1000';

const app = require('../server');

let server;
let base;

test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  server.close();
  fs.rmSync(workdir, { recursive: true, force: true });
});

/* --------------------------------- helpers -------------------------------- */

function call(pathname, options = {}) {
  const init = { method: options.method || 'GET', headers: { ...(options.headers || {}) } };
  if (options.body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(options.body);
  }
  if (options.cookie) init.headers.Cookie = options.cookie;
  return fetch(base + pathname, init);
}

async function json(response) {
  return response.json();
}

/** A browser-style conditional GET: If-None-Match without Cache-Control. */
function conditionalGet(pathname, etag) {
  return new Promise((resolve, reject) => {
    const request = http.get(
      { host: '127.0.0.1', port: server.address().port, path: pathname, headers: { 'If-None-Match': etag } },
      (response) => {
        let body = '';
        response.on('data', (chunk) => { body += chunk; });
        response.on('end', () => resolve({ statusCode: response.statusCode, body }));
      },
    );
    request.on('error', reject);
  });
}

function validSubmission(overrides = {}) {
  return {
    answers: {
      narrative_kind: ['chronicle'],
      how_you_know: ['lived'],
      narrative_title: 'A corner in Tehran',
      what_happened: 'Something happened at this corner, and this sentence is deliberately long enough to clear the minimum length the questionnaire asks for on the main narrative answer.',
      ...(overrides.answers || {}),
    },
    place: { name: 'A corner in Tehran', lat: 35.6892, lng: 51.3890, ...(overrides.place || {}) },
    period: { start: '1979-01-01', end: '1979-06-30', precision: 'month', ...(overrides.period || {}) },
    contributor: { name: 'Tester', email: 'tester@example.com', ...(overrides.contributor || {}) },
  };
}

async function signIn(password = 'test-password') {
  const response = await call('/api/admin/login', { method: 'POST', body: { password } });
  return { response, cookie: response.headers.get('set-cookie') || '' };
}

/* ------------------------------- public API ------------------------------- */

test('the version endpoint says which commit is running', async () => {
  const response = await fetch(`${base}/api/version`);
  assert.equal(response.status, 200);
  const body = await response.json();
  // Only a deployment sets it; outside one, saying so beats guessing.
  assert.ok('commit' in body);
  assert.ok(!Number.isNaN(Date.parse(body.startedAt)), 'it says when it started');
});

test('questions endpoint exposes the questionnaire and province list', async () => {
  const body = await json(await call('/api/questions'));
  assert.ok(Array.isArray(body.questions));
  assert.ok(body.questions.length > 0);
  assert.ok(body.questions[0].id, 'questions have ids');
  assert.ok(Array.isArray(body.sequence) && body.sequence.length > 0, 'the form sequence is served');
  assert.equal(body.provinces.length, 31);
  assert.ok(body.yearRange.min < body.yearRange.max);
});

test('every question is available in both languages', async () => {
  const { questions } = await json(await call('/api/questions'));
  for (const question of questions) {
    assert.ok(question.label.en, `${question.id} is missing an English label`);
    assert.ok(question.label.fa, `${question.id} is missing a Persian label`);
    if (question.help) {
      assert.ok(question.help.en && question.help.fa, `${question.id} help is not bilingual`);
    }
    if (question.type === 'select' || question.type === 'multiselect') {
      for (const option of question.options) {
        assert.ok(option.value, 'select options need a stable value');
        assert.ok(option.en && option.fa, `option ${option.value} is not bilingual`);
      }
    }
  }
});

test('validation errors carry a translatable code', async () => {
  const payload = validSubmission();
  delete payload.answers.what_happened;
  payload.place.lat = 48.8566;
  payload.place.lng = 2.3522;

  const response = await call('/api/submissions', { method: 'POST', body: payload });
  assert.equal(response.status, 400);

  const { errors } = await json(response);
  assert.ok(errors.length > 0);
  for (const error of errors) {
    assert.ok(error.code, `error on ${error.field} has no code`);
    assert.match(error.code, /^error\./);
    assert.ok(error.message, 'the English fallback message is still present');
  }
});

test('a select answer outside the allowed codes is rejected', async () => {
  const response = await call('/api/submissions', {
    method: 'POST',
    body: validSubmission({ answers: { how_you_know: ['I lived it'] } }),
  });
  assert.equal(response.status, 400);
  assert.ok((await json(response)).errors.some((e) => e.field === 'how_you_know'));
});

test('the public map starts empty', async () => {
  const body = await json(await call('/api/narratives'));
  assert.deepEqual(body.narratives, []);
});

test('a valid submission is accepted and held as pending', async () => {
  const response = await call('/api/submissions', { method: 'POST', body: validSubmission() });
  assert.equal(response.status, 201);

  const body = await json(response);
  assert.equal(body.status, 'pending');
  assert.match(body.id, /^[a-z0-9]{10}$/);

  const publicList = await json(await call('/api/narratives'));
  assert.deepEqual(publicList.narratives, [], 'pending submissions must not be public');
});

test('missing required answers are rejected field by field', async () => {
  const payload = validSubmission();
  delete payload.answers.what_happened;
  payload.answers.how_you_know = [];

  const response = await call('/api/submissions', { method: 'POST', body: payload });
  assert.equal(response.status, 400);

  const fields = (await json(response)).errors.map((e) => e.field);
  assert.ok(fields.includes('what_happened'));
  assert.ok(fields.includes('how_you_know'));
});

test('an answer that is too short is rejected', async () => {
  const response = await call('/api/submissions', {
    method: 'POST',
    body: validSubmission({ answers: { what_happened: 'Too short.' } }),
  });
  assert.equal(response.status, 400);
  assert.ok((await json(response)).errors.some((e) => e.field === 'what_happened'));
});

test('a pin outside Iran is rejected', async () => {
  const response = await call('/api/submissions', {
    method: 'POST',
    body: validSubmission({ place: { lat: 33.3152, lng: 44.3661 } }),
  });
  assert.equal(response.status, 400);
  assert.ok((await json(response)).errors.some((e) => e.field === 'place.point'));
});

test('an inverted or future period is rejected', async () => {
  const inverted = await call('/api/submissions', {
    method: 'POST',
    body: validSubmission({ period: { start: '1990-01-01', end: '1980-01-01' } }),
  });
  assert.equal(inverted.status, 400);

  const future = await call('/api/submissions', {
    method: 'POST',
    body: validSubmission({ period: { start: '2090-01-01', end: '2090-12-31' } }),
  });
  assert.equal(future.status, 400);
});

test('an hour-precision period keeps its times', async () => {
  const { cookie } = await signIn();
  const created = await json(await call('/api/submissions', {
    method: 'POST',
    body: validSubmission({
      period: { start: '1979-02-11', end: '1979-02-11', precision: 'hour', startTime: '14:00', endTime: '16:30' },
    }),
  }));

  const detail = await json(await call(`/api/admin/submissions/${created.id}`, { cookie }));
  assert.equal(detail.submission.period.precision, 'hour');
  assert.equal(detail.submission.period.startTime, '14:00');
  assert.equal(detail.submission.period.endTime, '16:30');

  await call(`/api/admin/submissions/${created.id}/status`, {
    method: 'POST', cookie, body: { status: 'approved' },
  });
  const published = (await json(await call(`/api/narratives/${created.id}`))).narrative;
  assert.equal(published.period.startTime, '14:00');
});

test('an hour period without times, or with impossible ones, is refused', async () => {
  for (const period of [
    { start: '1979-02-11', end: '1979-02-11', precision: 'hour' },
    { start: '1979-02-11', end: '1979-02-11', precision: 'hour', startTime: '25:00', endTime: '16:30' },
    { start: '1979-02-11', end: '1979-02-11', precision: 'hour', startTime: '2pm', endTime: '4pm' },
  ]) {
    const response = await call('/api/submissions', { method: 'POST', body: validSubmission({ period }) });
    assert.equal(response.status, 400, `should reject ${JSON.stringify(period)}`);
    assert.ok((await json(response)).errors.some((e) => e.code === 'error.badTime'));
  }
});

test('an hour period that ends before it starts on the same day is refused', async () => {
  const response = await call('/api/submissions', {
    method: 'POST',
    body: validSubmission({
      period: { start: '1979-02-11', end: '1979-02-11', precision: 'hour', startTime: '16:00', endTime: '14:00' },
    }),
  });
  assert.equal(response.status, 400);
  assert.ok((await json(response)).errors.some((e) => e.code === 'error.endBeforeStart'));
});

test('periods without an hour keep no times', async () => {
  const { cookie } = await signIn();
  const created = await json(await call('/api/submissions', {
    method: 'POST',
    body: validSubmission({ period: { start: '1979-01-01', end: '1979-12-31', precision: 'year' } }),
  }));
  const detail = await json(await call(`/api/admin/submissions/${created.id}`, { cookie }));
  assert.equal(detail.submission.period.startTime, null);
  assert.equal(detail.submission.period.endTime, null);
});

test('the province is derived from the coordinates', async () => {
  const { cookie } = await signIn();
  const created = await json(await call('/api/submissions', {
    method: 'POST',
    body: validSubmission({ place: { name: 'Shiraz', lat: 29.5918, lng: 52.5837 } }),
  }));
  const detail = await json(await call(`/api/admin/submissions/${created.id}`, { cookie }));
  assert.equal(detail.submission.place.province, 'Fars');
});

/* --------------------------------- admin ---------------------------------- */

test('admin endpoints reject anonymous callers', async () => {
  for (const [pathname, options] of [
    ['/api/admin/submissions', {}],
    ['/api/admin/submissions/whatever', {}],
    ['/api/admin/submissions/whatever/status', { method: 'POST', body: { status: 'approved' } }],
    ['/api/admin/submissions/whatever', { method: 'DELETE' }],
  ]) {
    const response = await call(pathname, options);
    assert.equal(response.status, 401, `${pathname} should require a session`);
  }
});

test('a wrong password does not issue a session', async () => {
  const { response } = await signIn('not-the-password');
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('set-cookie'), null);
});

test('a forged session cookie is refused', async () => {
  const response = await call('/api/admin/submissions', {
    cookie: `nm_admin=${Date.now() + 100000}.forged-signature`,
  });
  assert.equal(response.status, 401);
});

test('approving a submission publishes it to the map', async () => {
  const { cookie } = await signIn();
  const created = await json(await call('/api/submissions', {
    method: 'POST',
    body: validSubmission({ place: { name: 'To be published' } }),
  }));

  const queue = await json(await call('/api/admin/submissions?status=pending', { cookie }));
  assert.ok(queue.submissions.some((s) => s.id === created.id));
  assert.ok(queue.submissions[0].private, 'moderators see the private block');

  const approved = await call(`/api/admin/submissions/${created.id}/status`, {
    method: 'POST', cookie, body: { status: 'approved', note: 'Looks good.' },
  });
  assert.equal(approved.status, 200);

  const publicList = await json(await call('/api/narratives'));
  const published = publicList.narratives.find((n) => n.id === created.id);
  assert.ok(published, 'approved narrative appears publicly');
  assert.equal(published.place.name, 'To be published');
  assert.equal(published.private, undefined, 'private fields never reach the public API');
  assert.equal(published.contributor, 'Tester');

  const single = await json(await call(`/api/narratives/${created.id}`));
  assert.equal(single.narrative.id, created.id);
});

test('the contributor email never reaches the public API', async () => {
  const body = await json(await call('/api/narratives'));
  const serialised = JSON.stringify(body);
  assert.ok(!serialised.includes('tester@example.com'));
});

test('a declined submission stays off the map', async () => {
  const { cookie } = await signIn();
  const created = await json(await call('/api/submissions', {
    method: 'POST', body: validSubmission({ answers: { title: 'To be declined' } }),
  }));

  await call(`/api/admin/submissions/${created.id}/status`, {
    method: 'POST', cookie, body: { status: 'rejected', note: 'Not a narrative.' },
  });

  const publicList = await json(await call('/api/narratives'));
  assert.ok(!publicList.narratives.some((n) => n.id === created.id));

  const single = await call(`/api/narratives/${created.id}`);
  assert.equal(single.status, 404);
});

test('unpublishing removes a narrative from the map again', async () => {
  const { cookie } = await signIn();
  const created = await json(await call('/api/submissions', {
    method: 'POST', body: validSubmission({ answers: { title: 'On then off' } }),
  }));

  await call(`/api/admin/submissions/${created.id}/status`, {
    method: 'POST', cookie, body: { status: 'approved' },
  });
  assert.ok((await json(await call('/api/narratives'))).narratives.some((n) => n.id === created.id));

  await call(`/api/admin/submissions/${created.id}/status`, {
    method: 'POST', cookie, body: { status: 'pending' },
  });
  assert.ok(!(await json(await call('/api/narratives'))).narratives.some((n) => n.id === created.id));
});

test('a moderator edit updates the published narrative', async () => {
  const { cookie } = await signIn();
  const created = await json(await call('/api/submissions', {
    method: 'POST', body: validSubmission({ place: { name: 'Before the edit' } }),
  }));
  await call(`/api/admin/submissions/${created.id}/status`, {
    method: 'POST', cookie, body: { status: 'approved' },
  });

  const edited = validSubmission({
    place: { name: 'Moved to Tabriz', lat: 38.0800, lng: 46.2919 },
  });
  const response = await call(`/api/admin/submissions/${created.id}`, {
    method: 'PUT', cookie, body: edited,
  });
  assert.equal(response.status, 200);

  const published = (await json(await call(`/api/narratives/${created.id}`))).narrative;
  assert.equal(published.place.name, 'Moved to Tabriz');
  assert.equal(published.place.province, 'East Azerbaijan');
});

test('an invalid edit is refused and leaves the narrative untouched', async () => {
  const { cookie } = await signIn();
  const created = await json(await call('/api/submissions', {
    method: 'POST', body: validSubmission({ place: { name: 'Keeps its place' } }),
  }));
  await call(`/api/admin/submissions/${created.id}/status`, {
    method: 'POST', cookie, body: { status: 'approved' },
  });

  const response = await call(`/api/admin/submissions/${created.id}`, {
    method: 'PUT', cookie, body: validSubmission({ place: { lat: 48.8566, lng: 2.3522 } }),
  });
  assert.equal(response.status, 400);

  const published = (await json(await call(`/api/narratives/${created.id}`))).narrative;
  assert.equal(published.place.name, 'Keeps its place');
});

test('deleting a submission removes it entirely', async () => {
  const { cookie } = await signIn();
  const created = await json(await call('/api/submissions', {
    method: 'POST', body: validSubmission({ place: { name: 'Temporary' } }),
  }));

  const deleted = await call(`/api/admin/submissions/${created.id}`, { method: 'DELETE', cookie });
  assert.equal(deleted.status, 200);

  const lookup = await call(`/api/admin/submissions/${created.id}`, { cookie });
  assert.equal(lookup.status, 404);
});

test('signing out invalidates the session cookie', async () => {
  const { cookie } = await signIn();
  assert.equal((await call('/api/admin/submissions', { cookie })).status, 200);

  const response = await call('/api/admin/logout', { method: 'POST', cookie });
  const cleared = response.headers.get('set-cookie');
  assert.match(cleared, /nm_admin=;/);
  assert.match(cleared, /Max-Age=0/);
});

/* --------------------------------- pages ---------------------------------- */

test('the public pages are served', async () => {
  for (const pathname of ['/', '/submit', '/admin', '/css/style.css', '/data/iran.geo.json',
    '/fonts/xb-niloofar-regular.woff2', '/fonts/eb-garamond-latin.woff2']) {
    const response = await call(pathname);
    assert.equal(response.status, 200, `${pathname} should be served`);
  }
});

test('the About page is hidden until it is switched on', async () => {
  for (const pathname of ['/about', '/about.html', '/about/']) {
    const response = await call(pathname);
    assert.equal(response.status, 404, `${pathname} should not be served yet`);
  }
});

test('static assets revalidate so a deploy is never half-applied', async () => {
  // A cached script paired with a newer API renders as broken text rather than
  // as a visible error, so nothing may be held without checking back.
  for (const pathname of ['/', '/js/index.js', '/js/i18n.js', '/css/style.css', '/vendor/leaflet/leaflet.js']) {
    const response = await call(pathname);
    assert.equal(response.status, 200, `${pathname} should be served`);

    const cacheControl = response.headers.get('cache-control') || '';
    assert.match(cacheControl, /max-age=0/, `${pathname} must not be held without revalidating`);
    assert.ok(!/immutable/.test(cacheControl), `${pathname} must not be marked immutable`);
    assert.ok(response.headers.get('etag'), `${pathname} needs an ETag to revalidate cheaply`);
  }
});

test('a revalidated asset comes back as a 304 with no body', async () => {
  const first = await call('/js/i18n.js');
  const etag = first.headers.get('etag');
  assert.ok(etag);

  // Node's fetch attaches Cache-Control: no-cache to a conditional request,
  // which correctly tells the server to skip the 304. A browser doing an
  // ordinary reload does not, so use a plain request to model that.
  const { statusCode, body } = await conditionalGet('/js/i18n.js', etag);
  assert.equal(statusCode, 304);
  assert.equal(body.length, 0);
});

test('unknown paths return the right kind of 404', async () => {
  const page = await call('/does-not-exist');
  assert.equal(page.status, 404);
  assert.match(page.headers.get('content-type'), /text\/html/);

  const endpoint = await call('/api/does-not-exist');
  assert.equal(endpoint.status, 404);
  assert.match(endpoint.headers.get('content-type'), /application\/json/);
});

test('malformed JSON is rejected cleanly', async () => {
  const response = await fetch(`${base}/api/submissions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{ not json',
  });
  assert.equal(response.status, 400);
});
