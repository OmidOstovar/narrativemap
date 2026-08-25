'use strict';

const { validateAnswers } = require('./questions');
const { isInsideIran, provinceFor } = require('./geo');

const MIN_YEAR = Number(process.env.MIN_YEAR || 1800);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PRECISIONS = ['day', 'month', 'year'];

function maxYear() {
  return new Date().getUTCFullYear();
}

function isRealDate(value) {
  if (!DATE_PATTERN.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y
    && date.getUTCMonth() === m - 1
    && date.getUTCDate() === d;
}

function validatePlace(raw, errors) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const lat = Number(input.lat);
  const lng = Number(input.lng);

  if (!name) {
    errors.push({ field: 'place.name', code: 'error.placeNameRequired', message: 'Name the place this happened.' });
  } else if (name.length > 160) {
    errors.push({ field: 'place.name', code: 'error.placeNameTooLong', message: 'Please keep the place name under 160 characters.' });
  }

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    errors.push({ field: 'place.point', code: 'error.pinRequired', message: 'Drop a pin on the map to set the exact spot.' });
    return null;
  }
  if (!isInsideIran(lat, lng)) {
    errors.push({ field: 'place.point', code: 'error.outsideIran', message: 'That point is outside Iran. This map only carries narratives placed inside the country.' });
    return null;
  }

  return {
    name: name.slice(0, 160),
    // ~1 m of precision; more than that is noise from the map widget.
    lat: Math.round(lat * 1e5) / 1e5,
    lng: Math.round(lng * 1e5) / 1e5,
    province: provinceFor(lat, lng),
  };
}

function validatePeriod(raw, errors) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const precision = PRECISIONS.includes(input.precision) ? input.precision : 'day';
  const start = typeof input.start === 'string' ? input.start.trim() : '';
  const end = typeof input.end === 'string' ? input.end.trim() : '';

  if (!isRealDate(start) || !isRealDate(end)) {
    errors.push({ field: 'period', code: 'error.badDates', message: 'Give a real start and end date for the period.' });
    return null;
  }
  if (start > end) {
    errors.push({ field: 'period', code: 'error.endBeforeStart', message: 'The period ends before it starts.' });
    return null;
  }

  const startYear = Number(start.slice(0, 4));
  const endYear = Number(end.slice(0, 4));
  if (startYear < MIN_YEAR) {
    errors.push({ field: 'period', code: 'error.tooEarly', params: { min: MIN_YEAR }, message: `This map covers ${MIN_YEAR} onwards.` });
    return null;
  }
  if (endYear > maxYear()) {
    errors.push({ field: 'period', code: 'error.future', message: 'The period cannot end in the future.' });
    return null;
  }

  return { start, end, precision };
}

function validateContributor(raw, errors) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const email = typeof input.email === 'string' ? input.email.trim() : '';

  if (name.length > 80) {
    errors.push({ field: 'contributor.name', code: 'error.nameTooLong', message: 'Please keep the name under 80 characters.' });
  }
  if (email && !EMAIL_PATTERN.test(email)) {
    errors.push({ field: 'contributor.email', code: 'error.badEmail', message: 'That does not look like an email address.' });
  }

  return { name: name.slice(0, 80) || null, email: email.slice(0, 160) || null };
}

/**
 * Validates a whole submission body. Returns { value, errors }; `value` is null
 * when anything failed, so callers never half-write a record.
 */
function validateSubmission(body) {
  const input = body && typeof body === 'object' ? body : {};
  const errors = [];

  const { answers, errors: answerErrors } = validateAnswers(input.answers);
  errors.push(...answerErrors);

  const place = validatePlace(input.place, errors);
  const period = validatePeriod(input.period, errors);
  const contributor = validateContributor(input.contributor, errors);

  if (errors.length) return { value: null, errors };
  return { value: { answers, place, period, contributor }, errors: [] };
}

module.exports = { validateSubmission, MIN_YEAR, maxYear };
