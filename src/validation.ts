import { randomUUID } from "node:crypto";
import { demoCandidates } from "./demo";
import { CUTOFF_MS, type SalonCommand } from "./types";

export class InputError extends Error {}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new InputError("Expected a JSON object.");
  return value as Record<string, unknown>;
}

function text(value: unknown, name: string, max = 80): string {
  if (typeof value !== "string" || !value.length || value.length > max)
    throw new InputError(`Invalid ${name}.`);
  return value;
}

function choice<T extends string>(
  value: unknown,
  choices: readonly T[],
  name: string,
): T {
  if (!choices.includes(value as T)) throw new InputError(`Invalid ${name}.`);
  return value as T;
}

function only(input: Record<string, unknown>, keys: string[]) {
  if (Object.keys(input).some((key) => !keys.includes(key)))
    throw new InputError("Unexpected request field.");
}

/** Intl runs outside Workflow code. Persist the resolved UTC contact window once. */
export function contactWindow(
  now: number,
  startAt: number,
  timeZone: string,
  opens: string,
  closes: string,
) {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    throw new InputError(
      "Choose a valid IANA time zone, such as America/Los_Angeles.",
    );
  }

  const parts = (at: number) =>
    Object.fromEntries(
      formatter.formatToParts(at).map((part) => [part.type, part.value]),
    );

  const day = (at: number) => {
    const p = parts(at);
    return `${p.year}-${p.month}-${p.day}`;
  };

  if (day(now) !== day(startAt))
    throw new InputError("Choose an opening today in the salon time zone.");
  if (
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(opens) ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(closes) ||
    opens >= closes
  ) {
    throw new InputError(
      "Set opening and closing times on the same day, with closing after opening.",
    );
  }
  // Scan a bounded day window. This handles DST gaps/repeated hours without
  // depending on the computer's time zone or accepting an ambiguous local date.
  const targetDay = day(now);
  let first: number | undefined;
  let last: number | undefined;
  const minuteNow = Math.floor(now / 60_000) * 60_000;
  for (
    let at = minuteNow - 26 * 3_600_000;
    at <= minuteNow + 26 * 3_600_000;
    at += 60_000
  ) {
    const p = parts(at);
    const clock = `${p.hour}:${p.minute}`;
    if (
      `${p.year}-${p.month}-${p.day}` === targetDay &&
      clock >= opens &&
      clock < closes
    ) {
      if (last !== undefined && last !== at) {
        throw new InputError(
          "These hours cross an ambiguous repeated-clock window. Choose an unambiguous contact window.",
        );
      }
      first ??= at;
      last = at + 60_000;
    }
  }
  if (first === undefined || last === undefined)
    throw new InputError("These contact hours do not exist on this date.");
  return { contactStartAt: first, contactEndAt: last };
}

export function parseCommand(value: unknown, now = Date.now()): SalonCommand {
  const input = object(value);
  const type = text(input.type, "command", 24);
  if (type === "start") {
    only(input, [
      "type",
      "startAt",
      "durationMinutes",
      "service",
      "stylist",
      "timeZone",
      "opens",
      "closes",
      "demo",
    ]);
    const rawStart = text(input.startAt, "appointment time", 32);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(rawStart))
      throw new InputError("Send the appointment time in UTC ISO format.");
    const startAt = Date.parse(rawStart);
    if (
      !Number.isFinite(startAt) ||
      startAt <= now + CUTOFF_MS ||
      startAt > now + 24 * 3_600_000
    )
      throw new InputError(
        "The opening must be more than 30 minutes away and within 24 hours.",
      );
    const durationMinutes = input.durationMinutes;
    if (
      typeof durationMinutes !== "number" ||
      !Number.isInteger(durationMinutes) ||
      durationMinutes < 30 ||
      durationMinutes > 180
    )
      throw new InputError("Service duration must be 30 to 180 minutes.");
    if (typeof input.demo !== "boolean")
      throw new InputError("Select standard timing or demo timing.");
    const timeZone = text(input.timeZone, "time zone", 64);
    const opens = text(input.opens, "opening time", 5);
    const closes = text(input.closes, "closing time", 5);
    const opening = {
      id: randomUUID(),
      startAt,
      durationMinutes,
      service: choice(input.service, ["Haircut", "Color"], "service"),
      stylist: choice(input.stylist, ["Carla", "Lena"], "stylist"),
    };
    const policy = {
      timeZone,
      opens,
      closes,
      ...contactWindow(now, startAt, timeZone, opens, closes),
      demo: input.demo,
      offerSeconds: input.demo ? 20 : 900,
    };
    return { type, opening, policy, candidates: demoCandidates(opening, now) };
  }
  if (type === "reply") {
    only(input, ["type", "offerId", "clientId", "answer"]);
    const offerId = text(input.offerId, "offer ID", 32);
    if (!/^offer-\d+$/.test(offerId)) throw new InputError("Invalid offer ID.");
    return {
      type,
      offerId,
      clientId: text(input.clientId, "client ID", 24),
      answer: choice(input.answer, ["accept", "decline"], "reply"),
    };
  }
  if (type === "optOut") {
    only(input, ["type", "clientId"]);
    return { type, clientId: text(input.clientId, "client ID", 24) };
  }
  if (type === "resume") {
    only(input, ["type", "openingAvailable", "recoveryVersion"]);
    if (input.openingAvailable !== true)
      throw new InputError("Confirm that the opening is still available.");
    if (
      typeof input.recoveryVersion !== "number" ||
      !Number.isSafeInteger(input.recoveryVersion) ||
      input.recoveryVersion < 0
    )
      throw new InputError("Refresh the opening before resuming.");
    return {
      type,
      openingAvailable: true,
      recoveryVersion: input.recoveryVersion,
    };
  }
  only(input, ["type"]);
  return {
    type: choice(
      type,
      [
        "pause",
        "cancelOffer",
        "stop",
        "cancelReservation",
        "reopen",
        "squareEntered",
        "failNextMessage",
      ],
      "command",
    ),
  };
}
