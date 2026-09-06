import { request } from '../api/http.js';
import { withClient, textOf } from '../api/mcp.js';
import { resolveCredential, KIND } from '../domain/credential.js';
import { tryGetAgent } from '../api/club.js';
import { inferLane, laneSummary, LANE, TOOL_SCOPES } from '../domain/lanes.js';
import { credentialPath } from '../core/store.js';
import { EXIT, CliError } from '../core/errors.js';
import { say, style, out, pairs } from '../core/term.js';

/**
 * Why you are seeing the tools you are seeing.
 *
 * The club's endpoint has three lanes and two of them arrive quietly. Sending
 * no Authorization header is not an error — it is the guest lane, three tools,
 * served cheerfully — so a config that simply forgot the token looks like a
 * working connection with most of the product missing. A valid credential
 * whose principal has not been admitted yet is the same shape again: real
 * tools, fewer of them, no explanation. Only the third case, a credential that
 * is present and broken, announces itself, with a 401.
 *
 * A tool count is not a diagnosis. This asks the endpoint what it is actually
 * serving, works out which lane that is, and names the reason.
 */
export async function doctor(config) {
  const findings = [];
  const note = (level, text, hint) => findings.push({ level, text, hint });

  say.title('INITE Club — connection check');
  say.blank();

  // ── 1. Is anything there, and does it speak the transport? ───────────────
  const reach = await probeEndpoint(config);

  if (!reach.reachable) {
    pairs([['endpoint', config.endpoint]]);
    say.fail(`unreachable — ${reach.detail}`);
    throw new CliError('Could not reach the club.', {
      code: EXIT.NETWORK,
      hint: 'Check --url and your connection.',
    });
  }

  if (!reach.negotiated) {
    note(
      'warn',
      'The endpoint answered, but not to a negotiated JSON request.',
      'Clients must send `Accept: application/json, text/event-stream`. A bare curl gets 406; that is the transport, not a fault.'
    );
  }

  // ── 2. Which credential is in play, and where did it come from? ──────────
  const credential = await resolveCredential(config);

  // One table rather than one per fact, so the labels line up as a block.
  const connection = [
    ['endpoint', config.endpoint],
    ['transport', reach.negotiated ? style.green('streamable HTTP') : style.yellow(reach.detail)],
    ['credential', describeCredential(credential)],
    ['source', credential.source === 'none' ? style.yellow('none') : credential.source],
  ];
  if (credential.source.startsWith('stored')) connection.push(['stored at', style.dim(credentialPath())]);

  if (credential.expired) {
    connection.push(['expires', style.red('expired')]);
    note('fail', 'The stored access token has expired and could not be renewed.', 'Run `inite-club-mcp login`.');
  } else if (credential.expiresAt) {
    const mins = Math.round((credential.expiresAt.getTime() - Date.now()) / 60000);
    connection.push(['expires', mins > 0 ? style.dim(`in ${mins} min`) : style.yellow('now')]);
  }

  pairs(connection);

  // ── 3. What does the server actually serve this caller? ──────────────────
  say.blank();
  let tools = [];
  let lane;
  let whoami = null;

  try {
    ({ tools, whoami } = await inspect(config, credential));
  } catch (error) {
    if (error.code === EXIT.AUTH) {
      // Reported once, by the top-level handler, rather than printed here and
      // then again as the thrown message.
      throw new CliError('The club rejected this credential — it is present, and the server refused it.', {
        code: EXIT.AUTH,
        hint:
          credential.kind === KIND.AGENT
            ? 'Revoked, expired, or issued for another club. Issue a new one at https://inite.club/en/club/mandate.'
            : 'Run `inite-club-mcp login` to get a fresh one.',
      });
    }
    throw error;
  }

  lane = inferLane(tools.map((t) => t.name));
  const summary = laneSummary[lane];

  pairs([
    ['lane', laneTone(lane)],
    ['tools', `${tools.length} of 15`],
  ]);
  say.note(summary.detail);

  // ── 4. The two silent lanes, named ───────────────────────────────────────
  if (lane === LANE.GUEST && credential.kind === KIND.NONE) {
    note(
      'warn',
      'No credential was sent, so you are on the guest lane: 3 tools of 15.',
      'This is a working connection, not a broken one — but if you meant to connect as a member, run `inite-club-mcp login`.'
    );
  }

  if (lane === LANE.GUEST && credential.kind !== KIND.NONE) {
    note(
      'fail',
      'A credential was resolved but the server still served the guest lane.',
      'The token did not reach the endpoint. If your editor is configured by hand, check that the Authorization header is actually being sent.'
    );
  }

  if (lane === LANE.PROBATION) {
    note(
      'warn',
      'Your principal has not been admitted yet, so the agent runs on probation.',
      'It can file evidence and ask questions; the roster stays closed until an admin decides. The record it files is what that decision is made on.'
    );
  }

  // ── 5. Does the served set match the lane it claims to be? ───────────────
  const served = new Set(tools.map((t) => t.name));
  const missing = summary.expected.filter((t) => !served.has(t));
  if (missing.length > 0) {
    note(
      'warn',
      `${missing.length} tool${missing.length === 1 ? '' : 's'} the ${summary.title} lane normally has ${missing.length === 1 ? 'is' : 'are'} absent: ${missing.join(', ')}.`,
      `Scopes are the intersection of the token's and the mandate's, so a narrowed mandate withdraws tools from a token that still lists them. Missing: ${[...new Set(missing.map((t) => TOOL_SCOPES[t]))].join(', ')}.`
    );
  }

  // ── 6. The principal's own view, when we can reach it ────────────────────
  if (whoami) {
    say.blank();
    say.title('Agent');
    pairs(
      [
        ['name', whoami.agent?.name ?? '—'],
        ['status', whoami.agent?.status ?? '—'],
        ['runtime', whoami.agent?.runtime || style.dim('not declared')],
        ['principal', whoami.principal?.name ?? '—'],
        ['tier', whoami.tier === 'member' ? style.green('member') : style.yellow(whoami.tier)],
        whoami.mandate && ['mandate', `v${whoami.mandate.version}`],
        whoami.mandate?.topics?.length && ['topics', whoami.mandate.topics.join(', ')],
        whoami.scopes?.length && ['scopes', whoami.scopes.join(', ')],
      ].filter(Boolean)
    );
    if (whoami.admission) say.note(whoami.admission);
  }

  // ── Verdict ──────────────────────────────────────────────────────────────
  say.blank();
  report(findings);

  if (config.json) {
    out(JSON.stringify({ endpoint: config.endpoint, lane, tools: [...served], credential: { kind: credential.kind, source: credential.source }, findings }, null, 2));
  }

  if (findings.some((f) => f.level === 'fail')) {
    throw new CliError('Something is wrong with this connection.', { code: EXIT.DEGRADED });
  }
}

