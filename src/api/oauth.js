import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';

import { request, requestOk } from './http.js';
import { CliError, EXIT, authRequired } from '../core/errors.js';

/**
 * OAuth 2.1 against inite-auth, from a terminal.
 *
 * The device grant (RFC 8628) rather than the authorization code grant,
 * because the code grant needs a loopback listener and a browser on the same
 * machine — which a CLI run over SSH, or inside a container, does not have.
 * The device grant only needs the user to be able to open a URL somewhere.
 *
 * The client registers itself (RFC 7591) instead of shipping a client id.
 * A public client's id in a published npm package is not a secret and pins
 * every installed copy to one registration that cannot be rotated without a
 * release; registering per machine costs one request and avoids both.
 */

export async function discover(issuer, { timeout } = {}) {
  const base = issuer.replace(/\/$/, '');
  // Both spellings exist in the wild: RFC 8414 puts the well-known first,
  // OIDC Discovery puts it last. Ask for the RFC form and fall back.
  const candidates = [
    `${base}/.well-known/oauth-authorization-server`,
    `${base}/.well-known/openid-configuration`,
  ];

  for (const url of candidates) {
    const res = await request(url, { timeout });
    if (res.ok && res.body && typeof res.body === 'object') return res.body;
  }

  throw new CliError(`No OAuth metadata at ${issuer}`, {
    code: EXIT.NETWORK,
    hint: 'Check --issuer, or the authorization server may be down.',
  });
}

export async function registerClient(metadata, { clientName, timeout }) {
  if (!metadata.registration_endpoint) {
    throw new CliError('This authorization server does not accept dynamic client registration', {
      hint: 'Set INITE_CLUB_CLIENT_ID to a client id registered out of band.',
    });
  }

  const res = await requestOk(metadata.registration_endpoint, {
    timeout,
    json: {
      client_name: clientName,
      application_type: 'native',
      grant_types: ['urn:ietf:params:oauth:grant-type:device_code', 'refresh_token'],
      response_types: ['code'],
      // A CLI cannot hold a secret: anyone who can run it can read it.
      token_endpoint_auth_method: 'none',
    },
  });

  return res.body.client_id;
}

export async function startDeviceFlow(metadata, { clientId, scope, resource, timeout }) {
  const endpoint = metadata.device_authorization_endpoint;
  if (!endpoint) {
    throw new CliError('This authorization server does not support the device flow', {
      hint: 'Issue an agent token at https://inite.club/en/club/mandate and export INITE_CLUB_TOKEN instead.',
    });
  }

  const res = await requestOk(endpoint, {
    timeout,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    method: 'POST',
    body: form({ client_id: clientId, scope, resource }),
  });

  return res.body;
}

/**
 * Poll for the token.
 *
 * The interval belongs to the server, not to us: `slow_down` means it is
 * telling us to back off, and a client that ignores it gets throttled or
 * blocked. `authorization_pending` is the normal state for as long as the
 * person is still typing the code, so it is not an error until the device
 * code expires.
 */
export async function pollForToken(metadata, { clientId, deviceCode, resource, interval = 5, expiresIn = 900, timeout, onTick }) {
  const deadline = Date.now() + expiresIn * 1000;
  let wait = Math.max(1, interval) * 1000;

  while (Date.now() < deadline) {
    await sleep(wait);
    onTick?.(Math.max(0, Math.round((deadline - Date.now()) / 1000)));

    const res = await request(metadata.token_endpoint, {
      timeout,
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: deviceCode,
        client_id: clientId,
        resource,
      }),
    });

    if (res.ok) return res.body;

    const error = res.body?.error;
    if (error === 'authorization_pending') continue;
    if (error === 'slow_down') {
      wait += 5000;
      continue;
    }
    if (error === 'access_denied') {
      throw authRequired('Authorization was declined.');
    }
    if (error === 'expired_token') break;

    throw new CliError(`Authorization failed: ${res.body?.error_description || error || res.status}`, {
      code: EXIT.AUTH,
    });
  }

  throw authRequired('The code expired before it was approved.', 'Run `inite-club-mcp login` again.');
}

export async function refresh(metadata, { clientId, refreshToken, resource, timeout }) {
  const res = await request(metadata.token_endpoint, {
    timeout,
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      resource,
    }),
  });

  // A refusal here is not fatal in itself — the caller falls back to asking
  // for a fresh login, which is the only cure for a revoked refresh token.
  return res.ok ? res.body : null;
}

