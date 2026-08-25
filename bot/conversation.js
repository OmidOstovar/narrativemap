'use strict';

/**
 * The submission conversation, as a pure state machine.
 *
 * `step` returns what to say next and what to store; it never talks to
 * Telegram or to the API. That keeps the whole flow testable without a network,
 * which matters because the flow is long and easy to break.
 */

const { QUESTIONS } = require('../src/questions');
const { PROVINCES, citiesOf, EN_BY_FA } = require('./provinces');
const { t, PERSIAN_MONTHS } = require('./strings');

require('../public/js/jalali');
const Jalali = globalThis.Jalali;

const MIN_YEAR = Number(process.env.MIN_YEAR || 1800);

/** Persian and Arabic-Indic digits, so typed years work either way. */
function normaliseDigits(text) {
  return String(text || '')
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .trim();
}

/**
 * A year may be given in either calendar. Solar Hijri years are far smaller
 * than Gregorian ones for any period this map covers, so the magnitude tells
 * them apart without having to ask.
 */
function readYear(text) {
  const digits = normaliseDigits(text).replace(/[^0-9]/g, '');
  if (!digits) return null;
  const value = Number(digits);
  if (!Number.isInteger(value)) return null;
  if (value >= 1000 && value <= 1600) return { calendar: 'jalali', year: value };
  if (value >= MIN_YEAR && value <= 2200) return { calendar: 'gregorian', year: value };
  return null;
}

/** Steps that come before the questionnaire. */
const PRE_STEPS = ['name', 'province', 'city', 'place', 'location', 'precision', 'date'];

function newSession(lang) {
  return {
    lang: lang || 'fa',
    step: 'name',
    answers: {},
    questionIndex: 0,
    place: { province: null, provinceEn: null, city: null, name: null, lat: null, lng: null, approximate: false },
    period: { precision: 'year', startYear: null, endYear: null, month: null, day: null, calendar: 'jalali' },
    contributor: null,
    updatedAt: Date.now(),
  };
}

function totalSteps() {
  return PRE_STEPS.length + QUESTIONS.length;
}

function stepNumber(session) {
  const pre = PRE_STEPS.indexOf(session.step);
  if (pre >= 0) return pre + 1;
  return PRE_STEPS.length + session.questionIndex + 1;
}

/** The prompt for whatever the session is waiting on. */
function prompt(session) {
  const lang = session.lang;
  const footer = `\n\n<i>${t('step', lang, { n: stepNumber(session), total: totalSteps() })}</i>`;

  switch (session.step) {
    case 'name':
      return { text: t('ask.name', lang) + footer, keyboard: 'skip' };

    case 'province':
      return {
        text: t('ask.province', lang) + footer,
        keyboard: 'provinces',
      };

    case 'city':
      return {
        text: t('ask.city', lang, { province: session.place.province }) + footer,
        keyboard: 'cities',
      };

    case 'place':
      return { text: t('ask.place', lang) + footer, keyboard: null };

    case 'location':
      return { text: t('ask.location', lang) + footer, keyboard: 'skip' };

    case 'precision':
      return { text: t('ask.precision', lang) + footer, keyboard: 'precision' };

    case 'date':
      return datePrompt(session, footer);

    case 'question': {
      const question = QUESTIONS[session.questionIndex];
      return questionPrompt(question, lang, footer);
    }

    case 'review':
      return { text: reviewText(session), keyboard: 'review' };

    default:
      return { text: t('unknown', lang), keyboard: null };
  }
}

function datePrompt(session, footer) {
  const { lang } = session;
  const { precision, startYear, month } = session.period;

  if (startYear === null) return { text: t('ask.year', lang) + footer, keyboard: null };
  if (precision === 'year' && session.period.endYear === null) {
    return { text: t('ask.endYear', lang) + footer, keyboard: null };
  }
  if (precision !== 'year' && month === null) {
    return { text: t('ask.month', lang) + footer, keyboard: 'months' };
  }
  if (precision === 'day' && session.period.day === null) {
    return { text: t('ask.day', lang) + footer, keyboard: null };
  }
  return { text: t('ask.year', lang) + footer, keyboard: null };
}

function questionPrompt(question, lang, footer) {
  const label = question.label[lang] || question.label.fa;
  const help = question.help ? `\n\n<i>${question.help[lang] || question.help.fa}</i>` : '';
  return {
    text: `<b>${label}</b>${help}${footer}`,
    keyboard: question.type === 'select' ? 'options' : (question.required ? null : 'skip'),
    question,
  };
}

