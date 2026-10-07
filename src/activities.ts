// No real SMS is sent. A production provider would receive offerId as its idempotency key.
export async function sendSimulatedOffer(input: { offerId: string; fail: boolean }): Promise<{ delivered: boolean }> {
  console.info(`[simulated message] ${input.offerId}: ${input.fail ? "failed" : "delivered"}`);
  return { delivered: !input.fail };
}
