# Juniper Salon waitlist

A local Temporal prototype that offers a same-day cancellation to eligible clients, one at a time. Staff can see replies, stop outreach, and review interrupted offers. An acceptance reserves the opening here and explicitly asks staff to enter it in Square.

**Lena's goal:** refill at least half of last-minute cancellations without double-bookings or repeated staff checking. That is a business target, not a result established by this demonstration.

## Run with one command

Prerequisites: a standard Node.js 20+ installation with npm, and Docker Desktop running with Linux containers. Internet access is needed on first run to install locked dependencies and pull the Temporal image. Ports 3000, 7233, and 8233 must be available.

Open a terminal in this directory (`temporal-assessment`) and run:

```sh
node scripts/dev.mjs
```

The launcher installs dependencies if absent, starts the persistent local Temporal service, waits for its port, then starts the worker and API. It launches Node directly, avoiding the Windows `npm.ps1` / `spawn npm` problems in the starter.

- App: http://localhost:3000
- Temporal Web UI: http://localhost:8233
- Sign in with the temporary staff access code printed in the terminal. Do not commit or share this code.
- Ctrl+C stops the application processes. To stop the Docker service too, run `docker compose down`. Its named volume preserves workflow history; do not delete the volume during a recovery demonstration.

Both Docker ports and the app bind to loopback. This is a local demonstration, not a public production deployment. A new app process creates a new code and invalidates previous browser sessions.

## A five-minute demonstration

1. Sign in. Review the salon time zone and contact hours. The initial 09:00–18:00 hours are sample settings, not Lena's confirmed policy. If demonstrating outside those hours, explicitly choose a sample window that includes now. The evidence run used 00:00–23:59 only for the simulated demonstration.
2. Create an opening today, more than 30 minutes away. Appointment input uses your browser's local time; the dashboard labels appointment times in the selected salon time zone. Choose the service, stylist, and duration.
3. Keep **Demo timing** selected for 20-second offers. Standard timing is 15 minutes. Fictional clients illustrate matching by consent, service, duration, availability, and required stylist. Eligible clients receive offers in oldest-first order.
4. Decline Alex's offer using the simulator. Let Morgan's offer time out. Select Riley's current offer in the simulator and accept it. The dashboard shows a reservation and the outstanding Square task.
5. Select Alex's old offer and try accepting it. The application rejects it. The same check prevents repeated or competing acceptances.
6. Mark the appointment as entered in Square. The opening becomes **Completed**, its booking is archived, and you can create another opening without canceling the successful booking. Completed bookings remain visible below the reservation.
7. Inspect `juniper-salon` in Temporal Web UI. The workflow contains actual notification Activities, durable timers, Updates for staff/client commands, and recovery Signals. Its status stays **Running** because it is the durable salon session; the business opening can already be **Reserved** or **Completed**.

Additional demonstrations:

- **Recovery:** cancel the sample reservation, manually reopen, wait for an offer, stop the app, and run the same startup command again. Sign in with the new code. The opening is paused. Acceptances are rejected. Confirm availability and resume; the original deadline remains in effect and an expired offer advances.
- **Delivery failure:** arm “Simulate failure of next message,” then reopen a stopped opening. It stops with a staff alert without silently skipping that client.
- **Opt-out:** opt out the active offer holder. Their offer is canceled immediately and they remain excluded after reopening.
- **Quiet hours:** create an opening with a contact window that excludes now. Outreach pauses before sending anything. Staff must resume during the configured window.
- **Cutoff:** outreach and offer validity end 30 minutes before the appointment. Staff can stop earlier.

## How to read the code

Start with `types.ts`, then `rules.ts`, then `workflows.ts`. The remaining files connect that process to HTTP and the browser.

