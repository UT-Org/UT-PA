import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";
import { chromium } from "playwright";
import { createApp } from "../../src/app";
import { demoCandidates } from "../../src/demo";
import { initialState } from "../../src/rules";
import type { SalonCommand, SalonState } from "../../src/types";

/** Real DOM and HTTP authentication; fixture state never touches the live salon. */
test(
  "dashboard refresh and booking handoff",
  { timeout: 30_000 },
  async (t) => {
    const now = Date.now();
    const opening = {
      id: "browser-opening",
      startAt: now + 3_600_000,
      durationMinutes: 60,
      service: "Haircut" as const,
      stylist: "Carla" as const,
    };
    let state: SalonState = {
      ...initialState(),
      phase: "offering",
      opening,
      policy: {
        timeZone: "UTC",
        opens: "00:00",
        closes: "23:59",
        contactStartAt: now - 1000,
        contactEndAt: now + 7_200_000,
        offerSeconds: 900,
        demo: false,
      },
      candidates: demoCandidates(opening, now),
      offers: [
        {
          id: "offer-1",
          clientId: "alex",
          clientName: "Alex",
          createdAt: now,
          deadline: now + 900_000,
          status: "waiting",
        },
      ],
    };
    const commands: SalonCommand[] = [];
    const code = randomBytes(24).toString("hex");
    const server = createServer();
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = (server.address() as { port: number }).port;
    server.on(
      "request",
      createApp(
        {
          status: async () => structuredClone(state),
          execute: async (command) => {
            commands.push(command);
            return { ok: true, message: "Fixture accepted command." };
          },
        },
        code,
        port,
      ),
    );

    try {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto(`http://127.0.0.1:${port}`);
        await page.locator("#code").fill(code);
        await page.getByRole("button", { name: "Open the waitlist" }).click();
        await page.locator("#workspace").waitFor({ state: "visible" });
        await page.waitForFunction(
          () => document.querySelector("#holder")?.textContent === "Alex",
        );

        await t.test(
          "opening inputs exist and unchanged refresh preserves keyboard focus",
          async () => {
            for (const id of [
              "start",
              "service",
              "stylist",
              "duration",
              "timezone",
            ])
              assert.equal(await page.locator(`#${id}`).count(), 1);
            const pause = page.getByRole("button", {
              name: "Pause outreach",
              exact: true,
            });
            await pause.focus();
            await page.evaluate("refresh()");
            assert.equal(
              await pause.evaluate(
                (button) => button === document.activeElement,
              ),
              true,
            );
          },
        );

        await t.test(
          "decline and timeout advances select the current client and retain usable controls",
          async () => {
            state.offers[0].status = "declined";
            state.offers.push({
              ...state.offers[0],
              id: "offer-2",
              clientId: "morgan",
              clientName: "Morgan",
              status: "sending",
            });
            await page.evaluate("refresh()");
            assert.equal(
              await page.locator("#reply-offer").inputValue(),
              "offer-2",
            );
            assert.equal(
              await page
                .getByRole("button", { name: "Pause outreach", exact: true })
                .evaluate((button) => button === document.activeElement),
              true,
            );
            state.offers[1].status = "waiting";
            await page.evaluate("refresh()");
            assert.equal(
              await page.locator("#reply-offer").inputValue(),
              "offer-2",
            );
            state.offers[1].status = "expired";
            state.offers.push({
              ...state.offers[1],
              id: "offer-3",
              clientId: "riley",
              clientName: "Riley",
              status: "waiting",
            });
            await page.evaluate("refresh()");
            assert.equal(
              await page.locator("#reply-offer").inputValue(),
              "offer-3",
            );
            await page
              .getByRole("button", { name: "Accept offer", exact: true })
              .click();
            await page.waitForFunction(
              () =>
                !document.querySelector("#feedback")?.hasAttribute("hidden"),
            );
            assert.deepEqual(commands.at(-1), {
              type: "reply",
              offerId: "offer-3",
              clientId: "riley",
              answer: "accept",
            });
          },
        );

        await t.test(
          "staff can deliberately select an old offer without polling resetting it",
          async () => {
            await page.locator("#reply-offer").selectOption("offer-1");
            state.events.push({ at: now, message: "Unrelated status update" });
            await page.evaluate("refresh()");
            assert.equal(
              await page.locator("#reply-offer").inputValue(),
              "offer-1",
            );
          },
        );

        await t.test(
          "completed handoff enables the next opening and keeps its archive visible",
          async () => {
            state.phase = "completed";
            state.offers[2].status = "accepted";
            state.reservation = {
              clientId: "riley",
              clientName: "Riley",
              squareEntered: true,
            };
            state.completedBookings.push({
              opening,
              clientId: "riley",
              clientName: "Riley",
              completedAt: now,
            });
            await page.evaluate("refresh()");
            assert.equal(await page.locator("#create").isEnabled(), true);
            assert.equal(await page.locator("#controls button").count(), 0);
            assert.match(
              (await page.locator("#bookings").textContent()) ?? "",
              /Riley.*Entered in Square/,
            );
            state = { ...state, phase: "idle", reservation: null, offers: [] };
            await page.evaluate("refresh()");
            assert.match(
              (await page.locator("#bookings").textContent()) ?? "",
              /Riley/,
            );
          },
        );
        assert.deepEqual(
          errors,
          [],
          "the page must initialize and refresh without script errors",
        );
      } finally {
        await browser.close();
      }
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);
