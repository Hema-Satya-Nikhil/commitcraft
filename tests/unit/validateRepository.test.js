import { describe, expect, it } from 'vitest';
import { validateRepository } from '../../src/domain/index.js';

describe('repository validation', () => {
  it.each([
    'octocat/Hello-World', ' octocat/Hello-World ',
    'https://github.com/octocat/Hello-World', 'https://github.com/octocat/Hello-World.git/',
    'http://github.com/octocat/Hello-World/', 'https://www.github.com/octocat/Hello-World',
  ])('parses %s without accessing GitHub', (input) => {
    expect(validateRepository(input)).toEqual({
      valid: true, error: null,
      repository: { owner: 'octocat', name: 'Hello-World', fullName: 'octocat/Hello-World', url: 'https://github.com/octocat/Hello-World' },
    });
  });

  it.each([
    null, undefined, 42, {}, [], '', ' ', 'owner', 'owner/', '/repo', 'a/b/c',
    'owner/repo/issues', 'https://gitlab.com/a/b', 'https://github.com.evil.test/a/b',
    'https://evil.test/github.com/a/b', 'https://user:password@github.com/a/b',
    'https://github.com:443/a/b', 'https://github.com/a/b?x=1', 'https://github.com/a/b#readme',
    'git@github.com:a/b.git', 'ssh://github.com/a/b', 'javascript:alert(1)',
    'https://github.com/a%2Fb/c', '-owner/repo', 'owner-/repo', 'a--b/repo', 'a/..', 'a/.',
    'a/repo name', 'a/repo\nname', 'a\n/repo', 'https://github.com/a\n/repo', `${'a'.repeat(40)}/repo`, `a/${'r'.repeat(101)}`,
  ])('rejects unsupported or malformed input: %s', (input) => {
    expect(validateRepository(input)).toMatchObject({ valid: false, repository: null, error: expect.any(String) });
  });
});
