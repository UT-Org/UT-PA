import type { Candidate, Opening } from "./types";

/** Fixed fictional identities only. No real phone numbers enter Temporal history. */
export function demoCandidates(opening: Opening, now: number): Candidate[] {
  const base = {
    service: opening.service,
    durationMinutes: opening.durationMinutes,
    requiredStylist: null,
    availableFrom: opening.startAt - 60_000,
    availableUntil: opening.startAt + opening.durationMinutes * 60_000,
    consent: true,
  };
  return [
    { ...base, id: "alex", name: "Alex (sample)", joinedAt: now - 600_000 },
    { ...base, id: "morgan", name: "Morgan (sample)", joinedAt: now - 500_000 },
    { ...base, id: "riley", name: "Riley (sample)", joinedAt: now - 400_000 },
    {
      ...base,
      id: "sam",
      name: "Sam (sample)",
      joinedAt: now - 700_000,
      consent: false,
    },
    {
      ...base,
      id: "taylor",
      name: "Taylor (sample)",
      joinedAt: now - 800_000,
      requiredStylist: opening.stylist === "Carla" ? "Lena" : "Carla",
    },
    {
      ...base,
      id: "jordan",
      name: "Jordan (sample)",
      joinedAt: now - 900_000,
      durationMinutes: opening.durationMinutes + 30,
    },
  ];
}
