'use strict';

/**
 * The questionnaire. This is the single source of truth: the public form is
 * rendered from it, the API validates against it, and narrative pages render
 * answers in this order. Edit this file to change what contributors are asked.
 *
 * Changing a question's `id` orphans the answers already stored under the old
 * id, so prefer editing `label` and leaving `id` alone. Removing a question
 * hides its answers from the site but does not delete them from the database.
 *
 * type:     'text' | 'textarea' | 'select'
 * required: answers must be non-empty to submit
 * minLength/maxLength: enforced on the server, hinted in the browser
 */
const QUESTIONS = [
  {
    id: 'title',
    type: 'text',
    label: 'If this narrative had a title, what would it be?',
    help: 'This is what people see on the map pin and in the list of narratives.',
    placeholder: 'The last summer on our street',
    required: true,
    maxLength: 120,
  },
  {
    id: 'what_happened',
    type: 'textarea',
    label: 'What happened at this place? Tell it the way you would tell a friend.',
    help: 'Take as much room as you need. Long is fine — this is the heart of the narrative.',
    required: true,
    minLength: 120,
    maxLength: 8000,
    rows: 12,
  },
  {
    id: 'why_here',
    type: 'textarea',
    label: 'Why this exact spot, rather than the neighbourhood or the city around it?',
    help: 'What makes these particular coordinates the right ones for the story.',
    required: true,
    minLength: 40,
    maxLength: 2000,
    rows: 5,
  },
  {
    id: 'senses',
    type: 'textarea',
    label: 'What did it look, sound, or smell like? Give one detail nobody could have guessed.',
    required: false,
    maxLength: 1500,
    rows: 4,
  },
  {
    id: 'who_else',
    type: 'textarea',
    label: 'Who else is in this story, and how would they want to be named — or not named?',
    help: 'Please do not use anyone’s full name without their permission.',
    required: false,
    maxLength: 1500,
    rows: 4,
  },
  {
    id: 'what_changed',
    type: 'textarea',
    label: 'What did this change, for you or for the place itself?',
    required: false,
    maxLength: 2000,
    rows: 5,
  },
  {
    id: 'how_you_know',
    type: 'select',
    label: 'How do you know this story?',
    required: true,
    options: [
      'I lived it',
      'I was there, but it happened to someone else',
      'Someone in my family told me',
      'A friend or a neighbour told me',
      'I found it in documents, photographs, or archives',
      'Another way',
    ],
  },
  {
    id: 'before_reading',
    type: 'textarea',
    label: 'Is there anything a reader should know before they start?',
    help: 'Context, a content warning, a correction to something widely believed — anything.',
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
 * Returns { answers, errors } — `answers` holds only known, trimmed questions.
 */
function validateAnswers(raw) {
  const answers = {};
  const errors = [];
  const input = raw && typeof raw === 'object' ? raw : {};

  for (const q of QUESTIONS) {
    const value = typeof input[q.id] === 'string' ? input[q.id].trim() : '';

    if (!value) {
      if (q.required) errors.push({ field: q.id, message: 'This question needs an answer.' });
      continue;
    }
    if (q.type === 'select' && !q.options.includes(value)) {
      errors.push({ field: q.id, message: 'Choose one of the listed options.' });
      continue;
    }
    if (q.minLength && value.length < q.minLength) {
      errors.push({ field: q.id, message: `Please write at least ${q.minLength} characters.` });
      continue;
    }
    if (q.maxLength && value.length > q.maxLength) {
      errors.push({ field: q.id, message: `Please keep this under ${q.maxLength} characters.` });
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
