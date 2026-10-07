import type { Command, CommandResult, Opening, Offer, SalonState, Service, WaitlistClient } from "./types";

const ACTIVE = new Set(["sending", "waiting", "needs_staff", "awaiting_reopen"]);
const SERVICES: Service[] = ["Haircut", "Color", "Blowout"];
const fail = (message: string): CommandResult => ({ ok: false, message });
export const overlaps = (a: Opening, b: Opening) => a.startAt < b.startAt + b.durationMinutes * 60_000 && b.startAt < a.startAt + a.durationMinutes * 60_000;
export function matches(client: WaitlistClient, opening: Pick<Opening, "service" | "stylist" | "startAt" | "durationMinutes">): boolean {
  return client.service === opening.service && (client.stylist === "Any" || client.stylist === opening.stylist)
    && client.availableFrom <= opening.startAt && client.availableTo >= opening.startAt + opening.durationMinutes * 60_000;
}
export function initialState(now: number): SalonState {
  return { version: 0, startedAt: now, openings: [], events: [], clients: [
    ["alex", "Alex Morgan", "Haircut", "Any"], ["sam", "Sam Rivera", "Haircut", "Any"],
    ["jordan", "Jordan Lee", "Haircut", "Maya"], ["avery", "Avery Chen", "Color", "Maya"],
    ["riley", "Riley Patel", "Blowout", "Noor"],
  ].map(([id, name, service, stylist], index) => ({ id, name, service: service as Service, stylist,
    phone: `+1 (415) 555-01${index + 10}`, availableFrom: now - 86_400_000,
    availableTo: now + 7 * 86_400_000, joinedAt: now - (7 - index) * 86_400_000 })) };
}

