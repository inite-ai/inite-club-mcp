/**
 * What the endpoint gives whom, mirrored from the server's own scope table.
 *
 * This exists so `doctor` can say "you are seeing four tools because your
 * principal is still on probation" instead of "you are seeing four tools".
 * A count on its own is not a diagnosis. Kept as data rather than prose so
 * the difference between expected and actual is computed, not asserted.
 */

/** Tool → the scope that has to be held for the server to register it. */
export const TOOL_SCOPES = {
  whoami: 'identity',
  ask_concierge: 'identity',
  list_members: 'registry:read',
  get_member: 'registry:read',
  list_events: 'registry:read',
  get_path: 'path:read',
  get_report: 'path:read',
  file_evidence: 'path:write',
  check_in: 'path:write',
  rsvp: 'events:write',
  update_mandate: 'mandate:write',
  list_experts: 'consult',
  ask_agent: 'consult',
  get_transcript: 'consult',
  claim_consultation: 'consult',
};

/** Everything an agent is issued by default. Withholds mandate:write. */
export const DEFAULT_SCOPES = [
  'identity',
  'registry:read',
  'path:read',
  'path:write',
  'events:write',
  'consult',
];

/** What an applicant's agent holds while the club is still deciding. */
export const PROBATION_SCOPES = ['identity', 'path:read', 'path:write', 'consult'];

/** No credential at all. Not a failure — a deliberate lane. */
export const GUEST_TOOLS = ['join', 'list_experts', 'ask_agent'];

export const LANE = {
  GUEST: 'guest',
  PROBATION: 'probation',
  MEMBER: 'member',
};

export const toolsForScopes = (scopes) =>
  Object.entries(TOOL_SCOPES)
    .filter(([, scope]) => scopes.includes(scope))
    .map(([tool]) => tool);

/**
 * Read the lane back off the tools the server actually listed.
 *
 * Inferred from the response rather than from the credential, because the
 * whole point is to catch the case where the two disagree.
 */
export function inferLane(toolNames) {
  const names = new Set(toolNames);
  if (names.has('join') && !names.has('whoami')) return LANE.GUEST;
  if (names.has('list_members')) return LANE.MEMBER;
  if (names.has('whoami')) return LANE.PROBATION;
  return LANE.GUEST;
}

export const laneSummary = {
  [LANE.GUEST]: {
    title: 'guest',
    detail: 'No credential was sent, so the endpoint served the open lane.',
    expected: GUEST_TOOLS,
  },
  [LANE.PROBATION]: {
    title: 'probation',
    detail: 'The credential is valid, but the principal has not been admitted yet.',
    expected: toolsForScopes(PROBATION_SCOPES),
  },
  [LANE.MEMBER]: {
    title: 'member',
    detail: 'Admitted. Scopes are the intersection of the token and the mandate.',
    expected: toolsForScopes(DEFAULT_SCOPES),
  },
};
