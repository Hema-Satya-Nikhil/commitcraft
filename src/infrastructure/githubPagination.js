export const GITHUB_PAGE_SIZE = 100;
export const GITHUB_MAX_COMMITS = 100;
export const GITHUB_MAX_PAGES = 1;

function headerValue(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === 'function') {
    try {
      const result = headers.get(name);
      return result === null || result === undefined ? null : String(result);
    } catch {
      return null;
    }
  }
  if (typeof headers !== 'object') return null;
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key === undefined ? null : String(headers[key]);
}

/** Parse Link headers while accepting quoted or unquoted relation values. */
export function parseLinkHeader(value) {
  if (typeof value !== 'string' || !value.trim()) return [];
  return value.split(',').flatMap((part) => {
    const match = /^\s*<([^>]+)>\s*;\s*rel\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s;]+))/i.exec(part);
    if (!match) return [];
    return [{ url: match[1], rel: (match[2] ?? match[3] ?? match[4]).split(/\s+/).filter(Boolean) }];
  });
}

export function getNextPageUrl(headersOrLink) {
  const value = typeof headersOrLink === 'string' ? headersOrLink : headerValue(headersOrLink, 'link');
  return parseLinkHeader(value).find((link) => link.rel.some((relation) => relation.toLowerCase() === 'next'))?.url ?? null;
}

export function hasNextPage(headersOrLink) {
  return getNextPageUrl(headersOrLink) !== null;
}

export function createPaginationMetadata({ retrievedCount = 0, nextPageUrl = null, rateLimit = null, warnings = [] } = {}) {
  const hasNextPage = nextPageUrl !== null;
  return {
    requestedLimit: GITHUB_MAX_COMMITS,
    fetchedCount: retrievedCount,
    pageSize: GITHUB_PAGE_SIZE,
    maxCommits: GITHUB_MAX_COMMITS,
    maxPages: GITHUB_MAX_PAGES,
    pagesFetched: 1,
    retrievedCount,
    hasNextPage,
    nextPageUrl,
    historyComplete: !hasNextPage,
    truncated: hasNextPage,
    warnings: [...warnings],
    rateLimit,
  };
}
