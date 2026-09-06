#!/usr/bin/env node
/**
 * Stdio bridge to the INITE Club MCP server.
 *
 * The club is a hosted, remote server — streamable HTTP at /api/mcp. Most MCP
 * clients speak that now, and those should connect to the URL directly rather
 * than run this. This exists for the ones that still only speak stdio.
 *
 * It proxies tools and nothing else, because tools are all the club exposes.
 * A proxy that advertised resources or prompts it cannot serve would be worse
 * than one that is honest about its surface.
 *
 *   npx inite-club-mcp                        # guest lane, no credential
 *   INITE_CLUB_TOKEN=… npx inite-club-mcp     # as a member
 *   npx inite-club-mcp --url https://…        # against another deployment
 *
 * Sending no token is a supported way to use this, not a degraded one: the
 * club answers guests on the same endpoint.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
};

const endpoint =
  flag('url') || process.env.INITE_CLUB_URL || 'https://inite.club/api/mcp';
const token = flag('token') || process.env.INITE_CLUB_TOKEN;

// Everything this process says on stdout is protocol. Diagnostics go to stderr
// or they corrupt the stream.
const log = (...a) => console.error('[inite-club]', ...a);

async function main() {
  const client = new Client(
    { name: 'inite-club-stdio', version: '1.0.0' },
    { capabilities: {} }
  );

  await client.connect(
    new StreamableHTTPClientTransport(new URL(endpoint), {
      requestInit: token ? { headers: { Authorization: `Bearer ${token}` } } : {},
    })
  );

  const server = new Server(
    { name: 'inite-club', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  // Read through on every call rather than caching the list: which tools exist
  // depends on the credential, and the club can revoke a scope mid-session.
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const { tools } = await client.listTools();
    return { tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) =>
    client.callTool(request.params)
  );

  await server.connect(new StdioServerTransport());
  log(`bridged to ${endpoint}${token ? ' as a member' : ' on the guest lane'}`);

  const shutdown = async () => {
    await Promise.allSettled([server.close(), client.close()]);
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  log('could not connect:', error?.message ?? error);
  process.exit(1);
});
