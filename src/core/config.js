/**
 * Where settings come from, resolved in one place.
 *
 * Precedence is flag, then environment, then default — the order a user
 * expects, and the reason it lives here rather than being re-derived with a
 * slightly different fallback in each command.
 */
export const DEFAULTS = {
  endpoint: 'https://inite.club/api/mcp',
  site: 'https://inite.club',
  issuer: 'https://auth-api.inite.ai',
  /** Client name presented to the authorization server during registration. */
  clientName: 'INITE Club CLI',
  scope: 'openid profile email',
};

export function resolveConfig(flags = {}) {
  const endpoint =
    flags.url || process.env.INITE_CLUB_URL || DEFAULTS.endpoint;

  // The REST API and the MCP endpoint are the same deployment, so pointing
  // the CLI at a staging MCP endpoint has to move the REST calls with it.
  // Deriving the origin keeps one flag doing the whole job.
  const site = flags.site || process.env.INITE_CLUB_SITE || originOf(endpoint) || DEFAULTS.site;

  return {
    endpoint,
    site,
    issuer: flags.issuer || process.env.INITE_CLUB_ISSUER || DEFAULTS.issuer,
    // `--no-token` parses as false and must beat the environment: it is the
    // only way to ask for the guest lane on a machine that has a token set.
    token: flags.token === false ? null : flags.token || process.env.INITE_CLUB_TOKEN || null,
    tokenSource: flags.token ? 'flag' : process.env.INITE_CLUB_TOKEN ? 'INITE_CLUB_TOKEN' : null,
    json: flags.json === true,
    timeout: Number(flags.timeout || process.env.INITE_CLUB_TIMEOUT || 30000),
  };
}

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}
