import { describe, expect, it, vi } from 'vitest';
import { generateReleaseNotes } from '../../src/domain/index.js';
import { createGithubClient } from '../../src/infrastructure/index.js';

const repository = { name: 'repo', full_name: 'octo/repo', owner: { login: 'octo' }, html_url: 'https://github.com/octo/repo' };
const githubCommit = (sha, message) => ({ sha, commit: { message, committer: { date: '2026-01-01T00:00:00Z' }, author: { name: 'Author', date: '2026-01-01T00:00:00Z' } }, html_url: `https://github.com/octo/repo/commit/${sha}`, parents: [{ sha: 'b'.repeat(40) }] });
const response = (body, headers = {}) => ({ ok: true, status: 200, headers, json: async () => body });

describe('GitHub infrastructure to domain integration', () => {
  it('passes normalized commits and retrieval metadata into the existing deterministic domain engine', async () => {
    const duplicate = githubCommit('a'.repeat(40), 'feat: identical subject');
    const different = githubCommit('b'.repeat(40), 'feat: identical subject');
    const fetch = vi.fn()
      .mockResolvedValueOnce(response(repository))
      .mockResolvedValueOnce(response([duplicate, duplicate, different], { Link: '<https://api.github.com/repos/octo/repo/commits?page=2>; rel="next"' }));
    const retrieved = await createGithubClient({ fetch }).fetchRepository('octo/repo');
    const notes = generateReleaseNotes(retrieved.commits, { metadata: retrieved.metadata });
    expect(notes.stats.duplicateCount).toBe(1);
    expect(notes.stats.includedCount).toBe(2);
    expect(notes.sections.find(({ id }) => id === 'features').commits).toHaveLength(2);
    expect(notes.markdown.match(/identical subject/g)).toHaveLength(2);
    expect(notes.metadata).toMatchObject({ requestedLimit: 100, fetchedCount: 3, hasNextPage: true, historyComplete: false, truncated: true });
    expect(notes.warnings).toContain('GitHub reported another commit page; retrieval stopped after the configured one-page limit.');
  });
});
