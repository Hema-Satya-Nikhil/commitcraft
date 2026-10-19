import { normalizeCommit } from '../domain/normalizeCommit.js';
import { validateRepository } from '../domain/validateRepository.js';
import {
  GITHUB_ERROR_CATEGORIES,
  GithubError,
  isRateLimited,
  parseRateLimit,
  parseRetryAfter,
} from './githubErrors.js';
import { createPaginationMetadata, getNextPageUrl, GITHUB_MAX_COMMITS, GITHUB_PAGE_SIZE } from './githubPagination.js';
import { createRequestCancellation, isAbortError } from './requestCancellation.js';

const DEFAULT_BASE_URL = 'https://api.github.com';
const DEFAULT_TIMEOUT_MS = 15_000;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function repositoryIdentifier(input) {
  if (typeof input === 'string') return input;
  if (isRecord(input) && input.valid === true && isRecord(input.repository)) return repositoryIdentifier(input.repository);
  if (isRecord(input) && typeof input.owner === 'string' && typeof input.name === 'string') return `${input.owner}/${input.name}`;
  return input;
}

function errorMessage(body) {
  return isRecord(body) && typeof body.message === 'string' ? body.message : '';
}

function responseStatus(response) {
  return typeof response?.status === 'number' && Number.isInteger(response.status) ? response.status : null;
}

function responseHeaders(response) {
  return response?.headers ?? null;
}

function httpError(response, body = null) {
  const status = responseStatus(response);
  const headers = responseHeaders(response);
  const message = errorMessage(body);
  let category = GITHUB_ERROR_CATEGORIES.MALFORMED_RESPONSE;
  let userMessage = 'GitHub request failed.';
  if (status === 401) { category = GITHUB_ERROR_CATEGORIES.UNAUTHORIZED; userMessage = 'GitHub authentication failed.'; }
  else if (status === 404) { category = GITHUB_ERROR_CATEGORIES.NOT_FOUND; userMessage = 'The repository could not be found or is inaccessible.'; }
  else if (status === 429) { category = GITHUB_ERROR_CATEGORIES.TOO_MANY_REQUESTS; userMessage = 'GitHub temporarily rejected requests; try again later.'; }
  else if (status === 403 && isRateLimited(status, headers, message)) { category = GITHUB_ERROR_CATEGORIES.RATE_LIMIT; userMessage = 'GitHub API rate limit exhausted; try again after the reset time.'; }
  else if (status === 403) { category = GITHUB_ERROR_CATEGORIES.FORBIDDEN; userMessage = 'GitHub denied access to this repository.'; }
  else if (status !== null && status >= 500 && status <= 599) { category = GITHUB_ERROR_CATEGORIES.SERVER; userMessage = 'GitHub is temporarily unavailable; try again later.'; }

  const rateLimit = parseRateLimit(headers);
  const retryAfter = parseRetryAfter(headers);
  const details = isRecord(body) ? {
    documentationUrl: typeof body.documentation_url === 'string' ? body.documentation_url : null,
    errorCount: Array.isArray(body.errors) ? body.errors.length : null,
  } : null;
  return new GithubError(userMessage, {
    category,
    status,
    details,
    rateLimit,
    retryAfter,
  });
}

async function responseJson(response) {
  if (!response || typeof response.json !== 'function') {
    throw new GithubError('GitHub returned a response without JSON data.', { category: GITHUB_ERROR_CATEGORIES.MALFORMED_RESPONSE });
  }
  try {
    return await response.json();
  } catch (cause) {
    throw new GithubError('GitHub returned malformed JSON.', { category: GITHUB_ERROR_CATEGORIES.MALFORMED_RESPONSE, cause });
  }
}

function normalizeRepository(data, requested) {
  if (!isRecord(data)
    || typeof data.name !== 'string' || !data.name.trim()
    || typeof data.full_name !== 'string' || !data.full_name.trim()
    || typeof data.owner?.login !== 'string' || !data.owner.login.trim()
    || typeof data.html_url !== 'string' || !data.html_url.trim()) {
    throw new GithubError('GitHub returned malformed repository metadata.', { category: GITHUB_ERROR_CATEGORIES.MALFORMED_RESPONSE });
  }
  const owner = data.owner.login.trim();
  const name = data.name.trim();
  const fullName = data.full_name.trim();
  return {
    owner,
    name,
    fullName,
    url: data.html_url.trim(),
    apiUrl: typeof data.url === 'string' ? data.url : null,
    description: typeof data.description === 'string' ? data.description : null,
    defaultBranch: typeof data.default_branch === 'string' ? data.default_branch : null,
    private: typeof data.private === 'boolean' ? data.private : null,
    archived: typeof data.archived === 'boolean' ? data.archived : null,
    fork: typeof data.fork === 'boolean' ? data.fork : null,
  };
}

function normalizeGithubCommit(data) {
  const normalized = normalizeCommit(data);
  if (!normalized) throw new GithubError('GitHub returned a malformed commit record.', { category: GITHUB_ERROR_CATEGORIES.MALFORMED_RESPONSE });
  const parents = Array.isArray(data.parents) ? data.parents.map((parent) => (isRecord(parent) ? { ...parent } : parent)) : [];
  return {
    ...normalized,
    author: data.author ?? data.commit?.author ?? null,
    commitAuthor: data.commit?.author ?? null,
    url: typeof data.html_url === 'string' ? data.html_url : (typeof data.url === 'string' ? data.url : null),
    commitUrl: typeof data.html_url === 'string' ? data.html_url : (typeof data.url === 'string' ? data.url : null),
    parents,
  };
}

