'use strict';

/**
 * The questionnaire. This is the single source of truth: the public form is
 * rendered from it, the API validates against it, the Telegram bot walks it,
 * and narrative pages render answers in this order.
 *
 * Every contributor-facing string is an { en, fa } pair. The Persian is the
 * original — this archive is written for Persian speakers first — and the
 * English is its translation.
 *
 * type:     'text' | 'textarea' | 'select' | 'multiselect'
 * required: must be answered to submit
 * minLength/maxLength: enforced on the server, hinted in the browser
 *
 * `select` and `multiselect` options carry a stable `value` that is what gets
 * stored, so an answer chosen in Persian still renders in English for an
 * English reader. Changing a `value` orphans answers already given under it.
 */
const QUESTIONS = [
  {
    id: 'narrative_kind',
    type: 'multiselect',
    label: {
      fa: 'روایتتان از چه جنس است؟',
      en: 'What kind of narrative is this?',
    },
    help: {
      fa: 'می‌توانید چند گزینه را انتخاب کنید.',
      en: 'You can choose more than one.',
    },
    required: true,
    options: [
      {
        value: 'chronicle',
        fa: 'واقعه‌نگاری',
        en: 'Chronicle',
        detail: {
          fa: 'مثلاً در خیابانی جایی، اتفاقی افتاده که می‌خواهید بازگو کنید.',
          en: 'Something happened, on a street or in some place, and you want to recount it.',
        },
      },
      {
        value: 'impression',
        fa: 'شرح حال',
        en: 'selfgraphy',
        detail: {
          fa: 'مثلاً کسی را در این وقایع از دست داده‌اید و می‌خواهید آنچه فقدانش با شما کرده را بازگو کنید، یا مثلاً چیزهایی دیده‌اید که رهایتان نمی‌کنند و مدام تداعی می‌شوند و می‌خواهید بازگویشان کنید.',
          en: 'You lost someone in these events and want to tell what that absence has done to you; or you saw things that will not let go of you, that keep returning, and you want to set them down.',
        },
      },
      {
        value: 'other',
        fa: 'جور دیگری.',
        en: 'Some other way.',
      },
    ],
  },
  {
    id: 'how_you_know',
    type: 'multiselect',
    label: {
      fa: 'از کجا مطلعید؟',
      en: 'How do you know this?',
    },
    help: {
      fa: 'می‌توانید چند گزینه را انتخاب کنید.',
      en: 'You can choose more than one.',
    },
    required: true,
    options: [
      { value: 'lived', fa: 'شخصاً از سر گذراندم.', en: 'I lived through it myself.' },
      { value: 'witnessed', fa: 'شخصاً آنجا بودم، اما بر کسِ دیگری گذشت.', en: 'I was there myself, but it happened to someone else.' },
      { value: 'family_friend', fa: 'خانواده یا دوستِ نزدیکی تعریف کرد.', en: 'Family or a close friend told me.' },
      { value: 'other', fa: 'جور دیگری.', en: 'Some other way.' },
    ],
  },
  {
    id: 'what_happened',
    type: 'textarea',
    label: {
      fa: 'چه گذشت؟ روایت کنید.',
      en: 'What happened? Tell it.',
    },
    help: {
      fa: 'تصور کنید برای دوستی تعریف می‌کنید، همان‌طور بنویسید. تا جای ممکن جزئیات اضافه کنید، در مورد رنگ و رفتار و فضاهای غیرمعمول، در مورد ترس و درد و نگرانی‌های لحظاتِ فشرده.',
      en: 'Imagine you are telling a friend, and write it that way. Add as much detail as you can — colours, the way people behaved, anything out of the ordinary; the fear, the pain, the worry of those compressed moments.',
    },
    required: true,
    minLength: 80,
    maxLength: 12000,
    rows: 14,
  },
  {
    id: 'what_it_left',
    type: 'textarea',
    label: {
      fa: 'چه اثری بر جا گذاشت؟',
      en: 'What did it leave behind?',
    },
    help: {
      fa: 'اگر آنچه روایت کردید اثر ماندگاری بر شما داشته و بعد از آن چیزی متحول شده، بنویسید.',
      en: 'If what you have described left a lasting mark on you, or something changed afterwards, write it here.',
    },
    required: false,
    maxLength: 4000,
    rows: 6,
  },
  {
    id: 'light_ahead',
    type: 'textarea',
    label: {
      fa: 'چه روشنی‌ای در افق می‌بینید؟',
      en: 'What light do you see on the horizon?',
    },
    help: {
      fa: 'چطور علی‌رغم تمام این دشواری‌ها، چراغ زندگی را روشن نگه می‌دارید.',
      en: 'How, in spite of all this difficulty, you keep the lamp of life burning.',
    },
    required: false,
    maxLength: 4000,
    rows: 6,
  },
  {
    id: 'narrative_title',
    type: 'text',
    label: {
      fa: 'نامِ روایت',
      en: 'The title of the narrative',
    },
    help: {
      fa: 'عنوانی برای روایتِ خود انتخاب کنید. این عنوان وقتی نشانگر (ماوس) روی آن می‌رود نشان داده خواهد شد.',
      en: 'Choose a title for your narrative. It is what a reader sees when the pointer rests on your pin.',
    },
    required: true,
    maxLength: 120,
  },
];

