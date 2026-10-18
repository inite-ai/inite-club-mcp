## What this changes, in plain words

<!-- Two or three sentences a non-engineer can follow: what someone running `inite-club-mcp` will notice. -->

## Zone

<!-- See "Zones" in AGENTS.md. -->
- [ ] green
- [ ] yellow — manual check run (output below, tokens removed):
- [ ] red — approved issue: #

CLI surface (commands, flags, env vars, exit codes, `--json` output) changed? no / yes — deprecation path:
Versions bumped (`package.json` + `server.json` ×2, together)? no / yes

## Gates

- [ ] `npm install`
- [ ] `npm run lint`
- [ ] `node bin/cli.mjs --version` and `--help`
- [ ] CI green on this PR

## Tests and checks

- [ ] tests added (`npm test`) — or why not:
- [ ] read-only manual check (`ask --list --no-token`, `doctor --no-token`, `install --dry-run`):
- [ ] README / `help.js` updated where behaviour changed

## AI-assisted

<!-- Disclosure, not judgement. -->
- [ ] no
- [ ] yes — agent:
