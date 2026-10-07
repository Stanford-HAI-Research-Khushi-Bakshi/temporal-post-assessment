# Juniper Salon — a calmer front desk

A local working prototype built from the Temporal assessment starter for Lena and Carla. It fills cancellation openings by offering them to eligible clients **one at a time**, with real durable waits and explicit staff handoffs.

## Run locally

Requirements: **Node.js 20+** and a running **Docker engine with Docker Compose** (Docker Desktop, or Colima with the Compose plugin configured). Ports 3000, 7233 and 8233 must be available.

From the repository directory, run this one command:

```bash
npm start
```

On the first run, it installs the locked npm dependencies. It then starts the local Temporal server, Worker and API.

- App: http://localhost:3000
- Temporal Web UI: http://localhost:8233
- Stop the API/worker: Ctrl+C in the running terminal.
- Stop Temporal: `npm run stop`. The Docker volume preserves its history and data; stopping does not erase offers.
- Subsequent starts reconnect to the same `juniper-salon-v2` Workflow. Reloading the page also restores state.

For this Mac's existing Colima setup, start Docker first with `colima start --profile hai-dbt` if needed. Docker Desktop users do not need Colima.

## A three-minute demonstration

1. Click **Timeout → next client**. Demo offers last 20 seconds; ordinary new openings default to Lena's 15 minutes. Let Alex time out, then click **Accept** for Sam in Client preview. The queue and activity journal show what happened.
2. In Client preview, select Alex's expired offer and click **Simulate a stale acceptance**. The reply is rejected and Sam keeps the booking. Sam's **Test duplicate acceptance** does not create another booking.
3. Click **Failed message**. The first simulated delivery fails and outreach pauses. It never retries automatically. As Carla or Lena, record a phone acceptance/decline or explicitly move on after no answer.
4. On a confirmed opening, expand **Staff controls & phone bookings** and record **Client canceled booking**. It stays paused until **Reopen & continue queue**. Earlier declines, timeouts and the canceled client are skipped; original order is preserved.
5. **Overlapping offers** creates two openings with different stylists at the same time. Accept Alex on one; the other withdraws Alex's overlapping offer and immediately moves to Sam. Non-overlapping offers remain valid. This scenario uses 20 seconds on Maya's opening and 2 minutes on Noor's, so act promptly or use New opening with salon timing for a slower walkthrough.
6. Reload or restart the worker during an offer. The original deadline and history survive. Check the corresponding timers and activities in Temporal Web UI.

All scenario buttons create new sample openings; none contacts real clients. The client preview is a simulation in the staff screen, including a deliberately exposed stale-response test button.

## Lena's confirmed rules

The full discovery conversation is in [evidence/customer-chat.txt](evidence/customer-chat.txt). Her final answers supersede her initial broadcast preference: turn 16 chose sequential offers, turn 17 rejected late acceptances, and turns 23–26 refined conflicts, cutoff and reopening.

- Match requested service, stylist preference (including any stylist), and availability for the **entire appointment**. Queue by date joined, earliest first.
- One active offer per opening; 15-minute default response window. Declines and timeouts advance automatically. Declining keeps the client on the waitlist for future openings.
- Only the current, unexpired offer may accept. Confirmation is immediate and a repeated acceptance is idempotent.
- A confirmed client cannot book overlapping appointments. Other overlapping active offers are withdrawn and those queues advance. Offers on non-overlapping dates/times stay active.
- A failed send pauses with a visible failure time and phone number. There are **no automatic retries**. Staff records the actual phone outcome or explicitly moves on after no answer.
- Staff chooses a final cutoff, which can shorten the last offer. It closes even a failed-send pause or an opening awaiting reopening.
- Client cancellation preserves the original queue and requires explicit staff reopening. Previously contacted candidates are never re-offered that same opening.
- Staff can mark a slot filled outside the waitlist or cancel the opening, immediately withdrawing the offer. History distinguishes **confirmed**, **filled by staff**, **canceled**, and **unfilled**.
- Lena and Carla can see the current client, remaining candidates, declines, timeouts, delivery failures, rejected replies, and final outcome.
- Moving or canceling existing Square appointments remains staff work.

## Where Temporal is meaningful

`salonWorkflow` is a long-lived **salon coordinator**. Its deterministic state machine serializes decisions across all openings, so competing acceptances cannot book the same client into overlapping appointments. This is intentionally one coordinator for this small salon, not one Workflow per client.

- **Workflow state and queries** retain the waitlist, candidates, offers, outcomes and activity journal. Nothing important is stored only in the API's memory or browser storage.
- **Temporal Signals** durably deliver staff and client commands; a receipt query returns their definitive accepted/rejected result. Request IDs and repeated-acceptance handling make actions idempotent.
- **Durable Temporal timers** wake at the earliest reply deadline or booking cutoff. The server keeps timers while a worker is offline; resumed processing checks overdue deadlines before any response is accepted.
- **Activities** represent message delivery. `sendSimulatedOffer` records a simulated outcome; `maximumAttempts: 1` implements Lena's explicit no-retry rule. A production SMS provider would use the offer ID as its idempotency key.
- Each delivery result is checked against the still-current offer, so a delayed activity result cannot revive an opening closed by staff.
- Temporal's SQLite database resides in the Compose named volume. Restarting processes preserves the coordinator's history and replays its state.

The coordinator remains **Running** after individual openings are booked or closed because it continues serving the front desk. Individual final outcomes are visible in the app and `getSalonState` query. See [evidence](evidence/) for screenshots.

## Tests

```bash
npm run typecheck
npm test
```

Tests cover matching, exact timeout boundaries, stale/duplicate accepts, cross-opening conflicts, failed sends and manual decisions, cutoff while paused, explicit reopening, queue preservation, staff closure outcomes, exhausted queues, idempotency, and Temporal timers/activities with worker recovery. The Temporal test uses a downloaded ephemeral test server and requires internet on its first run, but not Docker.

## Visual direction

Lena did not specify brand colors, fonts, or a logo during discovery. The deep green, warm ivory and sage palette, botanical illustration and serif headings are proposed design choices for this prototype, not customer requirements.

## Prototype boundaries

- **Simulated SMS only.** Offers, confirmations and withdrawal notices are shown in Client preview; no real texts or external provider calls occur.
- **No Square integration**, authentication, client self-service portal or production deployment. The Lena/Carla switch is an attribution selector, not security. Express binds to localhost.
- Five fictional clients are initially seeded. Availability is one continuous date/time range, and candidate lists are captured when an opening is created. Newly added clients apply to new openings. Seed availability covers the next seven days.
- “Filled outside waitlist” records an external booking whose client identity is unknown to this prototype. Staff must check Square conflicts; use **Record phone acceptance** for a known current waitlist client to retain automatic conflict protection.
- History is kept for this assessment's small workload. A production version would add Workflow Continue-As-New, a queryable read model, authenticated roles, provider integrations, richer recurring availability, audit retention and operational monitoring.
- Fonts optionally load from Google Fonts; the app has local font fallbacks.

## Source map

- `src/salon.ts`: deterministic business rules.
- `src/workflows.ts`: durable coordinator, timers, queries and signals.
- `src/activities.ts`: simulated message delivery.
- `src/api.ts`: local browser API and Temporal Client.
- `public/`: staff dashboard and client response simulator.
- `tests/`: behavior and Workflow recovery checks.

Based on [the assessment starter](https://github.com/john-b-yang/temporal-waitlist-assessment-starter). This is an independent public repository, not a GitHub fork. The application runs locally and has not been publicly deployed.
