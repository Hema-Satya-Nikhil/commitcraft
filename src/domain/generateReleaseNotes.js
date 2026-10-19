import { classifyCommit, RELEASE_SECTIONS } from './classifyCommit.js';
import { normalizeCommit } from './normalizeCommit.js';

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const escapeMarkdown = (text) => text.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/[\\`*_{}\[\]()<>#!|~]/g, '\\$&');
const compareText = (a, b) => a < b ? -1 : a > b ? 1 : 0;

/** Pure release-note generation. Metadata is descriptive; it never controls retrieval. */
export function generateReleaseNotes(input = [], options = {}) {
  const records = Array.isArray(input) ? input : [];
  const settings = isRecord(options) ? options : {};
  const metadata = isRecord(settings.metadata) ? { ...settings.metadata } : {};
  const warnings = [...(Array.isArray(settings.warnings) ? settings.warnings : []), ...(Array.isArray(metadata.warnings) ? metadata.warnings : [])]
    .filter((warning) => typeof warning === 'string' && warning.trim()).map((warning) => warning.trim());
  if (metadata.truncated === true) warnings.push('Commit history was truncated; these release notes may be incomplete.');
  let invalidCount = 0;
  let duplicateCount = 0;
  let filteredCount = 0;
  const seen = new Set();
  const commits = [];
  for (const record of records) {
    const commit = normalizeCommit(record);
    if (!commit) { invalidCount += 1; continue; }
    if (seen.has(commit.sha)) { duplicateCount += 1; continue; }
    seen.add(commit.sha);
    const classification = classifyCommit(commit);
    if (classification.excluded) { filteredCount += 1; continue; }
    commits.push({ ...commit, ...classification });
  }
  commits.sort((a, b) => (b.timestamp ?? -Infinity) - (a.timestamp ?? -Infinity) || compareText(a.sha, b.sha));
  if (invalidCount) warnings.push(`Skipped ${invalidCount} malformed commit record(s).`);
  const sections = RELEASE_SECTIONS.map(({ id, title }) => ({ id, title, commits: commits.filter((commit) => commit.section === id) }));
  const lines = ['# Release Notes', ''];
  if (!commits.length) lines.push('No release-note entries.', '');
  for (const section of sections) {
    if (!section.commits.length) continue;
    lines.push(`## ${section.title}`, '');
    for (const commit of section.commits) {
      const scope = commit.scope ? `**${escapeMarkdown(commit.scope)}:** ` : '';
      lines.push(`- ${scope}${escapeMarkdown(commit.description)} (${commit.sha})`);
    }
    lines.push('');
  }
  if (Object.keys(metadata).length) {
    lines.push('## Retrieval Metadata', '');
    for (const key of Object.keys(metadata).sort(compareText)) {
      lines.push(`- **${escapeMarkdown(key)}:** ${escapeMarkdown(formatMetadata(metadata[key]))}`);
    }
    lines.push('');
  }
  if (warnings.length) {
    lines.push('## Warnings', '', ...warnings.map((warning) => `- ${escapeMarkdown(warning)}`), '');
  }
  return { markdown: lines.join('\n'), sections, metadata, warnings, stats: { inputCount: records.length, includedCount: commits.length, invalidCount, duplicateCount, filteredCount } };
}

function formatMetadata(value) {
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value) ?? String(value); } catch { return '[Unserializable metadata]'; }
}
