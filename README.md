# CommitCraft

CommitCraft will turn GitHub repository commit history into readable, deterministic release notes.

This repository implements **Milestone 4: production UI and application integration**, building on the deterministic domain engine from `f3ffd22` and bounded GitHub integration from `8d00f53`. The frontend is a static Vite application; no server-side proxy, database, authentication, or AI service is required.

## Requirements

- Node.js `22.14.0` (see `.nvmrc`)
- npm
- Docker for container verification

## Setup

```bash
npm ci
```

The committed `package-lock.json` is the source of truth for dependency installation. Dependencies are installed locally in the project; no global packages are required.

## Development

```bash
npm run dev
```

Vite serves the CommitCraft application at `http://localhost:5173`.

## Tests

The canonical offline test command is:

```bash
npm test
```

Tests do not call GitHub or require network access after dependencies have been installed.

## Production build

```bash
npm run build
```

The production assets are written to `dist/`.

## Docker

The container uses Nginx explicitly configured to listen on port `4173` internally. The host and container ports therefore match:

```bash
docker build -t commitcraft .
docker run --rm -p 4173:4173 commitcraft
```

Open `http://localhost:4173` after the container starts.

## Configuration and secrets

No environment variables are currently required. `.env.example` documents this and is included to make the policy explicit. Do not put GitHub tokens in `VITE_*` variables: Vite embeds those values into the browser bundle, making them public.

## Planned milestones

1. Foundation and reproducible build (complete)
2. Independent deterministic release-note domain engine (complete)
3. GitHub API integration with bounded pagination, Link-header detection, rate-limit handling, and cancellation (complete)
4. Responsive production UI and application integration (current milestone)
5. Hardening, accessibility, and release verification

## Domain API (Milestone 2)

All public functions are named ES module exports from `src/domain/index.js` and their individual modules. They have no external imports, UI dependencies, network access, clock reads, randomness, or input mutation. They operate on ordinary JavaScript data records; no retrieval is performed.

```js
import { validateRepository, normalizeCommit, classifyCommit, generateReleaseNotes } from './src/domain/index.js';

validateRepository('octocat/Hello-World');
// { valid: true, repository: { owner, name, fullName, url }, error: null }

const commits = [{ sha: 'abcdef1234567', message: 'feat(cli): add export', date: '2026-01-02T00:00:00Z' }];
normalizeCommit(commits[0]);
classifyCommit(commits[0]);
const result = generateReleaseNotes(commits, {
  metadata: { truncated: true, retrievedCount: 100, pagesFetched: 2, reason: 'caller limit' },
  warnings: ['Caller supplied a partial history.'],
});
console.log(result.markdown);
```

### Validation and normalization

- `validateRepository(input)` accepts trimmed `owner/repository` identifiers and HTTP(S) `github.com` or `www.github.com` URLs, with an optional `.git` suffix and URL trailing slash. Owner/repository case is preserved. Owners must be 1–39 alphanumeric/hyphen characters, without leading/trailing or consecutive hyphens. Repository names allow 1–100 alphanumeric, `.`, `_`, and `-` characters, except `.` and `..`. Extra paths, query strings, fragments, credentials, explicit ports, encoded paths, SSH URLs, and other hosts/protocols are rejected. Invalid input returns `{ valid: false, repository: null, error }` rather than throwing.
- `normalizeCommit(record)` accepts flat `{ sha, message, date, parents }` records or GitHub-shaped `{ sha, commit: { message, committer: { date }, author: { date } }, parents }` records. Flat fields take precedence; nested committer date precedes author date. SHAs are trimmed, lowercased hexadecimal strings of 7–40 or 64 characters. Message line endings become LF, surrounding whitespace is removed, and the first line becomes `subject`.
- Missing/invalid identity or message yields `null`. Missing/invalid dates yield `timestamp: null` and `date: null` while retaining the commit. Dates require explicit zoned ISO timestamps (`Z` or `±HH:MM`, optional 1–3 fractional digits) and valid calendar/time components, avoiding environment-dependent date parsing. Valid dates become UTC ISO strings and numeric epoch milliseconds. Unknown fields are ignored; malformed optional fields do not invalidate otherwise usable records.

