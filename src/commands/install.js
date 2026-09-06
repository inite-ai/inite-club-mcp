import { detectTargets, serverEntry, writeTarget, SERVER_NAME } from '../clients/targets.js';
import { loadCredential } from '../core/store.js';
import { resolveCredential, KIND } from '../domain/credential.js';
import { usage } from '../core/errors.js';
import { say, style, out, prompt } from '../core/term.js';

/**
 * Write the server into the MCP clients on this machine.
 *
 * The step this removes is the one where a member copies a token out of a web
 * page and pastes it into a JSON file whose location they have to look up,
 * per editor. That step is where the credential ends up in a clipboard, in a
 * shell history, or in the wrong file — and where an omitted token quietly
 * becomes the guest lane, which looks like a working install with most of the
 * product missing.
 *
 * Existing configs are read, merged and backed up, never overwritten: these
 * files hold the user's other servers.
 */
export async function install(config, flags) {
  const detected = await detectTargets();
  const token = await tokenFor(config, flags);

  const requested = typeof flags.client === 'string' ? flags.client.split(',').map((s) => s.trim()) : null;
  if (requested) {
    const known = new Set(detected.map((t) => t.id));
    const unknown = requested.filter((id) => !known.has(id));
    if (unknown.length) {
      throw usage(`Unknown client: ${unknown.join(', ')}`, `Known: ${[...known].join(', ')}`);
    }
  }

  let chosen = detected.filter((t) =>
    requested ? requested.includes(t.id) : flags.all ? true : t.installed
  );

  if (chosen.length === 0) {
    say.warn('No MCP client found on this machine.');
    say.note('Pass --all to write the config anyway, or --client <id> to name one.');
    say.note(`Known clients: ${detected.map((t) => t.id).join(', ')}`);
    return;
  }

  say.title(token ? 'Installing with your agent token' : 'Installing on the guest lane');
  if (!token) {
    say.note('No credential found, so the entry has no token: 3 tools of 15.');
    say.note('Run `inite-club-mcp login` then `join`, and re-run this to upgrade it.');
  }
  say.blank();

  // A config write is not something to do to five applications behind
  // someone's back, so on a terminal it is confirmed once, by name.
  if (!flags.yes && process.stdin.isTTY && !flags.dryRun) {
    for (const t of chosen) say.note(`${style.bold(t.label)}  ${style.dim(t.path)}`);
    say.blank();
    const answer = await prompt(`Write ${SERVER_NAME} into ${chosen.length} config${chosen.length === 1 ? '' : 's'}? [y/N]`, { default: 'n' });
    if (!/^y(es)?$/i.test(answer)) {
      say.warn('Nothing written.');
      return;
    }
    say.blank();
  }

  const entry = serverEntry({ endpoint: config.endpoint, token });
  const results = [];

  for (const target of chosen) {
    try {
      const result = await writeTarget(target, entry, { dryRun: flags.dryRun === true });
      results.push({ id: target.id, ok: true, ...result });
      const verb = flags.dryRun ? 'would write' : result.replaced ? 'updated' : 'added';
      say.ok(`${style.bold(target.label)} — ${verb} ${style.dim(result.path)}`);
      if (result.backedUp) say.note(`previous config kept at ${target.path}.inite-backup`);
    } catch (error) {
      results.push({ id: target.id, ok: false, error: error.message });
      say.fail(`${target.label} — ${error.message}`);
    }
  }

  say.blank();
  say.note('Restart the client for it to pick the server up.');
  say.note('Then `inite-club-mcp doctor` confirms which lane it landed on.');

  if (config.json) out(JSON.stringify({ entry, results }, null, 2));
}

/**
 * Which token goes into the config.
 *
 * An agent token is the right credential to leave in an editor: it belongs to
 * the agent rather than the person, it is revocable on its own, and it does
 * not expire out from under a long-running client the way an OAuth access
 * token would.
 */
async function tokenFor(config, flags) {
  if (typeof flags.token === 'string') return flags.token;
  // `--no-token` is an instruction, not an absent value: install the guest
  // lane deliberately rather than falling through to a stored credential.
  if (flags.token === false) return null;

  const stored = await loadCredential(config.endpoint);
  if (stored?.agent_token) return stored.agent_token;

  // Falling back to the sign-in token would put a short-lived credential in a
  // config file that nothing refreshes — it would work today and be a puzzle
  // next week. Better to install without one and say so.
  const credential = await resolveCredential(config, { allowRefresh: false });
  if (credential.kind === KIND.AGENT) return credential.token;

  return null;
}
