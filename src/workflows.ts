import {
  condition,
  defineQuery,
  defineSignal,
  defineUpdate,
  proxyActivities,
  patched,
  setHandler,
} from "@temporalio/workflow";
import type * as activities from "./activities";
import {
  activeOffer,
  eligibleCandidates,
  initialState,
  offerDeadline,
  outreachBlock,
} from "./rules";
import {
  CUTOFF_MS,
  type CommandResult,
  type SalonCommand,
  type SalonState,
} from "./types";

export const getSalon = defineQuery<SalonState>("getSalon");
export const command = defineUpdate<CommandResult, [SalonCommand]>("command");
export const recoveryPause = defineSignal<[string]>("recoveryPause");
const { sendSimulatedOffer } = proxyActivities<typeof activities>({
  startToCloseTimeout: "5 seconds",
  scheduleToCloseTimeout: "10 seconds",
  retry: { maximumAttempts: 1 },
});

/** One durable salon session serializes staff tabs and replies. One opening at a time. */
export async function salonWorkflow(): Promise<void> {
  const state = initialState();
  let offerSequence = 0;
  let generation = 0;

  function record(message: string) {
    state.message = message;
    state.events.push({ at: Date.now(), message });
    state.events = state.events.slice(-100);
    state.revision++;
  }

  function pause(message: string) {
    if (state.phase !== "offering" && state.phase !== "paused") return;
    state.phase = "paused";
    generation++;
    state.recoveryVersion++;
    record(message);
  }

  function stop(message: string) {
    const offer = activeOffer(state);
    if (offer) offer.status = "canceled";
    state.phase = "stopped";
    generation++;
    record(message);
  }

  function checkWindow(): boolean {
    if (!state.opening || !state.policy) return false;
    const blocked = outreachBlock(state.opening, state.policy, Date.now());
    if (!blocked) return true;
    if (Date.now() >= state.opening.startAt - CUTOFF_MS) stop(blocked);
    else pause(blocked);
    return false;
  }

  const result = (ok: boolean, message: string): CommandResult => ({
    ok,
    message,
  });

  setHandler(getSalon, () => state);
  setHandler(recoveryPause, (source) =>
    pause(
      `Recovery pause: ${source}. Staff must confirm availability and resume.`,
    ),
  );

  // No awaits in this handler: acceptance and reservation are one state transition.
  setHandler(command, (input) => {
    const offer = activeOffer(state);
    switch (input.type) {
      case "start":
        if (["offering", "paused", "reserved"].includes(state.phase))
          return result(
            false,
            "Finish or cancel the current opening before creating another.",
          );
        generation++;
        state.opening = input.opening;
        state.policy = input.policy;
        state.candidates = input.candidates;
        state.offers = [];
        state.reservation = null;
        state.phase = "offering";
        record("Opening created. Matching eligible clients in waitlist order.");
        checkWindow();
        break;
      case "reply":
        if (state.phase !== "offering")
          return result(false, "This opening is not accepting replies.");
        if (!checkWindow()) return result(false, state.message);
        if (
          !offer ||
          offer.status !== "waiting" ||
          offer.id !== input.offerId ||
          offer.clientId !== input.clientId
        )
          return result(false, "This offer is no longer available.");
        if (Date.now() >= offer.deadline)
          return result(false, "This offer has expired.");
        if (state.optedOut.includes(input.clientId))
          return result(false, "This client has opted out.");
        if (input.answer === "decline") {
          offer.status = "declined";
          record(
            `${offer.clientName} declined. Moving to the next eligible client.`,
          );
        } else {
          offer.status = "accepted";
          state.reservation = {
            clientId: offer.clientId,
            clientName: offer.clientName,
            squareEntered: false,
          };
          state.phase = "reserved";
          record(
            `Reserved for ${offer.clientName}. Staff must enter this appointment in Square.`,
          );
        }
        break;
      case "optOut":
        if (!state.candidates.some((client) => client.id === input.clientId))
          return result(false, "Unknown sample client.");
        if (!state.optedOut.includes(input.clientId))
          state.optedOut.push(input.clientId);
        if (offer?.clientId === input.clientId) offer.status = "opted_out";
        record(
          "Opt-out saved. This client will receive no further offers, including after reopening.",
        );
        break;
      case "pause":
        if (state.phase !== "offering")
          return result(false, "Only active outreach can be paused.");
        pause(
          "Staff paused outreach. Replies are rejected until staff resume.",
        );
        break;
      case "resume":
        if (state.phase !== "paused" || !input.openingAvailable)
          return result(
            false,
            "Confirm availability before resuming paused outreach.",
          );
        if (input.recoveryVersion !== state.recoveryVersion)
          return result(
            false,
            "The opening needs a new review. Refresh before resuming.",
          );
        if (!checkWindow()) return result(false, state.message);
        if (offer?.status === "sending") {
          state.phase = "failed";
          offer.status = "failed";
          record(
            "Delivery was interrupted. Staff must check manually and reopen if appropriate.",
          );
          return result(false, state.message);
        }
        if (offer && Date.now() >= offer.deadline) {
          offer.status = "expired";
          record(
            `${offer.clientName}'s original deadline expired during the pause.`,
          );
        }
        state.phase = "offering";
        record(
          "Staff confirmed availability and resumed. Original deadlines are unchanged.",
        );
        break;
      case "cancelOffer":
        if (!offer || !["offering", "paused"].includes(state.phase))
          return result(false, "There is no active offer to cancel.");
        offer.status = "canceled";
        pause(
          "Staff canceled the offer. Outreach is paused until staff resume.",
        );
        break;
      case "stop":
        if (["reserved", "completed"].includes(state.phase))
          return result(
            false,
            "Cancel the reservation separately before reopening.",
          );
        stop("Staff stopped outreach. The opening is no longer being offered.");
        break;
      case "cancelReservation":
        if (state.phase !== "reserved")
          return result(false, "There is no reservation to cancel.");
        state.reservation = null;
        stop(
          "Staff canceled the reservation. Update Square if necessary. Reopening is manual.",
        );
        break;
      case "reopen":
        if (
          !["stopped", "failed", "exhausted"].includes(state.phase) ||
          !state.opening
        )
          return result(
            false,
            "Only a closed, unreserved opening can be reopened.",
          );
        if (!checkWindow())
          return result(
            false,
            "The opening must be within contact hours and before its cutoff.",
          );
        state.offers = [];
        state.phase = "offering";
        generation++;
        record(
          "Staff manually reopened the opening. Consent and opt-outs still apply.",
        );
        break;
      case "squareEntered":
        if (!state.reservation)
          return result(false, "There is no reservation to record.");
        if (state.reservation.squareEntered && state.phase === "completed")
          return result(true, "This booking is already completed.");
        state.reservation.squareEntered = true;
        // Preserve old histories while new confirmations complete the handoff.
        if (patched("complete-square-handoff-v1")) {
          state.completedBookings.push({
            opening: { ...state.opening! },
            clientId: state.reservation.clientId,
            clientName: state.reservation.clientName,
            completedAt: Date.now(),
          });
          state.phase = "completed";
        }
        record(
          "Staff marked the appointment as entered in Square. This prototype did not update Square.",
        );
        break;
      case "failNextMessage":
        state.failNextMessage = true;
        record(
          "Simulation armed: the next notification will fail and alert staff.",
        );
        break;
    }
    return result(true, state.message);
  });

  while (true) {
    await condition(() => state.phase === "offering");
    if (!checkWindow()) continue;
    const current = activeOffer(state);
    if (current) {
      const changed = await condition(
        () => state.phase !== "offering" || current.status !== "waiting",
        Math.max(1, current.deadline - Date.now()),
      );
      if (
        !changed &&
        state.phase === "offering" &&
        current.status === "waiting"
      ) {
        current.status = "expired";
        record(
          `${current.clientName} timed out. Moving to the next eligible client.`,
        );
      }
      continue;
    }
    const next = eligibleCandidates(state).find(
      (client) => !state.offers.some((offer) => offer.clientId === client.id),
    );
    if (!next) {
      state.phase = "exhausted";
      record(
        "All eligible clients declined, timed out, or were withdrawn. Staff can handle the opening manually.",
      );
      continue;
    }
    state.offers.push({
      id: `offer-${++offerSequence}`,
      clientId: next.id,
      clientName: next.name,
      createdAt: Date.now(),
      deadline: offerDeadline(state.opening!, state.policy!, Date.now()),
      status: "sending",
    });
    const pending = state.offers[state.offers.length - 1];
    const expectedGeneration = generation;
    const fail = state.failNextMessage;
    state.failNextMessage = false;
    try {
      await sendSimulatedOffer({ offerId: pending.id, fail });
      // Staff actions or a recovery signal may arrive while the Activity runs.
      if (
        generation !== expectedGeneration ||
        state.phase !== "offering" ||
        pending.status !== "sending"
      )
        continue;
      if (!checkWindow()) continue;
      pending.status = "waiting";
      record(`Simulated offer sent to ${next.name}. Waiting for a reply.`);
    } catch {
      if (
        generation !== expectedGeneration ||
        state.phase !== "offering" ||
        pending.status !== "sending"
      )
        continue;
      pending.status = "failed";
      state.phase = "failed";
      record(
        "STAFF ALERT: notification failed or could not be confirmed. Outreach stopped; handle this opening manually.",
      );
    }
  }
}
