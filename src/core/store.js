import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { readFile, writeFile, mkdir, rm, chmod } from 'node:fs/promises';

/**
 * The credential file.
 *
 * A bearer token here acts for a member inside their club — so the file is
 * written 0600 and the directory 0700, and it is written whole rather than
 * merged in place, because a half-written credential is indistinguishable
 * from a tampered one. Keyed by endpoint: pointing the CLI at staging must
 * not overwrite the credential for production.
 */
const VERSION = 1;

export function configDir() {
  const xdg = process.env.XDG_CONFIG_HOME;
  return xdg ? join(xdg, 'inite-club') : join(homedir(), '.config', 'inite-club');
}

export const credentialPath = () => join(configDir(), 'credentials.json');

async function readAll() {
  try {
    const raw = await readFile(credentialPath(), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && parsed.version === VERSION ? parsed : { version: VERSION, accounts: {} };
  } catch {
    // Missing is the common case, and unreadable or corrupt is not worth
    // failing a command over — either way there is no credential to use.
    return { version: VERSION, accounts: {} };
  }
}

async function writeAll(data) {
  const path = credentialPath();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  // writeFile only applies the mode when it creates the file; an existing one
  // keeps whatever it had, which may be world-readable from an older version.
  await chmod(path, 0o600);
}

export async function loadCredential(endpoint) {
  const all = await readAll();
  return all.accounts[endpoint] ?? null;
}

export async function saveCredential(endpoint, credential) {
  const all = await readAll();
  all.accounts[endpoint] = { ...credential, savedAt: new Date().toISOString() };
  await writeAll(all);
}

export async function clearCredential(endpoint) {
  const all = await readAll();
  if (!(endpoint in all.accounts)) return false;
  delete all.accounts[endpoint];
  if (Object.keys(all.accounts).length === 0) {
    await rm(credentialPath(), { force: true });
  } else {
    await writeAll(all);
  }
  return true;
}
