import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { connect } from '../api/mcp.js';
import { resolveCredential } from '../domain/credential.js';
import { say, style } from '../core/term.js';

/**
 * The default command: a stdio server in front of the club's HTTP one.
 *
 * Clients that only speak stdio — and that is still most of them — cannot
 * reach a streamable-HTTP endpoint at all. This is the adapter: stdio in,
 * HTTP out, nothing in between. It deliberately does not interpret tools,
 * cache them, or filter them, because the club decides which tools a caller
 * gets from the credential, and a bridge with an opinion about that would
 * silently contradict the server.
 *
 * Everything it says goes to stderr. stdout is the protocol.
 */
export async function serve(config) {
  const credential = await resolveCredential(config);

  const upstream = await connect({
    endpoint: config.endpoint,
    token: credential.token,
    timeout: config.timeout,
  });

  say.ok(
    `connected to ${style.bold(config.endpoint)} ` +
      style.dim(credential.token ? `(${credential.source})` : '(guest lane — no credential)')
  );

  const server = new Server(
    { name: 'inite-club', version: '1.1.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: (await upstream.listTools()).tools,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) =>
    upstream.callTool(request.params)
  );

  // Closing the upstream is not politeness — an open socket keeps the process
  // alive, and a bridge that will not die is one the user has to hunt down in
  // a process list after their editor has already forgotten about it.
  let closing = false;
  const shutdown = async (code = 0) => {
    if (closing) return;
    closing = true;
    await upstream.close().catch(() => {});
    await server.close().catch(() => {});
    process.exit(code);
  };

  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));

  // The client going away is the ordinary way this ends. It closes the pipe
  // rather than signalling, so without this the bridge outlives every editor
  // session that ever started it.
  process.stdin.on('end', () => shutdown(0));
  process.stdin.on('close', () => shutdown(0));

  // An upstream that drops is not recoverable from in here: the credential
  // and the endpoint are fixed for the life of the process, so exiting lets
  // the client restart us, which is the one thing that can actually fix it.
  upstream.onerror = () => shutdown(1);

  await server.connect(new StdioServerTransport());
}
