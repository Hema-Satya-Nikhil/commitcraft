import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../src/App.jsx';

// The standalone Vitest config does not install the JSX automatic runtime used by Vite.
globalThis.React = React;

const { createGithubClientMock, fetchGithubRepositoryMock } = vi.hoisted(() => ({
  createGithubClientMock: vi.fn(),
  fetchGithubRepositoryMock: vi.fn(),
}));

vi.mock('../../src/infrastructure/index.js', () => ({
  createGithubClient: createGithubClientMock,
  GITHUB_ERROR_CATEGORIES: {
    INVALID_REPOSITORY: 'invalid-repository',
    NOT_FOUND: 'not-found',
    UNAUTHORIZED: 'unauthorized',
    FORBIDDEN: 'forbidden',
    RATE_LIMIT: 'rate-limit',
    TOO_MANY_REQUESTS: 'too-many-requests',
    SERVER: 'server',
    NETWORK: 'network',
    TIMEOUT: 'timeout',
    MALFORMED_RESPONSE: 'malformed-response',
    CANCELLATION: 'cancellation',
  },
}));

const repository = {
  owner: 'octo',
  name: 'hello-world',
  fullName: 'octo/hello-world',
  url: 'https://github.com/octo/hello-world',
};

const commits = [
  { sha: 'abcdef1', message: 'feat(ui): Add dashboard', date: '2025-01-04T12:00:00Z' },
  { sha: 'abcdef2', message: 'fix: Resolve timeout', date: '2025-01-03T12:00:00Z' },
  { sha: 'abcdef3', message: 'perf: Improve startup', date: '2025-01-02T12:00:00Z' },
  { sha: 'abcdef4', message: 'Merge pull request #4 from octo/old', date: '2025-01-01T12:00:00Z' },
];

function retrieved(overrides = {}) {
  const returnedCommits = overrides.commits ?? commits;
  return {
    repository: overrides.repository ?? repository,
    commits: returnedCommits,
    metadata: {
      requestedLimit: 100,
      fetchedCount: returnedCommits.length,
      pagesFetched: 1,
      hasNextPage: false,
      historyComplete: true,
      truncated: false,
      warnings: [],
      ...(overrides.metadata ?? {}),
    },
  };
}

function renderApp() {
  return render(<App />);
}

function submitRepository(value, { keyboard = false } = {}) {
  const input = screen.getByLabelText('GitHub repository');
  fireEvent.change(input, { target: { value } });
  if (keyboard) fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', charCode: 13 });
  fireEvent.submit(input.closest('form'));
}

