# Prototype evidence

Captured from the local prototype on October 6, 2026. All clients and phone numbers are fictional; no real messages were sent.

- [Refined interface](prototype-polished.png): updated typography, ivory/sage palette, botanical sidebar and clearer offer status. Layout and forms checked at mobile and desktop sizes.
- [Confirmed booking](prototype-confirmed.png): Alex timed out, Sam accepted, and the queue records both outcomes.
- [Failed message](failed-message.png): delivery failure pauses outreach and exposes explicit staff phone outcomes.
- [Temporal workflow](temporal-workflow.png): real `juniper-salon-v2` coordinator, Running status, Signals, message Activities and durable timers. The coordinator stays Running to serve future openings; individual outcomes appear in the app.
- [Customer interview](customer-chat.txt): all 26 discovery turns. Final decisions supersede the initial broadcast suggestion.

Verification: `npm run typecheck` passed. `npm test` passed all 12 tests, including a full Temporal server test with workflow caching disabled, worker shutdown, timer expiry while offline, replay on a new worker, stale-reply rejection and next-client confirmation. This verifies the durable behavior rather than relying only on screenshots.

The browser walkthrough separately confirmed the timeout/next-client path, a rejected late acceptance, and Carla recording a phone acceptance after failed delivery. The source runs locally with `npm start`; the application is not publicly deployed.

## Final verification after the visual refresh

Reran all 12 automated tests, TypeScript checking, JavaScript syntax checking and whitespace checks successfully. An isolated browser session on port 3001 exercised the final interface against a separate real Temporal coordinator (`juniper-ui-check`).

The browser pass verified adding a fictional client, service/stylist matching, decline to an unfilled outcome while retaining the client on the waitlist, overlapping-offer withdrawal, acceptance and duplicate acceptance, cancellation followed by explicit reopening to the next original candidate, filling outside the waitlist, rejection of a withdrawn offer, failed delivery followed by Carla's phone decline, explicit skip, and opening cancellation. The dashboard, waitlist, forms and filters were exercised. Desktop and mobile layout checks are documented above.

One display defect was found and fixed: filtering to active openings could retain a closed opening's detail panel. The selected opening now follows the visible list, and creating a new opening or demo returns to All so its result is visible. Verified the empty Active filter contains no stale opening details. [Browser verification screenshot](browser-verification.png).

This is verification of the local assessment prototype, not a production certification. Real SMS delivery and Square integration are deliberately excluded and were not tested.
