import { describe, expect, it } from 'vitest';
import {
  GITHUB_MAX_COMMITS,
  GITHUB_MAX_PAGES,
  GITHUB_PAGE_SIZE,
  createPaginationMetadata,
  getNextPageUrl,
  hasNextPage,
  parseLinkHeader,
} from '../../src/infrastructure/index.js';

describe('GitHub pagination', () => {
  it('parses quoted relation values and detects only rel=next', () => {
    const link = '<https://api.github.com/repos/o/r/commits?page=2>; rel="next", <https://api.github.com/repos/o/r/commits?page=5>; rel="last"';
    expect(parseLinkHeader(link)).toEqual([
      { url: 'https://api.github.com/repos/o/r/commits?page=2', rel: ['next'] },
      { url: 'https://api.github.com/repos/o/r/commits?page=5', rel: ['last'] },
    ]);
    expect(getNextPageUrl(link)).toContain('page=2');
    expect(hasNextPage(link)).toBe(true);
    expect(hasNextPage('<https://example.test>; rel="last"')).toBe(false);
  });

  it('accepts Headers-like and plain object headers safely', () => {
    expect(getNextPageUrl({ Link: '<https://example.test/2>; rel=next' })).toBe('https://example.test/2');
    expect(getNextPageUrl({ get: (name) => name === 'link' ? '<https://example.test/2>; rel="next"' : null })).toBe('https://example.test/2');
    expect(parseLinkHeader(null)).toEqual([]);
    expect(parseLinkHeader('not a link')).toEqual([]);
  });

  it('exposes the bounded retrieval policy and complete/truncated metadata', () => {
    expect([GITHUB_PAGE_SIZE, GITHUB_MAX_COMMITS, GITHUB_MAX_PAGES]).toEqual([100, 100, 1]);
    expect(createPaginationMetadata({ retrievedCount: 0 })).toMatchObject({
      requestedLimit: 100, fetchedCount: 0, pagesFetched: 1, hasNextPage: false,
      historyComplete: true, truncated: false, warnings: [],
    });
    expect(createPaginationMetadata({ retrievedCount: 100, nextPageUrl: 'next', warnings: ['partial'] })).toMatchObject({
      requestedLimit: 100, fetchedCount: 100, pagesFetched: 1, hasNextPage: true,
      historyComplete: false, truncated: true, warnings: ['partial'],
    });
  });
});
