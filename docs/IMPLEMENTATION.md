# Implementation walkthrough

This guide is for someone opening the repository for the first time. Comments in code explain timing and safety decisions; this document connects them to Lena's needs.

## 1. Shared contracts and business rules

**Why:** Eligibility and deadlines must mean the same thing in the dashboard and workflow. Copying those checks into routes and browser handlers would let them drift.

**Steps:** `types.ts` describes an opening, contact policy, candidate, offer, reservation, and command. `rules.ts` checks consent and opt-outs, service, duration, required stylist, and availability. It then sorts eligible clients by join time. The HTTP response uses the same exclusion function to explain rejected candidates.

**Outcome:** Staff can see why a client was excluded, and the workflow makes its decisions using that same rule. Times use UTC milliseconds internally; presentation uses the configured salon zone.

## 2. A durable salon process

**Why:** Waiting for replies and remembering who is next are Lena's main sources of manual work. One authoritative process also keeps two staff browser tabs from creating competing offers.

**Steps:** The API starts or attaches to workflow ID `juniper-salon`. A `start` Update opens one cancellation. The workflow selects the next candidate, invokes the simulated notification Activity, then waits using Temporal `condition` with a durable deadline. A decline or timeout advances the queue. An acceptance, staff stop, cutoff, or exhausted list stops outreach.

**Outcome:** Reloading the browser does not lose the queue or reset the timer. The long-running salon workflow accepts later staff commands, including canceling a reservation or manually reopening. This deliberately narrows the prototype to one opening at a time; multiple openings would require shared reservation coordination.

## 3. Reservation and reply safety

**Why:** A delayed or repeated response must not claim an expired or already-reserved opening.

**Steps:** Each offer receives a new ID, including after reopening. Every reply must match the current offer and client, arrive before its deadline and the cutoff, and find the process actively offering. The command handler does not await between checking and reserving, so another reply cannot interleave. An HTTP idempotency key becomes the Temporal Update ID.

**Outcome:** Exactly one valid acceptance reserves the opening within this app. Other replies receive a clear rejection. Staff see a Square reminder, and marking entry into Square never pretends to call Square's API.

## 4. Consent, hours, and cutoff

**Why:** Filling a chair does not justify contacting the wrong person, contacting someone after opt-out, or offering an opening too late.

**Steps:** Start requests must specify a valid IANA time zone and same-day contact hours. The server resolves those hours into a persisted UTC window. Before each offer, the workflow checks the window and cutoff. The offer deadline is the earliest of the response window, contact closing time, and 30 minutes before the appointment. Opt-out withdraws the active offer and persists in the durable salon state.

**Outcome:** No later offer reaches an opted-out client, even after reopening. Quiet hours pause outreach; staff resume during permitted hours. The UI labels sample settings and 20-second demo timing explicitly. Production timing remains 15 minutes.

## 5. Staff controls and recovery

**Why:** Lena asked for manual review after restart, rather than automatically continuing a possibly stale opening.

**Steps:** API and worker startup persist a recovery Signal before normal operation. The Signal pauses active outreach and increments a review version. Acceptances are rejected while paused. Staff must confirm availability and send the current review version to resume. The original deadline is retained; an expired offer advances only after resume. A stale tab cannot clear a newer recovery pause. Canceling an individual offer also pauses the process.

**Outcome:** The actual process-restart test showed no additional offers before staff resumed. The worker additionally monitors API health and checks it before each simulated send. Detection takes time; the README explicitly limits claims about full infrastructure outages.

## 6. Notification boundary and failure handling

**Why:** A failed message must not silently remove a client's turn or create a reservation.

**Steps:** `activities.ts` provides a clearly simulated send. The worker checks API availability before invoking it. The workflow uses a bounded Activity timeout and a single attempt. A deliberate failure or uncertain completion stops outreach and shows a staff alert. If staff intervene while a send is pending, a generation check prevents its eventual result from undoing their action.

**Outcome:** The interface exposes failure instead of pretending delivery succeeded. With real SMS, this boundary needs provider idempotency, delivery reconciliation, signed webhooks, and an external alert channel; simulated delivery proves none of those integrations.

## 7. HTTP security and minimal data

**Why:** Even a local prototype should not expose staff controls or client details to arbitrary websites.

