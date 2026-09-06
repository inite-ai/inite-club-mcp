import { CliError, EXIT, network } from '../core/errors.js';

/**
 * One fetch, with the three things every call here needs: a deadline, a body
 * parsed once, and a failure that names the endpoint. Node's fetch rejects
 * with a bare `TypeError: fetch failed` whose cause is two levels down, which
 * is useless in a terminal; this turns it into something actionable.
 */
export async function request(url, { timeout = 30000, token, json, ...init } = {}) {
  const headers = new Headers(init.headers || {});
  // A default, not an override: the MCP transport needs
  // `application/json, text/event-stream`, and clobbering what the caller
  // asked for is how a probe ends up diagnosing its own header as a 406.
  if (!headers.has('accept')) headers.set('accept', 'application/json');
  headers.set('user-agent', 'inite-club-mcp-cli');
  if (token) headers.set('authorization', `Bearer ${token}`);
  if (json !== undefined) {
    headers.set('content-type', 'application/json');
    init.body = JSON.stringify(json);
    init.method ||= 'POST';
  }

  let response;
  try {
    response = await fetch(url, { ...init, headers, signal: AbortSignal.timeout(timeout) });
  } catch (error) {
    const timedOut = error?.name === 'TimeoutError';
    throw network(
      timedOut ? `${url} did not respond within ${timeout}ms` : `Could not reach ${url}`,
      timedOut ? 'The service may be slow; retry, or raise --timeout.' : 'Check the URL and your connection.',
      error
    );
  }

  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  return { ok: response.ok, status: response.status, headers: response.headers, body };
}

/** As `request`, but a non-2xx is an error carrying the server's own words. */
export async function requestOk(url, options = {}) {
  const res = await request(url, options);
  if (res.ok) return res;

  const detail =
    (res.body && typeof res.body === 'object' && (res.body.error_description || res.body.error || res.body.message)) ||
    (typeof res.body === 'string' && res.body.slice(0, 200)) ||
    `HTTP ${res.status}`;

  throw new CliError(`${url} → ${detail}`, {
    code: res.status === 401 || res.status === 403 ? EXIT.AUTH : EXIT.FAILED,
    hint: res.status === 401 ? 'Run `inite-club-mcp login`.' : null,
  });
}
