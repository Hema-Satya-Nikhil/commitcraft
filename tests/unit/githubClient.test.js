import { describe, expect, it, vi } from 'vitest';
import { GITHUB_ERROR_CATEGORIES, createGithubClient } from '../../src/infrastructure/index.js';

const repositoryResponse = {
  id: 1, name: 'repo', full_name: 'octo/repo', owner: { login: 'octo' },
  html_url: 'https://github.com/octo/repo', url: 'https://api.github.com/repos/octo/repo',
  description: 'A public repository', default_branch: 'main', private: false,
};

function commit(sha = 'a'.repeat(40), message = 'feat: add export', date = '2026-01-02T00:00:00Z') {
  return {
    sha,
    commit: { message, author: { name: 'Ada', email: 'ada@example.test', date }, committer: { date } },
    author: { login: 'ada', id: 2 },
    html_url: `https://github.com/octo/repo/commit/${sha}`,
    parents: [{ sha: 'b'.repeat(40) }],
  };
}

function response(body, { status = 200, headers = {} } = {}) {
  return { ok: status >= 200 && status < 300, status, headers, json: async () => body };
}

function queuedFetch(...responses) {
  const fetch = vi.fn();
  for (const item of responses) fetch.mockResolvedValueOnce(item);
  return fetch;
}

