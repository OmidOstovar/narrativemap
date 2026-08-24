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
    place: 'The carpet sellers’ row, Grand Bazaar, Tehran',
    lat: 35.6739, lng: 51.4200,
    period: { start: '1978-09-01', end: '1979-02-11', precision: 'month' },
    contributor: 'Mina R.',
    answers: {
      title: 'My father counted the days in carpets',
      what_happened:
        'My father kept a stall three doors into the carpet row. That autumn he stopped selling and started counting. He would roll out a carpet in the morning, and if nobody came by noon he would roll it back up and mark the day in a notebook he kept under the till.\n\nBy the winter the notebook had more marks than the shop had carpets. He never explained the system to me and I never asked. I was eleven, and the bazaar was the whole world, and the whole world had gone quiet in a way I could feel in my teeth.',
      why_here:
        'The stall is still there. It sells phone cases now. But the arch above it has the same water stain shaped like a bird, and I can find the exact spot with my eyes closed.',
      senses:
        'Wet wool. When the bazaar is empty the wool smell comes forward, because there is nobody’s cologne or cigarettes to cover it.',
      who_else: 'My father, who would not want his name here. His neighbour Agha Rahim, who is gone.',
      what_changed:
        'I learned that adults keep records of things they cannot say out loud. I have kept a notebook ever since.',
      how_you_know: 'I lived it',
      before_reading: 'This is a small story about a shop, not about anything larger.',
    },
  },
  {
    place: 'Si-o-se-pol, the third arch from the north bank, Isfahan',
    lat: 32.6433, lng: 51.6675,
    period: { start: '1994-01-01', end: '1999-12-31', precision: 'year' },
    contributor: 'Anonymous',
    answers: {
      title: 'Six summers under the third arch',
      what_happened:
        'Every summer from when I was fourteen until I left for university, my cousins and I met under the third arch of Si-o-se-pol after evening prayers. It was the only place in the city where the adults could see we were being sensible and still not hear a word we said.\n\nWe argued about films, mostly. Someone always had a cassette. One year the river was so low you could walk out to the middle and stand where the water should have been, and we did, and nobody said anything about it, because saying it out loud would have made it true.',
      why_here:
        'The third arch specifically. The first two catch the wind off the bank and you have to shout. The third is quiet enough to whisper in, and that is why teenagers have used it for a hundred years.',
      senses:
        'The stone stays warm long after dark. You could sit on it at eleven at night in August and feel the whole day still in it.',
      who_else: 'Four cousins. Two are in Isfahan, one in Toronto, one I do not speak to.',
      what_changed:
        'When I go back now I check the water level before I check anything else. That habit started under that arch.',
      how_you_know: 'I lived it',
      before_reading: '',
    },
  },
  {
    place: 'A courtyard off Tarbiat Street, Tabriz',
    lat: 38.0740, lng: 46.2960,
    period: { start: '1966-04-01', end: '1966-04-30', precision: 'month' },
    contributor: 'Told to me by my grandmother',
    answers: {
      title: 'The month the pomegranate tree was planted',
      what_happened:
        'My grandmother was married in this courtyard in the spring of 1966. She has told the story so many times that I can describe a place I have never stood in. Her father planted a pomegranate sapling in the corner on the morning of the wedding, because his own father had done the same for him.\n\nThe tree outlived him, outlived the marriage, and outlived the house. When the building was pulled down in the nineties, my uncle went at dawn and took a cutting. It is in a pot on a balcony in Karaj and it has never fruited once.',
      why_here:
        'The courtyard is gone — there is a four-storey block there now. But the address is the address, and the family has been describing this exact rectangle of ground for sixty years.',
      senses:
        'She always mentions that the plaster was still wet on one wall and someone leaned against it in a good jacket.',
      who_else: 'My grandmother. Her father. My uncle, who is the reason the cutting exists.',
      what_changed:
        'I understood that a family can carry a place forward even after the place is demolished.',
      how_you_know: 'Someone in my family told me',
      before_reading: 'Everything here is second-hand, told to me across a kitchen table many times over.',
    },
  },
  {
    place: 'The steps at the tomb of Hafez, Shiraz',
    lat: 29.6255, lng: 52.5581,
    period: { start: '2005-03-01', end: '2005-03-31', precision: 'month' },
    contributor: 'Kaveh',
    answers: {
      title: 'A stranger opened the book for me',
      what_happened:
        'I had failed my entrance exams and had not told my family. I went to the tomb because it was the only place I could think of to go where sitting still for two hours would look normal.\n\nAn old man selling tea noticed I had been on the same step a long time. He did not ask what was wrong. He opened his own copy at random, read four lines to me, closed it, and went back to his flask. I have thought about those four lines for twenty years and I still cannot decide whether they were about patience or about giving up.',
      why_here:
        'The third step on the eastern side, where the shade reaches by four in the afternoon. That is where he was standing.',
      senses: 'Sour cherry tea, and the particular sound of a metal tray being set down on stone.',
      who_else: 'The tea seller. I never learned his name and he is certainly not there now.',
      what_changed:
        'I retook the exams. That is not the point of the story, but people always ask.',
      how_you_know: 'I lived it',
      before_reading: '',
    },
  },
  {
    place: 'Outside the citadel walls, Bam',
    lat: 29.1060, lng: 58.3570,
    period: { start: '2003-12-26', end: '2003-12-26', precision: 'day' },
    contributor: 'Anonymous',
    answers: {
      title: 'The morning the mud came down',
      what_happened:
        'I was a volunteer driver. I arrived the day it happened, and what I remember is not the ruins but the quiet — thousands of people, and almost no sound, because everybody was listening for the same thing under the same rubble.\n\nAn engineer I had never met before handed me a list of street names and asked me to read them out loud at every corner. Half of those streets no longer existed as streets. I read them anyway for eleven hours.',
      why_here:
        'The staging point was the flat ground just outside the eastern wall. That is where the lists were kept and where the reading happened.',
      senses:
        'Dust that tasted of clay. Everything you drank tasted of clay for a week afterwards.',
      who_else:
        'An engineer whose first name I think was Behrouz. Dozens of drivers whose faces I would not recognise now.',
      what_changed: 'I do not think I have ever been genuinely bored since.',
      how_you_know: 'I was there, but it happened to someone else',
      before_reading:
        'This account touches on a disaster in which many thousands of people died. It is deliberately restrained, but it is still about that day.',
    },
  },
  {
    place: 'کوچه‌ای پشت بازار ماهی‌فروش‌ها، رشت',
    lat: 37.2760, lng: 49.5890,
    period: { start: '1985-01-01', end: '1988-12-31', precision: 'year' },
    contributor: 'ناشناس',
    answers: {
      title: 'صبح‌های بارانی پشت بازار',
      what_happened:
        'مادرم هر روز صبح ساعت پنج از این کوچه رد می‌شد تا به بازار برسد. من هفت ساله بودم و گاهی دنبالش راه می‌افتادم، بیشتر برای اینکه در خانه تنها نمانم تا صدای آژیر بیاید.\n\nدر آن سه سال یاد گرفتم که باران رشت با باران هیچ‌جای دیگری فرق دارد؛ تمام‌نشدنی است و کسی از آن شکایت نمی‌کند. مادرم می‌گفت باران خوب است، چون وقتی می‌بارد هواپیما نمی‌آید. نمی‌دانم راست می‌گفت یا فقط می‌خواست من از باران نترسم.',
      why_here:
        'این کوچه هنوز هست. عرضش به اندازه‌ای است که دو نفر شانه‌به‌شانه رد شوند و نه بیشتر. من همان‌جا راه رفتن در باران را یاد گرفتم.',
      senses: 'بوی ماهی تازه و چوب خیس. هنوز هم با بوی چوب خیس یاد آن صبح‌ها می‌افتم.',
      who_else: 'مادرم. نمی‌خواهد اسمش نوشته شود.',
      what_changed: 'هیچ‌وقت نتوانستم در شهری زندگی کنم که باران کم دارد.',
      how_you_know: 'I lived it',
      before_reading: 'این روایت به سال‌های جنگ اشاره دارد اما درباره‌ی جنگ نیست.',
    },
  },
  {
    place: 'The staff canteen at the refinery gate, Abadan',
    lat: 30.3392, lng: 48.3043,
    period: { start: '1980-09-01', end: '1980-09-30', precision: 'month' },
    contributor: 'Told to me by my father',
    answers: {
      title: 'They left the tea urn on',
      what_happened:
        'My father worked in the refinery canteen. When the evacuation order came through, the supervisor went round switching off every appliance in the kitchen, and stopped at the tea urn. He decided to leave it running.\n\nMy father said the man could not explain why, only that turning it off felt like agreeing to something. They locked the door with the urn still hot behind it. My father talked about that urn more than he talked about anything else from that year.',
      why_here:
        'The canteen was directly inside the eastern gate. The building is not there now, but the gate position has not moved.',
      senses: 'He said the whole place smelled of the sweet burnt edge of an urn that has been on too long.',
      who_else: 'A supervisor my father only ever called “the Isfahani”.',
      what_changed:
        'My father never let a kettle be emptied and put away in our house. It always had water in it.',
      how_you_know: 'Someone in my family told me',
      before_reading: 'Told to me in pieces over about thirty years, so the details may have drifted.',
    },
  },
  {
    place: 'A rooftop in the old town, Yazd',
    lat: 31.8974, lng: 54.3569,
    period: { start: '1972-06-01', end: '1972-08-31', precision: 'month' },
    contributor: 'Farideh',
    answers: {
      title: 'We slept on the roof and argued about the stars',
      what_happened:
        'In the summer the whole family slept on the roof. My brother had a book of constellations from school and insisted on naming them; my grandmother insisted on different names entirely, the ones she had learned as a girl, and refused to concede a single one.\n\nThey argued every night for a whole summer. Neither of them ever changed their position. It is the happiest I remember either of them being.',
      why_here:
        'The roof of the house on the corner, the one with the badgir that leans very slightly to the east. The lean is how you find it.',
      senses:
        'Cold bedding at ten at night that was too hot to lie on by six in the morning.',
      who_else: 'My brother Hossein. My grandmother, who is buried here.',
      what_changed:
        'I have never once looked at the sky without hearing two people disagreeing pleasantly.',
      how_you_know: 'I lived it',
      before_reading: '',
    },
  },
  {
    place: 'The bus terminal at Vakil Abad, Mashhad',
    lat: 36.2880, lng: 59.6157,
    period: { start: '2010-11-01', end: '2010-11-30', precision: 'month' },
    contributor: 'Anonymous',
    answers: {
      title: 'Twelve hours in the wrong queue',
      what_happened:
        'I was travelling to see a cousin and I joined the wrong queue at the terminal. I did not realise for nearly four hours, because nobody in the queue realised either. By the time the mistake surfaced, the eleven of us had shared food twice and exchanged phone numbers.\n\nWe eventually all got on different buses to different cities. I still have a group message with four of them running fifteen years later. It has never once been about buses.',
      why_here:
        'Bay nine, which is where the queue formed, against a pillar with a hand-written sign that turned out to be for a service that had been discontinued.',
      senses: 'Diesel and cardamom, in that order, all night.',
      who_else: 'Ten strangers. Four of them are still in my phone.',
      what_changed:
        'I stopped being embarrassed about asking whether I am in the right place.',
      how_you_know: 'I lived it',
      before_reading: '',
    },
  },
  {
    place: 'A schoolyard on the western edge of Zahedan',
    lat: 29.4963, lng: 60.8629,
    period: { start: '1996-01-01', end: '1996-12-31', precision: 'year' },
    contributor: 'A teacher',
    answers: {
      title: 'The year we taught in three languages at once',
      what_happened:
        'I taught in a school where the children arrived speaking Balochi at home, Persian in the classroom, and a mix of both in the yard. That year we had a headmaster who decided the yard was the yard, and children could speak in the yard however they liked.\n\nIt sounds like nothing. It changed the noise level of the whole school. You could hear, from the staff room, that something had been unclenched.',
      why_here:
        'The yard, not the classrooms. The distinction is the entire story.',
      senses: 'Dust that got into the chalk and made it squeak differently.',
      who_else: 'A headmaster who was moved on after two years.',
      what_changed:
        'I have never since believed that a rule about language is only about language.',
      how_you_know: 'I lived it',
      before_reading: '',
    },
  },
];

