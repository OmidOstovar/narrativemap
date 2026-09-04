'use strict';

/**
 * The submission conversation, as a pure state machine.
 *
 * `step` returns what to say next and what to store; it never talks to
 * Telegram or to the API. That keeps the whole flow testable without a network,
 * which matters because the flow is long and easy to break.
 */

const { QUESTIONS, FORM_SEQUENCE, SELECT_TYPES } = require('../src/questions');
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

/**
 * The place block expands into several messages — a province, a city and a
 * location — because a chat asks one thing at a time. Nobody is asked to name
 * the place: the city answers that, and the pin fixes the rest.
 * Everything else maps one to one onto the shared sequence.
 */
const PLACE_STEPS = ['province', 'city', 'location'];
const PERIOD_STEPS = ['precision', 'date'];

/** The bot's own step list, expanded from the questionnaire's sequence. */
const STEPS = FORM_SEQUENCE.flatMap((entry) => {
  if (entry.kind === 'place') return PLACE_STEPS.map((name) => ({ kind: name }));
  if (entry.kind === 'period') return PERIOD_STEPS.map((name) => ({ kind: name }));
  if (entry.kind === 'pseudonym') return [{ kind: 'name' }];
  if (entry.kind === 'email') return [{ kind: 'email' }];
  return [{ kind: 'question', id: entry.id }];
});

/** Kept for the tests and for anything reading the old shape. */
const PRE_STEPS = STEPS.filter((s) => s.kind !== 'question').map((s) => s.kind);

function newSession(lang) {
  return {
    lang: lang || 'fa',
    stepIndex: 0,
    step: STEPS[0].kind,
    questionId: STEPS[0].id || null,
    chosen: {},
    answers: {},
    email: null,
    place: { province: null, provinceEn: null, city: null, name: null, lat: null, lng: null, approximate: false },
    period: {
      precision: 'year',
      startYear: null,
      endYear: null,
      month: null,
      day: null,
      startTime: null,
      endTime: null,
      calendar: 'jalali',
    },
    contributor: null,
    updatedAt: Date.now(),
  };
}

function totalSteps() {
  return STEPS.length;
}

function stepNumber(session) {
  return Math.min(session.stepIndex + 1, STEPS.length);
}

/** Moves to the next step, or to the review if there are none left. */
function advance(session) {
  session.stepIndex += 1;
  if (session.stepIndex >= STEPS.length) {
    session.step = 'review';
    session.questionId = null;
    return { ok: true };
  }
  const next = STEPS[session.stepIndex];
  session.step = next.kind;
  session.questionId = next.id || null;
  return { ok: true };
}

/** Steps back, used when a contributor asks for the province list again. */
function goBackTo(session, kind) {
  const index = STEPS.findIndex((s) => s.kind === kind);
  if (index < 0) return;
  session.stepIndex = index;
  session.step = kind;
  session.questionId = STEPS[index].id || null;
}

