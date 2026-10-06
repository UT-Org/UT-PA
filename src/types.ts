/** Shared contracts. Times are UTC milliseconds; all clients are fictional. */
export type Opening = {
  id: string;
  startAt: number;
  durationMinutes: number;
  service: "Haircut" | "Color";
  stylist: "Carla" | "Lena";
};
export type ContactPolicy = {
  timeZone: string;
  opens: string;
  closes: string;
  contactStartAt: number;
  contactEndAt: number;
  offerSeconds: number;
  demo: boolean;
};
export type Candidate = {
  id: string;
  name: string;
  service: Opening["service"];
  durationMinutes: number;
  requiredStylist: Opening["stylist"] | null;
  availableFrom: number;
  availableUntil: number;
  joinedAt: number;
  consent: boolean;
};
export type Offer = {
  id: string;
  clientId: string;
  clientName: string;
  createdAt: number;
  deadline: number;
  status:
    | "sending"
    | "waiting"
    | "declined"
    | "expired"
    | "accepted"
    | "opted_out"
    | "canceled"
    | "failed";
};
export type Phase =
  | "idle"
  | "offering"
  | "paused"
  | "reserved"
  | "completed"
  | "stopped"
  | "exhausted"
  | "failed";
export type SalonState = {
  phase: Phase;
  message: string;
  opening: Opening | null;
  policy: ContactPolicy | null;
  candidates: Candidate[];
  optedOut: string[];
  offers: Offer[];
  reservation: {
    clientId: string;
    clientName: string;
    squareEntered: boolean;
  } | null;
  completedBookings: {
    opening: Opening;
    clientId: string;
    clientName: string;
    completedAt: number;
  }[];
  events: { at: number; message: string }[];
  failNextMessage: boolean;
  revision: number;
  recoveryVersion: number;
};
/** All mutations share one endpoint and one authoritative workflow handler. */
export type SalonCommand =
  | {
      type: "start";
      opening: Opening;
      policy: ContactPolicy;
      candidates: Candidate[];
    }
  | {
      type: "reply";
      offerId: string;
      clientId: string;
      answer: "accept" | "decline";
    }
  | { type: "optOut"; clientId: string }
  | { type: "resume"; openingAvailable: true; recoveryVersion: number }
  | {
      type:
        | "pause"
        | "cancelOffer"
        | "stop"
        | "cancelReservation"
        | "reopen"
        | "squareEntered"
        | "failNextMessage";
    };
export type CommandResult = { ok: boolean; message: string };
export const WORKFLOW_ID = "juniper-salon";
export const TASK_QUEUE = "juniper-salon";
export const CUTOFF_MS = 30 * 60 * 1000;