| File | Responsibility |
| --- | --- |
| `src/types.ts` | Shared domain contracts and the single command union. |
| `src/rules.ts` | Pure matching, ordering, contact-window, and deadline calculations. |
| `src/workflows.ts` | Authoritative process state, reservation decisions, timers, and handlers. |
| `src/activities.ts` | Simulated notification transport and deliberate delivery failure. |
| `src/validation.ts` | HTTP input validation and conversion of salon contact hours to UTC. |
| `src/security.ts` | Staff sessions, host/origin checks, security headers, and request limits. |
| `src/app.ts` | HTTP routes, safe errors, and serving only `public/`. |
| `src/api.ts`, `src/temporal.ts` | Application startup and shared Temporal connection/recovery helpers. |
| `src/worker.ts`, `src/runtime-health.ts` | Activity registration, startup pause, and API availability monitoring. |
| `src/demo.ts` | Fictional waitlist fixtures; no real contact information. |
| `public/` | Dashboard rendering and simulator controls. The browser never decides who owns a slot. |
| `scripts/dev.mjs` | Cross-platform startup and process cleanup. |
| `tests/` | Business-rule, HTTP security, and real Temporal workflow tests. |

[Implementation walkthrough](docs/IMPLEMENTATION.md) explains what changed, why each part exists, and the sequence it follows. [Security notes](docs/SECURITY.md) explain the boundaries and remaining risks.

## Verify

After dependencies are installed:

```sh
npm test
npm run typecheck
npm audit
```

Browser regressions run separately against an isolated local HTTP server with fixture data, without touching the running salon. Install Chromium once, then run:

```powershell
npx.cmd playwright install chromium
npm.cmd run test:browser
```

In Windows PowerShell, use `npm.cmd` if script execution policy blocks `npm.ps1`. Tests use Temporal's isolated time-skipping test server, downloaded on the first run; Docker is not required for that test command. Integration tests can instead use the already-running local server:

```powershell
$env:TEMPORAL_TEST_ADDRESS = '127.0.0.1:7233'
npm.cmd test
Remove-Item Env:TEMPORAL_TEST_ADDRESS
```

The application itself always uses a real Temporal service. Tests cover filtering/order, timeout and exhaustion, simultaneous acceptances, recovery deadlines, consent/opt-outs, message failure, cutoff, staff controls, request validation, authentication, cross-origin protection, body limits, and session invalidation. Browser and actual process-restart verification are documented in `evidence/README.md`.

## Scope and limitations

- One opening at a time, with six fixed fictional waitlist clients. Google Sheets import, real SMS, payment, and Square writes are outside this prototype. The simulator is staff-only; there are no public client links.
- Canceling an individual offer pauses outreach until staff resume. Canceling a reservation does not automatically reopen it. Opting out of contact does not cancel an already accepted appointment.
- Square is still authoritative for the real calendar. This app cannot prevent independent bookings made in Square; staff coordination is required. “Entered in Square” is a staff acknowledgement, not an integration result.
- Contact settings cover one same-day window without overnight opening hours. Changing the opening or policy requires stopping and creating a new opening. Ambiguous repeated-hour windows are rejected.
- API/worker startup records a recovery pause before serving requests or polling tasks. A worker checks API availability before each simulated send and monitors it every two seconds. Outage detection is not instantaneous. An uncertain in-flight delivery requires manual handling rather than automatic resend.
- Restart the full application after a Temporal infrastructure outage. A standalone Temporal-server reconnect is not a fully implemented operator-review gate. Do not present this prototype as production outage management.
- The persistent salon workflow retains opt-outs, completed bookings, and the latest opening across app restarts. Its dashboard event list is capped at 100 entries. Completed bookings are retained for this small demo; archive limits, history rotation, long-term retention, production identity, monitoring outside the app, and multiple simultaneous openings remain production work.

## Submission artifacts

- [Temporal Web UI screenshot](evidence/temporal-workflow.png)
- [Dashboard screenshot](evidence/juniper-dashboard.png)
- [Four-slide PDF presentation](output/pdf/juniper-presentation.pdf)
- [Editable presentation source](output/juniper-presentation.pptx)

Keep this assessment in the assigned new public repository, not a fork. No real personal information, credentials, `.runtime/`, or `node_modules/` belong in the submission. No publishing or Git push is part of the local implementation.

## Technical references

The design uses Temporal's documented [message handlers](https://docs.temporal.io/develop/typescript/workflows/message-passing) and [durable timers](https://docs.temporal.io/develop/typescript/workflows/timers). HTTP controls follow the relevant local-app principles in [Express security guidance](https://expressjs.com/en/advanced/best-practice-security/). Production deployment requires additional controls described in the security notes.