const PENDING = [
  {
    place: 'The corniche near the old customs house, Bandar Abbas',
    lat: 27.1832, lng: 56.2666,
    period: { start: '2018-05-14', end: '2018-05-14', precision: 'day' },
    contributor: 'Nadia',
    email: 'nadia@example.com',
    answers: {
      title: 'The afternoon the wind stopped completely',
      what_happened:
        'For about forty minutes one afternoon in May the wind off the water stopped entirely. Anyone who has lived on that coast will tell you this does not happen. The fishermen came off their boats to stand and look at the water, and nobody said anything much.\n\nMy uncle, who had been at sea for thirty years, said it was the only time he had been frightened by good weather.',
      why_here:
        'The stretch of corniche directly in front of the old customs house, where the boats tie up close enough to talk to.',
      senses: 'The absence of the sound you stop noticing until it goes.',
      who_else: 'My uncle. Perhaps twenty fishermen whose names I do not know.',
      what_changed: 'I pay attention to the wind now in a way I did not before.',
      how_you_know: 'I lived it',
      before_reading: '',
    },
  },
  {
    place: 'A village road above Sarpol-e Zahab, Kermanshah province',
    lat: 34.3142, lng: 47.0650,
    period: { start: '2017-11-12', end: '2017-11-20', precision: 'day' },
    contributor: 'Anonymous',
    email: '',
    answers: {
      title: 'A week of headlights facing the same direction',
      what_happened:
        'In the week after the earthquake, the road was one long line of headlights going up, and almost nothing coming back down. People drove from cities that had no connection to the place at all.\n\nI helped unload for four days. The thing I remember is a man who had driven eight hours to deliver blankets, refused tea, and turned round and drove home again without stopping. Somebody told him he should rest. He said resting was not what he had come for.',
      why_here:
        'The bend in the road where the ground drops away on the left, which is where the vehicles had to stop and unload by hand.',
      senses: 'Diesel exhaust in cold mountain air, which is a smell I now associate with kindness.',
      who_else: 'Hundreds of people. One man with blankets.',
      what_changed: 'I do not accept the idea that people are basically indifferent.',
      how_you_know: 'I was there, but it happened to someone else',
      before_reading:
        'This refers to the 2017 earthquake, in which many people died. It is about the response rather than the event.',
    },
  },
];

function insert(sample, approve) {
  if (!isInsideIran(sample.lat, sample.lng)) {
    throw new Error(`Sample "${sample.answers.title}" is outside Iran.`);
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
