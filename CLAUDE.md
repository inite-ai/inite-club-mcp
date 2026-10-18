@AGENTS.md

## Claude Code notes

- `/contribute` — runs "From idea to PR" from AGENTS.md interactively, with
  stop points for red zones. `/spec-idea` — turns an idea into a filed issue,
  no code.
- Safe to run without asking: `npm install`, `npm run lint`,
  `node bin/cli.mjs --version|--help`, `node bin/cli.mjs ask --list --no-token`,
  `node bin/cli.mjs doctor --no-token`, `install --dry-run` with a temp `HOME`.
- Ask first: `ask "<question>"` (reaches a real member's agent and spends the
  guest quota), `login`, `join`, `install` without `--dry-run`, anything that
  writes to `~/.config/inite-club` or an editor config, `npm publish`.
- Keep personal permissions in `.claude/settings.local.json` (git-ignored).
