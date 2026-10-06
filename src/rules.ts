import {
  CUTOFF_MS,
  type Candidate,
  type ContactPolicy,
  type Opening,
  type SalonState,
} from "./types";

/** Pure rules shared by workflow decisions, previews, and focused tests. */
export function exclusionReason(
  client: Candidate,
  opening: Opening,
  optedOut: string[],
): string | null {
  if (optedOut.includes(client.id)) return "Opted out";
  if (!client.consent) return "No contact consent";
  if (client.service !== opening.service) return "Different service";
  if (client.durationMinutes > opening.durationMinutes)
    return "Service will not fit";
  if (client.requiredStylist && client.requiredStylist !== opening.stylist)
    return "Different required stylist";
  if (
    client.availableFrom > opening.startAt ||
    client.availableUntil < opening.startAt + client.durationMinutes * 60_000
  )
    return "Unavailable for the appointment";
  return null;
}

export function eligibleCandidates(state: SalonState): Candidate[] {
  if (!state.opening) return [];
  const opening = state.opening;
  return state.candidates
    .filter((candidate) => !exclusionReason(candidate, opening, state.optedOut))
    .sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id));
}

export function outreachBlock(
  opening: Opening,
  policy: ContactPolicy,
  now: number,
): string | null {
  if (now >= opening.startAt - CUTOFF_MS)
    return "Outreach stopped: the 30-minute cutoff has arrived.";
  if (now < policy.contactStartAt || now >= policy.contactEndAt)
    return "Outside configured business hours. Staff must resume during contact hours.";
  return null;
}

export function offerDeadline(
  opening: Opening,
  policy: ContactPolicy,
  now: number,
): number {
  return Math.min(
    now + policy.offerSeconds * 1000,
    opening.startAt - CUTOFF_MS,
    policy.contactEndAt,
  );
}

export function activeOffer(state: SalonState) {
  return state.offers.find(
    (offer) => offer.status === "waiting" || offer.status === "sending",
  );
}

export function initialState(): SalonState {
  return {
    phase: "idle",
    message: "Create an opening to begin.",
    opening: null,
    policy: null,
    candidates: [],
    optedOut: [],
    offers: [],
    reservation: null,
    completedBookings: [],
    events: [],
    failNextMessage: false,
    revision: 0,
    recoveryVersion: 0,
  };
}
