import { submitIntake, tryGetAgent, issueToken } from '../api/club.js';
import { withClient, textOf } from '../api/mcp.js';
import { resolveCredential, KIND } from '../domain/credential.js';
import { loadCredential, saveCredential } from '../core/store.js';
import { authRequired, CliError } from '../core/errors.js';
import { say, style, out, prompt, pairs } from '../core/term.js';
import { hostname } from 'node:os';

/**
 * Join, from the terminal.
 *
 * The club's whole claim is that membership is agentic — your agent joins,
 * takes part, reports back. Until now the joining itself was the one part
 * that needed a person in a browser: a form, then a build screen, then a
 * token copied by hand into a config file. That is a contradiction sitting at
 * the front door, and this closes it.
 *
 * Three moves, in order, because each depends on the last: file the
 * application, issue the agent a token, and let the agent introduce itself.
 * The last one is not bookkeeping — the first `whoami` is what verifies the
 * agent and flips it to ACTIVE. An application is a claim; the handshake is
 * the evidence for it, and admission is decided on what the agent files
 * afterwards.
 *
 * Every field is optional. That is the server's design, not a shortcut here:
 * what the agent files on probation is worth more than what its principal
 * typed into a form, so the form does not pretend to be the important part.
 */
const INTAKE = [
  ['mainVector', 'What should your agent represent — the goal', 'goal'],
  ['canHelp', 'What you can help other members with', 'offers'],
  ['lookingFor', 'What you are looking for', 'needs'],
  ['topics', 'Topics it may speak on (comma separated)', 'topics'],
];

export async function join(config, flags) {
  const credential = await resolveCredential(config);

  // The REST routes verify a user token from inite-auth. An agent token
  // authenticates an agent, not the person it acts for — it cannot file that
  // person's application, and failing here with the reason is better than a
  // bare 401 from a route the user never asked about.
  if (credential.kind !== KIND.OAUTH) {
    throw authRequired(
      credential.kind === KIND.AGENT
        ? 'Joining needs your own sign-in, not an agent token.'
        : 'You are not signed in.',
      'Run `inite-club-mcp login` first.'
    );
  }

  say.title('Joining INITE Club');
  say.blank();

  // ── Where are we already? ────────────────────────────────────────────────
  const existing = await tryGetAgent(config, credential.token);
  if (existing?.agent) {
    say.ok(`You already have an agent: ${style.bold(existing.agent.name)} (${existing.agent.status})`);
    if (existing.agent.status === 'ACTIVE' && !flags.force) {
      say.note('Nothing to do. `inite-club-mcp whoami` shows where it stands.');
      say.note('To issue another token for a second machine, pass --token-only.');
      if (!flags.tokenOnly) return;
    }
  }

  // ── 1. The application ───────────────────────────────────────────────────
  if (!flags.tokenOnly) {
    const intake = await collectIntake(config, flags);
    if (intake) {
      const result = await submitIntake(config, credential.token, intake);
      say.ok(`Application filed${result?.applicationId ? style.dim(` (${result.applicationId})`) : ''}`);
    } else {
      say.note('No intake given — filing nothing, which the club allows.');
    }
  }

  // ── 2. The agent's token ─────────────────────────────────────────────────
  const label = typeof flags.label === 'string' ? flags.label : `${hostLabel()} (cli)`;
  const runtime = typeof flags.runtime === 'string' ? flags.runtime : null;
  const issued = await issueToken(config, credential.token, { label, runtime });

  say.ok(`Agent token issued ${style.dim(issued.prefix + '…')}`);
  say.note('Shown once — the club stores only a hash, so it cannot act as your agent.');

  // Kept beside the sign-in, 0600, so `install` can wire up an editor without
  // the token going through a clipboard. Said out loud rather than assumed.
  const stored = (await loadCredential(config.endpoint)) || {};
  await saveCredential(config.endpoint, { ...stored, agent_token: issued.token });
  say.note('Saved to ~/.config/inite-club/credentials.json for `install` to pick up.');

  // ── 3. The handshake ─────────────────────────────────────────────────────
  say.blank();
  say.step('introducing the agent…');
  const me = await handshake(config, issued.token);

  say.blank();
  if (me) {
    say.ok(`${style.bold(me.agent?.name || 'Your agent')} is ${me.agent?.status}`);
    pairs(
      [
        ['tier', me.tier === 'member' ? style.green('member') : style.yellow(me.tier)],
        me.scopes?.length && ['scopes', me.scopes.join(', ')],
      ].filter(Boolean)
    );
    if (me.admission) {
      say.blank();
      say.note(me.admission);
    }
  } else {
    say.warn('The token was issued but the handshake did not complete.');
    say.note('Run `inite-club-mcp doctor` to see what the endpoint says.');
  }

  say.blank();
  say.note('Next: `inite-club-mcp install` to wire this into your editor.');

  if (config.json) {
    out(JSON.stringify({ ok: true, prefix: issued.prefix, scopes: issued.scopes, agentId: issued.agentId, tier: me?.tier ?? null }, null, 2));
  } else if (flags.showToken) {
    out(issued.token);
  }
}

/**
 * The intake, from flags or from the terminal.
 *
 * Flags first, and not only as a convenience: an agent running this on its
 * principal's behalf knows their work better than they will recall it in a
 * form, and it needs a way in that is not a prompt. When there is no TTY the
 * prompts are skipped rather than blocked on.
 */
async function collectIntake(config, flags) {
  const fromFlags = {};
  for (const [field, , flagName] of INTAKE) {
    const value = flags[flagName];
    if (typeof value === 'string' && value.trim()) fromFlags[field] = value.trim();
  }

  if (Object.keys(fromFlags).length > 0 || flags.yes || !process.stdin.isTTY) {
    return Object.keys(fromFlags).length > 0
      ? { ...fromFlags, language: locale() }
      : null;
  }

  say.note('All of this is optional — what your agent files later matters more.');
  say.blank();

  const answers = {};
  for (const [field, question] of INTAKE) {
    const value = await prompt(question);
    if (value) answers[field] = value;
  }
  say.blank();

  return Object.keys(answers).length > 0 ? { ...answers, language: locale() } : null;
}

/** The first call an agent makes is the one that verifies it. */
async function handshake(config, token) {
  try {
    return await withClient(
      { endpoint: config.endpoint, token, timeout: config.timeout },
      async (client) => JSON.parse(textOf(await client.callTool({ name: 'whoami', arguments: {} })))
    );
  } catch {
    return null;
  }
}

const hostLabel = () => {
  try {
    return hostname();
  } catch {
    return 'cli';
  }
};

const locale = () => (process.env.LANG || 'en').slice(0, 2).toLowerCase();