const QUESTIONS_BY_ID = new Map(QUESTIONS.map((q) => [q.id, q]));

/**
 * The order the contributor is asked things, on the form and in the bot.
 *
 * The place, the period and the contributor's details are structured fields
 * rather than questionnaire answers, but they are asked in amongst the
 * questions, so the sequence lives here and both surfaces follow it. This is
 * what makes the numbering on the form match the order in the bot.
 */
const FORM_SEQUENCE = [
  { kind: 'question', id: 'narrative_kind' },
  { kind: 'question', id: 'how_you_know' },
  { kind: 'place' },
  { kind: 'period' },
  { kind: 'question', id: 'what_happened' },
  { kind: 'question', id: 'what_it_left' },
  { kind: 'question', id: 'light_ahead' },
  { kind: 'pseudonym' },
  { kind: 'email' },
  { kind: 'question', id: 'narrative_title' },
];

/** The question a pin, a list card and the reading panel are labelled with. */
const TITLE_QUESTION_ID = 'narrative_title';

/** The question a list card is previewed with, under that title. */
const SUMMARY_QUESTION_ID = 'what_happened';

const SELECT_TYPES = new Set(['select', 'multiselect']);

/** Multi-select answers are arrays; a legacy single value still reads. */
function toArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value) return [value];
  return [];
}

function validateChoice(question, raw, errors) {
  const allowed = new Set(question.options.map((o) => o.value));

  if (question.type === 'select') {
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (!value) {
      if (question.required) {
        errors.push({ field: question.id, code: 'error.required', message: 'This question needs an answer.' });
      }
      return undefined;
    }
    if (!allowed.has(value)) {
      errors.push({ field: question.id, code: 'error.chooseOption', message: 'Choose one of the listed options.' });
      return undefined;
    }
    return value;
  }

  const chosen = toArray(raw).map((v) => String(v).trim()).filter(Boolean);
  const unique = [...new Set(chosen)];
  if (!unique.length) {
    if (question.required) {
      errors.push({ field: question.id, code: 'error.chooseAtLeastOne', message: 'Choose at least one option.' });
    }
    return undefined;
  }
  if (unique.some((v) => !allowed.has(v))) {
    errors.push({ field: question.id, code: 'error.chooseOption', message: 'Choose from the listed options.' });
    return undefined;
  }
  // Stored in the questionnaire's own order, not the order they were clicked.
  return question.options.map((o) => o.value).filter((v) => unique.includes(v));
}

/**
 * Validates a raw `{questionId: answer}` object against the questionnaire.
 * Errors carry a `code` (and any `params`) so the browser can translate them;
 * `message` is the English fallback for anything calling the API directly.
 */
function validateAnswers(raw) {
  const answers = {};
  const errors = [];
  const input = raw && typeof raw === 'object' ? raw : {};

  for (const q of QUESTIONS) {
    if (SELECT_TYPES.has(q.type)) {
      const value = validateChoice(q, input[q.id], errors);
      if (value !== undefined) answers[q.id] = value;
      continue;
    }

    const value = typeof input[q.id] === 'string' ? input[q.id].trim() : '';
    if (!value) {
      if (q.required) {
        errors.push({ field: q.id, code: 'error.required', message: 'This question needs an answer.' });
      }
      continue;
    }
    if (q.minLength && value.length < q.minLength) {
      errors.push({
        field: q.id,
        code: 'error.tooShort',
        params: { min: q.minLength },
        message: `Please write at least ${q.minLength} characters.`,
      });
      continue;
    }
    if (q.maxLength && value.length > q.maxLength) {
      errors.push({
        field: q.id,
        code: 'error.tooLong',
        params: { max: q.maxLength },
        message: `Please keep this under ${q.maxLength} characters.`,
      });
      continue;
    }
    answers[q.id] = value;
  }

  return { answers, errors };
}

module.exports = {
  QUESTIONS,
  QUESTIONS_BY_ID,
  FORM_SEQUENCE,
  TITLE_QUESTION_ID,
  SUMMARY_QUESTION_ID,
  SELECT_TYPES,
  toArray,
  validateAnswers,
};
