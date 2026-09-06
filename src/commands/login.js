import {
  discover,
  registerFull,
  supportsDeviceFlow,
  startDeviceFlow,
  pollForToken,
  pkce,
  listenForCode,
  exchangeCode,
  peekClaims,
} from '../api/oauth.js';
import { saveCredential } from '../core/store.js';
import { expiryFrom } from '../domain/credential.js';
import { DEFAULTS } from '../core/config.js';
import { CliError, EXIT, authRequired } from '../core/errors.js';
import { say, style, out, prompt } from '../core/term.js';

/**
 * Sign in from the terminal.
 *
 * Two flows, chosen by what the authorization server actually grants this
 * client rather than by what its metadata advertises. The device grant would
 * be the better one — it puts the approval in any browser, including one on
 * another machine, which is what an SSH session or a container needs. The
 * metadata lists it; the registration endpoint quietly withholds it. So the
 * loopback redirect (RFC 8252) is the working path, and the device branch
 * stays here and turns itself on the day registration honours the grant.
 *
 * The token is bound to the club's MCP endpoint as its resource, and the
 * club's REST routes check issuer and signature rather than audience — so one
 * sign-in covers both, and `join` needs no second credential.
 */
const CALLBACK_PORTS = [8976, 8977, 8978, 51789];
const CALLBACK_PATH = '/callback';

/** Where the redirect lands when the browser is somewhere else entirely. */
const handoffUri = (site) => `${site.replace(/\/$/, '')}/cli`;

/**
 * Is the browser plausibly on this machine?
 *
 * A loopback redirect assumes it is. Over SSH it is not, and the failure is
 * unhelpful — the browser opens on the person's laptop and the redirect goes
 * to a loopback address there, where nothing is listening, while the terminal
 * waits out its timeout. Guessing wrong is cheap in one direction only, so
 * this only ever *suggests* the paste flow; `--paste` and `--loopback` both
 * settle it outright.
 */
const looksRemote = () =>
  Boolean(process.env.SSH_CONNECTION || process.env.SSH_TTY || process.env.SSH_CLIENT);

export async function login(config, flags) {
  say.title('Signing in to INITE Club');
  say.note(`authorization server  ${config.issuer}`);
  say.note(`resource              ${config.endpoint}`);
  say.blank();

  const metadata = await discover(config.issuer, { timeout: config.timeout });
  const redirectUris = [
    ...CALLBACK_PORTS.map((p) => `http://127.0.0.1:${p}${CALLBACK_PATH}`),
    handoffUri(config.site),
  ];

  // An operator-provisioned client is the only kind that can hold the device
  // grant, and its grants are not discoverable from here — there is no
  // registration response to read. So it is tried, and a refusal falls back
  // rather than failing: the loopback flow works for either kind of client.
  const provisioned = process.env.INITE_CLUB_CLIENT_ID;
  const registration = provisioned
    ? { client_id: provisioned, operatorProvisioned: true }
    : await registerFull(metadata, {
        clientName: DEFAULTS.clientName,
        redirectUris,
        timeout: config.timeout,
      });

  const wantsPaste = flags.paste === true;
  const wantsLoopback = flags.loopback === true;

  const mayUseDevice =
    !wantsPaste &&
    !wantsLoopback &&
    (supportsDeviceFlow(registration) || registration.operatorProvisioned);

  let grant = null;
  if (mayUseDevice) {
    grant = await viaDeviceCode(config, metadata, registration, flags).catch((error) => {
      say.warn('This client cannot use the device flow — falling back to the browser.');
      say.note(error.message);
      say.blank();
      return null;
    });
  }

  if (!grant) {
    // Over SSH the loopback flow opens a browser on the wrong computer and
    // then waits for a redirect that will never arrive. Better to take the
    // route that works than to let it time out and call it a network problem.
    const paste = wantsPaste || (!wantsLoopback && looksRemote());
    if (paste && !wantsPaste) {
      say.note('This looks like a remote session, so the link is yours to open anywhere.');
      say.note('Pass --loopback if the browser is in fact on this machine.');
      say.blank();
    }
    grant = paste
      ? await viaPaste(config, metadata, registration, flags)
      : await viaLoopback(config, metadata, registration, flags);
  }

  await saveCredential(config.endpoint, {
    issuer: metadata.issuer || config.issuer,
    client_id: registration.client_id,
    access_token: grant.access_token,
    refresh_token: grant.refresh_token || null,
    expires_at: expiryFrom(grant),
  });

  const claims = peekClaims(grant.access_token);
  const who = claims?.email || claims?.sub || 'your account';

  say.blank();
  say.ok(`Signed in as ${style.bold(who)}`);
  say.note('Stored in ~/.config/inite-club/credentials.json, readable only by you.');
  if (!grant.refresh_token) {
    say.note('No refresh token was issued — you will be asked to sign in again when this expires.');
  }
  say.blank();
  say.note('Next: `inite-club-mcp join` to apply, or `inite-club-mcp install` to wire up your editor.');

  if (config.json) out(JSON.stringify({ ok: true, subject: who, expiresAt: expiryFrom(grant) }, null, 2));
}

