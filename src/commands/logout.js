import { clearCredential, credentialPath } from '../core/store.js';
import { say, style } from '../core/term.js';

/**
 * Forget the credential on this machine.
 *
 * Local only, and said plainly rather than implied: the access token stays
 * valid at the authorization server until it expires, and any agent token
 * issued from this account keeps working wherever it was pasted. Revoking
 * those is a different act, in a different place, and pretending otherwise
 * would leave someone believing they had closed a door they had not.
 */
export async function logout(config) {
  const removed = await clearCredential(config.endpoint);

  if (removed) {
    say.ok(`Forgot the credential for ${style.bold(config.endpoint)}`);
    say.note(`Removed from ${credentialPath()}`);
  } else {
    say.warn(`No stored credential for ${config.endpoint}`);
  }

  say.blank();
  say.note('This machine only. Agent tokens you issued stay valid — revoke those at');
  say.note('https://inite.club/en/club/mandate.');
}
