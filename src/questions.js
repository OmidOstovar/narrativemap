'use strict';

/**
 * The questionnaire. This is the single source of truth: the public form is
 * rendered from it, the API validates against it, and narrative pages render
 * answers in this order. Edit this file to change what contributors are asked.
 *
 * Every piece of contributor-facing text is a { en, fa } pair. The client picks
 * the half matching the interface language.
 *
 * Changing a question's `id` orphans the answers already stored under the old
 * id, so prefer editing the labels and leaving `id` alone. Removing a question
 * hides its answers from the site but does not delete them from the database.
 *
 * type:     'text' | 'textarea' | 'select'
 * required: answers must be non-empty to submit
 * minLength/maxLength: enforced on the server, hinted in the browser
 *
 * `select` options carry a stable `value` that is what actually gets stored, so
 * an answer given in English still renders in Persian for a Persian reader.
 */
const QUESTIONS = [
  {
    id: 'title',
    type: 'text',
    label: {
      en: 'If this narrative had a title, what would it be?',
      fa: 'اگر این روایت عنوانی داشت، چه بود؟',
    },
    help: {
      en: 'This is what people see on the map pin and in the list of narratives.',
      fa: 'همین چیزی است که روی نشانگر نقشه و در فهرست روایت‌ها دیده می‌شود.',
    },
    placeholder: {
      en: 'The last summer on our street',
      fa: 'آخرین تابستان کوچهٔ ما',
    },
    required: true,
    maxLength: 120,
  },
  {
    id: 'what_happened',
    type: 'textarea',
    label: {
      en: 'What happened at this place? Tell it the way you would tell a friend.',
      fa: 'اینجا چه گذشت؟ همان‌طور بنویسید که برای یک دوست تعریف می‌کنید.',
    },
    help: {
      en: 'Take as much room as you need. Long is fine — this is the heart of the narrative.',
      fa: 'هرقدر لازم است بنویسید. طولانی بودنش اشکالی ندارد — این قلب روایت است.',
    },
    required: true,
    minLength: 120,
    maxLength: 8000,
    rows: 12,
  },
  {
    id: 'why_here',
    type: 'textarea',
    label: {
      en: 'Why this exact spot, rather than the neighbourhood or the city around it?',
      fa: 'چرا دقیقاً همین نقطه، نه محله یا شهرِ دورش؟',
    },
    help: {
      en: 'What makes these particular coordinates the right ones for the story.',
      fa: 'چه چیزی همین مختصات را برای این روایت درست می‌کند.',
    },
    required: true,
    minLength: 40,
    maxLength: 2000,
    rows: 5,
  },
  {
    id: 'senses',
    type: 'textarea',
    label: {
      en: 'What did it look, sound, or smell like? Give one detail nobody could have guessed.',
      fa: 'آنجا چه شکلی بود، چه صدایی داشت، چه بویی می‌داد؟ یک جزئیات بگویید که هیچ‌کس نمی‌توانست حدس بزند.',
    },
    required: false,
    maxLength: 1500,
    rows: 4,
  },
  {
    id: 'who_else',
    type: 'textarea',
    label: {
      en: 'Who else is in this story, and how would they want to be named — or not named?',
      fa: 'چه کسان دیگری در این روایت هستند، و دوست دارند چطور نامیده شوند — یا اصلاً نامیده نشوند؟',
    },
    help: {
      en: 'Please do not use anyone’s full name without their permission.',
      fa: 'لطفاً نام کامل کسی را بدون اجازه‌اش ننویسید.',
    },
    required: false,
    maxLength: 1500,
    rows: 4,
  },
  {
    id: 'what_changed',
    type: 'textarea',
    label: {
      en: 'What did this change, for you or for the place itself?',
      fa: 'این ماجرا چه چیزی را عوض کرد، برای شما یا برای خودِ آن مکان؟',
    },
    required: false,
    maxLength: 2000,
    rows: 5,
  },
  {
    id: 'how_you_know',
    type: 'select',
    label: {
      en: 'How do you know this story?',
      fa: 'این روایت را از کجا می‌دانید؟',
    },
    required: true,
    options: [
      { value: 'lived', en: 'I lived it', fa: 'خودم از سر گذراندمش' },
      { value: 'witnessed', en: 'I was there, but it happened to someone else', fa: 'آنجا بودم، اما برای کس دیگری اتفاق افتاد' },
      { value: 'family', en: 'Someone in my family told me', fa: 'یکی از خانواده برایم تعریف کرد' },
      { value: 'friend', en: 'A friend or a neighbour told me', fa: 'دوست یا همسایه‌ای برایم تعریف کرد' },
      { value: 'archive', en: 'I found it in documents, photographs, or archives', fa: 'در اسناد، عکس‌ها یا آرشیوها پیدایش کردم' },
      { value: 'other', en: 'Another way', fa: 'جور دیگری' },
    ],
  },
  {
    id: 'before_reading',
    type: 'textarea',
    label: {
      en: 'Is there anything a reader should know before they start?',
      fa: 'چیزی هست که خواننده پیش از شروع بهتر است بداند؟',
    },
    help: {
      en: 'Context, a content warning, a correction to something widely believed — anything.',
      fa: 'زمینه، هشدار دربارهٔ محتوا، تصحیح چیزی که همه اشتباه می‌دانند — هرچه باشد.',
    },
    required: false,
    maxLength: 1000,
    rows: 3,
  },
];

const QUESTIONS_BY_ID = new Map(QUESTIONS.map((q) => [q.id, q]));

/** The question whose answer is used as the narrative's display title. */
const TITLE_QUESTION_ID = 'title';

/** The question whose answer is used for list previews and search snippets. */
const SUMMARY_QUESTION_ID = 'what_happened';

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
    const value = typeof input[q.id] === 'string' ? input[q.id].trim() : '';

    if (!value) {
      if (q.required) {
        errors.push({ field: q.id, code: 'error.required', message: 'This question needs an answer.' });
      }
      continue;
    }
    if (q.type === 'select') {
      if (!q.options.some((option) => option.value === value)) {
        errors.push({ field: q.id, code: 'error.chooseOption', message: 'Choose one of the listed options.' });
        continue;
      }
      answers[q.id] = value;
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
  TITLE_QUESTION_ID,
  SUMMARY_QUESTION_ID,
  validateAnswers,
};
