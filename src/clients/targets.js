import { homedir, platform } from 'node:os';
import { join, dirname } from 'node:path';
import { readFile, writeFile, mkdir, copyFile, access } from 'node:fs/promises';

/**
 * Where the MCP clients on this machine keep their server lists.
 *
 * Every one of them stores the same three facts — a command, its arguments,
 * and an environment — under a slightly different key in a slightly different
 * file. So the differences live here as data and the write is one function,
 * rather than five nearly identical writers drifting apart.
 */
const home = homedir();
const os = platform();

const appSupport = (...parts) =>
  os === 'darwin'
    ? join(home, 'Library', 'Application Support', ...parts)
    : os === 'win32'
      ? join(process.env.APPDATA || join(home, 'AppData', 'Roaming'), ...parts)
      : join(process.env.XDG_CONFIG_HOME || join(home, '.config'), ...parts);

export const TARGETS = [
  {
    id: 'claude-code',
    label: 'Claude Code',
    path: join(home, '.claude.json'),
    key: 'mcpServers',
    // The CLI owns this file and rewrites it; `claude mcp add` is the
    // supported way in, so prefer it and treat the file as the fallback.
    prefer: 'claude',
  },
  {
    id: 'claude-desktop',
    label: 'Claude Desktop',
    path: appSupport('Claude', 'claude_desktop_config.json'),
    key: 'mcpServers',
  },
  {
    id: 'cursor',
    label: 'Cursor',
    path: join(home, '.cursor', 'mcp.json'),
    key: 'mcpServers',
  },
  {
    id: 'windsurf',
    label: 'Windsurf',
    path: join(home, '.codeium', 'windsurf', 'mcp_config.json'),
    key: 'mcpServers',
  },
  {
    id: 'vscode',
    label: 'VS Code',
    path: appSupport('Code', 'User', 'mcp.json'),
    // VS Code is the one that does not call it mcpServers.
    key: 'servers',
  },
];

export const SERVER_NAME = 'inite-club';

const exists = (path) =>
  access(path).then(
    () => true,
    () => false
  );

/**
 * Which of them are actually on this machine.
 *
 * Presence is the config file, or the directory that would hold it — a client
 * installed but never opened has the directory and no file yet, and that is
 * still a target worth offering rather than one to hide.
 */
export async function detectTargets() {
  return Promise.all(
    TARGETS.map(async (target) => ({
      ...target,
      hasFile: await exists(target.path),
      installed: (await exists(target.path)) || (await exists(dirname(target.path))),
    }))
  );
}

/** The entry every client gets. Identical everywhere; only the key differs. */
export function serverEntry({ endpoint, token }) {
  const entry = {
    command: 'npx',
    args: ['-y', 'inite-club-mcp'],
  };
  const env = {};
  if (endpoint) env.INITE_CLUB_URL = endpoint;
  if (token) env.INITE_CLUB_TOKEN = token;
  if (Object.keys(env).length) entry.env = env;
  return entry;
}

/**
 * Merge the entry into a client's config.
 *
 * Read, merge, back up, write — never overwrite. These files hold the user's
 * other servers, and a CLI that clobbers them to add one of its own has done
 * something much worse than failing to install.
 */
export async function writeTarget(target, entry, { dryRun = false } = {}) {
  let config = {};
  let existed = false;

  if (await exists(target.path)) {
    existed = true;
    const raw = await readFile(target.path, 'utf8');
    if (raw.trim()) {
      try {
        config = JSON.parse(raw);
      } catch (error) {
        // Rewriting a file we could not parse would destroy whatever is in
        // it. Refuse, and let the caller report it as a skip.
        throw new Error(`${target.path} is not valid JSON — leaving it alone`);
      }
    }
  }

  const servers = config[target.key] && typeof config[target.key] === 'object' ? config[target.key] : {};
  const replaced = Object.prototype.hasOwnProperty.call(servers, SERVER_NAME);
  const next = { ...config, [target.key]: { ...servers, [SERVER_NAME]: entry } };

  if (dryRun) return { replaced, path: target.path, written: false };

  await mkdir(dirname(target.path), { recursive: true });
  if (existed) await copyFile(target.path, `${target.path}.inite-backup`).catch(() => {});
  await writeFile(target.path, JSON.stringify(next, null, 2) + '\n');

  return { replaced, path: target.path, written: true, backedUp: existed };
}