/** Claims without verification: this is display, never a security decision. */
export function peekClaims(jwt) {
  try {
    const payload = jwt.split('.')[1];
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

const form = (obj) =>
  new URLSearchParams(Object.entries(obj).filter(([, v]) => v != null && v !== '')).toString();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Authorization code + PKCE, over a loopback redirect ────────────────────
//
// The device grant is advertised in this authorization server's metadata but
// its registration endpoint silently drops it: ask for
// `urn:ietf:params:oauth:grant-type:device_code` and the client comes back
// holding `refresh_token` alone, after which the device endpoint refuses it.
// So the loopback flow is what actually works today. It is the conventional
// native-client pattern anyway (RFC 8252) — the cost is that the browser has
// to be on this machine, which the device grant would have lifted.
//
// `supportsDeviceFlow` reads the registration response rather than the
// metadata, so the day the server honours the grant, `login` picks it up with
// no change here.

export const supportsDeviceFlow = (registration) =>
  Array.isArray(registration?.grant_types) &&
  registration.grant_types.includes('urn:ietf:params:oauth:grant-type:device_code');

/** Register, and hand back the whole response so the caller can see the grants. */
export async function registerFull(metadata, { clientName, redirectUris, timeout }) {
  if (!metadata.registration_endpoint) {
    throw new CliError('This authorization server does not accept dynamic client registration', {
      hint: 'Set INITE_CLUB_CLIENT_ID to a client id registered out of band.',
    });
  }

  const res = await requestOk(metadata.registration_endpoint, {
    timeout,
    json: {
      client_name: clientName,
      application_type: 'native',
      grant_types: [
        'authorization_code',
        'refresh_token',
        'urn:ietf:params:oauth:grant-type:device_code',
      ],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      redirect_uris: redirectUris,
    },
  });

  return res.body;
}

export function pkce() {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

/**
 * Listen on loopback for the redirect, and answer the browser with something
 * a person can read — a blank page after signing in reads as a failure even
 * when it worked.
 */
export function listenForCode({ port, path = '/callback', state, timeoutMs = 300_000 }) {
  let settle;
  const result = new Promise((resolve, reject) => {
    settle = { resolve, reject };
  });

  const server = createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    if (url.pathname !== path) {
      res.writeHead(404).end();
      return;
    }

    const error = url.searchParams.get('error');
    const code = url.searchParams.get('code');
    const returned = url.searchParams.get('state');

    const finish = (title, body, failure) => {
      res.writeHead(failure ? 400 : 200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(page(title, body));
      server.close();
      failure ? settle.reject(failure) : settle.resolve(code);
    };

    if (error) {
      return finish('Not signed in', escapeHtml(url.searchParams.get('error_description') || error), authRequired(`Authorization failed: ${error}`));
    }
    // The state check is the CSRF defence for this flow; a mismatch means the
    // response is not the one this process asked for, whoever sent it.
    if (returned !== state) {
      return finish('Not signed in', 'The response did not match this request.', new CliError('State mismatch — ignoring the response.', { code: EXIT.AUTH }));
    }
    if (!code) {
      return finish('Not signed in', 'No authorization code came back.', authRequired('No authorization code in the redirect.'));
    }

    finish('Signed in', 'You can close this tab and go back to the terminal.');
  });

  const timer = setTimeout(() => {
    server.close();
    settle.reject(authRequired('Timed out waiting for the browser.', 'Run `inite-club-mcp login` again.'));
  }, timeoutMs);
  timer.unref?.();

  const listening = new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });

  return { listening, code: result.finally(() => clearTimeout(timer)) };
}

export async function exchangeCode(metadata, { clientId, code, verifier, redirectUri, resource, timeout }) {
  const res = await requestOk(metadata.token_endpoint, {
    timeout,
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form({
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      code_verifier: verifier,
      redirect_uri: redirectUri,
      resource,
    }),
  });
  return res.body;
}

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const page = (title, body) => `<!doctype html>
<meta charset="utf-8"><title>${title} — INITE Club</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; min-height:100vh; display:grid; place-items:center;
         font:16px/1.6 ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif;
         background:#0B0A10; color:#EDEAE4; }
  main { max-width:34ch; padding:2rem; text-align:center; }
  h1 { font-size:1.25rem; font-weight:600; margin:0 0 .5rem; letter-spacing:-.01em; }
  p { margin:0; opacity:.7; }
</style>
<main><h1>${title}</h1><p>${body}</p></main>`;
