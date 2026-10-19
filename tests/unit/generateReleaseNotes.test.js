import { describe, expect, it, vi } from 'vitest';
import { generateReleaseNotes } from '../../src/domain/index.js';

const commit = (sha, message, date = '2026-01-01T00:00:00Z') => ({ sha, message, date });
const included = (result) => result.sections.flatMap((section) => section.commits);

describe('release-note generation', () => {
  it('produces readable Markdown in stable section order', () => {
    const result = generateReleaseNotes([
      commit('aaaaaaa', 'chore: clean up'), commit('bbbbbbb', 'docs: explain usage'),
      commit('ccccccc', 'perf: speed up'), commit('ddddddd', 'fix: repair validation'),
      commit('eeeeeee', 'feat(cli): add export'), commit('fffffff', 'feat!: change API'),
      commit('1111111', 'unknown: miscellaneous change'), commit('2222222', 'refactor: simplify parsing'),
    ]);
    expect(result.markdown).toBe('# Release Notes\n\n## Breaking Changes\n\n- change API (fffffff)\n\n## Features\n\n- **cli:** add export (eeeeeee)\n\n## Bug Fixes\n\n- repair validation (ddddddd)\n\n## Performance\n\n- speed up (ccccccc)\n\n## Documentation\n\n- explain usage (bbbbbbb)\n\n## Refactoring\n\n- simplify parsing (2222222)\n\n## Maintenance\n\n- clean up (aaaaaaa)\n\n## Other Changes\n\n- miscellaneous change (1111111)\n');
  });

  it('deduplicates only SHAs, case-insensitively; the first valid record wins', () => {
    const result = generateReleaseNotes([
      { sha: 'aaaaaaa', message: null }, commit('aaaaaaa', 'feat: add export'),
      commit('AAAAAAA', 'fix: duplicate'), commit('bbbbbbb', 'feat: add export'),
    ]);
    expect(result.stats).toEqual({ inputCount: 4, includedCount: 2, invalidCount: 1, duplicateCount: 1, filteredCount: 0 });
    expect(included(result).map(({ sha }) => sha)).toEqual(['aaaaaaa', 'bbbbbbb']);
    expect(result.markdown.match(/add export/g)).toHaveLength(2);
  });

  it('sorts newest first with SHA ascending ties, invalid dates last', () => {
    const result = generateReleaseNotes([
      commit('ddddddd', 'fix: undated', null), commit('ccccccc', 'fix: same time'),
      commit('eeeeeee', 'fix: new', '2026-02-01T00:00:00Z'), commit('bbbbbbb', 'fix: same time'),
      commit('aaaaaaa', 'fix: undated', 'bad'),
    ]);
    expect(included(result).map(({ sha }) => sha)).toEqual(['eeeeeee', 'bbbbbbb', 'ccccccc', 'aaaaaaa', 'ddddddd']);
  });

  it('filters merges while retaining squash commits', () => {
    const result = generateReleaseNotes([
      commit('aaaaaaa', 'Merge pull request #1 from owner/branch'),
      { ...commit('bbbbbbb', 'feat: merged'), parents: [{}, {}] },
      commit('ccccccc', 'feat: squashed (#1)'),
    ]);
    expect(result.stats.filteredCount).toBe(2);
    expect(included(result).map(({ sha }) => sha)).toEqual(['ccccccc']);
  });

  it.each([undefined, null, {}, false, 1, 'bad', []])('handles empty/non-array input (%j)', (input) => {
    const result = generateReleaseNotes(input);
    expect(result.markdown).toBe('# Release Notes\n\nNo release-note entries.\n');
    expect(result.stats.includedCount).toBe(0);
  });

  it('skips malformed records and reports them without throwing', () => {
    const result = generateReleaseNotes([null, {}, { sha: 'aaaaaaa', message: 5 }, commit('bbbbbbb', 'fix: valid')], null);
    expect(result.stats.invalidCount).toBe(3);
    expect(result.warnings).toContain('Skipped 3 malformed commit record(s).');
    expect(result.markdown).toContain('## Warnings');
  });

  it('preserves retrieval metadata and supplied warnings even with no commits', () => {
    const metadata = Object.freeze({ truncated: true, retrievedCount: 100, pagesFetched: 2, hasNextPage: true, reason: 'caller cap', warnings: Object.freeze(['Caller warning']), arbitrary: Object.freeze({ limit: 100 }) });
    const options = Object.freeze({ metadata, warnings: Object.freeze(['Partial retrieval', null, 42, ' ']) });
    const result = generateReleaseNotes([], options);
    expect(result.metadata).toEqual(metadata);
    expect(result.warnings).toEqual(['Partial retrieval', 'Caller warning', 'Commit history was truncated; these release notes may be incomplete.']);
    expect(result.markdown).toContain('## Retrieval Metadata');
    for (const text of ['retrievedCount', '100', 'pagesFetched', 'hasNextPage', 'reason', 'caller cap', 'arbitrary', 'limit', 'Partial retrieval', 'Caller warning', 'may be incomplete']) expect(result.markdown).toContain(text);
  });

  it('does not infer incomplete retrieval merely from pagination metadata', () => {
    expect(generateReleaseNotes([], { metadata: { hasNextPage: true, truncated: false } }).warnings).toEqual([]);
  });

  it('is repeatable, does not mutate inputs, and sorts independently of input ordering', () => {
    const records = Object.freeze([Object.freeze(commit('bbbbbbb', 'fix: second')), Object.freeze(commit('aaaaaaa', 'fix: first'))]);
    const first = generateReleaseNotes(records);
    expect(generateReleaseNotes(records)).toEqual(first);
    expect(generateReleaseNotes([...records].reverse()).markdown).toBe(first.markdown);
    expect(records.map(({ sha }) => sha)).toEqual(['bbbbbbb', 'aaaaaaa']);
  });

  it('escapes untrusted Markdown and HTML', () => {
    const result = generateReleaseNotes([commit('aaaaaaa', 'feat: <script>alert(1)</script> [click](https://evil.test)')], { warnings: ['<img src=x>\n# heading'] });
    expect(result.markdown).not.toContain('<script>');
    expect(result.markdown).not.toContain('[click](https://evil.test)');
    expect(result.markdown).not.toContain('\n# heading');
  });

  it('handles malformed options and unserializable metadata', () => {
    const circular = {};
    circular.self = circular;
    expect(generateReleaseNotes([], { metadata: { circular }, warnings: {} }).markdown).toContain('Unserializable metadata');
    expect(generateReleaseNotes([], { metadata: [], warnings: null }).metadata).toEqual({});
  });

  it('does not use network, browser, current time, or randomness during generation', () => {
    const forbidden = () => { throw new Error('Forbidden side effect'); };
    vi.stubGlobal('fetch', forbidden);
    vi.stubGlobal('XMLHttpRequest', forbidden);
    vi.stubGlobal('window', undefined);
    vi.stubGlobal('document', undefined);
    const now = vi.spyOn(Date, 'now').mockImplementation(forbidden);
    const random = vi.spyOn(Math, 'random').mockImplementation(forbidden);
    try {
      expect(generateReleaseNotes([commit('aaaaaaa', 'feat: offline')]).markdown).toContain('offline');
    } finally {
      now.mockRestore();
      random.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});
