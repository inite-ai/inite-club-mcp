#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { parseArgv } from '../src/core/argv.js';
import { resolveConfig } from '../src/core/config.js';
import { CliError, EXIT, usage } from '../src/core/errors.js';
import { say, style } from '../src/core/term.js';

import { serve } from '../src/commands/serve.js';
import { ask } from '../src/commands/ask.js';
import { login } from '../src/commands/login.js';
import { logout } from '../src/commands/logout.js';
import { join as joinClub } from '../src/commands/join.js';
import { install } from '../src/commands/install.js';
import { doctor } from '../src/commands/doctor.js';
import { whoami } from '../src/commands/whoami.js';
import { help } from '../src/commands/help.js';

/**
 * The entry point, and nothing else.
 *
 * Routing, and turning a thrown `CliError` into an exit code and a printed
 * hint. Every command owns its own behaviour; this file exists so that none
 * of them has to know how the process ends.
 */
const COMMANDS = {
  serve: (config) => serve(config),
  ask: (config, positional, flags) => ask(config, positional, flags),
  login: (config, _positional, flags) => login(config, flags),
  logout: (config) => logout(config),
  join: (config, _positional, flags) => joinClub(config, flags),
  install: (config, _positional, flags) => install(config, flags),
  doctor: (config) => doctor(config),
  whoami: (config) => whoami(config),
};

async function main() {
  const { flags, positional } = parseArgv(process.argv.slice(2));

  if (flags.v || flags.version) return say.note(await version());
  if (flags.h || flags.help) return help();

  const [name, ...rest] = positional;

  // No command is the config case: an MCP client spawns this with pipes, not
  // a terminal, and expects a server on stdout. A person at a prompt who
  // types the bare name almost certainly wants to know what it does instead.
  if (!name) {
    if (process.stdin.isTTY) {
      help();
      say.note(`Running the server: ${style.cyan('inite-club-mcp serve')}`);
      return;
    }
    return serve(resolveConfig(flags));
  }

  const command = COMMANDS[name];
  if (!command) {
    throw usage(`Unknown command: ${name}`, `Known: ${Object.keys(COMMANDS).join(', ')}. Try --help.`);
  }

  return command(resolveConfig(flags), rest, flags);
}

async function version() {
  const here = dirname(fileURLToPath(import.meta.url));
  const pkg = JSON.parse(await readFile(join(here, '..', 'package.json'), 'utf8'));
  return `${pkg.name} ${pkg.version}`;
}

main().then(
  () => {
    // `serve` never resolves; anything that does is finished, and the process
    // should not be held open by a socket some layer forgot to close.
    if (process.exitCode === undefined) process.exitCode = EXIT.OK;
  },
  (error) => {
    if (error instanceof CliError) {
      say.blank();
      say.fail(error.message);
      if (error.hint) say.note(error.hint);
      say.blank();
      process.exit(error.code);
    }

    say.blank();
    say.fail(String(error?.message || error));
    if (process.env.INITE_CLUB_DEBUG) console.error(error);
    else say.note('Set INITE_CLUB_DEBUG=1 for the stack trace.');
    say.blank();
    process.exit(EXIT.FAILED);
  }
);
