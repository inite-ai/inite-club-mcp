import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CliError, EXIT } from '../core/errors.js';

const CLIENT_INFO = { name: 'inite-club-mcp-cli', version: '1.1.0' };

/**
 * Connect to the club as an MCP client.
 *
 * The transport is streamable HTTP and the server is stateless, so a
 * connection is cheap and nothing has to be torn down carefully — but it does
 * have to be torn down, or the process keeps an open socket and never exits,
 * which in a CLI reads as a hang. Hence `withClient`.
 */
export async function connect({ endpoint, token, timeout }) {
  const client = new Client(CLIENT_INFO, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
    requestInit: {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    },
  });

  try {
    await client.connect(transport, { timeout });
  } catch (error) {
    throw explain(error, endpoint, Boolean(token));
  }

  return client;
}

/** Connect, run, always close — including when the body throws. */
export async function withClient(options, body) {
  const client = await connect(options);
  try {
    return await body(client);
  } finally {
    await client.close().catch(() => {});
  }
}

/**
 * Turn a transport failure into something with a next move in it.
 *
 * The SDK reports an HTTP failure by stringifying the whole exchange —
 * `Streamable HTTP error: Error POSTing to endpoint: {"jsonrpc":…}` — so the
 * status code the club actually returned is not in the text at all. What is
 * in there is the club's own JSON-RPC error object, and its code is precise:
 * -32001 is the authentication branch. Matching that, rather than the word
 * "401" that never appears, is the difference between a diagnosis and a dump.
 */
const AUTH_RPC_CODE = -32001;

function explain(error, endpoint, hadToken) {
  const message = String(error?.message || error);
  const rpc = embeddedRpcError(message);

  if (rpc?.code === AUTH_RPC_CODE || /\b401\b|\b403\b|unauthor/i.test(message)) {
    return new CliError(`The club rejected the credential: ${rpc?.message || 'unauthorized'}`, {
      code: EXIT.AUTH,
      hint: hadToken
        ? 'It may be revoked, expired, or minted for another service. Run `inite-club-mcp login`, or issue a new agent token at https://inite.club/en/club/mandate.'
        : 'Run `inite-club-mcp login`.',
      cause: error,
    });
  }

  if (/fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|timed out|socket hang up/i.test(message)) {
    return new CliError(`Could not reach ${endpoint}`, {
      code: EXIT.NETWORK,
      hint: 'Check the URL and your connection.',
      cause: error,
    });
  }

  return new CliError(`MCP connection failed: ${rpc?.message || message}`, { cause: error });
}

/** Dig the server's own error object out of the SDK's stringified report. */
function embeddedRpcError(message) {
  const start = message.indexOf('{');
  if (start === -1) return null;
  try {
    return JSON.parse(message.slice(start)).error ?? null;
  } catch {
    return null;
  }
}

/** Tool results are content blocks; callers almost always want the text. */
export function textOf(result) {
  if (!result?.content) return '';
  return result.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
}