function currentQuestion(session) {
  return QUESTIONS.find((q) => q.id === session.questionId) || null;
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

    case 'location':
      return { text: t('ask.location', lang) + footer, keyboard: 'skip' };

    case 'precision':
      return { text: t('ask.precision', lang) + footer, keyboard: 'precision' };

    case 'date':
      return datePrompt(session, footer);

    case 'email':
      return { text: t('ask.email', lang) + footer, keyboard: 'skip' };

    case 'question': {
      const question = currentQuestion(session);
      if (!question) return { text: t('unknown', lang), keyboard: null };
      return questionPrompt(question, session, footer);
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
  if (precision !== 'month' && session.period.day === null) {
    return { text: t('ask.day', lang) + footer, keyboard: null };
  }
  if (precision === 'hour' && session.period.startTime === null) {
    return { text: t('ask.fromTime', lang) + footer, keyboard: null };
  }
  if (precision === 'hour' && session.period.endTime === null) {
    return { text: t('ask.toTime', lang) + footer, keyboard: null };
  }
  return { text: t('ask.year', lang) + footer, keyboard: null };
}

/** Reads a time typed in either script, as 14:30, 14.30, or 1430. */
function readTime(text) {
  const digits = normaliseDigits(text).replace(/[^\d:.]/g, '').replace(/\./g, ':');
  const match = digits.match(/^(\d{1,2}):?(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function questionPrompt(question, session, footer) {
  const lang = session.lang;
  const label = question.label[lang] || question.label.fa;
  const help = question.help ? `\n\n<i>${question.help[lang] || question.help.fa}</i>` : '';

  if (SELECT_TYPES.has(question.type)) {
    // A chat cannot show tick-boxes, so choices toggle and the contributor
    // says when they are done. What is already chosen is echoed back.
    const chosen = session.chosen[question.id] || [];
    const detail = question.options
      .filter((o) => o.detail)
      .map((o) => `• <b>${o[lang] || o.fa}</b> — ${o.detail[lang] || o.detail.fa}`)
      .join('\n');
    const echo = chosen.length
      ? `\n\n${t('choice.chosen', lang, {
        list: chosen.map((code) => {
          const option = question.options.find((o) => o.value === code);
          return option ? (option[lang] || option.fa) : code;
        }).join('، '),
      })}`
      : '';
    return {
      text: `<b>${label}</b>${help}${detail ? `\n\n${detail}` : ''}${echo}${footer}`,
      keyboard: 'options',
      question,
    };
  }

  return {
    text: `<b>${label}</b>${help}${footer}`,
    keyboard: question.required ? null : 'skip',
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
      if (input.skip) { session.contributor = null; return advance(session); }
      const name = (input.text || '').trim();
      if (!name) return { ok: false, error: t('error.needText', lang) };
      if (name.length > 80) return { ok: false, error: t('error.tooLong', lang, { max: 80 }) };
      session.contributor = name;
      return advance(session);
    }

    case 'email': {
      if (input.skip) { session.email = null; return advance(session); }
      const email = (input.text || '').trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
        return { ok: false, error: t('error.email', lang) };
      }
      session.email = email.slice(0, 160);
      return advance(session);
    }

    case 'province': {
      const province = PROVINCES.find((p) => p.fa === input.choice);
      if (!province) return { ok: false, error: t('error.pickOption', lang) };
      session.place.province = province.fa;
      session.place.provinceEn = province.en;
      session.place.city = null;
      return advance(session);
    }

    case 'city': {
      if (input.choice === '__back') { goBackTo(session, 'province'); return { ok: true }; }
      const cities = citiesOf(session.place.province);
      if (!cities.includes(input.choice)) return { ok: false, error: t('error.pickOption', lang) };
      session.place.city = input.choice;
      // The city the contributor picked is the place's name; the pin does the rest.
      session.place.name = input.choice;
      return advance(session);
    }

    case 'location': {
      if (input.skip) {
        session.place.lat = null;
        session.place.lng = null;
        session.place.approximate = true;
        return advance(session);
      }
      if (!input.location) return { ok: false, error: t('ask.location', lang) };
      session.place.lat = input.location.latitude;
      session.place.lng = input.location.longitude;
      session.place.approximate = false;
      return advance(session);
    }

    case 'precision': {
      if (!['year', 'month', 'day', 'hour'].includes(input.choice)) {
        return { ok: false, error: t('error.pickOption', lang) };
      }
      session.period.precision = input.choice;
      return advance(session);
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
    return advance(session);
  }

  if (period.month === null) {
    const month = Number(input.choice);
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      return { ok: false, error: t('error.pickOption', lang) };
    }
    period.month = month;
    if (period.precision === 'month') return advance(session);
    return { ok: true };
  }

  if (period.precision !== 'month' && period.day === null) {
    const day = Number(normaliseDigits(input.text));
    if (!Number.isInteger(day) || day < 1 || day > 31) {
      return { ok: false, error: t('error.day', lang) };
    }
    period.day = day;
    if (!isRealCalendarDate(period)) {
      period.day = null;
      return { ok: false, error: t('error.date', lang) };
    }
    if (period.precision === 'day') return advance(session);
    return { ok: true };
  }

  if (period.precision === 'hour' && period.startTime === null) {
    const time = readTime(input.text);
    if (!time) return { ok: false, error: t('error.time', lang) };
    period.startTime = time;
    return { ok: true };
  }

  if (period.precision === 'hour' && period.endTime === null) {
    const time = readTime(input.text);
    if (!time) return { ok: false, error: t('error.time', lang) };
    period.endTime = time;
    return advance(session);
  }

  return { ok: false, error: t('unknown', lang) };
}

/** True when the collected year/month/day is a date that exists. */
function isRealCalendarDate(period) {
  const { calendar, startYear, month, day } = period;
  if (calendar === 'jalali') return Boolean(Jalali.toISO(startYear, month, day));
  const date = new Date(Date.UTC(startYear, month - 1, day));
  return date.getUTCFullYear() === startYear
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function applyQuestion(session, input) {
  const lang = session.lang;
  const question = currentQuestion(session);
  if (!question) return { ok: false, error: t('unknown', lang) };

  if (SELECT_TYPES.has(question.type)) {
    const chosen = session.chosen[question.id] || [];

    if (input.choice === '__done') {
      if (!chosen.length) {
        return question.required
          ? { ok: false, error: t('choice.needOne', lang) }
          : advance(session);
      }
      session.answers[question.id] = question.type === 'multiselect' ? chosen : chosen[0];
      return advance(session);
    }

    const option = question.options.find((o) => o.value === input.choice);
    if (!option) return { ok: false, error: t('error.pickOption', lang) };

    if (question.type === 'multiselect') {
      // Tapping an option again takes it back off the list.
      session.chosen[question.id] = chosen.includes(option.value)
        ? chosen.filter((v) => v !== option.value)
        : [...chosen, option.value];
      return { ok: true, stay: true };
    }
    session.answers[question.id] = option.value;
    return advance(session);
  }

  if (input.skip) {
    if (question.required) return { ok: false, error: t('error.needText', lang) };
    return advance(session);
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
  return advance(session);
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
  if (!exact) return null;
  if (precision === 'day') return { start: exact, end: exact, precision: 'day' };

  if (session.period.startTime === null || session.period.endTime === null) return null;
  // "From eleven at night until two" means the small hours of the next day.
  const crossesMidnight = session.period.endTime < session.period.startTime;
  const endDate = crossesMidnight ? addDaysISO(exact, 1) : exact;
  return {
    start: exact,
    end: endDate,
    precision: 'hour',
    startTime: session.period.startTime,
    endTime: session.period.endTime,
  };
}

/** Adds days to a Gregorian ISO date. */
function addDaysISO(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`;
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
  const date = `${day} ${monthName} ${startYear}`;
  if (precision !== 'hour') return date;
  const { startTime, endTime } = session.period;
  if (!startTime) return date;
  return startTime === endTime ? `${date}، ${startTime}` : `${date}، ${startTime}–${endTime}`;
}

function reviewText(session) {
  const { lang } = session;
  const lines = [t('review.heading', lang), ''];
  const add = (label, value) => lines.push(`<b>${t(label, lang)}:</b> ${value}`);

  add('review.name', session.contributor || t('review.anonymous', lang));
  add('review.place', `${session.place.city} — ${session.place.province}`);
  add('review.point', session.place.approximate
    ? t('review.pointApprox', lang)
    : `${Number(session.place.lat).toFixed(4)}, ${Number(session.place.lng).toFixed(4)}`);
  add('review.when', describePeriod(session));
  lines.push('');

  for (const question of QUESTIONS) {
    const value = session.answers[question.id];
    if (!value || (Array.isArray(value) && !value.length)) continue;
    const label = question.label[lang] || question.label.fa;
    let shown;
    if (SELECT_TYPES.has(question.type)) {
      const codes = Array.isArray(value) ? value : [value];
      shown = codes.map((code) => {
        const option = question.options.find((o) => o.value === code);
        return option ? (option[lang] || option.fa) : code;
      }).join('، ');
    } else {
      shown = value.length > 220 ? `${value.slice(0, 220)}…` : value;
    }
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
    contributor: { name: session.contributor, email: session.email || null },
    source: 'telegram',
  };
}

module.exports = {
  newSession, prompt, apply, reviewText, describePeriod,
  resolvePeriod, toSubmission, readYear, readTime, normaliseDigits,
  totalSteps, STEPS, PRE_STEPS,
};
