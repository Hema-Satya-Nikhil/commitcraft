// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('standalone domain boundary', () => {
  it('imports and executes in plain Node with network, UI, clock, and randomness unavailable', () => {
    const moduleUrl = new URL('../../src/domain/index.js', import.meta.url).href;
    const script = `
      const forbidden = () => { throw new Error('Forbidden external behavior'); };
      globalThis.fetch = forbidden;
      globalThis.XMLHttpRequest = forbidden;
      for (const name of ['window', 'document', 'navigator', 'localStorage']) {
        Object.defineProperty(globalThis, name, { get: forbidden, configurable: true });
      }
      const OriginalDate = Date;
      globalThis.Date = class extends OriginalDate {
        constructor(...args) { if (!args.length) forbidden(); super(...args); }
        static now() { return forbidden(); }
      };
      Math.random = forbidden;
      const domain = await import(${JSON.stringify(moduleUrl)});
      const commit = { sha: 'abcdef1', message: 'feat: offline', date: '2026-01-01T00:00:00Z' };
      if (!domain.validateRepository('owner/repo').valid) throw new Error('Invalid repository');
      if (!domain.normalizeCommit(commit)) throw new Error('Invalid commit');
      if (domain.classifyCommit(commit).section !== 'features') throw new Error('Invalid classification');
      const result = domain.generateReleaseNotes([commit]);
      if (!result.markdown.includes('offline')) throw new Error('Missing notes');
      if (result.markdown !== domain.generateReleaseNotes([commit]).markdown) throw new Error('Non-deterministic');
      process.stdout.write('standalone domain passed');
    `;
    expect(execFileSync(process.execPath, ['--input-type=module', '--eval', script], { encoding: 'utf8', timeout: 10000 })).toBe('standalone domain passed');
  });
});
