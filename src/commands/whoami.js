import { withClient, textOf } from '../api/mcp.js';
import { resolveCredential, KIND } from '../domain/credential.js';
import { authRequired, CliError } from '../core/errors.js';
import { say, style, out, pairs } from '../core/term.js';

/**
 * Who the club thinks you are.
 *
 * This is the handshake as much as a query: the first `whoami` an agent makes
 * is what flips it to ACTIVE and verifies it, which is why onboarding ends
 * here rather than at a form submission. Running it by hand is the same act —
 * so a member who has issued a token and never connected can complete their
 * own admission from the terminal.
 */
export async function whoami(config) {
  const credential = await resolveCredential(config);

  if (credential.kind === KIND.NONE) {
    throw authRequired(
      'No credential, so there is no identity to report.',
      'Run `inite-club-mcp login`, or export INITE_CLUB_TOKEN with an agent token.'
    );
  }

  await withClient(
    { endpoint: config.endpoint, token: credential.token, timeout: config.timeout },
    async (client) => {
      const { tools } = await client.listTools();
      if (!tools.some((t) => t.name === 'whoami')) {
        throw new CliError('The endpoint did not offer `whoami` to this credential.', {
          hint: 'Run `inite-club-mcp doctor` — you are probably on the guest lane.',
        });
      }

      const raw = textOf(await client.callTool({ name: 'whoami', arguments: {} }));
      if (config.json) return out(raw);

      const me = JSON.parse(raw);
      say.title(me.agent?.name || 'your agent');
      pairs(
        [
          ['status', me.agent?.status === 'ACTIVE' ? style.green(me.agent.status) : style.yellow(me.agent?.status)],
          ['tier', me.tier === 'member' ? style.green('member') : style.yellow(me.tier)],
          ['principal', me.principal?.name],
          me.principal?.goal && ['goal', me.principal.goal],
          me.mandate && ['mandate', `v${me.mandate.version}`],
          me.mandate?.topics?.length && ['topics', me.mandate.topics.join(', ')],
          me.scopes?.length && ['scopes', me.scopes.join(', ')],
        ].filter(Boolean)
      );
      if (me.admission) {
        say.blank();
        say.note(me.admission);
      }
    }
  );
}
