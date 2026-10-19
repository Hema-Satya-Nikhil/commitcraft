import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { generateReleaseNotes, validateRepository } from './domain/index.js';
import { createGithubClient, GITHUB_ERROR_CATEGORIES } from './infrastructure/index.js';
import './App.css';

const INITIAL_INPUT = '';

function Icon({ name, size = 18 }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true };
  if (name === 'spark') return <svg {...common}><path d="m12 3 1.45 5.55L19 10l-5.55 1.45L12 17l-1.45-5.55L5 10l5.55-1.45L12 3Z" /><path d="m19 16 .6 2.4L22 19l-2.4.6L19 22l-.6-2.4L16 19l2.4-.6L19 16Z" /></svg>;
  if (name === 'github') return <svg {...common} fill="currentColor" stroke="none"><path d="M12 2.2a10 10 0 0 0-3.16 19.49c.5.1.68-.22.68-.48v-1.69c-2.78.61-3.37-1.18-3.37-1.18-.46-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.9 1.53 2.36 1.09 2.94.83.09-.65.35-1.09.64-1.34-2.22-.25-4.56-1.11-4.56-4.95 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02A9.6 9.6 0 0 1 12 8.15c.85 0 1.71.11 2.51.34 1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.85-2.35 4.69-4.59 4.94.36.31.68.92.68 1.86v2.76c0 .27.18.59.69.48A10 10 0 0 0 12 2.2Z" /></svg>;
  if (name === 'arrow') return <svg {...common}><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></svg>;
  if (name === 'copy') return <svg {...common}><rect x="9" y="9" width="10" height="10" rx="1.5" /><path d="M15 9V6.5A1.5 1.5 0 0 0 13.5 5h-7A1.5 1.5 0 0 0 5 6.5v7A1.5 1.5 0 0 0 6.5 15H9" /></svg>;
  if (name === 'download') return <svg {...common}><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></svg>;
  if (name === 'refresh') return <svg {...common}><path d="M20 11a8.1 8.1 0 0 0-14.9-3L3 11" /><path d="M3 5v6h6" /><path d="M4 13a8.1 8.1 0 0 0 14.9 3L21 13" /><path d="M21 19v-6h-6" /></svg>;
  if (name === 'check') return <svg {...common}><path d="m5 12 4.2 4.2L19 6.5" /></svg>;
  if (name === 'alert') return <svg {...common}><path d="M10.3 4.7 3 18a1.4 1.4 0 0 0 1.2 2h15.6A1.4 1.4 0 0 0 21 18L13.7 4.7a1.9 1.9 0 0 0-3.4 0Z" /><path d="M12 9v4" /><path d="M12 16.5h.01" /></svg>;
  if (name === 'clock') return <svg {...common}><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3 2" /></svg>;
  return <svg {...common}><circle cx="12" cy="12" r="8" /></svg>;
}

function formatDate(value) {
  if (!value) return 'Unknown date';
  try {
    return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
  } catch {
    return 'Unknown date';
  }
}

function friendlyError(error) {
  const category = error?.category;
  const copy = {
    [GITHUB_ERROR_CATEGORIES.NOT_FOUND]: ['Repository unavailable', 'GitHub could not find or expose this repository. Check the owner and repository name, then retry.'],
    [GITHUB_ERROR_CATEGORIES.UNAUTHORIZED]: ['GitHub authentication failed', 'GitHub rejected the request. Try again or check your connection.'],
    [GITHUB_ERROR_CATEGORIES.FORBIDDEN]: ['Access denied by GitHub', 'This repository may be private or GitHub has denied access.'],
    [GITHUB_ERROR_CATEGORIES.RATE_LIMIT]: ['GitHub rate limit reached', 'Wait for the rate limit to reset, then try the analysis again.'],
    [GITHUB_ERROR_CATEGORIES.TOO_MANY_REQUESTS]: ['GitHub is throttling requests', 'Wait a moment and retry the analysis.'],
    [GITHUB_ERROR_CATEGORIES.SERVER]: ['GitHub is unavailable', 'GitHub returned a server error. Please retry shortly.'],
    [GITHUB_ERROR_CATEGORIES.NETWORK]: ['Connection interrupted', 'CommitCraft could not reach GitHub. Check your network and retry.'],
    [GITHUB_ERROR_CATEGORIES.TIMEOUT]: ['Request timed out', 'GitHub took too long to respond. Retry when your connection is ready.'],
    [GITHUB_ERROR_CATEGORIES.MALFORMED_RESPONSE]: ['Unexpected GitHub response', 'GitHub returned data CommitCraft could not understand. Please retry.'],
    [GITHUB_ERROR_CATEGORIES.INVALID_REPOSITORY]: ['Repository format is invalid', 'Use owner/repository or a github.com repository URL.'],
  };
  const [title, message] = copy[category] ?? ['Analysis failed', error?.message || 'Something went wrong while reading the repository.'];
  return { title, message, category };
}