### Classification, filtering, and ordering

- `classifyCommit(messageOrRecord)` accepts a message string or `{ message, isMerge?, parents? }`, returning `{ section, type, scope, description, breaking, excluded }`; invalid messages yield `null`.
- Conventional subjects use `type(scope)!: description` with scope/`!` optional. Types are case-insensitive. `feat` maps to Features, `fix` to Bug Fixes, `perf` to Performance, `docs` to Documentation, and `refactor` to Refactoring. `chore`, `build`, `ci`, and `test` map to Maintenance. Unknown prefixes and ordinary messages go to Other Changes. Conventional prefixes are removed from displayed descriptions; scopes are retained.
- A conventional `!` or a line beginning `BREAKING CHANGE:` / `BREAKING-CHANGE:` with nonempty content puts the commit exclusively in Breaking Changes. Footer markers are case-sensitive; inline mentions are not markers.
- Merge records (more than one parent, or subjects beginning `Merge pull request`, `Merge branch`, `Merge remote-tracking branch`, or `Merge tag`, case-insensitively) are excluded, even if they contain breaking markers. Squash messages and unrelated messages such as `Merge sort optimization` are retained. `isMerge` is exposed by normalization and honored by classification.
- Stable section order is **Breaking Changes → Features → Bug Fixes → Performance → Documentation → Refactoring → Maintenance → Other Changes**, exported as frozen `RELEASE_SECTIONS`. Commits within each section sort by timestamp descending, then normalized full SHA ascending using code-point comparison. Missing/invalid dates sort last, still with SHA ascending ties.
- Deduplication uses **only normalized SHA**: the first valid occurrence wins, even if a later duplicate has different data. Distinct SHAs with identical messages remain. Short/full SHAs are not resolved into one identity. Merge records participate in SHA deduplication before filtering.

### Generation and retrieval metadata

- `generateReleaseNotes(commits = [], options = {})` returns `{ markdown, sections, metadata, warnings, stats }`. Non-array input is treated as empty; malformed records are skipped with a count warning. `sections` always includes all eight sections and their normalized/classified commits; empty sections are omitted from Markdown. Empty results say `No release-note entries.`. Stats include `inputCount`, `includedCount`, `invalidCount`, `duplicateCount`, and `filteredCount`.
- `options.metadata` is copied as supplied into the result and rendered in a Retrieval Metadata section with sorted keys. Arbitrary retrieval fields remain available, including nested data. Metadata should be JSON-compatible; unserializable values render a placeholder. `options.warnings` and `metadata.warnings` accept arrays of nonempty strings, preserved in that order and rendered under Warnings. Malformed optional values are ignored.
- Explicit `metadata.truncated: true` adds an incomplete-history warning, including for empty results. Other metadata never causes pagination, retrying, inferred truncation, or any network decision. The caller owns retrieval and its interpretation.
- Commit text, metadata, and warnings are escaped as Markdown text, including raw HTML. Full SHAs identify entries unambiguously. No current date is injected. Identical inputs produce identical Markdown; input order only matters for conflicting duplicates and supplied warnings.

Run the focused offline domain suite with `npm test -- tests/unit`. It covers malformed inputs, classification, filtering, SHA-only deduplication, ordering, metadata/warnings, exact Markdown, repeatability, and plain-Node execution with browser/network/clock/randomness access disabled. `npm test` runs this suite plus the foundation test.

## GitHub API integration (Milestone 3)

The infrastructure API is exported from `src/infrastructure/index.js` and uses GitHub's public REST API without requiring authentication:

