import assert from "node:assert/strict";
import { once } from "node:events";
import { randomBytes, randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";
import { test } from "node:test";
import { createApp } from "../src/app";
import { initialState } from "../src/rules";

test("HTTP boundary protects staff data and mutations", async (t) => {
  const code = randomBytes(24).toString("hex");
  let mutations = 0;
  const app = createApp(
    {
      status: async () => initialState(),
      execute: async () => {
        mutations++;
        return { ok: true, message: "done" };
      },
    },
    code,
    3000,
  );
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as { port: number }).port;

  const request = (
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) =>
    new Promise<Response>((resolve, reject) => {
      const request = httpRequest(
        {
          hostname: "127.0.0.1",
          port,
          path,
          method: body === undefined ? "GET" : "POST",
          headers: {
            host: "localhost:3000",
            ...(body === undefined
              ? {}
              : { "content-type": "application/json" }),
            ...headers,
          },
        },
        (response) => {
          let data = "";
          response.on("data", (chunk) => {
            data += chunk;
          });
          response.on("end", () =>
            resolve(
              new Response(data, {
                status: response.statusCode,
                headers: response.headers as Record<string, string>,
              }),
            ),
          );
        },
      );
      request.on("error", reject);
      request.end(body === undefined ? undefined : JSON.stringify(body));
    });

  try {
    await t.test(
      "anonymous access and cross-origin requests are denied",
      async () => {
        assert.equal((await request("/api/state")).status, 401);
        assert.equal(
          (await request("/api/command", { type: "stop" })).status,
          401,
        );
        assert.equal(
          (
            await request(
              "/api/login",
              { code },
              { origin: "https://attacker.invalid" },
            )
          ).status,
          403,
        );
        assert.equal(
          (await request("/", undefined, { host: "attacker.invalid" })).status,
          403,
        );
        assert.equal(mutations, 0);
      },
    );
    const login = await request("/api/login", { code });
    assert.equal(login.status, 200);
    const setCookie = login.headers.get("set-cookie")!;
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Strict/);
    const cookie = setCookie.split(";")[0];
    const headers = {
      cookie,
      "idempotency-key": randomUUID(),
      origin: "http://localhost:3000",
    };
    await t.test(
      "authenticated requests have security headers and validated commands",
      async () => {
        const response = await request("/api/state", undefined, headers);
        assert.equal(response.status, 200);
        assert.match(
          response.headers.get("content-security-policy")!,
          /frame-ancestors 'none'/,
        );
        assert.equal(response.headers.get("x-powered-by"), null);
        assert.equal(response.headers.get("cache-control"), "no-store");
        assert.equal(
          (
            await request(
              "/api/command",
              { type: "stop", extra: "ignored?" },
              headers,
            )
          ).status,
          400,
        );
        assert.equal(
          (await request("/api/command", { type: "stop" }, headers)).status,
          200,
        );
        assert.equal(mutations, 1);
        assert.equal(
          (
            await request(
              "/api/command",
              { type: "stop" },
              { ...headers, "content-type": "text/plain" },
            )
          ).status,
          415,
        );
        assert.equal(
          (await request("/api/command", { data: "x".repeat(9000) }, headers))
            .status,
          413,
        );
      },
    );
    await t.test(
      "logout invalidates the session and static serving excludes repository files",
      async () => {
        for (const file of ["/.env", "/src/api.ts", "/package.json"])
          assert.notEqual((await request(file)).status, 200);
        assert.equal((await request("/api/logout", {}, headers)).status, 200);
        assert.equal(
          (await request("/api/state", undefined, headers)).status,
          401,
        );
      },
    );
    await t.test(
      "successful logins do not consume the failed-login allowance",
      async () => {
        for (let i = 0; i < 11; i++) {
          const response = await request("/api/login", { code });
          assert.equal(response.status, 200);
          const cookie = response.headers.get("set-cookie")!.split(";")[0];
          assert.equal(
            (await request("/api/logout", {}, { cookie })).status,
            200,
          );
        }
      },
    );
    await t.test(
      "one session cannot exhaust another session or health checks",
      async () => {
        const first = await request("/api/login", { code });
        const second = await request("/api/login", { code });
        const firstHeaders = {
          cookie: first.headers.get("set-cookie")!.split(";")[0],
        };
        const secondHeaders = {
          cookie: second.headers.get("set-cookie")!.split(";")[0],
        };
        for (let i = 0; i < 240; i++)
          assert.equal(
            (await request("/api/state", undefined, firstHeaders)).status,
            200,
          );
        assert.equal(
          (await request("/api/state", undefined, firstHeaders)).status,
          429,
        );
        assert.equal(
          (await request("/health", undefined, firstHeaders)).status,
          200,
        );
        assert.equal((await request("/health")).status, 200);
        assert.equal(
          (await request("/api/state", undefined, secondHeaders)).status,
          200,
        );
        assert.equal(
          (await request("/health", undefined, { host: "attacker.invalid" }))
            .status,
          403,
        );
      },
    );
    await t.test("failed login attempts are rate limited", async () => {
      for (let i = 0; i < 10; i++)
        assert.equal(
          (await request("/api/login", { code: "incorrect" })).status,
          401,
        );
      assert.equal((await request("/api/login", { code })).status, 429);
      assert.equal((await request("/health")).status, 200);
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
