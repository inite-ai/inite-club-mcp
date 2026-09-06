import { requestOk, request } from './http.js';

/**
 * The club's REST surface — the half of the product that is not MCP.
 *
 * These are the same routes the dashboard calls, and they accept the same
 * bearer token the MCP endpoint does, because both verify it against
 * inite-auth. That is what makes a terminal onboarding possible at all: one
 * credential, obtained once, covers applying, issuing the agent's token and
 * then speaking as that agent.
 */
export const api = (site, path) => `${site.replace(/\/$/, '')}${path}`;

/** Submit the application. Everything in it is optional by design. */
export async function submitIntake(config, token, intake) {
  const res = await requestOk(api(config.site, '/api/onboarding'), {
    token,
    timeout: config.timeout,
    json: intake,
  });
  return res.body;
}

/**
 * The member's own view of their agent: status, mandate, tokens, last seen.
 * Never token values — those exist in exactly one response, at creation.
 */
export async function getAgent(config, token) {
  const res = await requestOk(api(config.site, '/api/agents'), {
    token,
    timeout: config.timeout,
  });
  return res.body;
}

/** Same, but a missing agent is an answer rather than an error to raise. */
export async function tryGetAgent(config, token) {
  const res = await request(api(config.site, '/api/agents'), {
    token,
    timeout: config.timeout,
  });
  return res.ok ? res.body : null;
}

/**
 * Issue an agent token. The raw value is in this response and nowhere else,
 * ever — the club stores only a hash, so it cannot act as anyone's agent.
 */
export async function issueToken(config, token, { label, runtime } = {}) {
  const res = await requestOk(api(config.site, '/api/agents/token'), {
    token,
    timeout: config.timeout,
    json: { label, runtime },
  });
  return res.body;
}
