# Verification evidence

Verified locally on 2026-10-06 with Node 24.16.0 on Windows and Temporal SDK 1.24.0.

## Submitted screenshots

- `temporal-workflow.png`: actual Temporal Web UI for workflow `juniper-salon`, showing its ID, running status, and the timeline of notification Activities, durable timers, and command Updates. The salon workflow stays running to support staff commands after an opening is reserved.
- `juniper-dashboard.png`: actual browser demonstration showing Alex declining, Morgan timing out, and Riley accepting. Ineligible fictional clients are excluded, the Square reminder is visible, and a late acceptance is rejected.

All clients are fictional. The demonstration explicitly used sample 00:00–23:59 contact hours and 20-second reply windows. Standard timing is 15 minutes. Those sample hours are not Lena's confirmed business hours.

## Checks performed

- One-command startup using `node scripts/dev.mjs`, including starting the Docker service, worker, and API.
- TypeScript check and automated rule, HTTP security, and Temporal workflow tests.
- Tests against the local Docker Temporal server and the default isolated time-skipping test server.
- `npm audit`: zero known reported vulnerabilities at verification time.
- Browser sign-in, decline, timeout, acceptance, and late-reply rejection, with no uncaught page errors.
- Mobile viewport at 390 pixels: no horizontal overflow.
- Actual application process tree stopped while an offer was outstanding, then restarted through the documented command. Verified paused state, unchanged original deadline, rejection of paused acceptance, rejection of stale resume approval, and advancing the expired offer only after current staff review.
- PDF slide count and rendered-page inspection.

The screenshots and tests demonstrate the local prototype. They do not establish Lena's 50% refill target, real SMS delivery, Square synchronization, or readiness for public production deployment.
