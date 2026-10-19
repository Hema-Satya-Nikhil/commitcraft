import { describe, expect, it } from 'vitest';
import { GITHUB_ERROR_CATEGORIES, GithubError, isRateLimited, parseRateLimit, parseRetryAfter } from '../../src/infrastructure/index.js';

describe('GitHub error utilities', () => {
  it('parses safe rate-limit metadata and an actionable reset instant', () => {
    expect(parseRateLimit({ 'X-RateLimit-Limit': '60', 'x-ratelimit-remaining': '0', 'X-RateLimit-Reset': '1700000000' })).toEqual({
      limit: 60, remaining: 0, reset: 1700000000, resetAt: '2023-11-14T22:13:20.000Z',
    });
    expect(isRateLimited(403, { 'x-ratelimit-remaining': '0' })).toBe(true);
    expect(isRateLimited(403, {}, 'API rate limit exceeded')).toBe(true);
    expect(parseRateLimit({ 'x-ratelimit-reset': 'not-a-time' })).toBeNull();
    expect(parseRateLimit({ 'x-ratelimit-reset': '999999999999999999999' })).toBeNull();
  });

  it('parses Retry-After seconds and absolute dates without trusting malformed values', () => {
    expect(parseRetryAfter({ 'retry-after': '12' }, 0)).toBe(12);
    expect(parseRetryAfter({ 'retry-after': 'Thu, 01 Jan 1970 00:00:10 GMT' }, 0)).toBe(10);
    expect(parseRetryAfter({ 'retry-after': 'unsafe' }, 0)).toBeNull();
  });

  it('exposes stable safe error fields without requiring raw response bodies', () => {
    const error = new GithubError('safe', { category: GITHUB_ERROR_CATEGORIES.NOT_FOUND, status: 404, details: { documentationUrl: null }, retrieval: { historyComplete: false } });
    expect(error).toBeInstanceOf(Error);
    expect(error.category).toBe('not-found');
    expect(error.toJSON()).toMatchObject({ category: 'not-found', status: 404, retrieval: { historyComplete: false } });
    expect(error.toJSON()).not.toHaveProperty('cause');
  });
});
