import { readFileSync } from 'node:fs';

/**
 * The package's name and version, read from package.json — the one place
 * they are written.
 *
 * The MCP handshake reports a version in both directions (the bridge to the
 * editor, the CLI to the club), and a literal copied into each of those drifts
 * the moment a release forgets one: both said 1.1.0 while the package was
 * 1.3.0. A client or a log that names a version that is not running is worse
 * than one that names none. package.json always ships in the npm tarball, so
 * reading it at load time costs nothing and cannot be missing.
 */
const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

export const NAME = pkg.name;
export const VERSION = pkg.version;