function sanitizeFilename(value) {
  const safe = String(value || 'release-notes').replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  return safe || 'release-notes';
}

function Stat({ value, label, accent = '' }) {
  return <div className={`stat ${accent}`}><strong>{value}</strong><span>{label}</span></div>;
}

function EmptyPreview() {
  return (
    <div className="preview-empty" data-testid="empty-preview">
      <div className="empty-icon"><Icon name="spark" size={21} /></div>
      <h2>Your release notes will appear here</h2>
      <p>Paste a public GitHub repository above and CommitCraft will turn its recent history into a focused, copy-ready changelog.</p>
      <div className="empty-hints"><span><Icon name="check" size={14} />Conventional commits grouped</span><span><Icon name="check" size={14} />Merge commits filtered</span><span><Icon name="check" size={14} />Markdown ready</span></div>
    </div>
  );
}

function LoadingPreview({ hasPreviousResult }) {
  return (
    <div className={`loading-preview ${hasPreviousResult ? 'loading-with-result' : ''}`} aria-busy="true">
      <div className="loading-line loading-line-wide" /><div className="loading-line" /><div className="loading-line loading-line-short" />
      <div className="loading-section"><div className="loading-line loading-line-title" /><div className="loading-line" /><div className="loading-line" /><div className="loading-line loading-line-short" /></div>
      <p><span className="spinner" />Fetching repository history…</p>
    </div>
  );
}

function ResultPreview({ result, loading, onCopy, onDownload, copyState }) {
  const { repository, notes, metadata } = result;
  const stats = notes.stats;
  const sectionCount = notes.sections.filter((section) => section.commits.length).length;
  const isEmpty = stats.includedCount === 0;
  return (
    <div className={`result-preview ${loading ? 'is-refreshing' : ''}`}>
      <div className="result-toolbar">
        <div className="result-heading"><span className="result-mark"><Icon name="check" size={17} /></span><div><p className="eyebrow">Analysis complete</p><h2>{repository.fullName}</h2></div></div>
        <div className="result-actions">
          <button className={`button button-quiet ${copyState ? `copy-${copyState}` : ''}`} type="button" onClick={onCopy} aria-label="Copy release notes as Markdown">
            <Icon name={copyState === 'success' ? 'check' : 'copy'} size={16} />{copyState === 'success' ? 'Copied' : copyState === 'error' ? 'Copy failed' : 'Copy Markdown'}
          </button>
          <button className="button button-quiet" type="button" onClick={onDownload}><Icon name="download" size={16} />Download</button>
        </div>
      </div>
      <div className="result-meta"><a href={repository.url} target="_blank" rel="noreferrer"><Icon name="github" size={15} />{repository.fullName}</a><span>·</span><span>{stats.includedCount} {stats.includedCount === 1 ? 'entry' : 'entries'}</span><span>·</span><span>{sectionCount} {sectionCount === 1 ? 'section' : 'sections'}</span></div>
      {metadata.truncated && <div className="notice notice-amber"><Icon name="alert" size={17} /><div><strong>History is truncated</strong><span>GitHub returned more commits than this analysis includes. These notes cover the first {metadata.fetchedCount ?? 'available'} commits.</span></div></div>}
      {isEmpty ? <div className="notes-empty"><div className="empty-icon small"><Icon name="spark" size={18} /></div><h3>No release-note entries found</h3><p>We found {stats.inputCount} {stats.inputCount === 1 ? 'commit' : 'commits'}, but none matched the release-note categories. Try another repository.</p></div> : <div className="notes-card"><pre aria-label="Generated Markdown">{notes.markdown}</pre></div>}
      {notes.warnings.length > 0 && <details className="warnings"><summary><Icon name="alert" size={15} />{notes.warnings.length} {notes.warnings.length === 1 ? 'note' : 'notes'} about this analysis</summary><ul>{notes.warnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}</ul></details>}
      {loading && <div className="refreshing-label"><span className="spinner" />Refreshing while keeping the last successful result</div>}
    </div>
  );
}

