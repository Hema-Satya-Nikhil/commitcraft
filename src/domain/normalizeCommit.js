const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Accept explicit, zoned ISO dates only, so parsing never depends on local timezone. */
function timestampOf(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(value)) return null;
  const [year, month, day, hour, minute, second] = value.match(/\d+/g).slice(0, 6).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1] || hour > 23 || minute > 59 || second > 59) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

/** Invalid identity/message records return null; invalid dates remain usable and sort last. */
export function normalizeCommit(record) {
  if (!isRecord(record)) return null;
  const nested = isRecord(record.commit) ? record.commit : {};
  const sha = typeof record.sha === 'string' ? record.sha.trim().toLowerCase() : '';
  const rawMessage = record.message ?? nested.message;
  if (!/^(?:[a-f\d]{7,40}|[a-f\d]{64})$/.test(sha) || typeof rawMessage !== 'string' || !rawMessage.trim()) return null;
  const message = rawMessage.replace(/\r\n?/g, '\n').trim();
  const timestamp = timestampOf(record.date ?? nested.committer?.date ?? nested.author?.date);
  return {
    sha,
    message,
    subject: message.split('\n')[0].trim(),
    timestamp,
    date: timestamp === null ? null : new Date(timestamp).toISOString(),
    isMerge: record.isMerge === true || (Array.isArray(record.parents) && record.parents.length > 1) || /^Merge\s+(?:pull request\b|branch\b|remote-tracking branch\b|tag\b)/i.test(message),
  };
}
