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
const db = require('../src/db');

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
      above_the_crowd: 'Something was rising over all of us that evening, and it is not there when I am on my own.',
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
  assert.equal(typeof body.submissionsSurviveDeploys, 'boolean', 'it answers the storage question');
  assert.equal(typeof body.backupEmail, 'boolean', 'and whether copies are being posted out');
  assert.equal(typeof body.translation, 'boolean', 'and whether narratives are being translated');
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

test('the About page is served, and carries the promise it is linked for', async () => {
  for (const pathname of ['/about', '/about.html', '/about/']) {
    const response = await call(pathname);
    assert.equal(response.status, 200, `${pathname} should be served`);
  }

  // The submission form sends a contributor here mid-thought, to one heading.
  // A link into a page that has lost its anchor lands them at the top with no
  // idea what they were promised, so the anchor is part of the contract.
  const page = await (await call('/about')).text();
  assert.match(page, /id="anonymity"/);
  for (const key of ['about.anon.stored.p', 'about.anon.notStored.p', 'about.anon.browser.p',
    'about.anon.leaves.p', 'about.anon.beyond.p', 'about.anon.most.p']) {
    assert.ok(page.includes(key), `${key} is on the page`);
  }

  const form = await (await call('/submit')).text();
  assert.match(form, /href="\/about#anonymity"/, 'and the form points at it');
  assert.match(form, /data-i18n="assure\.summary"/, 'under the one line that is always visible');

  // It is out of the navigation for now, and reached only from that promise.
  for (const file of ['index.html', 'submit.html', '404.html']) {
    const page = require('node:fs').readFileSync(path.join(__dirname, '..', 'public', file), 'utf8');
    assert.ok(!page.includes('data-i18n="nav.about"'), `${file} does not advertise it`);
  }
});

test('the promise the site makes is the one the code keeps', async () => {
  const fs = require('node:fs');
  const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');

  // Each of these is asserted to a contributor in about.anon.*. If one stops
  // being true, this fails before anyone is told something false.
  const schema = read('src', 'db.js');
  assert.ok(!/\b(ip_address|ip|user_agent|device_id|fingerprint)\s+(TEXT|INTEGER)/i.test(schema),
    'no column could hold an address, a browser or a device');

  const auth = read('src', 'auth.js');
  assert.match(auth, /const hits = new Map\(\)/,
    'the rate limiter counts in memory, and writes nothing down');

  // "Only this site": no page may fetch anything from anywhere else. Links a
  // reader may click are text, not requests.
  const pages = ['index.html', 'submit.html', 'about.html', '404.html'].map((f) => read('public', f)).join('\n');
  const scripts = ['index.js', 'submit.js', 'common.js', 'i18n.js', 'map-base.js', 'jalali.js']
    .map((f) => read('public', 'js', f)).join('\n');
  const styles = read('public', 'css', 'style.css');

  for (const [what, text] of [['markup', pages], ['scripts', scripts], ['styles', styles]]) {
    const calls = text.split('\n').filter((line) => (
      /(src|href)\s*=\s*["']https?:|fetch\(\s*["']https?:|url\(\s*["']?https?:/.test(line)
      && !/rel="noopener"|<a /.test(line)
    ));
    assert.deepEqual(calls, [], `${what} should call out to nobody: ${calls.join(' / ')}`);
  }
});