**Steps:** Loopback listeners limit network exposure. A random temporary access code creates an HttpOnly, SameSite=Strict session. Host/origin checks and JSON-only mutations block common cross-site request paths. Input allowlists, size and request limits, and generic infrastructure errors reduce the attack surface. The browser uses `textContent`, and CSP restricts scripts to this app. Only the `public/` directory is served. Credentials never enter workflow inputs or history.

**Outcome:** Anonymous reads and writes, cross-origin actions, oversized requests, unknown fields, and expired/logged-out sessions are rejected. Clients are fixed fictional aliases without phone numbers. Read `SECURITY.md` for the trust assumptions and production gaps.

## 8. A readable interface

**Why:** Staff need to understand the current opening quickly without knowing Temporal.

**Steps:** The left column configures the opening and policy. The main column shows status, the current offer, the queue with exclusion reasons, and activity history. A separate labeled simulator sends fictional client replies through the same authenticated API. Small DOM helpers centralize safe rendering and requests. The browser displays the server's decisions instead of recreating business rules.

**Outcome:** The demonstrated flow works on desktop and mobile. Connection failure marks status as potentially stale and disables the primary mutation controls. Temporal history is available through a separate inspection link.

## 9. Startup and documentation

**Why:** A reviewer should not need several terminals, Windows execution-policy changes, or knowledge of the original starter.

**Steps:** `node scripts/dev.mjs` installs locked dependencies when absent, brings up Docker, waits for Temporal, and starts the worker/API directly with Node's TypeScript loader. Shutdown handles both application processes. The README gives the demo sequence and a file-by-file reading order.

**Outcome:** One startup command was verified on this Windows machine. Application state survives because the Temporal database uses a named Docker volume. The public deployment and Docker service lifecycle remain explicit.

## 10. Verification and refactoring choices

**Why:** Passing a happy-path demo does not establish failure behavior or security.

**Steps:** Pure tests cover eligibility, time zones, and request validation. HTTP tests exercise authentication, cookies, origin and host checks, request limits, and restricted file serving. Workflow tests use real Temporal execution for deadlines, races, failures, opt-outs, quiet hours, and staff actions. Browser checks exercised the visible journey and mobile layout. An actual application process interruption verified recovery.

**Outcome:** The neutral demo was replaced rather than retained as an unused second path. Matching lives in `rules.ts`; validation in `validation.ts`; Temporal startup in `temporal.ts`; and HTTP access control in `security.ts`. The application has no added runtime dependencies. Formatting is consistent, and comments describe reasons rather than restating every line.

The original Temporal test server remains available through the existing test dependency. The presentation's editable source is included separately; it is not an application dependency.

## 11. Review fixes: completed bookings, request limits, and dashboard refresh

1. **Complete the Square handoff.** A staff confirmation archives the opening and accepted client, then changes the phase to `completed`. The archive survives the next opening, and repeated confirmations cannot create duplicate records. Completed openings cannot be reopened through outreach controls. A Temporal patch marker preserves replay behavior for earlier histories; an already-acknowledged reservation exposes a Complete booking button. This lets staff finish a successful booking without falsely canceling it.
2. **Separate request budgets.** Authenticated traffic uses a budget per valid session; anonymous traffic uses the actual connection address. Failed logins have a separate address-based allowance, and successful logins do not consume it. Health probes retain host/origin protection but bypass traffic quotas, preventing busy staff sessions from creating false outage signals. Expired buckets are removed.
3. **Follow the current offer.** When the active offer ID changes, the simulator selects that client. Staff can still deliberately select a historical offer to test late replies; refresh preserves that selection while the current offer remains the same.
4. **Preserve keyboard focus.** Unchanged responses refresh deadline text without rebuilding controls or lists. Changed responses reuse buttons by command, removing only controls that no longer apply. Comparing the small response also catches intermediate sending states that do not increment the workflow revision. Connection recovery forces a render to restore controls disabled during an outage.

The workflow and HTTP suites cover the handoff, archive preservation, repeat confirmation, independent session budgets, successful logins, and health availability. `npm run test:browser` uses Playwright as a development-only dependency to exercise the real DOM, authenticated HTTP boundary, simulator selection, focus, restored form inputs, and completed-booking display against isolated fixture state.
