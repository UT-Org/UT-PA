import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Express, NextFunction, Request, Response } from "express";

const hash = (value: string) => createHash("sha256").update(value).digest();

const SESSION_MS = 8 * 60 * 60_000;
type RateBucket = { count: number; expiresAt: number };

/** Expired buckets are removed so client/session keys do not accumulate. */
function rateBucket(
  buckets: Map<string, RateBucket>,
  key: string,
  duration: number,
) {
  const now = Date.now();
  for (const [id, bucket] of buckets)
    if (bucket.expiresAt <= now) buckets.delete(id);
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { count: 0, expiresAt: now + duration };
    buckets.set(key, bucket);
  }
  return bucket;
}

/** Local demo access control. Sessions and credentials never enter workflow history. */
export function installSecurity(
  app: Express,
  accessCode: string,
  port: number,
) {
  const sessions = new Map<string, number>();
  const allowedHosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`]);
  const requestBuckets = new Map<string, RateBucket>();
  const loginFailures = new Map<string, RateBucket>();

  const sessionId = (request: Request) =>
    /(?:^|;\s*)juniper_session=([a-f0-9]{64})(?:;|$)/.exec(
      request.headers.cookie ?? "",
    )?.[1];

  const clientAddress = (request: Request) =>
    request.socket.remoteAddress ?? "unknown";

  app.disable("x-powered-by");
  app.use((request: Request, response: Response, next: NextFunction) => {
    response.set({
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
      "Cache-Control": "no-store",
    });
    if (!allowedHosts.has(request.headers.host ?? ""))
      return void response.status(403).json({ error: "Unrecognized host." });
    const origin = request.headers.origin;
    if (origin && origin !== `http://${request.headers.host}`)
      return void response
        .status(403)
        .json({ error: "Cross-origin requests are not permitted." });
    if (request.headers["sec-fetch-site"] === "cross-site")
      return void response
        .status(403)
        .json({ error: "Cross-site requests are not permitted." });
    if (
      request.method !== "GET" &&
      request.method !== "HEAD" &&
      !request.is("application/json")
    )
      return void response.status(415).json({ error: "Use application/json." });
    // Health probes retain host/origin checks but never consume a staff budget.
    if (["GET", "HEAD"].includes(request.method) && request.path === "/health")
      return next();
    const id = sessionId(request);
    const key =
      id && (sessions.get(id) ?? 0) > Date.now()
        ? `session:${id}`
        : `address:${clientAddress(request)}`;
    const bucket = rateBucket(requestBuckets, key, 60_000);
    if (++bucket.count > 240)
      return void response
        .status(429)
        .json({ error: "Too many requests. Wait one minute." });
    next();
  });

  function requireStaff(
    request: Request,
    response: Response,
    next: NextFunction,
  ) {
    const id = sessionId(request);
    if (!id || (sessions.get(id) ?? 0) <= Date.now())
      return void response
        .status(401)
        .json({ error: "Staff sign-in required." });
    next();
  }

  function login(request: Request, response: Response) {
    const bucket = rateBucket(
      loginFailures,
      clientAddress(request),
      15 * 60_000,
    );
    if (bucket.count >= 10)
      return void response
        .status(429)
        .json({ error: "Too many sign-in attempts. Wait 15 minutes." });
    const code = request.body?.code;
    if (
      typeof code !== "string" ||
      code.length > 128 ||
      !timingSafeEqual(hash(code), hash(accessCode))
    ) {
      bucket.count++;
      return void response.status(401).json({ error: "Invalid access code." });
    }
    for (const [id, expires] of sessions)
      if (expires <= Date.now()) sessions.delete(id);
    if (sessions.size >= 10) sessions.delete(sessions.keys().next().value!);
    const id = randomBytes(32).toString("hex");
    sessions.set(id, Date.now() + SESSION_MS);
    response.cookie("juniper_session", id, {
      httpOnly: true,
      sameSite: "strict",
      maxAge: SESSION_MS,
      path: "/",
    });
    response.json({ ok: true });
  }

  function logout(request: Request, response: Response) {
    const id = sessionId(request);
    if (id) sessions.delete(id);
    response.clearCookie("juniper_session", {
      httpOnly: true,
      sameSite: "strict",
      path: "/",
    });
    response.json({ ok: true });
  }

  return { requireStaff, login, logout };
}
