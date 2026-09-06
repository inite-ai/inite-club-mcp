/**
 * Terminal output, with one rule held everywhere: chrome goes to stderr.
 *
 * The default command is an MCP server whose protocol channel is stdout. One
 * stray `console.log` in a helper corrupts the stream and the failure surfaces
 * as a parse error inside somebody's editor, a long way from the cause. So the
 * writer that everything narrates through cannot reach stdout at all — only
 * `out()` can, and only commands whose result is meant to be piped call it.
 */
const stderr = process.stderr;

const useColor = (() => {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR) return true;
  return stderr.isTTY === true;
})();

const wrap = (code) => (s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : String(s));

export const style = {
  bold: wrap('1'),
  dim: wrap('2'),
  red: wrap('31'),
  green: wrap('32'),
  yellow: wrap('33'),
  blue: wrap('34'),
  cyan: wrap('36'),
};

/** Narration. Always stderr, never the protocol channel. */
export const log = (...parts) => stderr.write(parts.join(' ') + '\n');

/** The result. The only writer that touches stdout. */
export const out = (text) => process.stdout.write(text.endsWith('\n') ? text : text + '\n');

export const say = {
  blank: () => stderr.write('\n'),
  title: (t) => log(style.bold(t)),
  step: (t) => log(style.cyan('›'), t),
  ok: (t) => log(style.green('✓'), t),
  warn: (t) => log(style.yellow('!'), t),
  fail: (t) => log(style.red('✗'), t),
  note: (t) => log(' ', style.dim(t)),
};

/** Aligned `label  value` pairs — the shape every status view here wants. */
export function pairs(rows) {
  const width = Math.max(0, ...rows.map(([k]) => k.length));
  for (const [k, v, tone] of rows) {
    const label = style.dim(k.padEnd(width));
    log(' ', label, tone ? style[tone](v) : v);
  }
}

/**
 * Ask on the TTY. Refuses when there is no terminal rather than hanging on a
 * stdin that will never produce a line — a CLI that blocks forever inside CI
 * is worse than one that exits saying it needed an answer.
 */
export async function prompt(question, { default: fallback = '' } = {}) {
  const { createInterface } = await import('node:readline/promises');
  const rl = createInterface({ input: process.stdin, output: stderr });

  try {
    const hint = fallback ? style.dim(` (${fallback})`) : '';

    // Answered, or stdin ended without one. `rl.question` neither resolves
    // nor rejects on EOF — it simply never settles, and the process then
    // exits when the event loop empties, halfway through whatever it was
    // doing. Racing the interface's own close event turns that into the
    // default it should have been. Reading a piped answer rather than
    // refusing outright is what makes `login --paste` scriptable.
    const answer = await Promise.race([
      rl.question(`  ${question}${hint}: `),
      new Promise((resolve) => rl.once('close', () => resolve(null))),
    ]);

    return answer == null ? fallback : answer.trim() || fallback;
  } catch {
    return fallback;
  } finally {
    rl.close();
  }
}