export default function App() {
  const [repositoryInput, setRepositoryInput] = useState(INITIAL_INPUT);
  const [inputError, setInputError] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [copyState, setCopyState] = useState('');
  const requestIdRef = useRef(0);
  const controllerRef = useRef(null);
  const lastRepositoryRef = useRef(null);
  const copyTimerRef = useRef(null);
  const client = useMemo(() => createGithubClient(), []);

  const reset = useCallback(() => {
    requestIdRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
    lastRepositoryRef.current = null;
    setRepositoryInput(INITIAL_INPUT);
    setInputError('');
    setResult(null);
    setError(null);
    setLoading(false);
    setCopyState('');
  }, []);

  const runAnalysis = useCallback(async (parsedRepository) => {
    const requestId = ++requestIdRef.current;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    lastRepositoryRef.current = parsedRepository;
    setLoading(true);
    setError(null);
    setCopyState('');
    try {
      const retrieved = await client.fetchGithubRepository(parsedRepository, { signal: controller.signal });
      if (requestId !== requestIdRef.current || controller.signal.aborted) return;
      const notes = generateReleaseNotes(retrieved.commits, { metadata: retrieved.metadata });
      setResult({ repository: retrieved.repository, notes, metadata: retrieved.metadata });
    } catch (caughtError) {
      if (requestId !== requestIdRef.current || controller.signal.aborted || caughtError?.category === GITHUB_ERROR_CATEGORIES.CANCELLATION) return;
      setError(friendlyError(caughtError));
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
        controllerRef.current = null;
      }
    }
  }, [client]);

  const submit = useCallback((event) => {
    event.preventDefault();
    const parsed = validateRepository(repositoryInput);
    if (!parsed.valid) {
      setInputError(parsed.error);
      return;
    }
    setInputError('');
    runAnalysis(parsed.repository);
  }, [repositoryInput, runAnalysis]);

  const retry = useCallback(() => {
    const parsed = validateRepository(repositoryInput);
    if (lastRepositoryRef.current) runAnalysis(lastRepositoryRef.current);
    else if (parsed.valid) runAnalysis(parsed.repository);
    else setInputError(parsed.error);
  }, [repositoryInput, runAnalysis]);

  const copyMarkdown = useCallback(async () => {
    if (!result?.notes?.markdown) return;
    const markdown = result.notes.markdown;
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(markdown);
      else {
        const area = document.createElement('textarea');
        area.value = markdown;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed'; area.style.opacity = '0';
        document.body.appendChild(area); area.select();
        const copied = document.execCommand('copy');
        area.remove();
        if (!copied) throw new Error('Copy command failed');
      }
      setCopyState('success');
    } catch {
      setCopyState('error');
    }
    window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = window.setTimeout(() => setCopyState(''), 2600);
  }, [result]);

  const downloadMarkdown = useCallback(() => {
    if (!result?.notes?.markdown) return;
    const markdown = result.notes.markdown;
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${sanitizeFilename(result.repository.fullName)}-release-notes.md`;
    document.body.appendChild(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }, [result]);

  useEffect(() => () => {
    requestIdRef.current += 1;
    controllerRef.current?.abort();
    window.clearTimeout(copyTimerRef.current);
  }, []);

  const errorDetails = error ? error : null;
  return (
    <div className="app-shell">
      <header className="topbar"><a className="brand" href="/" aria-label="CommitCraft home"><span className="brand-icon"><Icon name="spark" size={18} /></span><span>Commit<span>Craft</span></span></a><div className="topbar-status"><span className="status-dot" />GitHub analysis <span className="status-divider" /> <span className="status-muted">No token required</span></div></header>
      <main>
        <section className="hero"><div className="hero-kicker"><span className="kicker-line" />DEVELOPER TOOLKIT</div><h1>Release notes,<br /><em>without the busywork.</em></h1><p className="hero-copy">Turn a GitHub repository’s commit history into clear, structured Markdown your team can ship.</p>
          <form className="analysis-form" onSubmit={submit} noValidate>
            <label htmlFor="repository">GitHub repository</label>
            <div className={`input-row ${inputError ? 'has-error' : ''}`}><div className="input-prefix"><Icon name="github" size={18} /></div><input id="repository" name="repository" type="text" value={repositoryInput} onChange={(event) => { setRepositoryInput(event.target.value); if (inputError) setInputError(''); }} placeholder="owner / repository" autoComplete="off" spellCheck="false" aria-invalid={Boolean(inputError)} aria-describedby={inputError ? 'repository-error repository-help' : 'repository-help'} /><button className="analyze-button" type="submit" disabled={loading}>{loading ? <><span className="spinner" />Analyzing</> : <>Analyze <Icon name="arrow" size={17} /></>}</button></div>
            <div className="form-foot"><span id="repository-help">Use <code>owner/repository</code> or a GitHub URL</span>{inputError && <span className="field-error" id="repository-error" role="alert"><Icon name="alert" size={14} />{inputError}</span>}</div>
          </form>
        </section>

        {errorDetails && <div className={`error-banner ${result ? 'has-result' : ''}`} role="alert"><div className="error-icon"><Icon name="alert" size={19} /></div><div className="error-copy"><strong>{errorDetails.title}</strong><span>{errorDetails.message}</span>{errorDetails.category && <small>Reference: {errorDetails.category}</small>}</div><button className="button button-retry" type="button" onClick={retry}><Icon name="refresh" size={16} />Retry</button></div>}

       <section className="workspace" aria-live="polite"><div className="workspace-header"><div><p className="eyebrow">Workspace</p><h2>{result ? 'Your release notes' : 'Start with a repository'}</h2></div>{(result || repositoryInput || error) && <button className="new-analysis" type="button" onClick={reset}>New analysis</button>}</div>
          <div className="workspace-grid"><aside className="insight-panel"><div className="insight-top"><span className="panel-label">WHAT YOU’LL GET</span><span className="panel-number">01—03</span></div><div className="insight-list"><div className="insight-item"><span className="insight-icon indigo"><Icon name="spark" size={16} /></span><div><strong>Structured sections</strong><p>Features, fixes, performance, and more.</p></div></div><div className="insight-item"><span className="insight-icon cyan"><Icon name="check" size={16} /></span><div><strong>Clean commit history</strong><p>Duplicates and merge noise filtered out.</p></div></div><div className="insight-item"><span className="insight-icon amber"><Icon name="download" size={16} /></span><div><strong>Ready to ship</strong><p>Copy or download sanitized Markdown.</p></div></div></div><div className="insight-footer"><span className="mini-orbit" /><span>Deterministic output</span></div></aside><div className="preview-panel">{loading && !result ? <LoadingPreview hasPreviousResult={false} /> : result ? <ResultPreview result={result} loading={loading} onCopy={copyMarkdown} onDownload={downloadMarkdown} copyState={copyState} /> : <EmptyPreview />}</div></div>
        </section>

        {result && <div className="stats-row"><Stat value={result.notes.stats.includedCount} label="entries included" accent="stat-indigo" /><Stat value={result.notes.stats.filteredCount} label="merge commits filtered" accent="stat-cyan" /><Stat value={result.metadata.truncated ? 'Partial' : 'Complete'} label="history coverage" accent={result.metadata.truncated ? 'stat-amber' : 'stat-emerald'} />{result.metadata.rateLimit?.remaining != null && <Stat value={result.metadata.rateLimit.remaining} label="API calls remaining" accent="stat-emerald" />}</div>}
      </main>
      <footer className="footer"><span>CommitCraft <span className="footer-dot">·</span> Deterministic release notes from your commit history</span><span className="footer-right"><Icon name="clock" size={13} /> Bounded to the latest 100 commits</span></footer>
    </div>
  );
}
