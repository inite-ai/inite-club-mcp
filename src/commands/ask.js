import { withClient, textOf } from '../api/mcp.js';
import { resolveCredential } from '../domain/credential.js';
import { usage, CliError } from '../core/errors.js';
import { say, out, style } from '../core/term.js';

/**
 * One question, one answer, no setup.
 *
 * The guest lane answers without a credential, so this runs on a machine that
 * has never seen the club before: `npx @inite/club-mcp ask "…"`. That is the
 * shortest honest demonstration of what the product is — a question reaching
 * someone whose calendar you could not get — and it needs no account to be
 * true. With a credential it is the same command on the member lane.
 *
 * The answer goes to stdout so it can be piped; everything else is stderr.
 */
const MIN_QUESTION = 10;

export async function ask(config, positional, flags) {
  const question = positional.join(' ').trim();
  const wantList = flags.list === true;

  if (!wantList) {
    if (!question) {
      throw usage('Nothing to ask.', 'inite-club-mcp ask "how do you price a seed round?"');
    }
    if (question.length < MIN_QUESTION) {
      throw usage(
        'That question is too short for the club to route.',
        'The endpoint wants at least ten characters — ask it in a full sentence.'
      );
    }
  }

  const topic = typeof flags.topic === 'string' ? flags.topic : null;
  const credential = await resolveCredential(config);

  await withClient(
    { endpoint: config.endpoint, token: credential.token, timeout: config.timeout },
    async (client) => {
      const { tools } = await client.listTools();
      if (!tools.some((t) => t.name === 'ask_agent')) {
        throw new CliError('This endpoint is not offering the consultation tools.', {
          hint: 'Run `inite-club-mcp doctor` to see which lane you are on and why.',
        });
      }

      const listed = parse(
        textOf(await client.callTool({ name: 'list_experts', arguments: topic ? { topic } : {} }))
      );
      const roster = listed?.experts ?? [];

      if (wantList) return showRoster(config, listed, roster);

      if (roster.length === 0) {
        throw new CliError(
          topic ? `No agent here covers "${topic}".` : 'No agent is taking questions right now.',
          { hint: listed?.note || 'Try `inite-club-mcp ask --list`.' }
        );
      }

      // Without `--to`, the first entry: the server has already ordered by
      // expert status and recency, so choosing for the user beats making them
      // read a roster they did not ask to see.
      const target = flags.to ? roster.find((e) => matches(e, String(flags.to))) : roster[0];
      if (!target) {
        throw new CliError(`No agent here matches "${flags.to}".`, {
          hint: 'Run `inite-club-mcp ask --list` to see the names.',
        });
      }

      // `topic` is required by the tool and has to be one the agent declared,
      // so an unspecified topic becomes their first — not a guess, just the
      // narrowest true statement available about what this question is about.
      const chosen = topic || target.topics?.[0];
      if (!chosen) {
        throw new CliError(`${target.name} has not declared any topics.`, {
          hint: 'Pass --topic explicitly, or pick another agent with --to.',
        });
      }

      say.step(`asking ${style.bold(target.name)} ${style.dim(`about ${chosen}`)}`);
      say.blank();

      const answer = textOf(
        await client.callTool({
          name: 'ask_agent',
          arguments: { memberId: target.memberId, topic: chosen, question },
        })
      );

      if (config.json) {
        out(JSON.stringify(
          { asked: target.name, memberId: target.memberId, topic: chosen, question, answer: parse(answer) ?? answer },
          null,
          2
        ));
      } else {
        out(answer);
      }
    }
  );
}

function showRoster(config, listed, roster) {
  if (config.json) return out(JSON.stringify(listed ?? { experts: [] }, null, 2));

  if (roster.length === 0) {
    say.warn(listed?.note || 'No agent is taking outside questions right now.');
    return;
  }

  say.title(`${roster.length} agent${roster.length === 1 ? '' : 's'} taking questions`);
  say.blank();
  const width = Math.max(...roster.map((e) => (e.name || '').length));
  for (const expert of roster) {
    const badge = expert.expert ? style.cyan(' ★') : '  ';
    const topics = (expert.topics || []).join(', ') || style.dim('no topics listed');
    say.note(`${(expert.name || expert.memberId).padEnd(width)}${badge}  ${topics}`);
  }
  say.blank();
  if (listed?.note) say.note(listed.note);
}

const matches = (expert, needle) => {
  const n = needle.toLowerCase();
  return [expert.name, expert.memberId].some((v) => typeof v === 'string' && v.toLowerCase().includes(n));
};

const parse = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};
