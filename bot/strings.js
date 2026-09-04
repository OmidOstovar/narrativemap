'use strict';

/**
 * Everything the bot says, in Persian and English.
 *
 * The Persian keeps the warm, informal register of the original bot — this is
 * the voice contributors already know, and the tone matters when you are asking
 * someone for a difficult memory.
 */
const STRINGS = {
  'welcome': {
    fa: '📖 <b>تنها روایت است که می‌ماند.</b>\n\n'
      + 'هم آنچه دیده‌اید، هم آنچه از سر گذرانده‌اید — می‌توانید ناشناس بگویید.\n\n'
      + 'روایت‌ها روی نقشهٔ ایران منتشر می‌شوند، هر کدام سر جای خودش و در زمان خودش.\n\n'
      + 'هیچ روایتی پیش از خوانده‌شدن و تأیید منتشر نمی‌شود.',
    en: '📖 <b>What you lived through is part of the record, and it would be a shame to lose it.</b>\n\n'
      + 'What you saw, and what you went through — you can tell it anonymously.\n\n'
      + 'Narratives are published on a map of Iran, each one at its own place and its own time.\n\n'
      + 'Nothing is published until it has been read and accepted.',
  },
  'welcome.start': { fa: '✍️ ثبت روایت تازه', en: '✍️ Add a narrative' },
  'welcome.language': { fa: '🌐 English', en: '🌐 فارسی' },

  'cancelled': { fa: 'لغو شد. هر وقت خواستید /start را بزنید.', en: 'Cancelled. Send /start whenever you are ready.' },
  'expired': {
    fa: 'این گفت‌وگو منقضی شده. برای شروع دوباره /start را بزنید.',
    en: 'This conversation has expired. Send /start to begin again.',
  },
  'unknown': { fa: 'متوجه نشدم. برای شروع /start را بزنید.', en: 'I did not follow that. Send /start to begin.' },
  'skip': { fa: '⏭ رد کردن', en: '⏭ Skip' },
  'back': { fa: '« بازگشت', en: '« Back' },
  'step': { fa: 'گام {n} از {total}', en: 'Step {n} of {total}' },

  'choice.done': { fa: '✓ همین‌ها', en: '✓ That is all' },
  'choice.chosen': { fa: 'انتخاب‌شده: {list}', en: 'Chosen: {list}' },
  'choice.needOne': { fa: 'دست‌کم یک گزینه را انتخاب کنید.', en: 'Choose at least one option.' },
  'ask.name': {
    fa: '👤 <b>نام مستعارتان</b>\n\nروایت‌ها ناشناس خواهند بود؛ هر نامی که مایلید نمایش داده شود بنویسید. اگر می‌خواهید ناشناس بمانید، رد کنید.',
    en: '👤 <b>Your chosen name</b>\n\nNarratives are anonymous. Write whatever name you would like shown, or skip to stay anonymous.',
  },
  'ask.email': {
    fa: '✉️ <b>ایمیل</b> (اختیاری)\n\nصرفاً برای اما و اگرهای احتمالی آینده. اگر نمی‌خواهید، رد کنید.',
    en: '✉️ <b>Email</b> (optional)\n\nOnly for the ifs and maybes of some future moment. Skip if you would rather not.',
  },
  'error.email': { fa: 'این نشانی ایمیل درست به نظر نمی‌رسد.', en: 'That does not look like an email address.' },
  'ask.province': { fa: '📍 <b>استان را انتخاب کنید</b>', en: '📍 <b>Choose the province</b>' },
  'ask.city': { fa: '📍 <b>شهر را انتخاب کنید</b>\n\nاستان: {province}', en: '📍 <b>Choose the city</b>\n\nProvince: {province}' },
  'ask.place': {
    fa: '📍 <b>کجا بود؟</b>\n\nمی‌توانید یک جای کلی یا جزئی را مشخص کنید: از «بندرعباس» تا «دانشکدهٔ ادبیات دانشگاه تبریز».',
    en: '📍 <b>Where was it?</b>\n\nSomewhere broad or somewhere exact: anything from “Bandar Abbas” to “the Faculty of Literature at Tabriz University”.',
  },
  'ask.location': {
    fa: '🗺 <b>نقطهٔ دقیق را بفرستید</b>\n\nاز گیرهٔ 📎 گزینهٔ Location را بزنید و نشانگر را روی همان نقطه بکشید.\n\n'
      + 'اگر نمی‌توانید، رد کنید — روایت فعلاً وسط استان می‌نشیند و بعداً جابه‌جا می‌شود.',
    en: '🗺 <b>Send the exact spot</b>\n\nUse the 📎 attachment menu, choose Location, and drag the pin to the place.\n\n'
      + 'If you cannot, skip it — the narrative sits at the centre of the province until it is moved.',
  },
  'ask.precision': {
    fa: '📅 <b>کی شد؟</b>\n\nاگر مشاهده‌ای عینی بوده، ترجیحاً زمان دقیق را بنویسید. اگر از حسی ممتد می‌گویید، زمان حدودی کافی است.\n\nزمان را با چه دقتی می‌دانید؟',
    en: '📅 <b>When was it?</b>\n\nIf you saw it yourself, give the time as exactly as you can. If you are describing a feeling that stayed with you, roughly is enough.\n\nHow precisely do you know it?',
  },
  'precision.hour': { fa: 'تا حد ساعت', en: 'To the hour' },
  'precision.year': { fa: 'تا حد سال', en: 'To the year' },
  'precision.month': { fa: 'تا حد ماه', en: 'To the month' },
  'precision.day': { fa: 'تا حد روز', en: 'To the day' },

  'ask.year': {
    fa: '📅 <b>سال را بنویسید</b> (هجری شمسی، مثلاً ۱۳۵۷)\n\nاگر میلادی می‌نویسید، چهار رقمی بنویسید، مثلاً 1979.',
    en: '📅 <b>Which year?</b>\n\nWrite a Solar Hijri year such as 1357, or a Gregorian one such as 1979.',
  },
  'ask.month': { fa: '📅 <b>ماه را انتخاب کنید</b>', en: '📅 <b>Choose the month</b>' },
  'ask.day': { fa: '📅 <b>روز را بنویسید</b> (۱ تا ۳۱)', en: '📅 <b>Which day?</b> (1–31)' },
  'ask.fromTime': {
    fa: '🕐 <b>ساعت آغاز را بنویسید</b>\n\nمثلاً ۱۴:۳۰ یا 2:30 — همان ساعتی که آنجا بود.',
    en: '🕐 <b>What time did it start?</b>\n\nSomething like 14:30 — the time where you were.',
  },
  'ask.toTime': {
    fa: '🕐 <b>و تا چه ساعتی؟</b>\n\nاگر یک لحظه بوده، همان ساعت را دوباره بنویسید.',
    en: '🕐 <b>And until what time?</b>\n\nIf it was a single moment, write the same time again.',
  },
  'error.time': {
    fa: 'ساعت را نفهمیدم. به شکل ۱۴:۳۰ بنویسید.',
    en: 'I did not understand that time. Write it like 14:30.',
  },
  'ask.endYear': {
    fa: '📅 <b>تا چه سالی ادامه داشت؟</b>\n\nاگر مربوط به یک سال است، همان سال را دوباره بنویسید.',
    en: '📅 <b>Through to which year?</b>\n\nIf it belongs to one year, write the same year again.',
  },

  'error.year': {
    fa: 'سال را نفهمیدم. یک عدد بنویسید، مثلاً ۱۳۵۷ یا 1979.',
    en: 'I did not understand that year. Write a number such as 1357 or 1979.',
  },
  'error.yearRange': { fa: 'این نقشه سال‌های {min} تا {max} میلادی را در بر می‌گیرد.', en: 'This map covers {min} to {max}.' },
  'error.day': { fa: 'روز باید عددی بین ۱ تا ۳۱ باشد.', en: 'The day has to be a number from 1 to 31.' },
  'error.date': { fa: 'این تاریخ وجود ندارد. دوباره امتحان کنید.', en: 'That date does not exist. Try again.' },
  'error.endBeforeStart': { fa: 'سال پایان از سال آغاز جلوتر است. دوباره بنویسید.', en: 'The end year comes before the start. Try again.' },
  'error.outsideIran': {
    fa: 'این نقطه بیرون از ایران است. یک نقطهٔ دیگر بفرستید یا رد کنید.',
    en: 'That point is outside Iran. Send another one, or skip.',
  },
  'error.tooShort': { fa: 'کمی بیشتر بنویسید — دست‌کم {min} نویسه.', en: 'A little more, please — at least {min} characters.' },
  'error.tooLong': { fa: 'این بیش از حد بلند است. کمتر از {max} نویسه بنویسید.', en: 'That is too long. Please keep it under {max} characters.' },
  'error.needText': { fa: 'لطفاً پاسخ را به‌صورت متن بنویسید.', en: 'Please answer with text.' },
  'error.pickOption': { fa: 'یکی از گزینه‌ها را انتخاب کنید.', en: 'Choose one of the options.' },
  'error.send': {
    fa: '⚠️ روایت فرستاده نشد. کمی بعد دوباره /start را بزنید.',
    en: '⚠️ The narrative could not be sent. Try /start again shortly.',
  },
  'error.rateLimited': {
    fa: 'روایت‌های زیادی در مدت کوتاه فرستاده شده. کمی بعد دوباره تلاش کنید.',
    en: 'That is a lot of narratives in a short time. Please try again later.',
  },

  'review.heading': { fa: '📋 <b>یک بار مرور کنید</b>', en: '📋 <b>Have a last look</b>' },
  'review.name': { fa: 'راوی', en: 'Told by' },
  'review.anonymous': { fa: 'ناشناس', en: 'Anonymous' },
  'review.place': { fa: 'مکان', en: 'Place' },
  'review.point': { fa: 'نقطه', en: 'Point' },
  'review.pointApprox': { fa: 'مرکز استان (بعداً دقیق می‌شود)', en: 'centre of the province (to be placed exactly later)' },
  'review.when': { fa: 'زمان', en: 'When' },
  'review.confirm': { fa: '✅ بفرست', en: '✅ Send it' },
  'review.restart': { fa: '🔄 از نو', en: '🔄 Start over' },
  'review.cancel': { fa: '✖️ بی‌خیال', en: '✖️ Cancel' },

  'sent': {
    fa: '🌿 <b>روایت شما رسید.</b>\n\nبه‌محض اینکه خوانده و تأیید شود روی نقشه می‌آید.\n\n'
      + 'کد پیگیری: <code>{id}</code>\n\nبرای ثبت روایتی دیگر /start را بزنید.',
    en: '🌿 <b>Your narrative has arrived.</b>\n\nIt will appear on the map once it has been read and accepted.\n\n'
      + 'Reference: <code>{id}</code>\n\nSend /start to add another.',
  },
  'help': {
    fa: 'برای ثبت روایت /start را بزنید.\n/cancel گفت‌وگوی جاری را لغو می‌کند.\n/language زبان را عوض می‌کند.',
    en: 'Send /start to add a narrative.\n/cancel abandons the current one.\n/language switches language.',
  },
  'language.changed': { fa: 'زبان روی فارسی تنظیم شد.', en: 'Language set to English.' },
};

const PERSIAN_MONTHS = {
  fa: ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
    'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'],
  en: ['Farvardin', 'Ordibehesht', 'Khordad', 'Tir', 'Mordad', 'Shahrivar',
    'Mehr', 'Aban', 'Azar', 'Dey', 'Bahman', 'Esfand'],
};

function t(key, lang, params) {
  const entry = STRINGS[key];
  let text = entry ? (entry[lang] || entry.fa) : key;
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.split(`{${name}}`).join(String(value));
    }
  }
  return text;
}

module.exports = { STRINGS, PERSIAN_MONTHS, t };
