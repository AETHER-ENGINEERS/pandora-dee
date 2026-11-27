// Telling a model that's gone away from a model that just had a bad moment, and recognising provider error text
// anywhere it might be about to leave the host.
//
// Why the second matters: during an outage, the browser Atelier posts the provider's error into the chat it was
// answering. A usage-limit error reads like "you (<account name>) have reached your session usage limit, upgrade for
// higher limits: <link> or add usage credits: <link> (ref: <id>)": it names the person's account to anyone in that
// channel. Provider and model error text must never go to a channel or a DM.

'use strict';

const LIMIT = /usage limit|rate[- ]?limit|quota|reached your [a-z ]*limit|upgrade for higher limits|add (?:usage )?credits|insufficient (?:credits|quota|balance|funds)|out of credits|billing|too many requests|\b429\b/i;
const AUTH = /\b40[13]\b|unauthori[sz]ed|forbidden|invalid (?:api )?key|incorrect api key|authentication|not authenticated|api key (?:is )?(?:missing|invalid|expired)|permission denied/i;
const UNREACHABLE = /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EHOSTUNREACH|ECONNRESET|could not reach|couldn't reach|fetch failed|failed to fetch|network ?error|socket hang up|\b50[234]\b|service unavailable|bad gateway|gateway time-?out|timed out/i;

/** → 'usage-limit' | 'auth' | 'unreachable' | null (null: not a sign the model is gone) */
function classifyModelError(e) {
  const t = String(e && (e.message || e) || '');
  if (LIMIT.test(t)) return 'usage-limit';
  if (AUTH.test(t)) return 'auth';
  if (UNREACHABLE.test(t)) return 'unreachable';
  return null;
}

// phrases only a provider's error says; and things that turn a general phrase into one
const STRONG = /reached your (?:session |weekly |daily |monthly )?usage limit|upgrade for higher limits|add usage credits|you \([^)]{1,80}\) have reached|insufficient_quota|rate_limit_exceeded|invalid_api_key|model_not_found|context_length_exceeded|overloaded_error|"type"\s*:\s*"error"|\(ref: [^)]+\)/i;
const PROVIDER_URL = /https?:\/\/(?:www\.)?(?:ollama\.com\/(?:upgrade|settings|pricing)|platform\.openai\.com|console\.anthropic\.com|openrouter\.ai\/(?:settings|credits)|console\.groq\.com|aistudio\.google\.com|console\.mistral\.ai|platform\.deepseek\.com|together\.ai\/settings)/i;
const ERROR_SHAPE = /^\s*(?:⚠|error\b|\[error\]|\w*error:)/i;
const HTTP_STATUS = /\bHTTP\s?\d{3}\b|\b(?:status|code)[: ]+\d{3}\b/i;

/** True when outgoing text looks like a provider's or a model's error, which must never reach a channel or a DM. */
function looksLikeProviderError(text) {
  const t = String(text || '');
  if (!t.trim()) return false;
  if (STRONG.test(t) || PROVIDER_URL.test(t)) return true;
  const general = LIMIT.test(t) || AUTH.test(t) || UNREACHABLE.test(t);
  // the Atelier's own failed-turn reply ("⚠ <error>") and plain error lines carrying a status or a general sign
  if (ERROR_SHAPE.test(t) && (general || HTTP_STATUS.test(t))) return true;
  if (general && HTTP_STATUS.test(t)) return true;
  return false;
}

module.exports = { classifyModelError, looksLikeProviderError };
