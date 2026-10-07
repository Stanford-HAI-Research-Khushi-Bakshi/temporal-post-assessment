export type Service = "Haircut" | "Color" | "Blowout";
export type Phase = "sending" | "waiting" | "needs_staff" | "booked" | "filled_by_staff" | "awaiting_reopen" | "canceled" | "unfilled";
export type OfferStatus = "sending" | "waiting" | "accepted" | "declined" | "timed_out" | "delivery_failed" | "skipped" | "withdrawn" | "conflict" | "booking_canceled";
export interface WaitlistClient {
  id: string; name: string; phone: string; service: Service; stylist: string;
  availableFrom: number; availableTo: number; joinedAt: number;
}
export interface Offer {
  id: string; clientId: string; status: OfferStatus; createdAt: number;
  sentAt?: number; deadline?: number; endedAt?: number; message: string; simulateFailure: boolean;
}
export interface Opening {
  id: string; service: Service; stylist: string; startAt: number; durationMinutes: number;
  stopAt: number; responseSeconds: number; createdAt: number; phase: Phase;
  candidates: string[]; offers: Offer[]; currentOfferId: string | null;
  bookedClientId: string | null; demo: boolean;
}
export interface SalonEvent { id: number; at: number; openingId: string; kind: string; text: string; actor: string }
export interface SalonState { version: number; clients: WaitlistClient[]; openings: Opening[]; events: SalonEvent[]; startedAt: number }
export interface Command {
  requestId: string;
  kind: "create" | "add_client" | "demo" | "respond" | "skip" | "manual_accept" | "manual_decline" | "fill" | "close" | "cancel_booking" | "reopen";
  actor?: string; openingId?: string; offerId?: string; response?: "accept" | "decline";
  scenario?: "timeout" | "failure" | "overlap";
  opening?: { service: Service; stylist: string; startAt: number; durationMinutes: number; stopAt: number; responseSeconds: number; simulateFailure?: boolean };
  client?: Omit<WaitlistClient, "id" | "joinedAt">;
}
export interface CommandResult { ok: boolean; message: string; openingId?: string }