// One synchronous state machine in one Temporal Workflow serializes every booking,
// including conflicting client acceptances across different openings.
export class SalonEngine {
  readonly state: SalonState;
  private receipts = new Map<string, CommandResult>();
  constructor(now: number) { this.state = initialState(now); }
  private log(opening: Opening | null, now: number, kind: string, text: string, actor = "Juniper") {
    this.state.version++;
    this.state.events.push({ id: this.state.version, at: now, openingId: opening?.id ?? "", kind, text, actor });
  }
  private clientName(id: string) { return this.state.clients.find(c => c.id === id)?.name ?? "Client"; }
  private current(opening: Opening) { return opening.offers.find(o => o.id === opening.currentOfferId); }
  private bookedElsewhere(clientId: string, opening: Opening) {
    return this.state.openings.some(o => o.id !== opening.id && o.phase === "booked" && o.bookedClientId === clientId && overlaps(o, opening));
  }
  private withdraw(opening: Opening, now: number, reason: string, status: Offer["status"] = "withdrawn") {
    const offer = this.current(opening);
    if (offer) { offer.status = status; offer.endedAt = now; offer.message = reason;
      this.log(opening, now, "offer_withdrawn", `${this.clientName(offer.clientId)}: ${reason}`); }
    opening.currentOfferId = null;
  }
  private close(opening: Opening, phase: "canceled" | "unfilled" | "filled_by_staff", now: number, reason: string, actor = "Juniper") {
    this.withdraw(opening, now, "This opening is no longer available."); opening.phase = phase;
    this.log(opening, now, phase, reason, actor);
  }
  private next(opening: Opening, now: number, simulateFailure = false) {
    opening.currentOfferId = null;
    if (now >= opening.stopAt) { this.close(opening, "unfilled", now, "Booking cutoff reached. Opening closed unfilled."); return; }
    for (const clientId of opening.candidates) {
      if (opening.offers.some(o => o.clientId === clientId)) continue;
      const offer: Offer = { id: `${opening.id}-offer-${opening.offers.length + 1}`, clientId, status: "sending", createdAt: now,
        message: "Preparing your appointment offer.", simulateFailure };
      opening.offers.push(offer);
      if (this.bookedElsewhere(clientId, opening)) {
        offer.status = "conflict"; offer.endedAt = now; offer.message = "You already have an overlapping appointment.";
        this.log(opening, now, "conflict", `${this.clientName(clientId)} skipped: already booked at this time.`); continue;
      }
      opening.currentOfferId = offer.id; opening.phase = "sending";
      this.log(opening, now, "offer_preparing", `Preparing offer for ${this.clientName(clientId)}.`); return;
    }
    this.close(opening, "unfilled", now, opening.candidates.length ? "No eligible candidates remain. Opening stayed unfilled." : "No matching waitlist clients. Opening stayed unfilled.");
  }
  advance(now: number) {
    for (const opening of this.state.openings) {
      if (!ACTIVE.has(opening.phase)) continue;
      if (now >= opening.stopAt) { this.close(opening, "unfilled", now, "Booking cutoff reached. Opening closed unfilled."); continue; }
      const offer = this.current(opening);
      if (opening.phase === "waiting" && offer?.deadline !== undefined && now >= offer.deadline) {
        offer.status = "timed_out"; offer.endedAt = now; offer.message = "Your offer has expired. The next client now has a turn.";
        this.log(opening, now, "timed_out", `${this.clientName(offer.clientId)} did not respond before the deadline.`); this.next(opening, now);
      }
    }
  }
  nextDeadline(): number | undefined {
    const times: number[] = [];
    for (const opening of this.state.openings) { if (!ACTIVE.has(opening.phase)) continue;
      times.push(opening.stopAt); const offer = this.current(opening);
      if (opening.phase === "waiting" && offer?.deadline) times.push(offer.deadline); }
    return times.length ? Math.min(...times) : undefined;
  }
  pendingDelivery() {
    for (const opening of this.state.openings) { const offer = this.current(opening);
      if (opening.phase === "sending" && offer?.status === "sending") return { opening, offer }; }
    return undefined;
  }
  delivered(openingId: string, offerId: string, success: boolean, now: number) {
    this.advance(now); const opening = this.state.openings.find(o => o.id === openingId);
    if (!opening || opening.phase !== "sending" || opening.currentOfferId !== offerId) return;
    const offer = this.current(opening)!;
    if (success) {
      offer.status = "waiting"; offer.sentAt = now; offer.deadline = Math.min(now + opening.responseSeconds * 1000, opening.stopAt);
      offer.message = "An earlier appointment is available. Please accept or decline before your offer expires."; opening.phase = "waiting";
      this.log(opening, now, "offer_sent", `Offer sent to ${this.clientName(offer.clientId)}. Waiting for a reply.`);
    } else {
      offer.status = "delivery_failed"; offer.message = "Message was not delivered. Staff follow-up required."; opening.phase = "needs_staff";
      this.log(opening, now, "delivery_failed", `Message to ${this.clientName(offer.clientId)} failed. Paused for staff; no automatic retry.`);
    }
  }
  private accept(opening: Opening, offer: Offer, now: number, actor: string): CommandResult {
    if (this.bookedElsewhere(offer.clientId, opening)) return fail("This client already has an overlapping appointment.");
    offer.status = "accepted"; offer.endedAt = now; offer.message = "Your appointment is confirmed. This appointment is yours.";
    opening.phase = "booked"; opening.bookedClientId = offer.clientId; opening.currentOfferId = null;
    this.log(opening, now, "booked", `${this.clientName(offer.clientId)} accepted. Appointment confirmed. Update any previous booking in Square manually.`, actor);
    for (const other of this.state.openings) {
      if (other.id === opening.id || !overlaps(other, opening) || !ACTIVE.has(other.phase)) continue;
      if (this.current(other)?.clientId === offer.clientId) {
        this.withdraw(other, now, "This offer was withdrawn because you accepted an overlapping appointment.", "conflict"); this.next(other, now);
      }
    }
    return { ok: true, message: `${this.clientName(offer.clientId)} is confirmed.`, openingId: opening.id };
  }
  private create(cmd: Command, now: number, demo = false): CommandResult {
    const input = cmd.opening;
    if (!input || !SERVICES.includes(input.service) || !["Maya", "Noor"].includes(input.stylist)) return fail("Choose a valid service and stylist.");
    if (![input.startAt, input.stopAt, input.durationMinutes, input.responseSeconds].every(Number.isFinite)) return fail("Enter valid appointment times.");
    if (input.startAt <= now || input.stopAt <= now || input.stopAt > input.startAt) return fail("The cutoff must be in the future and no later than the appointment.");
    if (input.durationMinutes < 15 || input.durationMinutes > 240 || input.responseSeconds < 5 || input.responseSeconds > 900) return fail("Duration must be 15–240 minutes and response window 5–900 seconds.");
    const opening: Opening = { ...input, id: cmd.requestId, createdAt: now, phase: "sending", candidates: [], offers: [], currentOfferId: null, bookedClientId: null, demo };
    if (this.state.openings.some(o => o.stylist === opening.stylist && (ACTIVE.has(o.phase) || o.phase === "booked" || o.phase === "filled_by_staff") && overlaps(o, opening))) return fail("This stylist already has an opening or booking at that time.");
    opening.candidates = this.state.clients.filter(c => matches(c, opening)).sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id)).map(c => c.id);
    this.state.openings.push(opening);
    this.log(opening, now, "created", `${opening.service} opening with ${opening.stylist}. ${opening.candidates.length} matching clients, oldest first.`, cmd.actor ?? "Staff");
    this.next(opening, now, !!input.simulateFailure);
    return { ok: true, message: "Opening created. Outreach has started.", openingId: opening.id };
  }
  private apply(cmd: Command, now: number): CommandResult {
    const actor = cmd.actor === "Lena" || cmd.actor === "Carla" ? cmd.actor : "Staff";
    if (cmd.kind === "create") return this.create(cmd, now);
    if (cmd.kind === "demo") {
      if (!["timeout", "failure", "overlap"].includes(cmd.scenario ?? "")) return fail("Choose a demo scenario.");
      const latest = Math.max(now + 90 * 60_000, ...this.state.openings.map(o => o.startAt + o.durationMinutes * 60_000 + 30 * 60_000));
      const input = { service: "Haircut" as Service, stylist: "Maya", startAt: latest, durationMinutes: 60, stopAt: now + 20 * 60_000, responseSeconds: 20, simulateFailure: cmd.scenario === "failure" };
      const result = this.create({ ...cmd, opening: input }, now, true);
      if (result.ok && cmd.scenario === "overlap") this.create({ ...cmd, requestId: `${cmd.requestId}-overlap`, opening: { ...input, stylist: "Noor", responseSeconds: 120 } }, now, true);
      return result;
    }
    if (cmd.kind === "add_client") {
      const c = cmd.client;
      if (!c || typeof c.name !== "string" || c.name.trim().length < 2 || c.name.length > 60 || typeof c.phone !== "string" || !/^[+\d ()-]{7,24}$/.test(c.phone) || !SERVICES.includes(c.service) || !["Any", "Maya", "Noor"].includes(c.stylist)) return fail("Enter the client's name, phone, service, and stylist preference.");
      if (![c.availableFrom, c.availableTo].every(Number.isFinite) || c.availableTo <= c.availableFrom || c.availableTo <= now) return fail("Choose a valid future availability range.");
      this.state.clients.push({ ...c, name: c.name.trim(), id: cmd.requestId, joinedAt: now });
      this.log(null, now, "client_added", `${c.name.trim()} joined the waitlist. Eligible for new openings.`, actor);
      return { ok: true, message: "Client added to the waitlist for new openings." };
    }
    const opening = this.state.openings.find(o => o.id === cmd.openingId);
    if (!opening) return fail("Opening not found.");
    const offer = opening.offers.find(o => o.id === cmd.offerId); const activeOffer = this.current(opening);
    if (cmd.kind === "respond" || cmd.kind === "manual_accept" || cmd.kind === "manual_decline") {
      const response = cmd.kind === "manual_accept" ? "accept" : cmd.kind === "manual_decline" ? "decline" : cmd.response;
      if (response !== "accept" && response !== "decline") return fail("Choose accept or decline.");
      if (offer?.status === "accepted" && response === "accept" && opening.phase === "booked") return { ok: true, message: "Already confirmed. No duplicate booking was created.", openingId: opening.id };
      const manual = cmd.kind !== "respond";
      if (!offer || offer.id !== activeOffer?.id || !(opening.phase === "waiting" || (manual && opening.phase === "needs_staff"))) {
        const message = offer?.status === "timed_out" ? "This offer has expired. The next client keeps their turn." : "This offer is no longer available. No booking was made.";
        this.log(opening, now, "response_rejected", `${offer ? this.clientName(offer.clientId) : "Client"}: ${message}`, manual ? actor : "Client"); return fail(message);
      }
      if (response === "accept") return this.accept(opening, offer, now, manual ? actor : "Client");
      offer.status = "declined"; offer.endedAt = now; offer.message = "Declined. You remain on the waitlist for future openings.";
      this.log(opening, now, "declined", `${this.clientName(offer.clientId)} declined. Kept on the waitlist for future openings.`, manual ? actor : "Client");
      this.next(opening, now); return { ok: true, message: "Decline recorded. Moving to the next eligible client.", openingId: opening.id };
    }
    if (cmd.kind === "cancel_booking") {
      if (opening.phase !== "booked" && opening.phase !== "filled_by_staff") return fail("Only a confirmed booking can be canceled.");
      const accepted = opening.offers.find(o => o.status === "accepted");
      if (accepted) { accepted.status = "booking_canceled"; accepted.message = "This booking was canceled."; accepted.endedAt = now; }
      opening.bookedClientId = null; opening.phase = "awaiting_reopen";
      this.log(opening, now, "booking_canceled", "Booking canceled. Paused until staff reopen; the original queue and previous outcomes are preserved.", actor);
      if (now >= opening.stopAt) this.close(opening, "unfilled", now, "The cutoff has passed. Cannot reopen this opening.");
      return { ok: true, message: "Cancellation recorded. Staff must reopen to continue.", openingId: opening.id };
    }
    if (cmd.kind === "reopen") {
      if (opening.phase !== "awaiting_reopen") return fail("This opening is not waiting to be reopened.");
      this.log(opening, now, "reopened", "Staff reopened the opening. Continuing the original queue, without re-offering to previous candidates.", actor);
      this.next(opening, now); return { ok: true, message: "Opening reopened. Continuing with the next eligible client.", openingId: opening.id };
    }
    if (!ACTIVE.has(opening.phase)) return fail("This opening is already closed or booked.");
    if (cmd.kind === "skip") {
      if (!activeOffer || cmd.offerId !== activeOffer.id) return fail("The current offer changed. Refresh before moving on.");
      this.withdraw(opening, now, "Staff ended this offer and moved to the next client.", "skipped");
      this.log(opening, now, "staff_skipped", "Staff chose to move to the next eligible client.", actor); this.next(opening, now);
      return { ok: true, message: "Moved to the next eligible client.", openingId: opening.id };
    }
    if (cmd.kind === "fill") { this.close(opening, "filled_by_staff", now, "Filled by staff outside this offer flow. Active offer withdrawn; update Square manually.", actor); return { ok: true, message: "Marked filled by staff. Active offer is no longer available.", openingId: opening.id }; }
    if (cmd.kind === "close") { this.close(opening, "canceled", now, "Opening canceled by staff. Active offer withdrawn.", actor); return { ok: true, message: "Opening canceled. Client offer withdrawn.", openingId: opening.id }; }
    return fail("Unknown action.");
  }
  receipt(requestId: string): CommandResult | undefined { return this.receipts.get(requestId); }
  command(cmd: Command, now: number): CommandResult {
    this.advance(now);
    if (!cmd || typeof cmd.requestId !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(cmd.requestId)) return fail("A valid request ID is required.");
    const previous = this.receipts.get(cmd.requestId); if (previous) return previous;
    const result = this.apply(cmd, now); this.receipts.set(cmd.requestId, result);
    if (this.receipts.size > 2000) this.receipts.delete(this.receipts.keys().next().value!);
    return result;
  }
}
