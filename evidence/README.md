# Prototype evidence

Captured from the local prototype on October 6, 2026. All clients and phone numbers are fictional; no real messages were sent.

- [Refined interface](prototype-polished.png): updated typography, ivory/sage palette, botanical sidebar and clearer offer status. Layout and forms checked at mobile and desktop sizes.
- [Confirmed booking](prototype-confirmed.png): Alex timed out, Sam accepted, and the queue records both outcomes.
- [Failed message](failed-message.png): delivery failure pauses outreach and exposes explicit staff phone outcomes.
- [Temporal workflow](temporal-workflow.png): real `juniper-salon-v2` coordinator, Running status, Signals, message Activities and durable timers. The coordinator stays Running to serve future openings; individual outcomes appear in the app.
- [Customer interview](customer-chat.txt): all 26 discovery turns. Final decisions supersede the initial broadcast suggestion.

Verification: `npm run typecheck` passed. `npm test` passed all 12 tests, including a full Temporal server test with workflow caching disabled, worker shutdown, timer expiry while offline, replay on a new worker, stale-reply rejection and next-client confirmation. This verifies the durable behavior rather than relying only on screenshots.

The browser walkthrough separately confirmed the timeout/next-client path, a rejected late acceptance, and Carla recording a phone acceptance after failed delivery. The source runs locally with `npm start`; the application is not publicly deployed.