/* --------------------------------- input --------------------------------- */

/**
 * Applies one piece of input. Returns { ok, error } and advances the session.
 * `input` is { text } or { location } or { choice }.
 */
function apply(session, input) {
  const lang = session.lang;
  session.updatedAt = Date.now();

  switch (session.step) {
    case 'name': {
      if (input.skip) { session.contributor = null; session.step = 'province'; return { ok: true }; }
      const name = (input.text || '').trim();
      if (!name) return { ok: false, error: t('error.needText', lang) };
      if (name.length > 80) return { ok: false, error: t('error.tooLong', lang, { max: 80 }) };
      session.contributor = name;
      session.step = 'province';
      return { ok: true };
    }

    case 'province': {
      const province = PROVINCES.find((p) => p.fa === input.choice);
      if (!province) return { ok: false, error: t('error.pickOption', lang) };
      session.place.province = province.fa;
      session.place.provinceEn = province.en;
      session.place.city = null;
      session.step = 'city';
      return { ok: true };
    }

    case 'city': {
      if (input.choice === '__back') { session.step = 'province'; return { ok: true }; }
      const cities = citiesOf(session.place.province);
      if (!cities.includes(input.choice)) return { ok: false, error: t('error.pickOption', lang) };
      session.place.city = input.choice;
      session.step = 'place';
      return { ok: true };
    }

    case 'place': {
      const text = (input.text || '').trim();
      if (!text) return { ok: false, error: t('error.needText', lang) };
      if (text.length > 140) return { ok: false, error: t('error.tooLong', lang, { max: 140 }) };
      session.place.name = `${text}، ${session.place.city}`.slice(0, 160);
      session.step = 'location';
      return { ok: true };
    }

    case 'location': {
      if (input.skip) {
        session.place.lat = null;
        session.place.lng = null;
        session.place.approximate = true;
        session.step = 'precision';
        return { ok: true };
      }
      if (!input.location) return { ok: false, error: t('ask.location', lang) };
      session.place.lat = input.location.latitude;
      session.place.lng = input.location.longitude;
      session.place.approximate = false;
      session.step = 'precision';
      return { ok: true };
    }

    case 'precision': {
      if (!['year', 'month', 'day'].includes(input.choice)) {
        return { ok: false, error: t('error.pickOption', lang) };
      }
      session.period.precision = input.choice;
      session.step = 'date';
      return { ok: true };
    }

    case 'date':
      return applyDate(session, input);

    case 'question':
      return applyQuestion(session, input);

    default:
      return { ok: false, error: t('unknown', lang) };
  }
}

function applyDate(session, input) {
  const lang = session.lang;
  const period = session.period;

  if (period.startYear === null) {
    const read = readYear(input.text);
    if (!read) return { ok: false, error: t('error.year', lang) };
    period.calendar = read.calendar;
    period.startYear = read.year;
    if (period.precision === 'year') return { ok: true };
    return { ok: true };
  }

  if (period.precision === 'year' && period.endYear === null) {
    const read = readYear(input.text);
    if (!read) return { ok: false, error: t('error.year', lang) };
    if (read.calendar !== period.calendar) period.calendar = read.calendar;
    if (read.year < period.startYear) return { ok: false, error: t('error.endBeforeStart', lang) };
    period.endYear = read.year;
    session.step = 'question';
    return { ok: true };
  }

  if (period.month === null) {
    const month = Number(input.choice);
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      return { ok: false, error: t('error.pickOption', lang) };
    }
    period.month = month;
    if (period.precision === 'month') session.step = 'question';
    return { ok: true };
  }

  if (period.precision === 'day' && period.day === null) {
    const day = Number(normaliseDigits(input.text));
    if (!Number.isInteger(day) || day < 1 || day > 31) {
      return { ok: false, error: t('error.day', lang) };
    }
    period.day = day;
    if (!resolvePeriod(session)) {
      period.day = null;
      return { ok: false, error: t('error.date', lang) };
    }
    session.step = 'question';
    return { ok: true };
  }

  return { ok: false, error: t('unknown', lang) };
}