/** The conventional native-client flow: a browser here, a listener here. */
async function viaLoopback(config, metadata, registration, flags) {
  const { verifier, challenge } = pkce();
  const state = pkce().verifier;

  const { port, code } = await bindFirstFree(state);
  const redirectUri = `http://127.0.0.1:${port}${CALLBACK_PATH}`;

  const authorize = authorizeUrl(config, metadata, registration, {
    redirectUri,
    state,
    challenge,
  });

  say.step('Open this and approve the request:');
  say.blank();
  say.note(style.bold(style.blue(authorize)));
  say.blank();

  if (flags.open !== false) await openInBrowser(authorize);
  say.step(`waiting on 127.0.0.1:${port}…`);

  return exchangeCode(metadata, {
    clientId: registration.client_id,
    code: await code,
    verifier,
    redirectUri,
    resource: config.endpoint,
    timeout: config.timeout,
  });
}

/**
 * Sign in with the browser somewhere else entirely.
 *
 * The redirect lands on a page at inite.club instead of on loopback, that
 * page shows one string, and the person carries it back here. Which is what
 * the device grant would do without the copying — but the device grant is
 * provisioned per operator, and this needs no grant the client cannot get.
 *
 * PKCE is what makes the copying safe: the verifier stays in this process, so
 * the string on that page cannot be exchanged by whoever else reads it. The
 * state travels alongside so a code from a different attempt is refused
 * rather than swapped in.
 */
async function viaPaste(config, metadata, registration, flags) {
  const { verifier, challenge } = pkce();
  const state = pkce().verifier;
  const redirectUri = handoffUri(config.site);

  const authorize = authorizeUrl(config, metadata, registration, {
    redirectUri,
    state,
    challenge,
  });

  say.step('Open this in any browser, on any device, and approve:');
  say.blank();
  say.note(style.bold(style.blue(authorize)));
  say.blank();
  say.note('It will show you one line to copy back here.');
  say.blank();

  const pasted = await prompt('Paste it');
  if (!pasted) {
    throw authRequired('Nothing pasted.', 'Run `inite-club-mcp login --paste` again.');
  }

  const { code, state: returned } = decodeHandoff(pasted);
  if (returned !== state) {
    throw new CliError('That code belongs to a different sign-in attempt.', {
      code: EXIT.AUTH,
      hint: 'Start again and use the link this run prints.',
    });
  }

  return exchangeCode(metadata, {
    clientId: registration.client_id,
    code,
    verifier,
    redirectUri,
    resource: config.endpoint,
    timeout: config.timeout,
  });
}

/** One shape of authorize URL, so the two flows cannot drift apart. */
function authorizeUrl(config, metadata, registration, { redirectUri, state, challenge }) {
  const url = new URL(metadata.authorization_endpoint);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: registration.client_id,
    redirect_uri: redirectUri,
    // offline_access is what actually produces a refresh token here; without
    // it the session ends silently in an hour and looks like a bug.
    scope: `${DEFAULTS.scope} offline_access`,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource: config.endpoint,
  }).toString();
  return url.toString();
}

/**
 * Undo what the page encoded: base64url of `code:state`.
 *
 * Split on the last colon rather than the first: the state is generated here
 * and is colon-free, so everything before that separator is the code, whatever
 * the authorization server chose to put in it.
 */
function decodeHandoff(pasted) {
  let decoded;
  try {
    decoded = Buffer.from(pasted.trim(), 'base64url').toString('utf8');
  } catch {
    decoded = '';
  }

  const cut = decoded.lastIndexOf(':');
  if (cut < 1) {
    throw new CliError('That does not look like the line from the page.', {
      code: EXIT.USAGE,
      hint: 'Copy the whole string, including any trailing characters.',
    });
  }

  return { code: decoded.slice(0, cut), state: decoded.slice(cut + 1) };
}

/**
 * Try each candidate port. Loopback redirect URIs have to be registered in
 * advance here, so the set is fixed and one of them has to be free.
 */
async function bindFirstFree(state) {
  const failures = [];
  for (const port of CALLBACK_PORTS) {
    const listener = listenForCode({ port, path: CALLBACK_PATH, state });
    try {
      await listener.listening;
      // Nothing awaits `code` on the failure path, and an unobserved rejection
      // takes the process down in Node — so it is claimed either way.
      listener.code.catch(() => {});
      return { port, code: listener.code };
    } catch (error) {
      failures.push(`${port}: ${error.code || error.message}`);
    }
  }
  throw new CliError(`No loopback port was free (${failures.join(', ')}).`, {
    code: EXIT.NETWORK,
    hint: `The flow needs one of ${CALLBACK_PORTS.join(', ')} on 127.0.0.1.`,
  });
}

/** Kept live for the day registration stops dropping the device grant. */
async function viaDeviceCode(config, metadata, registration, flags) {
  const device = await startDeviceFlow(metadata, {
    clientId: registration.client_id,
    scope: `${DEFAULTS.scope} offline_access`,
    resource: config.endpoint,
    timeout: config.timeout,
  });

  const url = device.verification_uri_complete || device.verification_uri;
  say.step('Open this and approve the request:');
  say.blank();
  say.note(style.bold(style.blue(url)));
  say.note(`code  ${style.bold(device.user_code)}`);
  say.blank();

  if (flags.open !== false) await openInBrowser(url);
  say.step('waiting for approval…');

  return pollForToken(metadata, {
    clientId: registration.client_id,
    deviceCode: device.device_code,
    resource: config.endpoint,
    interval: device.interval,
    expiresIn: device.expires_in,
    timeout: config.timeout,
  });
}

/**
 * Best effort, and silent when it fails: the URL is already on screen, so a
 * machine with no browser has lost nothing, and an error about `xdg-open`
 * would be noise on top of a working instruction.
 */
async function openInBrowser(url) {
  const { spawn } = await import('node:child_process');
  const command =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  try {
    spawn(command, [url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' }).unref();
  } catch {
    /* the link is on screen */
  }
}
