import { describe, expect, it } from 'vitest';
import { normalizeCommit } from '../../src/domain/index.js';

describe('commit normalization', () => {
  it('normalizes a flat record without mutating it', () => {
    const input = Object.freeze({ sha: ' ABCDEF1 ', message: ' feat: export\r\n\r\nbody \r\n', date: '2026-01-02T12:00:00+02:00' });
    expect(normalizeCommit(input)).toEqual({ sha: 'abcdef1', message: 'feat: export\n\nbody', subject: 'feat: export', timestamp: Date.parse('2026-01-02T10:00:00Z'), date: '2026-01-02T10:00:00.000Z', isMerge: false });
  });

  it('normalizes GitHub-shaped records and prefers committer over author date', () => {
    expect(normalizeCommit({ sha: 'a'.repeat(40), commit: { message: 'fix: repair', committer: { date: '2026-01-02T00:00:00Z' }, author: { date: '2025-01-01T00:00:00Z' } }, parents: [{ sha: 'a' }, { sha: 'b' }] }))
      .toMatchObject({ message: 'fix: repair', date: '2026-01-02T00:00:00.000Z', isMerge: true });
    expect(normalizeCommit({ sha: 'a'.repeat(40), commit: { message: 'fix: repair', author: { date: '2025-01-01T00:00:00Z' } } }).date).toBe('2025-01-01T00:00:00.000Z');
  });

  it.each([null, undefined, false, 12, [], 'message', {}, { sha: 'abcdef1' }, { sha: 'bad', message: 'x' }, { sha: 'z'.repeat(40), message: 'x' }, { sha: 'abcdef1', message: '' }, { sha: 'abcdef1', message: {} }, { sha: {}, commit: { message: 'x' } }])('skips invalid records safely (%j)', (input) => {
    expect(normalizeCommit(input)).toBeNull();
  });

  it.each([undefined, null, 12, {}, '', 'yesterday', '2026-01-01', '2026-01-01T12:00:00', '2026-99-99T00:00:00Z', '2026-02-30T00:00:00Z', '2026-02-29T00:00:00Z', '2026-01-01T24:00:00Z'])('retains commits with missing/invalid dates (%j)', (date) => {
    expect(normalizeCommit({ sha: 'abcdef1', message: 'fix: x', date, parents: 'bad', commit: 42 })).toMatchObject({ timestamp: null, date: null, isMerge: false });
  });

  it('accepts leap days in leap years', () => {
    expect(normalizeCommit({ sha: 'abcdef1', message: 'fix: leap', date: '2024-02-29T00:00:00Z' }).date).toBe('2024-02-29T00:00:00.000Z');
  });

  it('can normalize its own output without losing merge metadata', () => {
    const normalized = normalizeCommit({ sha: 'abcdef1', message: 'feat: x', parents: [{}, {}], date: '2026-01-01T00:00:00Z' });
    expect(normalizeCommit(normalized)).toEqual(normalized);
  });
});
