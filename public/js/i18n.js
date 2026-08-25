/**
 * Bilingual UI: English and Persian, switchable at runtime.
 *
 * Static markup is translated by tagging elements:
 *   data-i18n="key"             replaces textContent
 *   data-i18n-placeholder="key" replaces the placeholder attribute
 *   data-i18n-label="key"       replaces aria-label
 *   data-i18n-html="key"        replaces innerHTML (only for keys we author)
 *
 * Anything rendered from JavaScript calls t(key, params) directly.
 *
 * The Persian register deliberately matches the Telegram bot contributors
 * already know — warm and informal rather than bureaucratic.
 */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'nm_lang';
  const LANGS = ['en', 'fa'];

  const STRINGS = {
    /* ---------------------------- page titles --------------------------- */
    'title.map': { en: 'Narrative Map — Iran', fa: 'نقشهٔ روایت‌ها — ایران' },
    'title.submit': { en: 'Add your narrative — Narrative Map', fa: 'ثبت روایت — نقشهٔ روایت‌ها' },
    'title.about': { en: 'About — Narrative Map', fa: 'دربارهٔ نقشهٔ روایت‌ها' },
    'title.admin': { en: 'Review queue — Narrative Map', fa: 'صف بررسی — نقشهٔ روایت‌ها' },
    'title.404': { en: 'Not found — Narrative Map', fa: 'پیدا نشد — نقشهٔ روایت‌ها' },

    /* ------------------------------ chrome ------------------------------ */
    'brand.name': { en: 'Narrative Map', fa: 'نقشهٔ روایت‌ها' },
    'brand.sub': { en: 'Iran', fa: 'ایران' },
    'nav.map': { en: 'Map', fa: 'نقشه' },
    'nav.submit': { en: 'Add your narrative', fa: 'ثبت روایت' },
    'nav.submitShort': { en: 'Add', fa: 'ثبت' },
    'nav.submitRest': { en: 'your narrative', fa: 'روایت' },
    'nav.about': { en: 'About', fa: 'درباره' },
    'nav.publicMap': { en: 'Public map', fa: 'نقشهٔ عمومی' },
    'lang.toggle': { en: 'فارسی', fa: 'English' },
    'lang.toggleShort': { en: 'فا', fa: 'EN' },
    'lang.toggleLabel': { en: 'Switch to Persian', fa: 'Switch to English' },

    /* ------------------------------- map -------------------------------- */
    'map.search': { en: 'Search titles, places, and text…', fa: 'جست‌وجو در عنوان‌ها، مکان‌ها و متن…' },
    'map.searchLabel': { en: 'Search narratives', fa: 'جست‌وجوی روایت‌ها' },
    'map.allProvinces': { en: 'All provinces', fa: 'همهٔ استان‌ها' },
    'map.provinceLabel': { en: 'Filter by province', fa: 'فیلتر بر اساس استان' },
    'map.sortLabel': { en: 'Sort narratives', fa: 'ترتیب روایت‌ها' },
    'map.sort.chronological': { en: 'Oldest first', fa: 'قدیمی‌ترین اول' },
    'map.sort.reverse': { en: 'Newest first', fa: 'تازه‌ترین اول' },
    'map.sort.recent': { en: 'Recently published', fa: 'به‌تازگی منتشرشده' },
    'map.sort.title': { en: 'By title', fa: 'بر اساس عنوان' },
    'map.count.one': { en: 'narrative', fa: 'روایت' },
    'map.count.many': { en: 'narratives', fa: 'روایت' },
    'map.count.ofTotal': { en: 'of {total} narratives', fa: 'از {total} روایت' },
    'map.clearFilters': { en: 'Clear filters', fa: 'حذف فیلترها' },
    'map.streetDetail': { en: 'Street detail', fa: 'نمای خیابانی' },
    'map.empty.title': { en: 'No narratives yet.', fa: 'هنوز روایتی ثبت نشده.' },
    'map.empty.body': { en: 'This map fills up one story at a time.', fa: 'این نقشه یکی‌یکی پر می‌شود.' },
    'map.empty.cta': { en: 'Be the first to add one →', fa: 'اولین روایت را شما ثبت کنید →' },
    'map.noMatch.title': { en: 'Nothing matches these filters.', fa: 'چیزی با این فیلترها پیدا نشد.' },
    'map.noMatch.body': {
      en: 'Try widening the time period or clearing the search.',
      fa: 'بازهٔ زمانی را بازتر کنید یا جست‌وجو را پاک کنید.',
    },
    'map.cluster': { en: '{count} narratives — click to zoom in', fa: '{count} روایت — برای بزرگ‌نمایی کلیک کنید' },

    /* ----------------------------- timeline ----------------------------- */
    'timeline.label': { en: 'Time period', fa: 'بازهٔ زمانی' },
    'timeline.reset': { en: 'Reset', fa: 'بازنشانی' },
    'timeline.aria': { en: 'Filter narratives by time period', fa: 'فیلتر روایت‌ها بر اساس بازهٔ زمانی' },
    'timeline.from': { en: 'Earliest year', fa: 'زودترین سال' },
    'timeline.to': { en: 'Latest year', fa: 'دیرترین سال' },

    /* ------------------------------ reader ------------------------------ */
    'reader.back': { en: '← Back to map', fa: '→ بازگشت به نقشه' },
    'reader.close': { en: 'Close narrative', fa: 'بستن روایت' },
    'reader.copyLink': { en: 'Copy link', fa: 'کپی نشانی' },
    'reader.copied': { en: 'Link copied.', fa: 'نشانی کپی شد.' },
    'reader.copyFailed': {
      en: 'Copy the address bar to share this narrative.',
      fa: 'برای هم‌رسانی، نشانی صفحه را از نوار آدرس کپی کنید.',
    },
    'reader.place': { en: 'Place', fa: 'مکان' },
    'reader.when': { en: 'When', fa: 'زمان' },
    'reader.toldBy': { en: 'Told by', fa: 'راوی' },
    'reader.anonymous': { en: 'Anonymous', fa: 'ناشناس' },
    'reader.solarHijri': { en: '(Solar Hijri)', fa: '(هجری شمسی)' },
    'reader.gregorian': { en: '(Gregorian)', fa: '(میلادی)' },
    'reader.untitled': { en: 'Untitled narrative', fa: 'روایت بی‌عنوان' },

    /* ------------------------------ submit ------------------------------ */
    'submit.eyebrow': { en: 'Add your narrative', fa: 'ثبت روایت' },
    'submit.title': { en: 'Put your story on the map.', fa: 'روایتتان را روی نقشه بگذارید.' },
    'submit.lede': {
      en: 'Every narrative here is anchored to one exact place in Iran and one period of time. Answer the questions below, mark the spot, and send it in. Nothing appears on the public map until it has been read and accepted.',
      fa: 'هر روایت اینجا به یک نقطهٔ مشخص در ایران و یک بازهٔ زمانی گره خورده است. به پرسش‌های زیر پاسخ دهید، نقطه را روی نقشه مشخص کنید و بفرستید. هیچ روایتی تا خوانده و تأیید نشود روی نقشهٔ عمومی نمی‌آید.',
    },
    'submit.where.title': { en: 'Where did it happen?', fa: 'کجا اتفاق افتاد؟' },
    'submit.where.note': {
      en: 'Search for the place or click straight on the map. Drag the pin to fine-tune it — the exact coordinates are what fixes your narrative to the map.',
      fa: 'نام مکان را جست‌وجو کنید یا مستقیم روی نقشه کلیک کنید. برای دقیق‌کردن، نشانگر را بکشید — همین مختصات دقیق است که روایت شما را روی نقشه ثابت می‌کند.',
    },
    'submit.search': { en: 'Search for a city, street, or landmark in Iran…', fa: 'جست‌وجوی شهر، خیابان یا نشانه‌ای در ایران…' },
    'submit.searchLabel': { en: 'Search for a place in Iran', fa: 'جست‌وجوی مکان در ایران' },
    'submit.searchNone': { en: 'No matches. Click the map instead.', fa: 'چیزی پیدا نشد. مستقیم روی نقشه کلیک کنید.' },
    'submit.searchDown': {
      en: 'Place search is unavailable. Click the map to drop your pin.',
      fa: 'جست‌وجوی مکان در دسترس نیست. برای گذاشتن نشانگر روی نقشه کلیک کنید.',
    },
    'submit.pinHint': { en: 'Click anywhere on Iran to drop your pin', fa: 'برای گذاشتن نشانگر، هرجای ایران کلیک کنید' },
    'submit.pin': { en: 'Pin:', fa: 'نشانگر:' },
    'submit.pinUnset': { en: 'not set', fa: 'مشخص نشده' },
    'submit.province': { en: 'Province:', fa: 'استان:' },
    'submit.insideIran': { en: 'inside Iran', fa: 'داخل ایران' },
    'submit.outsideIran': { en: 'outside Iran', fa: 'خارج از ایران' },
    'submit.placeName': { en: 'What is this place called?', fa: 'این مکان را چه می‌نامید؟' },
    'submit.placeNameHelp': {
      en: 'In your own words — “my grandmother’s courtyard on Sepah Street”, not just “Tehran”.',
      fa: 'به زبان خودتان — «حیاط خانهٔ مادربزرگم در خیابان سپه»، نه فقط «تهران».',
    },
    'submit.placeNamePlaceholder': {
      en: 'e.g. The bakery at the corner of Ferdowsi and Enghelab',
      fa: 'مثلاً نانوایی سر نبش فردوسی و انقلاب',
    },
    'submit.when.title': { en: 'When did it happen?', fa: 'کِی اتفاق افتاد؟' },
    'submit.when.note': {
      en: 'A single day, a month, or a stretch of years — whatever you actually know. Dates are shown in both calendars on the map.',
      fa: 'یک روز، یک ماه، یا چند سال — هرچه واقعاً می‌دانید. تاریخ‌ها روی نقشه به هر دو تقویم نشان داده می‌شوند.',
    },
    'submit.precision': { en: 'How precisely do you know the time?', fa: 'زمان را با چه دقتی می‌دانید؟' },
    'submit.precision.year': { en: 'To the year', fa: 'تا حد سال' },
    'submit.precision.month': { en: 'To the month', fa: 'تا حد ماه' },
    'submit.precision.day': { en: 'To the day', fa: 'تا حد روز' },
    'submit.fromYear': { en: 'From year', fa: 'از سال' },
    'submit.toYear': { en: 'To year', fa: 'تا سال' },
    'submit.fromMonth': { en: 'From month', fa: 'از ماه' },
    'submit.toMonth': { en: 'To month', fa: 'تا ماه' },
    'submit.firstDay': { en: 'First day', fa: 'روز آغاز' },
    'submit.lastDay': { en: 'Last day', fa: 'روز پایان' },
    'submit.inSolarHijri': { en: 'in the Solar Hijri calendar', fa: 'به تقویم هجری شمسی' },
    'submit.chooseOne': { en: 'Choose one…', fa: 'یکی را انتخاب کنید…' },
    'submit.atLeast': { en: '{count} / at least {min}', fa: '{count} / دست‌کم {min}' },
    'submit.narrative.title': { en: 'The narrative', fa: 'روایت' },
    'submit.narrative.note': {
      en: 'Answer in whichever language you think in — English or Persian both work. The questions marked optional can be left empty.',
      fa: 'به هر زبانی که با آن فکر می‌کنید بنویسید — فارسی یا انگلیسی، فرقی نمی‌کند. پرسش‌هایی که «اختیاری» خورده‌اند را می‌توانید خالی بگذارید.',
    },
    'submit.about.title': { en: 'About you', fa: 'دربارهٔ شما' },
    'submit.about.note': {
      en: 'Optional. Leave the name blank to appear as “Anonymous”.',
      fa: 'اختیاری. اگر نامی ننویسید، «ناشناس» نمایش داده می‌شوید.',
    },
    'submit.yourName': { en: 'Name to show with the narrative', fa: 'نامی که کنار روایت بیاید' },
    'submit.optionalPublic': { en: 'optional, public', fa: 'اختیاری، عمومی' },
    'submit.optional': { en: 'optional', fa: 'اختیاری' },
    'submit.email': { en: 'Email', fa: 'ایمیل' },
    'submit.emailOptional': { en: 'optional, never published', fa: 'اختیاری، هرگز منتشر نمی‌شود' },
    'submit.emailHelp': {
      en: 'Only so the moderator can come back to you with a question before publishing.',
      fa: 'فقط برای اینکه اگر پیش از انتشار پرسشی بود بتوانیم با شما تماس بگیریم.',
    },
    'submit.send': { en: 'Send for review', fa: 'ارسال برای بررسی' },
    'submit.sending': { en: 'Sending…', fa: 'در حال ارسال…' },
    'submit.moderatorNote': {
      en: 'A moderator reads every submission before it is published.',
      fa: 'هر روایت پیش از انتشار خوانده می‌شود.',
    },
    'submit.progress.none': { en: 'Nothing answered yet', fa: 'هنوز چیزی پر نشده' },
    'submit.progress.some': { en: '{done} of {total} required parts filled in', fa: '{done} از {total} بخش لازم پر شده' },
    'submit.progress.done': { en: 'Everything required is filled in.', fa: 'همهٔ بخش‌های لازم پر شده‌اند.' },
    'submit.success.title': { en: 'Your narrative is with the moderator.', fa: 'روایت شما برای بررسی فرستاده شد.' },
    'submit.success.body': {
      en: 'It will appear on the public map once it has been read and accepted.',
      fa: 'به‌محض اینکه خوانده و تأیید شود، روی نقشهٔ عمومی می‌آید.',
    },
    'submit.success.ref': { en: 'Reference: {id}', fa: 'کد پیگیری: {id}' },
    'submit.success.back': { en: 'Back to the map', fa: 'بازگشت به نقشه' },
    'submit.success.another': { en: 'Add another narrative', fa: 'ثبت روایتی دیگر' },
    'submit.fixErrors': { en: '{message} See the highlighted questions above.', fa: '{message} به پرسش‌های مشخص‌شده در بالا نگاه کنید.' },
    'submit.loadFailed': { en: 'Could not load the form.', fa: 'فرم بارگذاری نشد.' },
    'map.loadFailed': { en: 'Could not load the map.', fa: 'نقشه بارگذاری نشد.' },

    /* ------------------------------- admin ------------------------------ */
    'admin.brandSub': { en: 'Review queue', fa: 'صف بررسی' },
    'admin.signIn': { en: 'Sign in', fa: 'ورود' },
    'admin.signOut': { en: 'Sign out', fa: 'خروج' },
    'admin.title': { en: 'Review queue', fa: 'صف بررسی' },
    'admin.loginNote': {
      en: 'Sign in to read submitted narratives and decide what goes on the public map.',
      fa: 'برای خواندن روایت‌های رسیده و تصمیم دربارهٔ انتشارشان وارد شوید.',
    },
    'admin.password': { en: 'Password', fa: 'گذرواژه' },
    'admin.tab.pending': { en: 'Pending', fa: 'در انتظار' },
    'admin.tab.approved': { en: 'Published', fa: 'منتشرشده' },
    'admin.tab.rejected': { en: 'Declined', fa: 'ردشده' },
    'admin.nothingSelected': { en: 'Nothing selected.', fa: 'چیزی انتخاب نشده.' },
    'admin.pickOne': { en: 'Pick a submission from the queue to read it.', fa: 'برای خواندن، یکی از روایت‌های صف را انتخاب کنید.' },
    'admin.empty.pending': { en: 'Queue is empty.', fa: 'صف خالی است.' },
    'admin.empty.pendingNote': { en: 'Every submission has been dealt with.', fa: 'به همهٔ روایت‌ها رسیدگی شده.' },
    'admin.empty.approved': { en: 'Nothing published yet.', fa: 'هنوز چیزی منتشر نشده.' },
    'admin.empty.approvedNote': { en: 'Approved narratives show up here.', fa: 'روایت‌های تأییدشده اینجا می‌آیند.' },
    'admin.empty.rejected': { en: 'Nothing declined.', fa: 'چیزی رد نشده.' },
    'admin.privateHeading': { en: 'Moderator only — never shown publicly', fa: 'فقط برای شما — هرگز عمومی نمی‌شود' },
    'admin.reference': { en: 'Reference', fa: 'کد پیگیری' },
    'admin.submitted': { en: 'Submitted', fa: 'زمان ارسال' },
    'admin.contact': { en: 'Contact', fa: 'راه تماس' },
    'admin.noContact': { en: 'none given', fa: 'ثبت نشده' },
    'admin.reviewed': { en: 'Reviewed', fa: 'زمان بررسی' },
    'admin.note': { en: 'Note', fa: 'یادداشت' },
    'admin.viewOnMap': { en: 'View on the public map ↗', fa: 'دیدن روی نقشهٔ عمومی ↗' },
    'admin.streetCheck': {
      en: 'Street detail — check the pin against real streets',
      fa: 'نمای خیابانی — نشانگر را با خیابان‌های واقعی بسنجید',
    },
    'admin.leftBlank': { en: 'Left blank: {questions}', fa: 'بی‌پاسخ مانده: {questions}' },
    'admin.source': { en: 'Came from', fa: 'از راه' },
    'admin.source.web': { en: 'the website', fa: 'وب‌سایت' },
    'admin.source.telegram': { en: 'Telegram', fa: 'تلگرام' },
    'admin.approximate': {
      en: 'This pin is approximate — it sits at the centre of the province because the contributor could not give an exact spot. Drag it to the right place before publishing.',
      fa: 'این نشانگر تقریبی است — چون راوی نتوانسته نقطهٔ دقیق را بدهد، وسط استان نشسته. پیش از انتشار آن را به جای درست بکشید.',
    },
    'admin.approximateShort': { en: 'approximate pin', fa: 'نشانگر تقریبی' },
    'admin.approximateField': { en: 'Still approximate', fa: 'هنوز تقریبی است' },
    'admin.publish': { en: 'Publish to the map', fa: 'انتشار روی نقشه' },
    'admin.unpublish': { en: 'Unpublish', fa: 'برداشتن از نقشه' },
    'admin.decline': { en: 'Decline', fa: 'رد کردن' },
    'admin.backToPending': { en: 'Move back to pending', fa: 'بازگرداندن به صف بررسی' },
    'admin.edit': { en: 'Edit details', fa: 'ویرایش جزئیات' },
    'admin.delete': { en: 'Delete', fa: 'حذف' },
    'admin.save': { en: 'Save changes', fa: 'ذخیرهٔ تغییرات' },
    'admin.cancel': { en: 'Cancel', fa: 'انصراف' },
    'admin.editing': { en: 'Editing “{title}”', fa: 'ویرایش «{title}»' },
    'admin.editNote': {
      en: 'Fix typos, tighten a place name, or move a misplaced pin. Changes are saved to the submission itself, so a published narrative updates on the map.',
      fa: 'غلط‌ها را درست کنید، نام مکان را دقیق‌تر کنید، یا نشانگر جابه‌جا را حرکت دهید. تغییرات روی خودِ روایت ذخیره می‌شود، پس روایت منتشرشده روی نقشه هم به‌روز می‌شود.',
    },
    'admin.placeAndTime': { en: 'Place and time', fa: 'مکان و زمان' },
    'admin.placeName': { en: 'Place name', fa: 'نام مکان' },
    'admin.latitude': { en: 'Latitude', fa: 'عرض جغرافیایی' },
    'admin.longitude': { en: 'Longitude', fa: 'طول جغرافیایی' },
    'admin.provinceIs': { en: 'Province:', fa: 'استان:' },
    'admin.dragPin': { en: '— drag the pin below to move it.', fa: '— برای جابه‌جایی، نشانگر پایین را بکشید.' },
    'admin.periodStart': { en: 'Period start', fa: 'آغاز بازه' },
    'admin.periodEnd': { en: 'Period end', fa: 'پایان بازه' },
    'admin.shownAs': { en: 'Shown as', fa: 'نمایش به‌صورت' },
    'admin.noAnswer': { en: '— no answer —', fa: '— بی‌پاسخ —' },
    'admin.unknown': { en: 'unknown', fa: 'نامشخص' },
    'admin.outsideProvinces': { en: 'outside the province layer', fa: 'بیرون از لایهٔ استان‌ها' },
    'admin.declineReason': { en: 'Why is this being declined? (private note, optional)', fa: 'چرا رد می‌شود؟ (یادداشت خصوصی، اختیاری)' },
    'admin.confirmDelete': { en: 'Delete “{title}” permanently? This cannot be undone.', fa: 'روایت «{title}» برای همیشه حذف شود؟ این کار برگشت‌پذیر نیست.' },
    'admin.published': { en: 'Narrative published.', fa: 'روایت منتشر شد.' },
    'admin.declined': { en: 'Narrative declined.', fa: 'روایت رد شد.' },
    'admin.movedBack': { en: 'Narrative moved back to pending.', fa: 'روایت به صف بررسی بازگشت.' },
    'admin.deleted': { en: 'Submission deleted.', fa: 'روایت حذف شد.' },
    'admin.saved': { en: 'Changes saved.', fa: 'تغییرات ذخیره شد.' },
    'admin.status.pending': { en: 'pending', fa: 'در انتظار' },
    'admin.status.approved': { en: 'published', fa: 'منتشرشده' },
    'admin.status.rejected': { en: 'declined', fa: 'ردشده' },

    /* ------------------------------ errors ------------------------------ */
    'error.required': { en: 'This question needs an answer.', fa: 'این پرسش باید پاسخ داده شود.' },
    'error.chooseOption': { en: 'Choose one of the listed options.', fa: 'یکی از گزینه‌های فهرست را انتخاب کنید.' },
    'error.tooShort': { en: 'Please write at least {min} characters.', fa: 'دست‌کم {min} نویسه بنویسید.' },
    'error.tooLong': { en: 'Please keep this under {max} characters.', fa: 'لطفاً کمتر از {max} نویسه بنویسید.' },
    'error.placeNameRequired': { en: 'Name the place this happened.', fa: 'نام مکانی که این اتفاق افتاد را بنویسید.' },
    'error.placeNameTooLong': { en: 'Please keep the place name under 160 characters.', fa: 'نام مکان را کمتر از ۱۶۰ نویسه بنویسید.' },
    'error.pinRequired': { en: 'Drop a pin on the map to set the exact spot.', fa: 'برای مشخص‌کردن نقطهٔ دقیق، نشانگر را روی نقشه بگذارید.' },
    'error.outsideIran': {
      en: 'That point is outside Iran. This map only carries narratives placed inside the country.',
      fa: 'این نقطه بیرون از ایران است. این نقشه فقط روایت‌هایی را نگه می‌دارد که داخل کشور ثبت شده باشند.',
    },
    'error.badDates': { en: 'Give a real start and end date for the period.', fa: 'تاریخ آغاز و پایان بازه را درست وارد کنید.' },
    'error.endBeforeStart': { en: 'The period ends before it starts.', fa: 'پایان بازه پیش از آغاز آن است.' },
    'error.tooEarly': { en: 'This map covers {min} onwards.', fa: 'این نقشه از سال {min} به بعد را در بر می‌گیرد.' },
    'error.future': { en: 'The period cannot end in the future.', fa: 'بازه نمی‌تواند در آینده تمام شود.' },
    'error.nameTooLong': { en: 'Please keep the name under 80 characters.', fa: 'نام را کمتر از ۸۰ نویسه بنویسید.' },
    'error.badEmail': { en: 'That does not look like an email address.', fa: 'این نشانی ایمیل درست به نظر نمی‌رسد.' },
    'error.generic': { en: 'Something went wrong.', fa: 'خطایی رخ داد.' },

    /* ------------------------------- about ------------------------------ */
    'about.eyebrow': { en: 'About', fa: 'دربارهٔ این نقشه' },
    'about.title': { en: 'A map made of what people remember.', fa: 'نقشه‌ای از آنچه مردم به یاد دارند.' },
    'about.lede': {
      en: 'Most maps of Iran show roads, borders, and administrative units. This one shows what happened to people, and exactly where.',
      fa: 'بیشتر نقشه‌های ایران جاده‌ها و مرزها و تقسیمات اداری را نشان می‌دهند. این یکی نشان می‌دهد بر مردم چه گذشته، و دقیقاً کجا.',
    },
    'about.what.title': { en: 'What counts as a narrative', fa: 'روایت یعنی چه' },
    'about.what.p1': {
      en: 'A narrative is one account, told by one person, tied to two things that never move: an exact place and a period of time. A street corner in Tabriz in the spring of 1979. A schoolyard in Ahvaz across four years in the 1980s. A single afternoon at a bus stop.',
      fa: 'روایت یعنی یک شرح، از زبان یک نفر، گره‌خورده به دو چیز که جابه‌جا نمی‌شوند: یک مکان دقیق و یک بازهٔ زمانی. سر یک کوچه در تبریز، بهار ۱۳۵۸. حیاط مدرسه‌ای در اهواز، در چهار سال دههٔ شصت. یک بعدازظهر سر ایستگاه اتوبوس.',
    },
    'about.what.p2': {
      en: 'Narratives are not written free-form. Everyone answers the same set of questions, which is what makes very different accounts readable side by side.',
      fa: 'روایت‌ها آزاد نوشته نمی‌شوند. همه به یک مجموعه پرسش یکسان پاسخ می‌دهند، و همین است که شرح‌های بسیار متفاوت را کنار هم خواندنی می‌کند.',
    },
    'about.how.title': { en: 'How the place and the time are recorded', fa: 'مکان و زمان چطور ثبت می‌شوند' },
    'about.how.place': {
      en: 'Place. A pin, set to about a metre of precision, plus the name the contributor uses for it. The province is worked out from the coordinates.',
      fa: 'مکان. یک نشانگر با دقتی در حد یک متر، به‌همراه نامی که راوی برایش به کار می‌برد. استان از روی مختصات به دست می‌آید.',
    },
    'about.how.time': {
      en: 'Time. A start and an end, with the precision the contributor actually has — to the year, the month, or the day. The map shows the period in both the Gregorian and the Solar Hijri calendar.',
      fa: 'زمان. یک آغاز و یک پایان، با همان دقتی که راوی واقعاً دارد — تا حد سال، ماه یا روز. نقشه بازه را به هر دو تقویم میلادی و هجری شمسی نشان می‌دهد.',
    },
    'about.review.title': { en: 'How submissions are reviewed', fa: 'روایت‌ها چطور بررسی می‌شوند' },
    'about.review.p1': {
      en: 'Nothing reaches the public map on its own. Every submission goes into a private queue, where a moderator reads it in full and either publishes it, sends it back, or declines it.',
      fa: 'هیچ روایتی خودبه‌خود روی نقشهٔ عمومی نمی‌آید. هر روایت به صف بررسی خصوصی می‌رود، آنجا کامل خوانده می‌شود و یا منتشر می‌شود، یا برمی‌گردد، یا رد می‌شود.',
    },
    'about.review.p2': {
      en: 'A contributor who leaves the name field blank appears as “Anonymous”.',
      fa: 'اگر راوی نامی ننویسد، با عنوان «ناشناس» نمایش داده می‌شود.',
    },
    'about.lang.title': { en: 'Languages', fa: 'زبان‌ها' },
    'about.lang.p': {
      en: 'The interface is available in English and Persian — use the toggle in the header. Answers can be written in either language; Persian and Arabic text is detected and rendered right-to-left automatically.',
      fa: 'رابط کاربری به فارسی و انگلیسی در دسترس است — از کلید بالای صفحه استفاده کنید. پاسخ‌ها را می‌توانید به هر دو زبان بنویسید؛ متن فارسی و عربی به‌طور خودکار راست‌به‌چپ نمایش داده می‌شود.',
    },
    'about.map.title': { en: 'Where the map comes from', fa: 'نقشه از کجا آمده' },
    'about.map.p': {
      en: 'The outline of Iran and its 31 provinces is drawn from geoBoundaries (CC BY 4.0), bundled with the site so the map loads without calling out to anyone. The optional “Street detail” layer is the only thing that fetches third-party tiles, from OpenStreetMap.',
      fa: 'خطوط مرزی ایران و ۳۱ استان آن از geoBoundaries (CC BY 4.0) گرفته شده و همراه سایت عرضه می‌شود، تا نقشه بدون درخواست از جای دیگری بارگذاری شود. تنها لایهٔ «نمای خیابانی» است که کاشی‌های نقشه را از OpenStreetMap می‌گیرد.',
    },
    'about.cta': { en: 'Add your narrative', fa: 'ثبت روایت' },

    /* -------------------------------- 404 ------------------------------- */
    '404.title': { en: 'Nothing at this address.', fa: 'در این نشانی چیزی نیست.' },
    '404.body': { en: 'The page you were looking for is not here. The map still is.', fa: 'صفحه‌ای که دنبالش بودید اینجا نیست. اما نقشه سر جایش است.' },
    '404.back': { en: 'Back to the map', fa: 'بازگشت به نقشه' },
  };

  /**
   * Province names are stored as the English spelling used by the boundary
   * data. These are the Persian equivalents, matching the wording the Telegram
   * bot already uses with contributors.
   */
  const PROVINCES = {
    'Alborz': 'البرز',
    'Ardabil': 'اردبیل',
    'Bushehr': 'بوشهر',
    'Chaharmahal and Bakhtiari': 'چهارمحال و بختیاری',
    'East Azerbaijan': 'آذربایجان شرقی',
    'Fars': 'فارس',
    'Gilan': 'گیلان',
    'Golestan': 'گلستان',
    'Hamadan': 'همدان',
    'Hormozgan': 'هرمزگان',
    'Ilam': 'ایلام',
    'Isfahan': 'اصفهان',
    'Kerman': 'کرمان',
    'Kermanshah': 'کرمانشاه',
    'Khuzestan': 'خوزستان',
    'Kohgiluyeh and Boyer-Ahmad': 'کهگیلویه و بویراحمد',
    'Kurdistan': 'کردستان',
    'Lorestan': 'لرستان',
    'Markazi': 'مرکزی',
    'Mazandaran': 'مازندران',
    'North Khorasan': 'خراسان شمالی',
    'Qazvin': 'قزوین',
    'Qom': 'قم',
    'Razavi Khorasan': 'خراسان رضوی',
    'Semnan': 'سمنان',
    'Sistan and Baluchestan': 'سیستان و بلوچستان',
    'South Khorasan': 'خراسان جنوبی',
    'Tehran': 'تهران',
    'West Azerbaijan': 'آذربایجان غربی',
    'Yazd': 'یزد',
    'Zanjan': 'زنجان',
  };

  /** Renders a stored province name in the current language. */
  function province(name) {
    if (!name) return '';
    return current === 'fa' ? (PROVINCES[name] || name) : name;
  }

  let current = 'en';

  function detect() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (LANGS.includes(saved)) return saved;
    } catch { /* storage blocked */ }
    const fromUrl = new URLSearchParams(location.search).get('lang');
    if (LANGS.includes(fromUrl)) return fromUrl;
    const nav = (navigator.language || 'en').toLowerCase();
    return nav.startsWith('fa') || nav.startsWith('pe') ? 'fa' : 'en';
  }

  /** Looks up a key and fills {placeholders} from params. */
  function t(key, params) {
    const entry = STRINGS[key];
    let text = entry ? (entry[current] || entry.en) : key;
    if (params) {
      for (const [name, value] of Object.entries(params)) {
        text = text.split(`{${name}}`).join(String(value));
      }
    }
    return text;
  }

  /** Picks the right half of a { en, fa } pair coming from the API. */
  function pick(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value[current] || value.en || '';
    }
    return value == null ? '' : String(value);
  }

  function lang() { return current; }
  function isRTL() { return current === 'fa'; }

  /** Rewrites every tagged element in the document. */
  function apply(root) {
    const scope = root || document;
    scope.querySelectorAll('[data-i18n]').forEach((node) => {
      node.textContent = t(node.dataset.i18n);
    });
    scope.querySelectorAll('[data-i18n-html]').forEach((node) => {
      node.innerHTML = t(node.dataset.i18nHtml);
    });
    scope.querySelectorAll('[data-i18n-placeholder]').forEach((node) => {
      node.placeholder = t(node.dataset.i18nPlaceholder);
    });
    scope.querySelectorAll('[data-i18n-label]').forEach((node) => {
      node.setAttribute('aria-label', t(node.dataset.i18nLabel));
    });
  }

  const listeners = new Set();

  /** Registers a callback for anything that has to re-render on a switch. */
  function onChange(fn) { listeners.add(fn); }

  function setLang(next, { rerender = true } = {}) {
    if (!LANGS.includes(next)) return;
    current = next;
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* storage blocked */ }

    document.documentElement.lang = next === 'fa' ? 'fa' : 'en';
    document.documentElement.dir = isRTL() ? 'rtl' : 'ltr';

    apply();
    if (rerender) listeners.forEach((fn) => fn(next));
  }

  function toggle() { setLang(current === 'en' ? 'fa' : 'en'); }

  /** Builds the header switch and applies the initial language. */
  function init() {
    current = detect();
    document.documentElement.lang = current === 'fa' ? 'fa' : 'en';
    document.documentElement.dir = isRTL() ? 'rtl' : 'ltr';

    const nav = document.querySelector('.site-nav');
    if (nav && !nav.querySelector('.lang-toggle')) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'lang-toggle';
      button.addEventListener('click', toggle);
      nav.appendChild(button);

      const paint = () => {
        button.innerHTML = '';
        const long = document.createElement('span');
        long.className = 'lang-toggle__long';
        long.textContent = t('lang.toggle');
        const short = document.createElement('span');
        short.className = 'lang-toggle__short';
        short.textContent = t('lang.toggleShort');
        button.append(long, short);
        button.setAttribute('aria-label', t('lang.toggleLabel'));
      };
      listeners.add(paint);
      paint();
    }
    apply();
  }

  global.I18N = { t, pick, province, lang, isRTL, setLang, toggle, apply, onChange, init, LANGS };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}(window));
