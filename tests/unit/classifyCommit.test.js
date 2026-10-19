import { describe, expect, it } from 'vitest';
import { classifyCommit, RELEASE_SECTIONS } from '../../src/domain/index.js';

describe('commit classification', () => {
  it.each([
    ['feat: add export', 'features', false, 'add export'],
    ['fix: repair validation', 'fixes', false, 'repair validation'],
    ['feat!: change API', 'breaking', true, 'change API'],
    ['fix(core)!: rename option', 'breaking', true, 'rename option'],
    ['feat: export\n\nBREAKING CHANGE: removed legacy API', 'breaking', true, 'export'],
    ['fix: export\r\n\r\nBREAKING-CHANGE: removed API', 'breaking', true, 'export'],
    ['perf: reduce allocations', 'performance', false, 'reduce allocations'],
    ['docs: explain usage', 'documentation', false, 'explain usage'],
    ['refactor: simplify parsing', 'refactoring', false, 'simplify parsing'],
    ['chore: maintenance', 'maintenance', false, 'maintenance'],
    ['build: update bundler', 'maintenance', false, 'update bundler'],
    ['ci: update pipeline', 'maintenance', false, 'update pipeline'],
    ['test: cover validation', 'maintenance', false, 'cover validation'],
    ['unknown: something new', 'other', false, 'something new'],
    ['constructor: safe lookup', 'other', false, 'safe lookup'],
    ['plain message', 'other', false, 'plain message'],
    ['fix missing colon', 'other', false, 'fix missing colon'],
    ['fix: explain BREAKING CHANGE: in subject', 'fixes', false, 'explain BREAKING CHANGE: in subject'],
    ['FIX: repair', 'fixes', false, 'repair'],
  ])('classifies %s', (message, section, breaking, description) => {
    expect(classifyCommit(message)).toMatchObject({ section, breaking, description, excluded: false });
  });

  it('preserves scopes', () => {
    expect(classifyCommit({ message: 'feat(cli): add output' })).toMatchObject({ type: 'feat', scope: 'cli', description: 'add output' });
  });

  it.each(['Merge pull request #4 from a/b', "Merge branch 'main'", "Merge remote-tracking branch 'origin/main'", "Merge tag 'v1'", 'Merge pull request #1\n\nBREAKING CHANGE: x'])('filters recognized merge subjects (%s)', (message) => {
    expect(classifyCommit(message)).toMatchObject({ excluded: true, section: null });
  });

  it('filters parent-identified merges, but retains squash and merge-like feature messages', () => {
    expect(classifyCommit({ message: 'feat: new API', parents: [{}, {}] }).excluded).toBe(true);
    expect(classifyCommit({ message: 'fix: x', isMerge: true }).excluded).toBe(true);
    expect(classifyCommit('feat: add export (#42)').excluded).toBe(false);
    expect(classifyCommit('Merge sort optimization').excluded).toBe(false);
  });

  it.each([undefined, null, 42, {}, [], '', '   ', { message: 42 }])('handles malformed messages (%j)', (input) => {
    expect(classifyCommit(input)).toBeNull();
  });

  it('exports immutable, stable section order', () => {
    expect(RELEASE_SECTIONS).toEqual([
      { id: 'breaking', title: 'Breaking Changes' },
      { id: 'features', title: 'Features' },
      { id: 'fixes', title: 'Bug Fixes' },
      { id: 'performance', title: 'Performance' },
      { id: 'documentation', title: 'Documentation' },
      { id: 'refactoring', title: 'Refactoring' },
      { id: 'maintenance', title: 'Maintenance' },
      { id: 'other', title: 'Other Changes' },
    ]);
    expect(Object.isFrozen(RELEASE_SECTIONS)).toBe(true);
    expect(RELEASE_SECTIONS.every(Object.isFrozen)).toBe(true);
  });
});
