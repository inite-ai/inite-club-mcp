# AGENTS.md — inite-club-mcp

Instructions for AI coding agents (Claude Code, Cursor, Codex, Copilot coding
agent, Gemini CLI, Windsurf…) working **on** this repository. Humans: the
[README](README.md) says what the package does; [CONTRIBUTING.md](CONTRIBUTING.md)
says how to propose a change.

## What this is

`@inite/club-mcp` — a small Node CLI (`inite-club-mcp`) for the
[INITE Club](https://inite.club): ask a member's agent a question with no
account (`ask`), sign in and join from a terminal (`login`, `join`), wire the
club into local MCP clients (`install`), diagnose a connection (`doctor`), and
— the default with no command — run as a **stdio→streamable-HTTP bridge** to
`https://inite.club/api/mcp` for editors that only speak stdio.

For whom: club members and their agents, and anyone who wants to try the guest
lane with `npx @inite/club-mcp ask "…"`. Tokens come from INITE Auth
(`https://auth-api.inite.ai`, the INITE Triad's identity service; contract:
<https://github.com/inite-ai/inite-triad/blob/main/docs/compatibility.md>).

**The MCP tools are not defined here.** The club server (a separate, private
deployment) decides which tools a caller sees from the credential. This repo
only forwards `tools/list` and `tools/call`, and mirrors the scope table in
`src/domain/lanes.js` so `doctor` can explain what it sees.

## Ground rules (non-negotiable)

1. **The bridge stays transparent.** `src/commands/serve.js` never filters,
   caches, renames, adds or rewrites tools or results. The club's tool names
   and input schemas are a public contract owned by the club server and
   advertised in the MCP Registry through `server.json`; a change to a tool is
   a change *there*, not here.
2. **stdout is the protocol.** In `serve` mode any stray byte on stdout breaks
   the client. Narrate only through `say` / `log` (stderr) in
   `src/core/term.js`; only `out()` writes stdout, and only for results meant
   to be piped. Never add `console.log`.
3. **Never print, log or send a secret.** Token values (`ic_ag_…`, OAuth access
   and refresh tokens) are never written to output, error messages, hints or
   issue/PR text. They go only to the configured endpoint/issuer as a bearer
   header. The credential file stays `0600` in a `0700` dir
   (`src/core/store.js`); `install` merges and backs up editor configs, never
   overwrites them.
4. **The CLI surface is a public contract.** Commands, flags, environment
   variables (`INITE_CLUB_*`, `NO_COLOR`), JSON output under `--json`, and exit
   codes (`EXIT` in `src/core/errors.js`) are scripted by people and by agents
   (`join --yes`). Never rename or remove one, or change its meaning, without a
   deprecation path (keep the old name working, warn on stderr, say so in the
   README) agreed with a maintainer.
5. **Package identity stays fixed.** `name` (`@inite/club-mcp`), `bin`
   (`inite-club-mcp`), `mcpName` (must equal `server.json` `name`,
   `club.inite/inite-club`). Changing any of them breaks `npx` lines and the
   registry entry.
6. **Versions move together.** `package.json` `version`, `server.json`
   `version` and `server.json` `packages[0].version` are all `1.3.0` today;
   bump them in one commit. Do not bump on a docs-only change. Never run
   `npm publish` or the registry publisher — releases are a maintainer step.
7. **No new runtime dependencies** without asking. The package has exactly
   one (`@modelcontextprotocol/sdk`); `src/core/argv.js` exists to avoid a
   second. Don't commit `package-lock.json` (it is git-ignored on purpose).
8. **Failures are values.** Throw `CliError` (or `usage`/`authRequired`/
   `network`) with a `hint` naming the next move; `bin/cli.mjs` turns it into
   an exit code. Don't `process.exit` from a command.
9. **Don't spend other people's quota in tests.** The guest lane allows a few
   questions a day; `ask "<question>"` reaches a real member's agent. Use
   `ask --list` (read-only) and `install --dry-run` for manual checks.

## Zones

| Path | What lives there | Zone |
|---|---|---|
| `README.md`, `AGENTS.md`, `CONTRIBUTING.md`, `.github/` templates | docs | green |
| `src/commands/help.js`, wording in `src/core/term.js`, `ask.js` / `doctor.js` / `whoami.js` presentation | what people read | green |
| `src/commands/{ask,doctor,whoami,join,logout}.js` behaviour | command logic | yellow |
| `src/clients/targets.js`, `src/commands/install.js` | writes into users' editor configs | yellow |
| `src/domain/lanes.js` | mirror of the club server's scope→tool table | yellow — must match the server; cite where you checked |
| `src/core/{argv,config,errors}.js`, `bin/cli.mjs` | flags, env, exit codes, routing (public CLI contract) | yellow; renames/removals red |
| `src/commands/serve.js`, `src/api/mcp.js` | the stdio bridge | red |
| `src/api/oauth.js`, `src/commands/login.js`, `src/domain/credential.js`, `src/core/store.js` | sign-in, token refresh, credential storage | red |
| `package.json` (`name`, `bin`, `mcpName`, `files`, deps), `server.json` | npm + MCP Registry identity | red |

Green: just do it. Yellow: needs a manual check recorded in the PR (there is
no test suite yet — see Testing). Red: open an issue with a spec first
(template "Product idea"); a maintainer approves the design before code.

## Setup

- **Codespaces / devcontainer:** "Code → Codespaces → Create" (or "Reopen in
  Container" locally). `.devcontainer/devcontainer.json` is a plain Node 20
  image; `npm install` runs on create. No services are needed.
- **Local:** Node `>=18.17` (`engines`; CI uses 20), then:

```bash
npm install
```

There is no build step: `bin/` and `src/` are plain ESM JavaScript and are
what npm ships (`files`).

## Commands

Exactly what CI runs ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)):

```bash
npm install                       # no lockfile is committed, so not `npm ci`
npm run lint                      # node --check bin/cli.mjs
node bin/cli.mjs --version        # loads every module: catches syntax/import errors in src/
node bin/cli.mjs --help
```

Done = all four green. Useful manual checks (network, no writes, no quota):

```bash
node bin/cli.mjs ask --list --no-token        # guest roster from the live club
node bin/cli.mjs doctor --no-token            # lane diagnosis
HOME=$(mktemp -d) node bin/cli.mjs install --dry-run --all --no-token --yes   # shows target paths, writes nothing
node --check src/commands/<file>.js           # one file
```

`node bin/cli.mjs serve` runs the bridge (it waits on stdin; a client
launches it). There is no test, format or typecheck script.

## Architecture map

```
bin/cli.mjs            entry: parseArgv → resolveConfig → COMMANDS[name]; CliError → exit code
src/core/argv.js       flag parser (--x v, --x=v, --no-x, -h, --)
src/core/config.js     flag > env > default for endpoint, site, issuer, token, timeout
src/core/errors.js     CliError, EXIT codes, usage/authRequired/network helpers
src/core/term.js       say/log (stderr), out (stdout), style, pairs, prompt
src/core/store.js      ~/.config/inite-club/credentials.json, keyed by endpoint, 0600
src/domain/credential.js  which token to use (flag/env/stored), refresh near expiry
src/domain/lanes.js    TOOL_SCOPES / GUEST_TOOLS / lane inference for doctor
src/api/http.js        fetch with deadline + readable failures
src/api/mcp.js         MCP client over streamable HTTP (connect, withClient, textOf)
src/api/oauth.js       discovery, dynamic registration, PKCE, loopback, device flow, refresh
src/api/club.js        club REST: /api/onboarding, /api/agents, /api/agents/token
src/clients/targets.js MCP client config locations (Claude Code/Desktop, Cursor, Windsurf, VS Code)
src/commands/*.js      one file per command; serve.js is the bridge
```

Request flow (bridge): MCP client → stdio → `serve.js` → `api/mcp.js` client →
`https://inite.club/api/mcp` with `Authorization: Bearer <token>` (or none =
guest lane) → result passed back unchanged.

**Add a command:** create `src/commands/<name>.js` exporting
`async function <name>(config, flags)`; register it in `COMMANDS` in
`bin/cli.mjs`; add a row to `COMMANDS` in `src/commands/help.js` and to the
README "Commands" table. Narrate with `say.*`, put the result through `out()`
only when `config.json` or when it is meant to be piped, and throw `CliError`
with a hint on failure.

**Add a flag / env var:** a global one (used by several commands) is read in
`src/core/config.js` (flag > env > default) so every command sees the same
value, and listed in `help.js` `OPTIONS`. A flag only one command uses is read
from `flags` inside that command, as `ask.js` does with `--to`, `--topic` and
`--list`, and listed in its own `help.js` section (see `LOGIN_OPTIONS`).
Document both in the README. (Today `ask --to/--topic` are not in `--help` or
the README — fix that if you touch `ask`.)

**Add or change an MCP tool:** not here — it lives in the club server. If the
server's scope table changes, update `src/domain/lanes.js` and the README
"Scopes" table to match.

**Add an MCP client target:** add an entry to `TARGETS` in
`src/clients/targets.js` (id, label, path, key); the writer is shared.

## From idea to PR

The loop you run **with** the human (Claude Code: `/contribute` runs it):

1. Restate the idea in plain words; ask at most 3 clarifying questions.
2. Find where it fits (Zones). Check for an existing issue:
   `gh issue list -R inite-ai/inite-club-mcp --search "<words>" --state all`.
   If it is really about which tools exist or what they do, it belongs to the
   club server — file an idea issue here and say so.
3. Write a short spec: problem, user-visible behaviour (commands/flags/
   output), change to the CLI surface, credential/config files touched, risks,
   out of scope. **Red zone → stop**, open an issue with the spec (template
   "Product idea"), and wait for a maintainer.
4. Plan small steps.
5. Implement. Keep each command's behaviour in its own file.
6. Run every command in "Commands"; for yellow changes also run the relevant
   manual check and paste its output (redacted) in the PR.
7. Update `README.md` and `help.js` wherever behaviour or flags changed.
8. Commit with conventional commits, as the history does:
   `fix(doctor): …`, `feat(login): …`, `docs: …`; `!` for a breaking change.
   There is no release automation — versions are bumped by hand (rule 6).
9. Open a PR with the template filled, explaining the change to a
   non-engineer too.

## Conventions

- ESM JavaScript, Node built-ins first, 2-space indent, single quotes,
  semicolons, trailing commas in multi-line literals. No formatter or linter is
  configured — match the surrounding file.
- Every module and non-trivial function opens with a JSDoc block that explains
  **why** (the constraint, the failure it prevents), not what. Keep that
  density; it is how this codebase records decisions.
- Errors: `CliError` with `code` from `EXIT` and a `hint`. Network calls go
  through `src/api/http.js` (`request`/`requestOk`) so they get a deadline and
  a readable failure.
- Output: stderr for narration, stdout only via `out()`; respect `NO_COLOR`.
- Branches: `feat/<slug>`, `fix/<slug>`, `docs/<slug>`. Small PRs — one
  behaviour per PR.

## Testing

There is no automated test suite yet. What protects the code today is
`node --check`, the `--version` load of every module, and manual checks
against the live endpoint (read-only ones listed under Commands).

Commands that call the club (`ask`, `whoami`, `join`) cannot be exercised
without the network and, for `ask "<question>"`, without spending a real
member's quota — so keep new logic in pure helpers you can test, and ask a
human before an end-to-end run.

If you add pure logic (e.g. in `argv.js`, `config.js`, `lanes.js`), add tests
with the built-in runner — `test/<module>.test.js` using `node:test` and
`node:assert/strict`, as the sibling repos
[inite-visibility](https://github.com/inite-ai/inite-visibility/tree/main/test)
do — add `"test": "node --test test/*.test.js"` to `package.json`, and a
`npm test` step to CI, in the same PR. Tests must not hit the network or the
real home directory (set `HOME`/`XDG_CONFIG_HOME` to a temp dir).

## When to ask a human

- anything in a red zone (bridge, sign-in, credential storage, package/registry identity);
- renaming/removing a command, flag, env var, exit code or `--json` field;
- adding a runtime dependency;
- a version bump or a release;
- the change needs the club server to change (new tool, scope, endpoint);
- you would need a real token, or to send real questions, to verify it;
- the README and the code disagree and you can't tell which is right.

## Help

Issues: <https://github.com/inite-ai/inite-club-mcp/issues> (templates: product
idea, bug). Contributing: [CONTRIBUTING.md](CONTRIBUTING.md). Security: do
**not** open a public issue — this repo has no `SECURITY.md` yet; ask a
maintainer for a private channel. Claude Code: `/contribute` runs the loop
above; `/spec-idea` only files an idea.