function requestHeaders(options) {
  const headers = {};
  if (options.headers && typeof options.headers === 'object') {
    if (typeof options.headers.forEach === 'function') options.headers.forEach((value, key) => { headers[key] = value; });
    else Object.assign(headers, options.headers);
  }
  headers.Accept ??= 'application/vnd.github+json';
  headers['X-GitHub-Api-Version'] ??= '2022-11-28';
  const token = options.token ?? options.authToken;
  if (typeof token === 'string' && token.trim()) headers.Authorization = `Bearer ${token.trim()}`;
  return headers;
}

function requestUrl(baseUrl, path) {
  return `${baseUrl.replace(/\/+$/, '')}${path}`;
}

function makeClientRequest(fetchImpl, baseUrl, options, url) {
  const cancellation = createRequestCancellation({ signal: options.signal, timeoutMs: options.timeoutMs });
  return (async () => {
    try {
      if (cancellation.wasCancelled()) {
        throw new GithubError('The GitHub request was cancelled.', { category: GITHUB_ERROR_CATEGORIES.CANCELLATION });
      }
      let response;
      try {
        response = await fetchImpl(url, { method: 'GET', headers: requestHeaders(options), signal: cancellation.signal });
      } catch (cause) {
        if (cancellation.didTimeout()) throw new GithubError('The GitHub request timed out.', { category: GITHUB_ERROR_CATEGORIES.TIMEOUT, cause });
        if (cancellation.wasCancelled() || isAbortError(cause)) throw new GithubError('The GitHub request was cancelled.', { category: GITHUB_ERROR_CATEGORIES.CANCELLATION, cause });
        throw new GithubError('The GitHub request could not be completed.', { category: GITHUB_ERROR_CATEGORIES.NETWORK, cause });
      }
      const status = responseStatus(response);
      if (status === null) {
        throw new GithubError('GitHub returned a malformed response.', { category: GITHUB_ERROR_CATEGORIES.MALFORMED_RESPONSE, status });
      }
      const ok = typeof response.ok === 'boolean' ? response.ok : status >= 200 && status <= 299;
      if (!ok) {
        let body = null;
        if (typeof response.json === 'function') {
          try { body = await response.json(); } catch { /* status is still useful when an error body is not JSON */ }
        }
        throw httpError(response, body);
      }
      return response;
    } finally {
      cancellation.cleanup();
    }
  })();
}

/** Create a GitHub REST client. No network request occurs until a method is called. */
export function createGithubClient({ fetch: fetchImpl = globalThis.fetch, baseUrl = DEFAULT_BASE_URL, apiBaseUrl, token, authToken, headers, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const root = apiBaseUrl ?? baseUrl;
  const request = async (repositoryInput, requestOptions = {}) => {
    const parsed = validateRepository(repositoryIdentifier(repositoryInput));
    if (!parsed.valid) {
      throw new GithubError(parsed.error, { category: GITHUB_ERROR_CATEGORIES.INVALID_REPOSITORY });
    }
    if (typeof fetchImpl !== 'function') {
      throw new GithubError('No fetch implementation was provided.', { category: GITHUB_ERROR_CATEGORIES.NETWORK });
    }

    const options = {
      token,
      authToken,
      headers,
      timeoutMs,
      ...requestOptions,
    };
    const path = `/repos/${encodeURIComponent(parsed.repository.owner)}/${encodeURIComponent(parsed.repository.name)}`;
    const failureMetadata = () => ({
      requestedLimit: 100,
      fetchedCount: 0,
      pagesFetched: 0,
      hasNextPage: false,
      historyComplete: false,
      truncated: false,
      warnings: [],
    });
    try {
      const repositoryResponse = await makeClientRequest(fetchImpl, root, options, requestUrl(root, path));
      const repositoryData = await responseJson(repositoryResponse);
      const repository = normalizeRepository(repositoryData, parsed.repository);

      const commitsResponse = await makeClientRequest(fetchImpl, root, options, requestUrl(root, `${path}/commits?per_page=${GITHUB_PAGE_SIZE}&page=1`));
      const commitsData = await responseJson(commitsResponse);
      if (!Array.isArray(commitsData)) {
        throw new GithubError('GitHub returned malformed commit data.', { category: GITHUB_ERROR_CATEGORIES.MALFORMED_RESPONSE });
      }
      const fetchedCount = Math.min(commitsData.length, GITHUB_PAGE_SIZE);
      const commits = commitsData.slice(0, GITHUB_PAGE_SIZE).map(normalizeGithubCommit);
      const nextPageUrl = getNextPageUrl(commitsResponse.headers);
      const warnings = nextPageUrl === null ? [] : [fetchedCount === GITHUB_MAX_COMMITS
        ? `Commit history was truncated after ${GITHUB_MAX_COMMITS} commits; GitHub reported another page.`
        : 'GitHub reported another commit page; retrieval stopped after the configured one-page limit.'];
      return {
        repository,
        commits,
        metadata: createPaginationMetadata({
          retrievedCount: fetchedCount,
          nextPageUrl,
          warnings,
          rateLimit: parseRateLimit(commitsResponse.headers) ?? parseRateLimit(repositoryResponse.headers),
        }),
      };
    } catch (error) {
      if (error instanceof GithubError) {
        error.retrieval ??= failureMetadata();
        throw error;
      }
      throw new GithubError('The GitHub request failed.', { category: GITHUB_ERROR_CATEGORIES.NETWORK, retrieval: failureMetadata(), cause: error });
    }
  };

  return Object.freeze({
    fetchGithubRepository: request,
    fetchRepository: request,
  });
}

/** Fetch repository metadata and its first bounded commit page with one call. */
export function fetchGithubRepository(repositoryInput, options = {}) {
  return createGithubClient(options).fetchGithubRepository(repositoryInput, options);
}

export const fetchGitHubRepository = fetchGithubRepository;