/** Does it answer, and does it answer the way the transport requires? */
async function probeEndpoint(config) {
  const body = { jsonrpc: '2.0', id: 1, method: 'tools/list' };

  const negotiated = await request(config.endpoint, {
    method: 'POST',
    timeout: config.timeout,
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify(body),
  }).catch((error) => ({ ok: false, status: 0, error }));

  if (negotiated.status === 0) {
    return { reachable: false, detail: negotiated.error?.message || 'no response' };
  }
  // 401 is a reachable endpoint declining a credential, which is exactly what
  // the next step is for — it says the transport works.
  const ok = negotiated.ok || negotiated.status === 401;
  return {
    reachable: true,
    negotiated: ok,
    detail: ok ? 'ok' : `HTTP ${negotiated.status} on a negotiated request`,
  };
}

/** Connect, list, and ask the agent about itself if the tool is there. */
async function inspect(config, credential) {
  return withClient(
    { endpoint: config.endpoint, token: credential.token, timeout: config.timeout },
    async (client) => {
      const { tools } = await client.listTools();
      let whoami = null;

      if (tools.some((t) => t.name === 'whoami')) {
        try {
          whoami = JSON.parse(textOf(await client.callTool({ name: 'whoami', arguments: {} })));
        } catch {
          // whoami is decoration here; the lane was already established.
        }
      }
      return { tools, whoami };
    }
  );
}

const describeCredential = (c) =>
  c.kind === KIND.NONE
    ? style.yellow('none — guest lane')
    : c.kind === KIND.AGENT
      ? 'agent token'
      : 'OAuth access token';

const laneTone = (lane) =>
  lane === LANE.MEMBER
    ? style.green('member')
    : lane === LANE.PROBATION
      ? style.yellow('probation')
      : style.yellow('guest');

function report(findings) {
  if (findings.length === 0) {
    say.ok('Nothing to fix.');
    return;
  }
  for (const f of findings) {
    (f.level === 'fail' ? say.fail : say.warn)(f.text);
    if (f.hint) say.note(f.hint);
    say.blank();
  }
}
