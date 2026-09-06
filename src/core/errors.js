/**
 * Failure as a value, not a stack trace.
 *
 * Every command throws `CliError` with an exit code and, where there is one,
 * a `hint` naming the next move. A CLI that prints "Error: 401" and stops has
 * told the user what happened and nothing about what to do; the hint is the
 * part that matters, so it is a required consideration rather than an
 * afterthought appended by whoever remembered.
 */

/** Exit codes, distinct so a script can branch on why rather than whether. */
export const EXIT = {
  OK: 0,
  FAILED: 1,
  USAGE: 2,
  AUTH: 3,
  NETWORK: 4,
  DEGRADED: 5,
};

export class CliError extends Error {
  constructor(message, { code = EXIT.FAILED, hint = null, cause = null } = {}) {
    super(message);
    this.name = 'CliError';
    this.code = code;
    this.hint = hint;
    if (cause) this.cause = cause;
  }
}

export const usage = (m, hint) => new CliError(m, { code: EXIT.USAGE, hint });
export const authRequired = (m, hint) => new CliError(m, { code: EXIT.AUTH, hint });
export const network = (m, hint, cause) => new CliError(m, { code: EXIT.NETWORK, hint, cause });
