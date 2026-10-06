# Security boundaries and remaining work

## Intended environment

This is an authenticated, loopback-only local demonstration with fictional clients. It is not a multi-user production service and has not received an independent penetration test. Security checks reduce specific risks; they do not establish that no vulnerability can exist.

## Implemented controls

| Boundary | Control | Verification |
| --- | --- | --- |
| Local network exposure | API listens on 127.0.0.1; Docker publishes 7233/8233 on 127.0.0.1 only. | Live listeners and Docker port configuration checked. |
| Staff data/actions | Random temporary access code; server-side sessions; eight-hour expiry; logout invalidation. | Anonymous read/write and logout tests. |
| Session handling | HttpOnly and SameSite=Strict cookies; credentials never stored in browser localStorage or workflow history. | Cookie assertions and code review. |
| Cross-site requests | Host allowlist, same-origin checks, Fetch Metadata checks, JSON-only mutations, no permissive CORS. | Host/origin/content-type rejection tests. |
| Input abuse | Allowlisted enums/fields, bounded identifiers, valid dates/zones, body limit, session/address request budgets, and failed-login limits by connection address. Health probes retain host/origin checks and bypass traffic quotas. | Validation, oversized-body, login-limit, session-isolation, and health-availability tests. |
| Browser injection | DOM `textContent`; no inline application scripts; CSP; anti-framing and MIME-sniffing headers. | Header tests, source review, browser run without script errors. |
| Accidental disclosure | Only `public/` is served; no real phone numbers; safe API errors; ignored local runtime files. | Repository-file access tests and submission review. |
| Duplicate reservation | Serialized workflow mutations, current-offer validation, unique offer IDs, deadline checks, Update IDs. | Competing/repeated/late acceptance tests. |
| Dependencies | Existing packages retained and lockfile synchronized. | `npm audit` reported zero known vulnerabilities on 2026-10-06. This is a dated check, not a guarantee. |

## Deliberate limits

- **Trusted local computer:** other processes or users with access to this machine may access local Temporal ports, the terminal code, Docker storage, and workflow history. The app's login does not authenticate the Temporal development server. Do not enter real personal data or expose these ports publicly.
- **Local HTTP:** the app uses HTTP on loopback. Cookies intentionally omit `Secure` for this local setup. A public service requires HTTPS, Secure cookies, appropriately configured proxies, and production identity/authorization.
- **Shared demo identity:** the access code identifies a local staff session, not an individual employee or role. There is no per-employee audit trail, password recovery, or multi-tenant isolation.
- **Simulated contact:** no public client response endpoint exists. Real links require expiring client-scoped credentials; real SMS webhooks require provider signature verification, replay protection, and consent storage.
- **Alerts:** staff alerts appear in the dashboard. A full outage cannot deliver an in-app alert until service returns. Production requires an external alert channel and tested monitoring.
- **Calendar coordination:** this app cannot prevent independent Square bookings. A real integration requires atomic reservation coordination and reconciliation with Square's authoritative calendar.
- **Retention:** Temporal history contains fictional aliases and workflow details. Real deployments need data minimization, retention/deletion policy, encryption, access controls, and payload handling designed for that data.
- **Recovery:** application/worker restarts are gated. API health detection runs every two seconds and is not instantaneous. A Temporal-server-only interruption with still-running application processes requires restarting the full app to enforce operator review.
- **Long-running history:** the workflow is intentionally small and suitable for the assessment. A sustained deployment needs history rotation, retention, observability, and capacity testing.

Never put credentials in a public repository or screenshots. `.env`, `.runtime/`, temporary files, and logs are excluded by `.gitignore`. Review the actual staged submission before publishing.
