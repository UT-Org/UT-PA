import assert from "node:assert/strict";
import { test } from "node:test";
import { demoCandidates } from "../src/demo";
import {
  eligibleCandidates,
  exclusionReason,
  initialState,
  offerDeadline,
  outreachBlock,
} from "../src/rules";
import { contactWindow, parseCommand } from "../src/validation";
import type { Opening } from "../src/types";

const now = Date.parse("2026-10-06T17:00:00Z");
const opening: Opening = {
  id: "test",
  service: "Haircut",
  stylist: "Carla",
  durationMinutes: 60,
  startAt: now + 3_600_000,
};
test("matching respects consent, duration, service, availability, stylist, and queue order", () => {
  const candidates = demoCandidates(opening, now);
  const state = {
    ...initialState(),
    opening,
    candidates: [...candidates].reverse(),
  };
  assert.deepEqual(
    eligibleCandidates(state).map((c) => c.id),
    ["alex", "morgan", "riley"],
  );
  assert.equal(
    exclusionReason({ ...candidates[0], service: "Color" }, opening, []),
    "Different service",
  );
  assert.equal(
    exclusionReason(
      { ...candidates[0], availableFrom: opening.startAt + 1 },
      opening,
      [],
    ),
    "Unavailable for the appointment",
  );
  assert.equal(
    exclusionReason(
      { ...candidates[0], availableUntil: opening.startAt + 1 },
      opening,
      [],
    ),
    "Unavailable for the appointment",
  );
  state.optedOut = ["alex"];
  assert.deepEqual(
    eligibleCandidates(state).map((c) => c.id),
    ["morgan", "riley"],
  );
});
test("contact policy resolves the salon zone, including a DST date", () => {
  assert.deepEqual(
    contactWindow(
      now,
      opening.startAt,
      "America/Los_Angeles",
      "09:00",
      "18:00",
    ),
    {
      contactStartAt: Date.parse("2026-10-06T16:00:00Z"),
      contactEndAt: Date.parse("2026-10-07T01:00:00Z"),
    },
  );
  const dst = Date.parse("2026-11-01T18:00:00Z");
  assert.throws(
    () =>
      contactWindow(
        dst,
        dst + 3_600_000,
        "America/Los_Angeles",
        "01:30",
        "01:45",
      ),
    /ambiguous/,
  );
  assert.equal(
    contactWindow(dst, dst + 3_600_000, "America/Los_Angeles", "09:00", "18:00")
      .contactStartAt,
    Date.parse("2026-11-01T17:00:00Z"),
  );
  assert.throws(() =>
    contactWindow(now, opening.startAt, "bad/zone", "09:00", "18:00"),
  );
  assert.throws(() =>
    contactWindow(now, now + 48 * 3_600_000, "UTC", "09:00", "18:00"),
  );
  assert.throws(() =>
    contactWindow(now, opening.startAt, "UTC", "18:00", "09:00"),
  );
});
test("cutoff and contact closing cap the original offer deadline", () => {
  const policy = {
    timeZone: "UTC",
    opens: "00:00",
    closes: "23:59",
    contactStartAt: now - 1000,
    contactEndAt: now + 10_000,
    offerSeconds: 900,
    demo: false,
  };
  assert.equal(offerDeadline(opening, policy, now), now + 10_000);
  assert.match(outreachBlock(opening, policy, now + 10_000)!, /Outside/);
  assert.match(
    outreachBlock(opening, policy, opening.startAt - 30 * 60_000)!,
    /cutoff/,
  );
});
test("API validation rejects unknown fields and unsafe or malformed values", () => {
  const input = {
    type: "start",
    startAt: new Date(opening.startAt).toISOString(),
    durationMinutes: 60,
    service: "Haircut",
    stylist: "Carla",
    timeZone: "UTC",
    opens: "09:00",
    closes: "23:00",
    demo: false,
  };
  const parsed = parseCommand(input, now);
  assert.equal(parsed.type, "start");
  if (parsed.type === "start") assert.equal(parsed.policy.offerSeconds, 900);
  for (const patch of [
    { durationMinutes: 999999 },
    { service: "<script>" },
    { candidates: [] },
    { startAt: "not a date" },
    { demo: "true" },
  ])
    assert.throws(() => parseCommand({ ...input, ...patch }, now));
  assert.throws(() =>
    parseCommand({ type: "resume", openingAvailable: false }),
  );
  assert.throws(() =>
    parseCommand({
      type: "reply",
      offerId: "../../",
      clientId: "alex",
      answer: "accept",
    }),
  );
});
