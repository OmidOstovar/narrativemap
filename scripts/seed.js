#!/usr/bin/env node
'use strict';

/**
 * Fills the database with illustrative narratives so a fresh install has
 * something on the map. Every entry below is invented sample content, not a
 * real account. Run `npm run seed -- --reset` to clear the table first.
 *
 * Delete this file, or just the rows, before running the site for real.
 */

const db = require('../src/db');
const { provinceFor, isInsideIran } = require('../src/geo');

const SAMPLES = [
  {
    place: 'خیابانی نزدیک میدان، سرپل ذهاب',
    lat: 34.4614, lng: 45.8631,
    period: { start: '2026-01-08', end: '2026-01-08', precision: 'hour', startTime: '21:00', endTime: '23:30' },
    contributor: 'ناشناس',
    originalLang: 'fa',
    answers: {
      narrative_kind: ['chronicle'],
      how_you_know: ['lived'],
      what_happened:
        'این یک نمونهٔ ساختگی است تا نقشه در نصب تازه خالی نباشد.\n\nمتن واقعی روایت اینجا می‌آید: آنچه دیده‌اید، به همان زبانی که برای دوستی تعریف می‌کنید، با همان جزئیاتی که یادتان مانده.',
      what_it_left: 'این هم نمونه است. جای اثری است که ماجرا بر جا گذاشته.',
    },
  },
  {
    place: 'A courtyard off Tarbiat Street, Tabriz',
    lat: 38.0740, lng: 46.2960,
    period: { start: '2026-01-09', end: '2026-01-10', precision: 'day' },
    contributor: 'Anonymous',
    originalLang: 'en',
    answers: {
      narrative_kind: ['impression'],
      how_you_know: ['family_friend'],
      what_happened:
        'This is invented sample content, so that a fresh install has something on the map.\n\nA real narrative would go here: what was seen, told the way you would tell a friend, with whatever detail stayed with you.',
      light_ahead: 'Sample text, standing in for what someone might say keeps them going.',
    },
  },
];

const PENDING = [
  {
    place: 'کوچه‌ای پشت بازار، رشت',
    lat: 37.2808, lng: 49.5832,
    period: { start: '2026-01-10', end: '2026-01-10', precision: 'day' },
    contributor: null,
    email: '',
    originalLang: 'fa',
    answers: {
      narrative_kind: ['chronicle', 'impression'],
      how_you_know: ['witnessed'],
      what_happened:
        'نمونه‌ای که در صف بررسی می‌ماند، تا بتوانید صفحهٔ بررسی را با چیزی واقعی امتحان کنید.\n\nاین متن ساختگی است و باید پیش از انتشار سایت حذف شود.',
    },
  },
];

function insert(sample, approve) {
  if (!isInsideIran(sample.lat, sample.lng)) {
    throw new Error(`Sample "${sample.place}" is outside Iran.`);
  }
  const id = db.createSubmission({
    answers: sample.answers,
    place: {
      name: sample.place,
      lat: sample.lat,
      lng: sample.lng,
      province: provinceFor(sample.lat, sample.lng),
    },
    period: sample.period,
    contributor: { name: sample.contributor, email: sample.email || null },
    originalLang: sample.originalLang,
  });
  if (approve) db.setStatus(id, 'approved', 'Seeded sample narrative.');
  return id;
}

function main() {
  if (process.argv.includes('--reset')) {
    db.db.exec('DELETE FROM narratives');
    console.log('Cleared existing narratives.');
  }

  const existing = db.counts();
  if (existing.approved + existing.pending + existing.rejected > 0 && !process.argv.includes('--force')) {
    console.log('Database already has narratives. Use --reset to replace them, or --force to add anyway.');
    process.exit(0);
  }

  SAMPLES.forEach((sample) => insert(sample, true));
  PENDING.forEach((sample) => insert(sample, false));

  const counts = db.counts();
  console.log(`Seeded ${counts.approved} published narratives and ${counts.pending} waiting in the review queue.`);
  console.log('These are invented samples — delete them before the site goes live.');
}

main();
