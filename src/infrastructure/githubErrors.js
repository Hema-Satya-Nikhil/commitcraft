/** Stable categories emitted by the GitHub transport boundary. */
export const GITHUB_ERROR_CATEGORIES = Object.freeze({
  INVALID_REPOSITORY: 'invalid-repository',
  NOT_FOUND: 'not-found',
  UNAUTHORIZED: 'unauthorized',
  FORBIDDEN: 'forbidden',
  RATE_LIMIT: 'rate-limit',
  TOO_MANY_REQUESTS: 'too-many-requests',
  SERVER: 'server',
  NETWORK: 'network',
  TIMEOUT: 'timeout',
  MALFORMED_RESPONSE: 'malformed-response',
  CANCELLATION: 'cancellation',
});

/** An error from the GitHub infrastructure boundary. */
export class GithubError extends Error {
  constructor(message, { category, status = null, details = null, rateLimit = null, retryAfter = null, retrieval = null, cause } = {}) {
    super(message);
    this.name = 'GithubError';
    this.category = category;
    this.code = category;
    this.type = category;
    this.status = Number.isInteger(status) ? status : null;
    this.details = details;
    this.rateLimit = rateLimit;
    this.retryAfter = retryAfter;
    this.retrieval = retrieval;
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      category: this.category,
      code: this.code,
      status: this.status,
      details: this.details,
      rateLimit: this.rateLimit,
      retryAfter: this.retryAfter,
      retrieval: this.retrieval,
    };
  }
}

function headerValue(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === 'function') {
    try {
      const value = headers.get(name);
      return value === null || value === undefined ? null : String(value);
    } catch {
      return null;
    }
  }
  if (typeof headers !== 'object') return null;
  const wanted = name.toLowerCase();
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === wanted);
  const value = key === undefined ? null : headers[key];
  return value === null || value === undefined ? null : String(value);
}

function safeInteger(value, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) return null;
  const number = Number(text);
  return Number.isSafeInteger(number) && number >= minimum && number <= maximum ? number : null;
}

/** Read GitHub's rate-limit headers without trusting malformed or unsafe values. */
export function parseRateLimit(headers) {
  const limit = safeInteger(headerValue(headers, 'x-ratelimit-limit'));
  const remaining = safeInteger(headerValue(headers, 'x-ratelimit-remaining'));
  const reset = safeInteger(headerValue(headers, 'x-ratelimit-reset'), { maximum: 8_640_000_000_000 });
  if (limit === null && remaining === null && reset === null) return null;
  return {
    limit,
    remaining,
    reset,
    resetAt: reset === null ? null : new Date(reset * 1000).toISOString(),
  };
}

/** Parse Retry-After as seconds or an absolute HTTP date, returning null when unsafe. */
export function parseRetryAfter(headers, now = Date.now()) {
  const value = headerValue(headers, 'retry-after');
  if (value === null) return null;
  const seconds = safeInteger(value);
  if (seconds !== null) return seconds;
  const date = Date.parse(value);
  if (!Number.isFinite(date) || !Number.isFinite(now)) return null;
  return Math.max(0, Math.ceil((date - now) / 1000));
}

export function isRateLimited(status, headers, message = '') {
  if (status === 429) return true;
  if (status !== 403) return false;
  const rateLimit = parseRateLimit(headers);
  return rateLimit?.remaining === 0 || /rate limit|abuse detection|secondary rate/i.test(message);
}

export { headerValue };

// Both spellings are kept as named aliases because GitHub's brand casing varies
// in consuming code, while the runtime error shape remains the same.
export const GitHubError = GithubError;
export const ERROR_CATEGORIES = GITHUB_ERROR_CATEGORIES;