function githubError(category, message = 'transport failure') {
  return Object.assign(new Error(message), { category });
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function installClipboardFallback(execCommandImplementation) {
  const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
  const execCommand = vi.fn(execCommandImplementation);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
  Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
  return {
    execCommand,
    restore() {
      if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
      else delete navigator.clipboard;
      if (originalExecCommand) Object.defineProperty(document, 'execCommand', originalExecCommand);
      else delete document.execCommand;
    },
  };
}

beforeEach(() => {
  fetchGithubRepositoryMock.mockReset();
  createGithubClientMock.mockReset();
  createGithubClientMock.mockReturnValue({ fetchGithubRepository: fetchGithubRepositoryMock });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  if (Object.prototype.hasOwnProperty.call(navigator, 'clipboard')) delete navigator.clipboard;
});

describe('App', () => {
  it('renders the initial workspace with labeled repository controls', () => {
    renderApp();

    expect(screen.getByRole('heading', { name: /Release notes, without the busywork/i })).toBeInTheDocument();
    expect(screen.getByLabelText('GitHub repository')).toHaveAttribute('placeholder', 'owner / repository');
    expect(screen.getByRole('button', { name: /Analyze/i })).toBeEnabled();
    expect(screen.getByTestId('empty-preview')).toBeInTheDocument();
    expect(screen.getByText('Your release notes will appear here')).toBeInTheDocument();
    expect(document.getElementById('repository-help')).toHaveTextContent('Use owner/repository or a GitHub URL');
    expect(screen.getByLabelText('GitHub repository')).toHaveAttribute('aria-invalid', 'false');
    expect(fetchGithubRepositoryMock).not.toHaveBeenCalled();
  });

  it('validates repository input before invoking the GitHub boundary', () => {
    renderApp();
    submitRepository('not a repository');

    expect(screen.getByRole('alert')).toHaveTextContent('Enter owner/repository or a GitHub repository URL.');
    expect(screen.getByLabelText('GitHub repository')).toHaveAttribute('aria-invalid', 'true');
    expect(fetchGithubRepositoryMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('GitHub repository'), { target: { value: 'octo/hello-world' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('submits a valid GitHub URL from the keyboard and passes the parsed repository', async () => {
    fetchGithubRepositoryMock.mockResolvedValue(retrieved({ commits: [] }));
    renderApp();
    submitRepository('https://github.com/octo/hello-world.git', { keyboard: true });

    await waitFor(() => expect(screen.getByText('No release-note entries found')).toBeInTheDocument());
    expect(fetchGithubRepositoryMock).toHaveBeenCalledWith(
      expect.objectContaining({ owner: 'octo', name: 'hello-world', fullName: 'octo/hello-world' }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('renders repository metadata, commit counts, generated Markdown, and domain sections', async () => {
    fetchGithubRepositoryMock.mockResolvedValue(retrieved());
    renderApp();
    submitRepository('octo/hello-world');

    await waitFor(() => expect(screen.getByText('Analysis complete')).toBeInTheDocument());
    expect(screen.getAllByText('octo/hello-world').filter((node) => !node.closest('.print-sheet'))).toHaveLength(2);
    expect(screen.getByText('3 entries')).toBeInTheDocument();
    expect(screen.getByText('merge commits filtered').parentElement).toHaveTextContent('1');

    const markdown = screen.getByLabelText('Generated Markdown');
    expect(markdown).toHaveTextContent('# Release Notes');
    expect(markdown).toHaveTextContent('## Features');
    expect(markdown).toHaveTextContent('## Bug Fixes');
    expect(markdown).toHaveTextContent('## Performance');
    expect(markdown).toHaveTextContent('Add dashboard');
  });

  it('shows a truncated-history warning and preserves retrieval warnings in Markdown', async () => {
    fetchGithubRepositoryMock.mockResolvedValue(retrieved({
      metadata: {
        truncated: true,
        fetchedCount: 100,
        warnings: ['GitHub reported another commit page; retrieval stopped after the one-page limit.'],
      },
    }));
    renderApp();
    submitRepository('octo/hello-world');

    await waitFor(() => expect(screen.getByText('History is truncated')).toBeInTheDocument());
    expect(screen.getByText('History is truncated').parentElement).toHaveTextContent(/These notes cover the first 100 commits/);
    expect(screen.getAllByText('Partial').filter((node) => !node.closest('.print-sheet'))).toHaveLength(1);
    expect(screen.getByLabelText('Generated Markdown')).toHaveTextContent('## Warnings');
    expect(screen.getByRole('button', { name: 'Copy release notes as Markdown' })).toBeInTheDocument();
  });

  it('renders an explicit empty-history result', async () => {
    fetchGithubRepositoryMock.mockResolvedValue(retrieved({ commits: [] }));
    renderApp();
    submitRepository('octo/hello-world');

    await waitFor(() => expect(screen.getByText('No release-note entries found')).toBeInTheDocument());
    expect(screen.getByText('0 entries')).toBeInTheDocument();
    expect(screen.getByText(/We found 0 commits, but none matched/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Generated Markdown')).not.toBeInTheDocument();
  });

  it.each([
    ['not-found', 'Repository unavailable', 'could not find or expose'],
    ['unauthorized', 'GitHub authentication failed', 'Try again or check your connection'],
    ['forbidden', 'Access denied by GitHub', 'may be private or GitHub has denied access'],
    ['rate-limit', 'GitHub rate limit reached', 'Wait for the rate limit to reset'],
    ['too-many-requests', 'GitHub is throttling requests', 'Wait a moment and retry'],
    ['invalid-repository', 'Repository format is invalid', 'Use owner/repository or a github.com repository URL'],
    ['network', 'Connection interrupted', 'could not reach GitHub'],
    ['timeout', 'Request timed out', 'took too long to respond'],
    ['malformed-response', 'Unexpected GitHub response', 'could not understand'],
  ])('shows actionable messaging for the %s API error', async (category, title, detail) => {
    fetchGithubRepositoryMock.mockRejectedValue(githubError(category));
    renderApp();
    submitRepository('octo/hello-world');

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(title));
    expect(screen.getByRole('alert')).toHaveTextContent(detail);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('silently ignores cancellation errors and clears the loading state', async () => {
    fetchGithubRepositoryMock.mockRejectedValue(githubError('cancellation', 'The request was cancelled.'));
    renderApp();
    submitRepository('octo/hello-world');

    await waitFor(() => expect(screen.getByRole('button', { name: /Analyze/i })).toBeEnabled());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByTestId('empty-preview')).toBeInTheDocument();
  });

  it('retries a failed analysis and replaces the error with the successful result', async () => {
    fetchGithubRepositoryMock
      .mockRejectedValueOnce(githubError('network'))
      .mockResolvedValueOnce(retrieved({ commits: [] }));
    renderApp();
    submitRepository('octo/hello-world');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByText('No release-note entries found')).toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(fetchGithubRepositoryMock).toHaveBeenCalledTimes(2);
  });

  it('protects the UI from stale results when a newer analysis supersedes an older one', async () => {
    const first = deferred();
    const second = deferred();
    fetchGithubRepositoryMock
      .mockImplementationOnce((_parsed, options) => {
        first.options = options;
        return first.promise;
      })
      .mockImplementationOnce((_parsed, options) => {
        second.options = options;
        return second.promise;
      });
    const firstRepository = { ...repository, name: 'first', fullName: 'octo/first', url: 'https://github.com/octo/first' };
    const secondRepository = { ...repository, name: 'second', fullName: 'octo/second', url: 'https://github.com/octo/second' };
    renderApp();

    submitRepository('octo/first');
    submitRepository('octo/second');
    expect(first.options.signal.aborted).toBe(true);

    second.resolve(retrieved({ repository: secondRepository, commits: [] }));
    await waitFor(() => expect(screen.getAllByText('octo/second').filter((node) => !node.closest('.print-sheet'))).toHaveLength(2));
    first.resolve(retrieved({ repository: firstRepository, commits }));
    expect(screen.getAllByText('octo/second').filter((node) => !node.closest('.print-sheet'))).toHaveLength(2);
    expect(screen.queryByText('octo/first')).not.toBeInTheDocument();
    expect(screen.getByText('No release-note entries found')).toBeInTheDocument();
  });

  it('copies generated Markdown successfully', async () => {
    fetchGithubRepositoryMock.mockResolvedValue(retrieved());
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    renderApp();
    submitRepository('octo/hello-world');
    await waitFor(() => expect(screen.getByLabelText('Generated Markdown')).toBeInTheDocument());

    const markdown = screen.getByLabelText('Generated Markdown').textContent;
    fireEvent.click(screen.getByRole('button', { name: 'Copy release notes as Markdown' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copy release notes as Markdown' })).toHaveTextContent('Copied'));
    expect(writeText).toHaveBeenCalledWith(markdown);
  });

  it('reports clipboard failures without losing the generated result', async () => {
    fetchGithubRepositoryMock.mockResolvedValue(retrieved());
    const writeText = vi.fn().mockRejectedValue(new Error('clipboard unavailable'));
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    renderApp();
    submitRepository('octo/hello-world');
    await waitFor(() => expect(screen.getByLabelText('Generated Markdown')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Copy release notes as Markdown' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copy release notes as Markdown' })).toHaveTextContent('Copy failed'));
    expect(screen.getByLabelText('Generated Markdown')).toBeInTheDocument();
  });

  it('uses the clipboard fallback and removes its temporary textarea after success', async () => {
    fetchGithubRepositoryMock.mockResolvedValue(retrieved());
    const fallback = installClipboardFallback(() => true);
    try {
      renderApp();
      submitRepository('octo/hello-world');
      await waitFor(() => expect(screen.getByLabelText('Generated Markdown')).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: 'Copy release notes as Markdown' }));
      await waitFor(() => expect(screen.getByRole('button', { name: 'Copy release notes as Markdown' })).toHaveTextContent('Copied'));
      expect(fallback.execCommand).toHaveBeenCalledWith('copy');
      expect(document.body.querySelectorAll('textarea')).toHaveLength(0);
    } finally {
      fallback.restore();
    }
  });

  it('reports clipboard fallback failures and removes its temporary textarea', async () => {
    fetchGithubRepositoryMock.mockResolvedValue(retrieved());
    const fallback = installClipboardFallback(() => { throw new Error('copy unavailable'); });
    try {
      renderApp();
      submitRepository('octo/hello-world');
      await waitFor(() => expect(screen.getByLabelText('Generated Markdown')).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: 'Copy release notes as Markdown' }));
      await waitFor(() => expect(screen.getByRole('button', { name: 'Copy release notes as Markdown' })).toHaveTextContent('Copy failed'));
      expect(screen.getByLabelText('Generated Markdown')).toBeInTheDocument();
      expect(fallback.execCommand).toHaveBeenCalledWith('copy');
      expect(document.body.querySelectorAll('textarea')).toHaveLength(0);
    } finally {
      fallback.restore();
    }
  });

  it('downloads Markdown with a sanitized repository filename', async () => {
    const unsafeRepository = {
      ...repository,
      fullName: 'Octo/Release Notes<>',
      url: 'https://github.com/Octo/Release-Notes',
    };
    fetchGithubRepositoryMock.mockResolvedValue(retrieved({ repository: unsafeRepository, commits: [] }));
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: vi.fn(() => 'blob:commitcraft-test') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: vi.fn() });
    let clickedLink;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click() {
      clickedLink = { download: this.download, href: this.href };
    });
    renderApp();
    submitRepository('octo/hello-world');
    await waitFor(() => expect(screen.getByText('No release-note entries found')).toBeInTheDocument());

    // Empty history has no Markdown to download, so use a result with one release-note entry.
    fetchGithubRepositoryMock.mockResolvedValueOnce(retrieved({ repository: unsafeRepository }));
    fireEvent.click(screen.getByRole('button', { name: /New analysis/ }));
    submitRepository('octo/hello-world');
    await waitFor(() => expect(screen.getByLabelText('Generated Markdown')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));

    expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(clickedLink).toEqual({ download: 'Octo-Release-Notes-release-notes.md', href: 'blob:commitcraft-test' });
  });

  it('opens the browser print dialog and prepares linked commits for PDF export', async () => {
    const linkedCommits = commits.map((commit) => ({ ...commit, url: `https://github.com/octo/hello-world/commit/${commit.sha}` }));
    fetchGithubRepositoryMock.mockResolvedValue(retrieved({ commits: linkedCommits }));
    const originalPrint = window.print;
    const print = vi.fn();
    Object.defineProperty(window, 'print', { configurable: true, value: print });
    try {
      renderApp();
      submitRepository('octo/hello-world');
      await waitFor(() => expect(screen.getByLabelText('Generated Markdown')).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: 'Export release notes as PDF' }));

      expect(print).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('status')).toHaveTextContent('Choose “Save as PDF”');
      const printSheet = document.querySelector('.print-sheet');
      expect(printSheet).toHaveAttribute('hidden');
      expect(printSheet).toHaveTextContent('octo/hello-world');
      expect(printSheet.querySelector('a[href="https://github.com/octo/hello-world/commit/abcdef1"]')).toBeTruthy();
    } finally {
      Object.defineProperty(window, 'print', { configurable: true, value: originalPrint });
    }
  });

  it('reports a print failure without changing the generated Markdown', async () => {
    fetchGithubRepositoryMock.mockResolvedValue(retrieved());
    const originalPrint = window.print;
    const print = vi.fn(() => { throw new Error('print unavailable'); });
    Object.defineProperty(window, 'print', { configurable: true, value: print });
    try {
      renderApp();
      submitRepository('octo/hello-world');
      await waitFor(() => expect(screen.getByLabelText('Generated Markdown')).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: 'Export release notes as PDF' }));

      expect(screen.getByRole('alert')).toHaveTextContent('Could not open the PDF print dialog');
      expect(screen.getByLabelText('Generated Markdown')).toHaveTextContent('# Release Notes');
    } finally {
      Object.defineProperty(window, 'print', { configurable: true, value: originalPrint });
    }
  });

  it('resets to a new empty analysis', async () => {
    fetchGithubRepositoryMock.mockResolvedValue(retrieved());
    renderApp();
    submitRepository('octo/hello-world');
    await waitFor(() => expect(screen.getByLabelText('Generated Markdown')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /New analysis/ }));
    expect(screen.getByLabelText('GitHub repository')).toHaveValue('');
    expect(screen.getByText('Start with a repository')).toBeInTheDocument();
    expect(screen.getByTestId('empty-preview')).toBeInTheDocument();
    expect(screen.queryByLabelText('Generated Markdown')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /New analysis/ })).not.toBeInTheDocument();
  });
});
