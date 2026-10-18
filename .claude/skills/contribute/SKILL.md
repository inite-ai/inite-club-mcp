---
name: contribute
description: Use when someone says "I have an idea", "I want to add / change / fix something" in inite-club-mcp (the INITE Club CLI and stdio MCP bridge) — runs idea → spec → plan → change → gates → PR, stopping at red zones and explaining each step in plain words.
---

# /contribute — inite-club-mcp

The person may not be an engineer. Say what you are doing, and why, in plain
words at every step. `AGENTS.md` is the source of truth; re-read the section a
step names when unsure.

## 1. Understand

Restate the idea in two or three plain sentences. Ask at most 3 clarifying
questions — only ones whose answer changes what gets built.

## 2. Does it belong here?

This repo is the **CLI and the bridge**. The MCP tools themselves (what
`ask_agent`, `whoami`, `list_experts`… do, which scopes exist) live in the
club server, which is not in this repo. If the idea is "a new tool" or "a tool
should behave differently", say so plainly, offer `/spec-idea` to file it as
an idea here, and stop.

Search for an existing issue first:
`gh issue list -R inite-ai/inite-club-mcp --search "<key words>" --state all`.

## 3. Zone and spec

Find the zone in AGENTS.md "Zones" and tell the person which one and what it
means. Write a short spec: problem · what a user will see (commands, flags,
output) · change to the CLI surface · files on the user's machine touched ·
risks · out of scope.

- **Red** (`serve.js`/`api/mcp.js` bridge, `oauth.js`/`login.js`/
  `credential.js`/`store.js`, `package.json` identity, `server.json`):
  **stop.** Show the spec, get a yes, file it with the "Product idea"
  template (`/spec-idea` does this) and explain that a maintainer approves the
  design before code.
- Renaming or removing a command, flag, env var, exit code or `--json` field
  is red too (AGENTS.md ground rule 4).

## 4. Plan, then build

Branch from `main`: `git switch -c feat/<slug>` (or `fix/`, `docs/`). List the
small steps, then implement them following AGENTS.md "Architecture map" (how
to add a command / flag / client target) and "Conventions" (stderr only,
`CliError` with a hint, JSDoc explaining why). Update `README.md` and
`src/commands/help.js` when behaviour or flags change.

Never print a token, never `console.log`, never send a real question with
`ask` or run `login`/`join`/`install` for real without the person's explicit
yes.

## 5. Gates

Run, and show the person the result:

```bash
npm install
npm run lint
node bin/cli.mjs --version
node bin/cli.mjs --help
```

For yellow changes also run the matching read-only check from AGENTS.md
"Commands" (`ask --list --no-token`, `doctor --no-token`,
`install --dry-run` with a temp `HOME`) and keep its output (no tokens) for
the PR. If you added tests, `npm test` too.

## 6. Commit and PR

Conventional commits (`feat(ask): …`, `fix(doctor): …`, `docs: …`). Do not
bump versions unless the person and a maintainer asked for a release. Then:

```bash
git push -u origin HEAD
gh pr create --fill   # then edit the body to follow .github/PULL_REQUEST_TEMPLATE.md
```

Fill every section of the template: plain-language summary, zone, gates,
manual checks, AI-assisted disclosure. Give the person the PR link and say
what happens next: CI runs, a maintainer reviews.
