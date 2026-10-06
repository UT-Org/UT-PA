import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import {
  salonWorkflow,
  command,
  getSalon,
  recoveryPause,
} from "../src/workflows";
import * as activities from "../src/activities";
import { demoCandidates } from "../src/demo";
import type { SalonCommand, SalonState } from "../src/types";

test("durable waitlist business scenarios", { timeout: 120_000 }, async (t) => {
  const environment = process.env.TEMPORAL_TEST_ADDRESS
    ? await TestWorkflowEnvironment.createFromExistingServer({
        address: process.env.TEMPORAL_TEST_ADDRESS,
      })
    : await TestWorkflowEnvironment.createTimeSkipping();
  const taskQueue = `test-${randomUUID()}`;
  const worker = await Worker.create({
    connection: environment.nativeConnection,
    taskQueue,
    workflowsPath: require.resolve("../src/workflows"),
    activities,
  });

  async function scenario(
    body: (context: {
      send: (input: SalonCommand) => Promise<{ ok: boolean; message: string }>;
      status: () => Promise<SalonState>;
      wait: (predicate: (s: SalonState) => boolean) => Promise<SalonState>;
      start: (
        seconds?: number,
        cutoffMs?: number,
        contactDelay?: number,
      ) => Promise<void>;
      pause: () => Promise<void>;
    }) => Promise<void>,
  ) {
    const handle = await environment.client.workflow.start(salonWorkflow, {
      workflowId: `test-${randomUUID()}`,
      taskQueue,
    });

    const status = () => handle.query(getSalon);

    const send = (input: SalonCommand) =>
      handle.executeUpdate(command, { args: [input] });

    async function wait(
      predicate: (state: SalonState) => boolean,
    ): Promise<SalonState> {
      for (let i = 0; i < 100; i++) {
        const state = await status();
        if (predicate(state)) return state;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error(
        `State did not arrive: ${JSON.stringify(await status())}`,
      );
    }

    async function start(
      seconds = 20,
      cutoffMs = 3_600_000,
      contactDelay = -1000,
    ) {
      const now = await environment.currentTimeMs();
      const opening = {
        id: randomUUID(),
        startAt: now + 30 * 60_000 + cutoffMs,
        durationMinutes: 60,
        service: "Haircut" as const,
        stylist: "Carla" as const,
      };
      await send({
        type: "start",
        opening,
        candidates: demoCandidates(opening, now),
        policy: {
          timeZone: "UTC",
          opens: "00:00",
          closes: "23:59",
          contactStartAt: now + contactDelay,
          contactEndAt: now + 24 * 3_600_000,
          offerSeconds: seconds,
          demo: true,
        },
      });
    }

    try {
      await body({
        send,
        status,
        wait,
        start,
        pause: () => handle.signal(recoveryPause, "test restart"),
      });
    } finally {
      await handle.terminate("Test complete");
    }
  }

  try {
    await worker.runUntil(async () => {
      await t.test(
        "Square handoff archives the booking and permits another opening",
        () =>
          scenario(async ({ send, start, wait, status }) => {
            await start();
            const first = (await wait((s) => s.offers[0]?.status === "waiting"))
              .offers[0];
            await send({
              type: "reply",
              offerId: first.id,
              clientId: first.clientId,
              answer: "accept",
            });
            const reserved = await status();
            await start();
            assert.equal(
              (await status()).opening?.id,
              reserved.opening?.id,
              "unconfirmed handoff still blocks a new opening",
            );
            assert.equal((await send({ type: "squareEntered" })).ok, true);
            assert.equal((await send({ type: "squareEntered" })).ok, true);
            const completed = await status();
            assert.equal(completed.phase, "completed");
            assert.equal(completed.reservation?.squareEntered, true);
            assert.equal(
              completed.completedBookings.length,
              1,
              "repeated confirmation does not duplicate the archive",
            );
            assert.deepEqual(
              completed.completedBookings[0].opening,
              reserved.opening,
            );
            assert.equal(
              completed.completedBookings[0].clientId,
              first.clientId,
            );
            for (const type of ["reopen", "stop", "cancelReservation"] as const)
              assert.equal(
                (await send({ type })).ok,
                false,
                "completed bookings cannot become available through outreach controls",
              );
            await start(20, 7_200_000);
            const next = await wait(
              (s) =>
                s.phase === "offering" && s.offers[0]?.status === "waiting",
            );
            assert.notEqual(next.opening?.id, reserved.opening?.id);
            assert.equal(next.reservation, null);
            assert.deepEqual(
              next.completedBookings,
              completed.completedBookings,
            );
            assert.equal(
              (
                await send({
                  type: "reply",
                  offerId: first.id,
                  clientId: first.clientId,
                  answer: "accept",
                })
              ).ok,
              false,
            );
          }),
      );
      await t.test("all nonresponders time out and outreach ends", () =>
        scenario(async ({ start, wait }) => {
          await start(1);
          for (let index = 0; index < 3; index++) {
            await wait((s) => s.offers[index]?.status === "waiting");
            await environment.sleep(1100);
          }
          const final = await wait((s) => s.phase === "exhausted");
          assert.equal(final.reservation, null);
          assert.ok(final.offers.every((offer) => offer.status === "expired"));
        }),
      );
      await t.test("quiet hours pause before any notification", () =>
        scenario(async ({ start, status, send }) => {
          await start(20, 3_600_000, 60_000);
          const state = await status();
          assert.equal(state.phase, "paused");
          assert.equal(state.offers.length, 0);
          assert.equal(
            (
              await send({
                type: "resume",
                openingAvailable: true,
                recoveryVersion: state.recoveryVersion,
              })
            ).ok,
            false,
          );
        }),
      );
      await t.test("decline, timeout, then exactly one valid acceptance", () =>
        scenario(async ({ send, wait, start, status }) => {
          await start(1);
          const first = (await wait((s) => s.offers[0]?.status === "waiting"))
            .offers[0];
          await send({
            type: "reply",
            offerId: first.id,
            clientId: first.clientId,
            answer: "decline",
          });
          await wait((s) => s.offers[1]?.status === "waiting");
          await environment.sleep(1100);
          const third = (await wait((s) => s.offers[2]?.status === "waiting"))
            .offers[2];
          const results = await Promise.all(
            [0, 1].map(() =>
              send({
                type: "reply",
                offerId: third.id,
                clientId: third.clientId,
                answer: "accept",
              }),
            ),
          );
          assert.equal(results.filter((r) => r.ok).length, 1);
          assert.equal((await status()).reservation?.clientId, "riley");
          assert.equal((await status()).reservation?.squareEntered, false);
          assert.equal(
            (
              await send({
                type: "reply",
                offerId: first.id,
                clientId: first.clientId,
                answer: "accept",
              })
            ).ok,
            false,
          );
        }),
      );
      await t.test(
        "pause rejects replies, preserves deadline, and skips expiry on resume",
        () =>
          scenario(async ({ send, wait, start, pause, status }) => {
            await start(1);
            const first = (await wait((s) => s.offers[0]?.status === "waiting"))
              .offers[0];
            await pause();
            await wait((s) => s.phase === "paused");
            assert.equal(
              (
                await send({
                  type: "reply",
                  offerId: first.id,
                  clientId: first.clientId,
                  answer: "accept",
                })
              ).ok,
              false,
            );
            await environment.sleep(1100);
            assert.equal((await status()).offers.length, 1);
            assert.equal((await status()).offers[0].deadline, first.deadline);
            await send({
              type: "resume",
              openingAvailable: true,
              recoveryVersion: (await status()).recoveryVersion,
            });
            const resumed = await wait(
              (s) => s.offers[1]?.status === "waiting",
            );
            assert.equal(resumed.offers[0].status, "expired");
          }),
      );
      await t.test(
        "opt-out cancels the active offer and persists across reopening",
        () =>
          scenario(async ({ send, wait, start }) => {
            await start();
            await wait((s) => s.offers[0]?.status === "waiting");
            await send({ type: "optOut", clientId: "alex" });
            const second = await wait((s) => s.offers[1]?.status === "waiting");
            assert.equal(second.offers[0].status, "opted_out");
            await send({ type: "stop" });
            await send({ type: "reopen" });
            assert.equal(
              (await wait((s) => s.offers[0]?.status === "waiting")).offers[0]
                .clientId,
              "morgan",
            );
          }),
      );
      await t.test("message failure stops without skipping the client", () =>
        scenario(async ({ send, wait, start }) => {
          await send({ type: "failNextMessage" });
          await start();
          const failed = await wait((s) => s.phase === "failed");
          assert.equal(failed.offers.length, 1);
          assert.equal(failed.offers[0].status, "failed");
          assert.match(failed.message, /STAFF ALERT/);
        }),
      );
      await t.test("cutoff invalidates an outstanding offer", () =>
        scenario(async ({ send, wait, start }) => {
          await start(20, 1000);
          const first = (await wait((s) => s.offers[0]?.status === "waiting"))
            .offers[0];
          await environment.sleep(1100);
          await wait((s) => s.phase === "stopped");
          assert.equal(
            (
              await send({
                type: "reply",
                offerId: first.id,
                clientId: first.clientId,
                answer: "accept",
              })
            ).ok,
            false,
          );
        }),
      );
      await t.test("exhaustion, staff cancellation, and manual reopening", () =>
        scenario(async ({ send, wait, start, status }) => {
          await start();
          await wait((s) => s.offers[0]?.status === "waiting");
          await send({ type: "cancelOffer" });
          assert.equal((await status()).phase, "paused");
          await send({
            type: "resume",
            openingAvailable: true,
            recoveryVersion: (await status()).recoveryVersion,
          });
          for (let i = 1; i < 3; i++) {
            const offer = (await wait((s) => s.offers[i]?.status === "waiting"))
              .offers[i];
            await send({
              type: "reply",
              offerId: offer.id,
              clientId: offer.clientId,
              answer: "decline",
            });
          }
          await wait((s) => s.phase === "exhausted");
          await send({ type: "reopen" });
          const offer = (await wait((s) => s.offers[0]?.status === "waiting"))
            .offers[0];
          await send({
            type: "reply",
            offerId: offer.id,
            clientId: offer.clientId,
            answer: "accept",
          });
          await send({ type: "cancelReservation" });
          assert.equal((await status()).phase, "stopped");
          assert.equal((await status()).reservation, null);
        }),
      );
    });
  } finally {
    await environment.teardown();
  }
});
