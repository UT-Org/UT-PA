import path from "node:path";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { installSecurity } from "./security";
import { InputError, parseCommand } from "./validation";
import { exclusionReason } from "./rules";
import type { CommandResult, SalonCommand, SalonState } from "./types";

export interface SalonService {
  status(): Promise<SalonState>;

  execute(command: SalonCommand, requestId: string): Promise<CommandResult>;
}

/** HTTP boundary only. Tests inject a service without opening a Temporal connection. */
export function createApp(
  service: SalonService,
  accessCode: string,
  port: number,
) {
  const app = express();
  const security = installSecurity(app, accessCode, port);
  app.use(express.json({ limit: "8kb", strict: true }));
  app.get("/health", (_request, response) => {
    response.json({ ok: true });
  });
  app.post("/api/login", security.login);
  app.use("/api", security.requireStaff);
  app.post("/api/logout", security.logout);
  app.get("/api/state", async (_request, response) => {
    const state = await service.status();
    response.json({
      ...state,
      candidates: state.candidates.map((candidate) => ({
        ...candidate,
        exclusionReason: state.opening
          ? exclusionReason(candidate, state.opening, state.optedOut)
          : null,
      })),
    });
  });
  app.post("/api/command", async (request, response) => {
    const requestId = request.headers["idempotency-key"];
    if (typeof requestId !== "string" || !/^[a-f0-9-]{36}$/.test(requestId))
      throw new InputError("A UUID idempotency key is required.");
    const command = parseCommand(request.body);
    const result = await service.execute(command, requestId);
    response.status(result.ok ? 200 : 409).json(result);
  });
  app.use("/api", (_request, response) => {
    response.status(404).json({ error: "Unknown API route." });
  });
  app.use(
    express.static(path.resolve(__dirname, "../public"), {
      dotfiles: "deny",
      index: "index.html",
    }),
  );
  app.use(
    (
      error: unknown,
      _request: Request,
      response: Response,
      _next: NextFunction,
    ) => {
      if (error instanceof InputError)
        return void response.status(400).json({ error: error.message });
      const type = (error as { type?: string })?.type;
      if (type === "entity.too.large")
        return void response
          .status(413)
          .json({ error: "Request body is too large." });
      if (type === "entity.parse.failed")
        return void response.status(400).json({ error: "Malformed JSON." });
      // Stack traces, infrastructure addresses, and request bodies never reach clients.
      console.error("Request could not complete. Check local service health.");
      response.status(503).json({
        error:
          "Service unavailable. Do not assume the last action succeeded. Refresh when the service returns; staff review may be required.",
      });
    },
  );
  return app;
}