test('the margins are a setting, not an edit', async () => {
  const margins = require('../src/margins');
  const saved = process.env.MARGINS;
  try {
    process.env.MARGINS = 'photo';
    assert.match(margins.css(), /margin-left\.jpg/);
    assert.match(margins.css(), /margin-right\.jpg/);

    // On the dark theme the photographed page gives way to a woven border,
    // at every width rather than only on a phone.
    assert.match(margins.css(), /\[data-theme='dark'\][\s\S]*margin-dark\.jpg/);

    process.env.MARGINS = 'drawn';
    assert.match(margins.css(), /jadval-band\.svg/);
    assert.ok(!margins.css().includes('margin-left.jpg'));
    // The drawn margin was made dark; it needs no stand-in.
    assert.ok(!margins.css().includes('margin-dark.jpg'));

    process.env.MARGINS = 'off';
    assert.ok(!/\.page::before\s*,/.test(margins.css()), 'nothing is drawn at all');

    // A phone keeps the ruled edge rather than losing the page altogether.
    process.env.MARGINS = 'photo';
    assert.match(margins.css(), /@media \(max-width: 1120px\)[\s\S]*width: 22px/);
    assert.match(margins.css(), /padding-inline/, 'and the column is given room to clear it');
    assert.match(margins.css(), /mobile-border\.jpg/, 'a woven border, where the drawing cannot be read');

    // The margin runs the whole height; the header is drawn over its top.
    assert.match(margins.css(), /top: 0;/);
    assert.ok(!margins.css().includes('top: var(--header-height)'));

    // A setting nobody recognises leaves the archive looking as it should.
    process.env.MARGINS = 'sideways';
    assert.equal(margins.which(), 'photo');
  } finally {
    if (saved === undefined) delete process.env.MARGINS; else process.env.MARGINS = saved;
  }
});

test('a width from the environment has to be a width', () => {
  const margins = require('../src/margins');
  const saved = process.env.MARGIN_WIDTH;
  try {
    process.env.MARGIN_WIDTH = '60px';
    assert.match(margins.css(), /width: 60px;/);

    // Anything else is ignored rather than written into a stylesheet: a
    // setting is read by a browser as code, so it is refused unless it plainly
    // is a length. (The stylesheet has a `display: none` of its own, in the
    // rule that hides the margins on a narrow window — hence the specific
    // check here rather than a search for those two words.)
    process.env.MARGIN_WIDTH = '60px; } body { display: none';
    assert.match(margins.css(), /width: 124px;/);
    assert.ok(!margins.css().includes('body {'), 'no rule of its own got in');
    assert.ok(!margins.css().includes('60px'), 'and nothing of it survived');
  } finally {
    if (saved === undefined) delete process.env.MARGIN_WIDTH; else process.env.MARGIN_WIDTH = saved;
  }
});

