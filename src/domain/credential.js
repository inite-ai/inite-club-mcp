import { loadCredential, saveCredential } from '../core/store.js';
import { discover, refresh, peekClaims } from '../api/oauth.js';

/**
 * Which credential a command should use, and where it came from.
 *
 * Two kinds reach the same endpoint. An agent token — `ic_ag_`, issued on the
 * mandate page for an agent the member runs themselves — is opaque and does
 * not expire on a schedule. An OAuth access token comes from `login`, carries
 * an expiry, and can be renewed without the member doing anything.
 *
 * Reporting `source` matters more than it looks: when the CLI behaves
 * differently from the editor the member also has configured, the answer is
 * almost always that one of them is reading a credential the other is not.
 */
export const KIND = { OAUTH: 'oauth', AGENT: 'agent', NONE: 'none' };

const AGENT_PREFIX = 'ic_ag_';
/** Renew this far ahead of expiry, so a long call does not straddle it. */
const RENEW_MARGIN_MS = 120_000;

export async function resolveCredential(config, { allowRefresh = true } = {}) {
  if (config.token) {
    return {
      token: config.token,
      kind: kindOf(config.token),
      source: config.tokenSource || 'environment',
      expiresAt: null,
    };
  }

  const stored = await loadCredential(config.endpoint);
  if (!stored?.access_token) {
    return { token: null, kind: KIND.NONE, source: 'none', expiresAt: null };
  }

  const expiresAt = stored.expires_at ? new Date(stored.expires_at) : null;
  const stale = expiresAt && expiresAt.getTime() - Date.now() < RENEW_MARGIN_MS;

  if (stale && allowRefresh && stored.refresh_token) {
    const renewed = await renew(config, stored);
    if (renewed) return renewed;
  }

  return {
    token: stored.access_token,
    kind: kindOf(stored.access_token),
    source: 'stored',
    expiresAt,
    expired: Boolean(expiresAt && expiresAt.getTime() <= Date.now()),
    claims: peekClaims(stored.access_token),
  };
}

async function renew(config, stored) {
  try {
    const metadata = await discover(stored.issuer || config.issuer, { timeout: config.timeout });
    const grant = await refresh(metadata, {
      clientId: stored.client_id,
      refreshToken: stored.refresh_token,
      resource: config.endpoint,
      timeout: config.timeout,
    });
    if (!grant?.access_token) return null;

    const credential = {
      ...stored,
      access_token: grant.access_token,
      // Rotation is optional in OAuth 2.1 — keep the old one when the server
      // does not send a new one, or the next renewal has nothing to present.
      refresh_token: grant.refresh_token || stored.refresh_token,
      expires_at: expiryFrom(grant),
    };
    await saveCredential(config.endpoint, credential);

    return {
      token: credential.access_token,
      kind: KIND.OAUTH,
      source: 'stored (renewed)',
      expiresAt: credential.expires_at ? new Date(credential.expires_at) : null,
      claims: peekClaims(credential.access_token),
    };
  } catch {
    // A failed renewal is not a failed command: the token in hand may still
    // have minutes left on it, and if it does not the call itself will say so.
    return null;
  }
}

export const kindOf = (token) =>
  !token ? KIND.NONE : token.startsWith(AGENT_PREFIX) ? KIND.AGENT : KIND.OAUTH;

export const expiryFrom = (grant) =>
  grant.expires_in ? new Date(Date.now() + grant.expires_in * 1000).toISOString() : null;