describe('GitHub client', () => {
  it('retrieves and normalizes repository metadata and one commit page', async () => {
    const fetch = queuedFetch(response(repositoryResponse), response([commit()], { headers: { 'x-ratelimit-limit': '60', 'x-ratelimit-remaining': '59', 'x-ratelimit-reset': '1700000000' } }));
    const result = await createGithubClient({ fetch, baseUrl: 'https://api.github.test' }).fetchRepository({ valid: true, repository: { owner: 'octo', name: 'repo' } });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0][0]).toBe('https://api.github.test/repos/octo/repo');
    expect(fetch.mock.calls[1][0]).toBe('https://api.github.test/repos/octo/repo/commits?per_page=100&page=1');
    expect(fetch.mock.calls[1][1].headers).toMatchObject({ Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' });
    expect(result.repository).toMatchObject({ owner: 'octo', name: 'repo', fullName: 'octo/repo', url: 'https://github.com/octo/repo', defaultBranch: 'main' });
    expect(result.commits[0]).toMatchObject({ sha: 'a'.repeat(40), message: 'feat: add export', subject: 'feat: add export', date: '2026-01-02T00:00:00.000Z', author: { login: 'ada' }, commitAuthor: { name: 'Ada', email: 'ada@example.test' }, url: expect.stringContaining('/commit/'), commitUrl: expect.stringContaining('/commit/') });
    expect(result.metadata).toMatchObject({ requestedLimit: 100, fetchedCount: 1, pagesFetched: 1, hasNextPage: false, historyComplete: true, truncated: false, warnings: [], rateLimit: { remaining: 59 } });
  });

  it('handles empty repositories as complete histories', async () => {
    const fetch = queuedFetch(response(repositoryResponse), response([]));
    const result = await createGithubClient({ fetch }).fetchGithubRepository('octo/repo');
    expect(result.commits).toEqual([]);
    expect(result.metadata).toMatchObject({ fetchedCount: 0, historyComplete: true, hasNextPage: false, truncated: false, warnings: [] });
  });

  it('stops at one page and marks a next page as truncated without unbounded requests', async () => {
    const commits = Array.from({ length: 100 }, (_, index) => commit(index.toString(16).padStart(40, '0'), `fix: repair ${index}`));
    const fetch = queuedFetch(response(repositoryResponse), response(commits, { headers: { Link: '<https://api.github.com/repos/octo/repo/commits?page=2>; rel="next"' } }));
    const result = await createGithubClient({ fetch }).fetchRepository('octo/repo');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.commits).toHaveLength(100);
    expect(result.metadata).toMatchObject({ requestedLimit: 100, fetchedCount: 100, pagesFetched: 1, hasNextPage: true, historyComplete: false, truncated: true });
    expect(result.metadata.warnings[0]).toContain('truncated after 100 commits');
  });

  it('rejects malformed repository and commit responses safely', async () => {
    const invalidRepositoryFetch = queuedFetch(response({ name: 'repo' }));
    await expect(createGithubClient({ fetch: invalidRepositoryFetch }).fetchRepository('octo/repo')).rejects.toMatchObject({ category: 'malformed-response', retrieval: { historyComplete: false } });
    const invalidCommitFetch = queuedFetch(response(repositoryResponse), response([{ sha: 'bad', commit: { message: 'fix: bad' } }]));
    await expect(createGithubClient({ fetch: invalidCommitFetch }).fetchRepository('octo/repo')).rejects.toMatchObject({ category: 'malformed-response', retrieval: { historyComplete: false } });
    expect(invalidCommitFetch).toHaveBeenCalledTimes(2);
    const malformedJsonFetch = queuedFetch({ ok: true, status: 200, headers: {}, json: async () => { throw new SyntaxError('invalid json'); } });
    await expect(createGithubClient({ fetch: malformedJsonFetch }).fetchRepository('octo/repo')).rejects.toMatchObject({ category: 'malformed-response', retrieval: { historyComplete: false } });
  });

  it.each([
    [404, 'not-found', 'could not be found or is inaccessible'],
    [401, 'unauthorized', 'authentication failed'],
    [403, 'forbidden', 'denied access'],
    [429, 'too-many-requests', 'temporarily rejected'],
    [500, 'server', 'temporarily unavailable'],
  ])('normalizes HTTP %s failures', async (status, category, phrase) => {
    const fetch = queuedFetch(response({ message: 'private internal details should not leak' }, { status }));
    await expect(createGithubClient({ fetch }).fetchRepository('octo/repo')).rejects.toSatisfy((error) => {
      expect(error.category).toBe(category);
      expect(error.status).toBe(status);
      expect(error.message).toContain(phrase);
      expect(error.message).not.toContain('private internal');
      expect(error.details).not.toHaveProperty('message');
      return true;
    });
  });

  it('distinguishes exhausted rate limits and preserves safe rate-limit metadata', async () => {
    const fetch = queuedFetch(response({ message: 'API rate limit exceeded; secret token omitted' }, { status: 403, headers: { 'x-ratelimit-limit': '60', 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1700000000' } }));
    await expect(createGithubClient({ fetch }).fetchRepository('octo/repo')).rejects.toSatisfy((error) => {
      expect(error.category).toBe(GITHUB_ERROR_CATEGORIES.RATE_LIMIT);
      expect(error.rateLimit).toMatchObject({ limit: 60, remaining: 0, resetAt: '2023-11-14T22:13:20.000Z' });
      expect(error.message).not.toContain('secret token');
      return true;
    });
  });

  it('normalizes failures from the commit request, not just repository lookup', async () => {
    const fetch = queuedFetch(response(repositoryResponse), response({ message: 'not visible' }, { status: 404 }));
    await expect(createGithubClient({ fetch }).fetchRepository('octo/repo')).rejects.toMatchObject({ category: 'not-found', status: 404, retrieval: { historyComplete: false } });
  });

  it('normalizes network failures and never reports failed retrieval as complete', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('socket details'));
    await expect(createGithubClient({ fetch }).fetchRepository('octo/repo')).rejects.toSatisfy((error) => {
      expect(error.category).toBe('network');
      expect(error.retrieval).toMatchObject({ historyComplete: false, truncated: false });
      expect(error.message).not.toContain('socket details');
      return true;
    });
  });

  it('classifies timeout and intentional AbortSignal cancellation separately', async () => {
    const hangingFetch = vi.fn((url, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })) )));
    const timeoutPromise = createGithubClient({ fetch: hangingFetch, timeoutMs: 5 }).fetchRepository('octo/repo');
    const timeoutAssertion = expect(timeoutPromise).rejects.toMatchObject({ category: 'timeout', retrieval: { historyComplete: false } });
    await new Promise((resolve) => setTimeout(resolve, 15));
    await timeoutAssertion;

    const controller = new AbortController();
    const cancellationPromise = createGithubClient({ fetch: hangingFetch, timeoutMs: 1000 }).fetchRepository('octo/repo', { signal: controller.signal });
    const cancellationAssertion = expect(cancellationPromise).rejects.toMatchObject({ category: 'cancellation', retrieval: { historyComplete: false } });
    controller.abort();
    await cancellationAssertion;
  });

  it('rejects invalid repositories before making a request', async () => {
    const fetch = vi.fn();
    await expect(createGithubClient({ fetch }).fetchRepository('https://gitlab.com/octo/repo')).rejects.toMatchObject({ category: 'invalid-repository', status: null });
    expect(fetch).not.toHaveBeenCalled();
  });
});