test('the margins stylesheet is served, and never from a cache', async () => {
  const response = await call('/css/margins.css');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /text\/css/);
  assert.match(response.headers.get('cache-control') || '', /no-store/);
  assert.match(await response.text(), /MARGINS=/);

  // And every page that has margins asks for it.
  const fs = require('node:fs');
  for (const file of ['about.html', 'submit.html', '404.html']) {
    const page = fs.readFileSync(path.join(__dirname, '..', 'public', file), 'utf8');
    assert.match(page, /href="\/css\/margins\.css"/, `${file} links it`);
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

/* ------------------------------- hearings -------------------------------- */

/** Publishes one narrative and hands back its public id. */
async function publishOne(overrides) {
  const { cookie } = await signIn();
  const created = await json(await call('/api/submissions', {
    method: 'POST', body: validSubmission(overrides),
  }));
  await call(`/api/admin/submissions/${created.id}/status`, {
    method: 'POST', cookie, body: { status: 'approved' },
  });
  return created.id;
}

const READER = 'reader-key-for-the-tests-01';

test('a reader can mark a narrative as heard, and take it back', async () => {
  const id = await publishOne();

  const first = await json(await call(`/api/narratives/${id}/heard`, {
    method: 'POST', body: { reader: READER, heard: true },
  }));
  assert.deepEqual(first, { heard: true, count: 1 });

  // Marking twice is not two hearings; one reader is one reader.
  const again = await json(await call(`/api/narratives/${id}/heard`, {
    method: 'POST', body: { reader: READER, heard: true },
  }));
  assert.deepEqual(again, { heard: true, count: 1 });

  const undone = await json(await call(`/api/narratives/${id}/heard`, {
    method: 'POST', body: { reader: READER, heard: false },
  }));
  assert.deepEqual(undone, { heard: false, count: 0 });
});

test('separate readers each count once', async () => {
  const id = await publishOne();
  for (const reader of ['reader-aaaaaaaaaaaaaaaa', 'reader-bbbbbbbbbbbbbbbb']) {
    await call(`/api/narratives/${id}/heard`, { method: 'POST', body: { reader, heard: true } });
  }
  const narrative = await json(await call(`/api/narratives/${id}`));
  assert.equal(narrative.narrative.heardBy, 2);
});

test('the count travels with the narrative on the public map', async () => {
  const id = await publishOne();
  await call(`/api/narratives/${id}/heard`, {
    method: 'POST', body: { reader: READER, heard: true },
  });
  const listed = await json(await call('/api/narratives'));
  const found = listed.narratives.find((n) => n.id === id);
  assert.equal(found.heardBy, 1);
});

test('a reader is told which narratives they already marked', async () => {
  const mine = await publishOne();
  const other = await publishOne();
  await call(`/api/narratives/${mine}/heard`, {
    method: 'POST', body: { reader: READER, heard: true },
  });

  const seen = await json(await call(`/api/narratives/heard?reader=${READER}`));
  assert.ok(seen.heard.includes(mine));
  assert.ok(!seen.heard.includes(other), 'only what this reader marked');
});

test('an unpublished narrative cannot be marked', async () => {
  const created = await json(await call('/api/submissions', {
    method: 'POST', body: validSubmission(),
  }));
  const response = await call(`/api/narratives/${created.id}/heard`, {
    method: 'POST', body: { reader: READER, heard: true },
  });
  assert.equal(response.status, 404, 'a narrative still in the queue is not there to be heard');
});

test('a missing or malformed reader key is refused', async () => {
  const id = await publishOne();
  for (const reader of [undefined, '', 'short', 'has spaces in it and is long enough']) {
    const response = await call(`/api/narratives/${id}/heard`, {
      method: 'POST', body: { reader, heard: true },
    });
    assert.equal(response.status, 400, `refused: ${JSON.stringify(reader)}`);
  }
});

test('nothing about the reader is stored beyond the key they invented', async () => {
  const id = await publishOne();
  await call(`/api/narratives/${id}/heard`, {
    method: 'POST', body: { reader: READER, heard: true },
  });
  const columns = db.db.prepare('PRAGMA table_info(narrative_hearings)').all().map((c) => c.name);
  assert.deepEqual(columns.sort(), ['created_at', 'narrative_id', 'reader_key'],
    'no address, no agent, nothing that could identify a reader');
});

test('the moderator sees how many have heard a published narrative', async () => {
  const { cookie } = await signIn();
  const id = await publishOne();
  for (const reader of ['queue-reader-aaaaaaaaaa', 'queue-reader-bbbbbbbbbb']) {
    await call(`/api/narratives/${id}/heard`, { method: 'POST', body: { reader, heard: true } });
  }

  const queue = await json(await call('/api/admin/submissions?status=approved', { cookie }));
  const found = queue.submissions.find((s) => s.id === id);
  assert.equal(found.heardBy, 2, 'the count reaches the review queue');

  const detail = await json(await call(`/api/admin/submissions/${id}`, { cookie }));
  assert.equal(detail.submission.heardBy, 2);
});

test('a place search is relayed, not made from the browser', async () => {
  // Upstream is unreachable from the test environment, so what matters here is
  // that the route exists, answers as JSON, and never asks the browser to go
  // to a third party itself.
  const short = await json(await call('/api/places?q=ab'));
  assert.deepEqual(short, { places: [] }, 'too short to be worth asking about');

  const response = await call('/api/places?q=tehran');
  assert.ok([200, 502].includes(response.status), 'answers rather than throwing');
  const body = await json(response);
  assert.ok('places' in body || 'error' in body);
});

test('the submission form contacts nobody but this server', async () => {
  const fs = require('node:fs');
  const scripts = ['submit.js', 'common.js', 'i18n.js', 'index.js']
    .map((f) => fs.readFileSync(path.join(__dirname, '..', 'public', 'js', f), 'utf8'))
    .join('\n');
  // Attribution links are text a reader may click, not requests the page makes.
  const requests = scripts.split('\n').filter((line) => (
    /fetch\(|XMLHttpRequest|\.src\s*=|tileLayer\(/.test(line) && /https?:\/\//.test(line)
  ));
  assert.deepEqual(requests, [], `nothing should call out: ${requests.join(' / ')}`);
});

/* --------------------------------- tiles ---------------------------------- */

const tiles = require('../src/tiles');

test('a tile address is built from three integers and nothing else', () => {
  const url = tiles.upstreamFor(5, 20, 12, false);
  // The order is the provider's business — Esri asks for {z}/{y}/{x} — so what
  // matters is that the three numbers are there and nothing is left unfilled.
  assert.match(url, /\/5\/(20\/12|12\/20)/);
  assert.ok(!url.includes('..'), 'and no path of its own');
  assert.ok(!url.includes('{'), 'every placeholder is filled');
});

test('the relay cannot be talked into fetching anything else', () => {
  const rejected = [
    [5, 20, 'x'], [5, NaN, 12], [-1, 0, 0], [99, 0, 0],
    // Out of range for the zoom level: at z=2 the grid is only 4 wide.
    [2, 4, 0], [2, 0, 4], [2, -1, 0],
  ];
  for (const [z, x, y] of rejected) {
    assert.equal(tiles.upstreamFor(z, x, y, false), null, `refused ${z}/${x}/${y}`);
  }
});

test('a doubled tile is asked for only where the provider has one', () => {
  const saved = process.env.TILE_URL;
  process.env.TILE_URL = 'https://example.test/{z}/{x}/{y}{r}.png';
  try {
    assert.ok(tiles.upstreamFor(5, 20, 12, true).includes('@2x'));
    assert.ok(!tiles.upstreamFor(5, 20, 12, false).includes('@2x'));
  } finally {
    if (saved === undefined) delete process.env.TILE_URL; else process.env.TILE_URL = saved;
  }

  // The default provider serves one size. A dense screen must still get a
  // square rather than a hole, so it is handed the ordinary one.
  assert.equal(tiles.upstreamFor(5, 20, 12, true), tiles.upstreamFor(5, 20, 12, false));
});

test('no basemap on offer asks for a key', () => {
  // A key is a thing that can be withdrawn, and its withdrawal is what wrote
  // "api key required" across this map once already.
  for (const [name, style] of Object.entries(tiles.STYLES)) {
    assert.ok(!/api[_-]?key|access[_-]?token|\{key\}/i.test(style.url), `${name} is open`);
  }
});

test('the default map is the one that has never refused', () => {
  // Plain OpenStreetMap, shown as it draws itself. Pale under a dark page, but
  // it needs no account, carries every name, and has answered throughout.
  assert.equal(tiles.DEFAULT_STYLE, 'osm');
  const style = tiles.STYLES[tiles.DEFAULT_STYLE];
  assert.match(style.url, /tile\.openstreetmap\.org/);
  assert.equal(style.filter, 'none', 'untouched, as it was before any of this');
});

test('a provider that keeps its names apart is fetched whole', () => {
  const saved = process.env.TILE_STYLE;
  process.env.TILE_STYLE = 'esri-dark';
  try {
    assert.equal(tiles.config().labels, true, 'the browser is told to fetch them');
    assert.match(tiles.upstreamFor(5, 20, 12, false, 'labels'), /Reference/);
  } finally {
    if (saved === undefined) delete process.env.TILE_STYLE; else process.env.TILE_STYLE = saved;
  }
});

test('the names layer is a second address, checked like the first', () => {
  const saved = process.env.TILE_STYLE;
  process.env.TILE_STYLE = 'esri-dark';
  try {
    const labels = tiles.upstreamFor(5, 20, 12, false, 'labels');
    assert.match(labels, /Reference/, 'the companion layer, not the ground');
    assert.notEqual(labels, tiles.upstreamFor(5, 20, 12, false));
    assert.equal(tiles.upstreamFor(99, 0, 0, false, 'labels'), null, 'bounds still apply');
  } finally {
    if (saved === undefined) delete process.env.TILE_STYLE; else process.env.TILE_STYLE = saved;
  }

  assert.equal(tiles.upstreamFor(5, 20, 12, false, 'labels'), null,
    'a provider with names already drawn in is not asked for a second layer');
});

test('every style carries what a map needs to show it', () => {
  for (const [name, style] of Object.entries(tiles.STYLES)) {
    assert.match(style.url, /\{z\}/, `${name} has a zoom placeholder`);
    assert.match(style.url, /\{x\}/, `${name} has an x placeholder`);
    assert.match(style.url, /\{y\}/, `${name} has a y placeholder`);
    assert.ok(style.attribution, `${name} credits its provider`);
    assert.equal(typeof style.maxZoom, 'number', `${name} says how far it draws`);
  }
});

test('a style is chosen by name, without touching the code', () => {
  const saved = process.env.TILE_STYLE;
  process.env.TILE_STYLE = 'osm-dark';
  try {
    assert.match(tiles.upstreamFor(6, 40, 25, false), /tile\.openstreetmap\.org\/6\/40\/25/);
    assert.match(tiles.config().filter, /invert/, 'pale tiles are turned dark here');
    assert.equal(tiles.config().labels, false);
  } finally {
    if (saved === undefined) delete process.env.TILE_STYLE; else process.env.TILE_STYLE = saved;
  }

  process.env.TILE_STYLE = 'esri-dark';
  try {
    // Esri orders them {z}/{y}/{x}; the relay follows the address it is given.
    assert.ok(tiles.upstreamFor(6, 40, 25, false).endsWith('/6/25/40'));
  } finally {
    if (saved === undefined) delete process.env.TILE_STYLE; else process.env.TILE_STYLE = saved;
  }
});

test('an English reader is offered a map lettered in Latin', () => {
  const config = tiles.config();

  // The ordinary imagery is unchanged by any of this.
  assert.equal(config.style, 'osm');
  assert.match(tiles.upstreamFor(5, 20, 12, false), /tile\.openstreetmap\.org/);

  // And beside it, a second set with its names in a layer of their own.
  assert.ok(config.latin, 'there is a second set');
  assert.equal(config.latin.labels, true, 'whose names come apart from the ground');
  assert.notEqual(config.latin.token, config.token, 'at an address of its own');

  // The token is the whole of how the relay tells them apart.
  assert.equal(tiles.variantFor(config.latin.token), 'latin');
  assert.equal(tiles.variantFor(config.token), undefined);
  assert.equal(tiles.variantFor('made-up'), undefined, 'a stale address gets the ordinary map');
  assert.equal(tiles.variantFor(''), undefined);

  // Each address goes to its own provider, and Esri's own ordering is kept.
  assert.match(tiles.upstreamFor(6, 40, 25, false, 'base', 'latin'), /Light_Gray_Base/);
  assert.ok(tiles.upstreamFor(6, 40, 25, false, 'base', 'latin').endsWith('/6/25/40'));
  assert.match(tiles.upstreamFor(6, 40, 25, false, 'labels', 'latin'), /Light_Gray_Reference/);

  // The bounds are the same bounds; a variant is not a way past them.
  assert.equal(tiles.upstreamFor(99, 0, 0, false, 'base', 'latin'), null);
  assert.equal(tiles.upstreamFor(5, 99999, 12, false, 'base', 'latin'), null);
});

test('the second map is a setting, and can be switched off', () => {
  const saved = process.env.TILE_STYLE_LATIN;
  try {
    process.env.TILE_STYLE_LATIN = 'off';
    assert.equal(tiles.config().latin, null, 'everyone is left on the one map');
    assert.equal(tiles.upstreamFor(5, 20, 12, false, 'base', 'latin'), null);
    assert.equal(tiles.variantFor('esri-latin-anything'), undefined);

    // A style with no separate name layer cannot letter anything differently,
    // so it is refused rather than served as if it could.
    process.env.TILE_STYLE_LATIN = 'osm';
    assert.equal(tiles.config().latin, null);

    // A name nobody recognises falls back rather than breaking the map.
    process.env.TILE_STYLE_LATIN = 'sideways';
    assert.equal(tiles.config().latin.style, 'esri-latin');

    process.env.TILE_STYLE_LATIN = 'esri-dark';
    assert.equal(tiles.config().latin.style, 'esri-dark');
    assert.match(tiles.upstreamFor(5, 20, 12, false, 'base', 'latin'), /Dark_Gray_Base/);
  } finally {
    if (saved === undefined) delete process.env.TILE_STYLE_LATIN;
    else process.env.TILE_STYLE_LATIN = saved;
  }
});

test('the archive can say which providers it can actually reach', async () => {
  const body = await json(await call('/api/tiles/status'));
  assert.equal(typeof body.inUse.style, 'string');
  assert.ok(Array.isArray(body.providers) && body.providers.length >= 4);

  const inUse = body.providers.filter((p) => p.inUse);
  assert.equal(inUse.length, 1, 'exactly one is the one being served');

  for (const provider of body.providers) {
    assert.equal(typeof provider.style, 'string');
    assert.equal(typeof provider.ok, 'boolean', 'answered or did not, plainly');
    assert.ok(!provider.url.includes('?'), 'a key in the query is never reported');
  }
});

test('the provider is a setting, not a hardcoded host', () => {
  const saved = process.env.TILE_URL;
  process.env.TILE_URL = 'https://example.test/{z}/{x}/{y}.png';
  try {
    assert.equal(tiles.upstreamFor(3, 4, 5, false), 'https://example.test/3/4/5.png');
  } finally {
    if (saved === undefined) delete process.env.TILE_URL; else process.env.TILE_URL = saved;
  }
});

test('nonsense coordinates are refused by the route, not passed upstream', async () => {
  const { token } = tiles.config();
  for (const path of [
    `/tiles/${token}/base/99/0/0.png`,
    `/tiles/${token}/base/2/9/0.png`,
    `/tiles/${token}/base/abc/0/0.png`,
    `/tiles/${token}/labels/2/0/9.png`,
  ]) {
    const response = await call(path);
    assert.equal(response.status, 404, `refused ${path}`);
  }
});

test('a change of provider changes every tile address', () => {
  // Tiles are cached for a week and told they will never change, which is true
  // of a square of map and false of the provider drawing it. Without this, a
  // reader who has already looked at the map keeps the provider we just left —
  // watermark and all — until the cache lets go.
  const saved = process.env.TILE_STYLE;
  try {
    process.env.TILE_STYLE = 'esri-dark';
    const before = tiles.token();
    process.env.TILE_STYLE = 'osm-dark';
    const after = tiles.token();
    assert.notEqual(before, after);
    assert.match(before, /^esri-dark-[0-9a-f]{8}$/, 'legible, so a log says which map it was');
  } finally {
    if (saved === undefined) delete process.env.TILE_STYLE; else process.env.TILE_STYLE = saved;
  }

  // And it is stable, or every reload would refetch the whole map.
  assert.equal(tiles.token(), tiles.token());
});

test('the answer naming the provider is never served from a cache', async () => {
  const response = await call('/api/tiles');
  assert.match(response.headers.get('cache-control') || '', /no-store/);
});

test('the map is told what to credit and how to show it', async () => {
  const body = await json(await call('/api/tiles'));
  assert.ok(body.attribution.includes('OpenStreetMap'));
  assert.equal(typeof body.maxZoom, 'number');
  assert.equal(typeof body.filter, 'string', 'the treatment travels with the provider');
});
