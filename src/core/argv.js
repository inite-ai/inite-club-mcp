/**
 * Argument parsing, at the size this CLI actually needs.
 *
 * A dependency for this would be 40kB to turn `--url x` into `{url: 'x'}`.
 * Supported: `--flag value`, `--flag=value`, `--boolean`, `--no-boolean`,
 * short `-h`, and `--` to stop parsing. Anything not a flag is a positional.
 */
const camel = (s) => s.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());

export function parseArgv(argv) {
  const raw = Object.create(null);
  // Both spellings land in the same object, so a command may read `dryRun`
  // while the user types `--dry-run` and neither has to know about the other.
  const flags = new Proxy(raw, {
    get: (t, k) => t[k],
    set: (t, k, v) => {
      t[k] = v;
      const c = camel(String(k));
      if (c !== k) t[c] = v;
      return true;
    },
    has: (t, k) => k in t,
  });
  const positional = [];
  let i = 0;

  for (; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--') {
      positional.push(...argv.slice(i + 1));
      break;
    }

    if (arg.startsWith('--')) {
      const body = arg.slice(2);
      const eq = body.indexOf('=');

      if (eq !== -1) {
        flags[body.slice(0, eq)] = body.slice(eq + 1);
        continue;
      }
      if (body.startsWith('no-')) {
        flags[body.slice(3)] = false;
        continue;
      }

      // A flag takes the next token only when that token is not itself a
      // flag, so `--json --verbose` leaves both as booleans.
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('-')) {
        flags[body] = next;
        i++;
      } else {
        flags[body] = true;
      }
      continue;
    }

    if (arg.startsWith('-') && arg.length > 1) {
      for (const ch of arg.slice(1)) flags[ch] = true;
      continue;
    }

    positional.push(arg);
  }

  return { flags: raw, positional };
}
