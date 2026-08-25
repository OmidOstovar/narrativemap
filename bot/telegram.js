'use strict';

/**
 * A small Telegram Bot API client over long polling.
 *
 * The Bot API is plain HTTPS with JSON bodies, so this needs no dependency:
 * getUpdates blocks server-side for `timeout` seconds and returns as soon as
 * anything arrives, which is both cheaper and more responsive than polling in
 * a loop of our own.
 */

const API_ROOT = 'https://api.telegram.org';

class TelegramError extends Error {
  constructor(method, description, code) {
    super(`Telegram ${method} failed: ${description}`);
    this.name = 'TelegramError';
    this.method = method;
    this.code = code;
  }
}

function createClient(token, { fetchImpl = fetch } = {}) {
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not set.');

  async function call(method, payload, { timeoutMs = 15000 } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${API_ROOT}/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload || {}),
        signal: controller.signal,
      });
      // A blocked proxy or a gateway error page answers with HTML, not JSON, so
      // parse defensively rather than surfacing a JSON syntax error.
      const text = await response.text();
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        throw new TelegramError(
          method,
          `unexpected reply (HTTP ${response.status}): ${text.slice(0, 120)}`,
          response.status,
        );
      }
      if (!body.ok) throw new TelegramError(method, body.description, body.error_code);
      return body.result;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    call,

    getMe: () => call('getMe'),

    /** Long poll. Resolves with an empty array when nothing arrived in time. */
    getUpdates: (offset, seconds) => call(
      'getUpdates',
      { offset, timeout: seconds, allowed_updates: ['message', 'callback_query'] },
      { timeoutMs: (seconds + 10) * 1000 },
    ),

    sendMessage: (chatId, text, extra) => call('sendMessage', Object.assign({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    }, extra)),

    editMessageText: (chatId, messageId, text, extra) => call('editMessageText', Object.assign({
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: 'HTML',
    }, extra)),

    answerCallbackQuery: (id, text) => call('answerCallbackQuery', {
      callback_query_id: id,
      text: text || undefined,
    }),

    deleteMessage: (chatId, messageId) => call('deleteMessage', {
      chat_id: chatId, message_id: messageId,
    }).catch(() => null),
  };
}

/** Escapes text for Telegram's HTML parse mode. */
function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Lays buttons out `perRow` to a row for an inline keyboard. */
function inlineKeyboard(buttons, perRow = 2) {
  const rows = [];
  for (let i = 0; i < buttons.length; i += perRow) {
    rows.push(buttons.slice(i, i + perRow));
  }
  return { inline_keyboard: rows };
}

module.exports = { createClient, escapeHtml, inlineKeyboard, TelegramError };
