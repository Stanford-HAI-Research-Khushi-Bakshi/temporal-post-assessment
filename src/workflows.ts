import { condition, defineQuery, defineSignal, proxyActivities, setHandler } from "@temporalio/workflow";
import { SalonEngine } from "./salon";
import type { Command, CommandResult, SalonState } from "./types";
import type * as activities from "./activities";

export const getSalonState = defineQuery<SalonState>("getSalonState");
export const salonCommand = defineSignal<[Command]>("salonCommand");
export const getCommandResult = defineQuery<CommandResult | undefined, [string]>("getCommandResult");
const { sendSimulatedOffer } = proxyActivities<typeof activities>({
  startToCloseTimeout: "5 seconds",
  retry: { maximumAttempts: 1 }, // Lena wants a human handoff, not automatic retries.
});

export async function salonWorkflow(): Promise<void> {
  const engine = new SalonEngine(Date.now());
  let commandVersion = 0;
  setHandler(getSalonState, () => engine.state);
  setHandler(getCommandResult, (requestId) => engine.receipt(requestId));
  setHandler(salonCommand, (command) => {
    engine.command(command, Date.now());
    commandVersion++;
  });
  for (;;) {
    engine.advance(Date.now());
    const pending = engine.pendingDelivery();
    if (pending) {
      let delivered = false;
      try { delivered = (await sendSimulatedOffer({ offerId: pending.offer.id, fail: pending.offer.simulateFailure })).delivered; }
      catch { /* Provider failures pause the opening for staff as well. */ }
      engine.delivered(pending.opening.id, pending.offer.id, delivered, Date.now());
      continue;
    }
    const version = commandVersion;
    const deadline = engine.nextDeadline();
    if (deadline === undefined) await condition(() => commandVersion !== version);
    else await condition(() => commandVersion !== version, Math.max(1, deadline - Date.now()));
  }
}