```js
import { createGithubClient } from './src/infrastructure/index.js';

const client = createGithubClient();
const result = await client.fetchRepository({ owner: 'octocat', name: 'Hello-World' }, { signal });
// A successful validateRepository(...) result is accepted too.
// { repository, commits, metadata }
```

`createGithubClient({ fetch, baseUrl, timeoutMs })` accepts an injected `fetch` implementation for offline tests and uses `https://api.github.com` by default. It performs exactly two requests on success: repository metadata and page 1 of commits with `per_page=100&page=1`. The fixed first-version policy is `requestedLimit: 100`, page size `100`, and maximum pages `1`; a `Link` header with `rel="next"` is detected but never followed.

The normalized repository contains `owner`, `name`, `fullName`, `url`, and available metadata such as description and default branch. Normalized commits retain the domain fields (`sha`, `message`, `subject`, `timestamp`, `date`, and merge information) plus available `author`, `url`/`commitUrl`, and `parents` values. The infrastructure does not classify or deduplicate commits; callers pass them to the existing domain engine.

Successful retrieval returns:

```js
{
  repository,
  commits,
  metadata: {
    requestedLimit: 100,
    fetchedCount,
    pagesFetched: 1,
    hasNextPage,
    historyComplete, // true only after success with no rel="next"
    truncated,
    warnings,
    rateLimit,
  },
}
```

When a next page exists, retrieval stops after the first page, `historyComplete` is `false`, `truncated` is `true`, and a warning is included. Empty histories with no next page are complete. Failed, malformed, timed-out, or cancelled operations reject with a `GithubError` carrying a stable `category`, optional HTTP `status`, safe user-facing `message`, parsed rate-limit data, and `retrieval.historyComplete: false`; raw error response bodies and request secrets are not exposed. Categories include `invalid-repository`, `not-found`, `unauthorized`, `forbidden`, `rate-limit`, `too-many-requests`, `server`, `network`, `timeout`, `malformed-response`, and `cancellation`.

Pass an `AbortSignal` to `fetchRepository` to cancel repository or commit requests. `timeoutMs` bounds each request; cancellation and timeout are reported separately. The infrastructure makes no automatic retries and does not contain UI stale-response logic. Its tests use mocked fetch responses only; `npm test` remains offline.

## Application workflow (Milestone 4)

The production workflow is implemented in `src/App.jsx` and uses the domain and infrastructure contracts directly. Enter a public GitHub URL or `owner/repository`, then submit with the button or Enter. The interface validates locally before making a request, shows a loading state, and renders deterministic Markdown from the retrieved commits. It provides repository metadata, entry and filtered-merge counts, complete/truncated history coverage, prominent incomplete-history warnings, empty-history messaging, retry, and New analysis controls.

The result toolbar copies the generated Markdown to the clipboard and downloads the same content as a sanitized `<repository>-release-notes.md` file. Clipboard failure is shown as failure feedback; no success state is displayed unless the browser operation resolves. New analyses cancel an in-flight request, and request identities prevent stale responses from replacing the latest result. Intentional cancellation is not shown as an ordinary network error. The UI keeps a previous successful result visible during an appropriate retry.

The UI has responsive desktop/mobile layouts, keyboard-visible focus states, semantic labels and live status regions, restrained loading motion, and `prefers-reduced-motion` support. No GitHub token or `VITE_*` secret is used by the frontend.

## Static deployment

The build output is the `dist/` directory. For Vercel, import this repository and use:

- Framework preset: **Vite** (or Other)
- Build command: `npm run build`
- Output directory: `dist`
- Install command: `npm ci`

No environment variables are required. After deployment, open the assigned HTTPS URL and verify that the initial workspace renders, submit a known public repository, confirm the Markdown result, and test Copy Markdown and Download. The application calls GitHub's public REST API directly from the browser, so a live verification requires browser network access and GitHub availability.

For a local static verification, run `npm run build` and serve `dist/` with any static server. The included Dockerfile builds the Vite assets and serves them with Nginx on internal port `4173`.
