/** Stable public section order, including empty sections (omitted from Markdown). */
export const RELEASE_SECTIONS = Object.freeze([
  Object.freeze({ id: 'breaking', title: 'Breaking Changes' }),
  Object.freeze({ id: 'features', title: 'Features' }),
  Object.freeze({ id: 'fixes', title: 'Bug Fixes' }),
  Object.freeze({ id: 'performance', title: 'Performance' }),
  Object.freeze({ id: 'documentation', title: 'Documentation' }),
  Object.freeze({ id: 'refactoring', title: 'Refactoring' }),
  Object.freeze({ id: 'maintenance', title: 'Maintenance' }),
  Object.freeze({ id: 'other', title: 'Other Changes' }),
]);

/** Classify a message or normalized commit. Merge commits are excluded first. */
export function classifyCommit(input) {
  const message = typeof input === 'string' ? input : input?.message;
  if (typeof message !== 'string' || !message.trim()) return null;
  const text = message.replace(/\r\n?/g, '\n').trim();
  const subject = text.split('\n')[0].trim();
  const merge = input?.isMerge === true || (Array.isArray(input?.parents) && input.parents.length > 1) || /^Merge\s+(?:pull request\b|branch\b|remote-tracking branch\b|tag\b)/i.test(subject);
  if (merge) return { section: null, type: null, scope: null, description: subject, breaking: false, excluded: true };
  const match = /^([a-z][a-z\d-]*)(?:\(([^()\n]+)\))?(!)?:\s+(.+)$/i.exec(subject);
  const type = match ? match[1].toLowerCase() : null;
  const breaking = Boolean(match?.[3]) || /^BREAKING(?: CHANGE|-CHANGE):\s*\S/m.test(text);
  const sections = {
    feat: 'features', fix: 'fixes', perf: 'performance', docs: 'documentation',
    refactor: 'refactoring', chore: 'maintenance', build: 'maintenance', ci: 'maintenance', test: 'maintenance',
  };
  return {
    section: breaking ? 'breaking' : (Object.hasOwn(sections, type) ? sections[type] : 'other'),
    type,
    scope: match?.[2] ?? null,
    description: match?.[4] ?? subject,
    breaking,
    excluded: false,
  };
}
