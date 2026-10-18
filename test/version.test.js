import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

/**
 * Both handshakes name the package version: the bridge to the editor, and the
 * CLI to the club. They used to carry their own literal, and both said 1.1.0
 * while package.json said 1.3.0. This runs the real bridge between a real MCP
 * client and a stand-in club on 127.0.0.1, so it reads the versions off the
 * wire rather than off the source. No network beyond loopback, no real home.
 */
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const cli = fileURLToPath(new URL('../bin/cli.mjs', import.meta.url));

/**
 * The smallest streamable-HTTP MCP server that completes a handshake, and
 * remembers who said hello. Written by hand rather than with the SDK's server
 * transport, whose Node adapter does not run on the `engines` floor (18.17).
 */
async function standInClub() {
  const hellos = [];
  const http = createServer(async (req, res) => {
    // No server-initiated stream: the client is told so and carries on.
    if (req.method !== 'POST') return res.writeHead(405).end();
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const message = JSON.parse(raw);
    if (message.id === undefined) return res.writeHead(202).end();
    const reply = { jsonrpc: '2.0', id: message.id };
    if (message.method === 'initialize') {
      hellos.push(message.params.clientInfo);
      reply.result = {
        protocolVersion: message.params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: 'stand-in-club', version: '0.0.0' },
      };
    } else if (message.method === 'tools/list') {
      reply.result = { tools: [] };
    } else {
      reply.error = { code: -32601, message: 'Method not found' };
    }
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(reply));
  });
  await new Promise((resolve) => http.listen(0, '127.0.0.1', resolve));
  const { port } = http.address();
  return { url: `http://127.0.0.1:${port}/api/mcp`, hellos, close: () => new Promise((r) => http.close(r)) };
}

test('the bridge and the CLI both report the package version in the handshake', async (t) => {
  const club = await standInClub();
  const home = mkdtempSync(join(tmpdir(), 'inite-club-test-'));
  const client = new Client({ name: 'version-test', version: '0.0.0' }, { capabilities: {} });
  t.after(async () => {
    await client.close().catch(() => {});
    await club.close();
    rmSync(home, { recursive: true, force: true });
  });

  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [cli, 'serve', '--url', club.url, '--no-token'],
      env: { PATH: process.env.PATH ?? '', HOME: home, XDG_CONFIG_HOME: home, NO_COLOR: '1' },
      stderr: 'pipe',
    })
  );

  assert.equal(client.getServerVersion()?.name, 'inite-club');
  assert.equal(client.getServerVersion()?.version, pkg.version, 'bridge → editor');
  assert.equal(club.hellos[0]?.version, pkg.version, 'CLI → club');
});