function applyQuestion(session, input) {
  const lang = session.lang;
  const question = QUESTIONS[session.questionIndex];

  if (input.skip) {
    if (question.required) return { ok: false, error: t('error.needText', lang) };
    return advanceQuestion(session);
  }

  if (question.type === 'select') {
    const option = question.options.find((o) => o.value === input.choice);
    if (!option) return { ok: false, error: t('error.pickOption', lang) };
    session.answers[question.id] = option.value;
    return advanceQuestion(session);
  }

  const text = (input.text || '').trim();
  if (!text) return { ok: false, error: t('error.needText', lang) };
  if (question.minLength && text.length < question.minLength) {
    return { ok: false, error: t('error.tooShort', lang, { min: question.minLength }) };
  }
  if (question.maxLength && text.length > question.maxLength) {
    return { ok: false, error: t('error.tooLong', lang, { max: question.maxLength }) };
  }
  session.answers[question.id] = text;
  return advanceQuestion(session);
}

function advanceQuestion(session) {
  session.questionIndex += 1;
  if (session.questionIndex >= QUESTIONS.length) {
    session.step = 'review';
  } else {
    session.step = 'question';
  }
  return { ok: true };
}

/* --------------------------------- output -------------------------------- */

/** Turns the collected period into the ISO start and end the API expects. */
function resolvePeriod(session) {
  const { precision, calendar, startYear, endYear, month, day } = session.period;
  if (startYear === null) return null;

  const toISO = (year, m, d) => {
    if (calendar === 'jalali') return Jalali.toISO(year, m, d);
    const date = new Date(Date.UTC(year, m - 1, d));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
    return `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  };
  const lastDay = (year, m) => (calendar === 'jalali'
    ? Jalali.daysInMonth(year, m)
    : new Date(Date.UTC(year, m, 0)).getUTCDate());

  if (precision === 'year') {
    const last = endYear === null ? startYear : endYear;
    const start = toISO(startYear, 1, 1);
    const end = toISO(last, 12, lastDay(last, 12));
    return start && end ? { start, end, precision: 'year' } : null;
  }
  if (precision === 'month') {
    const start = toISO(startYear, month, 1);
    const end = toISO(startYear, month, lastDay(startYear, month));
    return start && end ? { start, end, precision: 'month' } : null;
  }
  const exact = toISO(startYear, month, day);
  return exact ? { start: exact, end: exact, precision: 'day' } : null;
}

function describePeriod(session) {
  const { lang } = session;
  const { precision, calendar, startYear, endYear, month, day } = session.period;
  const months = calendar === 'jalali' ? PERSIAN_MONTHS[lang] : null;
  const monthName = month && months ? months[month - 1] : month;

  if (precision === 'year') {
    const last = endYear === null ? startYear : endYear;
    return startYear === last ? String(startYear) : `${startYear} – ${last}`;
  }
  if (precision === 'month') return `${monthName} ${startYear}`;
  return `${day} ${monthName} ${startYear}`;
}

function reviewText(session) {
  const { lang } = session;
  const lines = [t('review.heading', lang), ''];
  const add = (label, value) => lines.push(`<b>${t(label, lang)}:</b> ${value}`);

  add('review.name', session.contributor || t('review.anonymous', lang));
  add('review.place', `${session.place.name} — ${session.place.province}`);
  add('review.point', session.place.approximate
    ? t('review.pointApprox', lang)
    : `${Number(session.place.lat).toFixed(4)}, ${Number(session.place.lng).toFixed(4)}`);
  add('review.when', describePeriod(session));
  lines.push('');

  for (const question of QUESTIONS) {
    const value = session.answers[question.id];
    if (!value) continue;
    const label = question.label[lang] || question.label.fa;
    const shown = question.type === 'select'
      ? (question.options.find((o) => o.value === value) || {})[lang] || value
      : (value.length > 220 ? `${value.slice(0, 220)}…` : value);
    lines.push(`<b>${label}</b>\n${shown}\n`);
  }
  return lines.join('\n');
}

/** The body posted to /api/submissions. */
function toSubmission(session, { centroidFor }) {
  const period = resolvePeriod(session);
  if (!period) return null;

  let { lat, lng } = session.place;
  if (session.place.approximate) {
    const centre = centroidFor(session.place.provinceEn);
    if (!centre) return null;
    lat = centre.lat;
    lng = centre.lng;
  }

  return {
    answers: session.answers,
    place: {
      name: session.place.name,
      lat,
      lng,
      approximate: session.place.approximate,
    },
    period,
    contributor: { name: session.contributor, email: null },
    source: 'telegram',
  };
}

module.exports = {
  newSession, prompt, apply, reviewText, describePeriod,
  resolvePeriod, toSubmission, readYear, normaliseDigits,
  totalSteps, PRE_STEPS,
};
