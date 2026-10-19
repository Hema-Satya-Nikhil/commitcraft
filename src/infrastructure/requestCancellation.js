/** Return true for the abort errors produced by native fetch implementations. */
export function isAbortError(error) {
  return error?.name === 'AbortError' || error?.code === 'ABORT_ERR';
}

/**
 * Compose a caller AbortSignal with an optional timeout signal.
 * The returned cleanup function must be called after fetch settles.
 */
export function createRequestCancellation({ signal = undefined, timeoutMs = undefined } = {}) {
  const controller = new AbortController();
  let timedOut = false;
  let timeoutId = null;

  const abortFromCaller = () => controller.abort(signal?.reason);
  if (signal?.aborted) {
    abortFromCaller();
  } else if (signal && typeof signal.addEventListener === 'function') {
    signal.addEventListener('abort', abortFromCaller, { once: true });
  }

  const hasTimeout = typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs >= 0;
  if (hasTimeout) {
    timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort(new DOMException('The request timed out.', 'TimeoutError'));
    }, timeoutMs);
  }

  return {
    signal: controller.signal,
    cancel() {
      controller.abort();
    },
    didTimeout: () => timedOut,
    wasCancelled: () => signal?.aborted === true,
    cleanup() {
      if (timeoutId !== null) clearTimeout(timeoutId);
      if (signal && typeof signal.removeEventListener === 'function') signal.removeEventListener('abort', abortFromCaller);
    },
  };
}
