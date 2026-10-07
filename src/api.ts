import path from "node:path";
import { Client, Connection, WorkflowExecutionAlreadyStartedError } from "@temporalio/client";
import express, { type NextFunction, type Request, type Response } from "express";
import type { Command, CommandResult, SalonState } from "./types";

const app = express();
const workflowId = process.env.SALON_WORKFLOW_ID ?? "juniper-salon-v2";
app.use(express.json({ limit: "20kb" }));
app.use(express.static(path.join(process.cwd(), "public")));
let ready: Promise<Client> | undefined;
async function client(): Promise<Client> {
  if (!ready) {
    ready = (async () => {
      const connection = await Connection.connect({ address: process.env.TEMPORAL_ADDRESS ?? "localhost:7233" });
      const temporal = new Client({ connection, namespace: "default" });
      try { await temporal.workflow.start("salonWorkflow", { workflowId, taskQueue: "juniper-salon" }); }
      catch (error) { if (!(error instanceof WorkflowExecutionAlreadyStartedError)) throw error; }
      return temporal;
    })().catch(error => { ready = undefined; throw error; });
  }
  return ready;
}
app.get("/api/state", async (_request, response) => {
  const temporal = await client();
  const state = await temporal.workflow.getHandle(workflowId).query<SalonState>("getSalonState");
  response.json({ ...state, workflowId, serverTime: Date.now(), simulated: true });
});
app.post("/api/commands", async (request, response) => {
  const command: Command = request.body;
  if (!command || typeof command !== "object" || !command.kind || !command.requestId) { response.status(400).json({ ok: false, message: "Action and request ID are required." }); return; }
  const temporal = await client();
  if (typeof command.requestId !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(command.requestId)) { response.status(400).json({ok:false,message:"Invalid request ID."}); return; }
  const handle = temporal.workflow.getHandle(workflowId);
  await handle.signal("salonCommand", command);
  let result: CommandResult | undefined;
  for (let attempt = 0; attempt < 150; attempt++) {
    result = await handle.query<CommandResult | undefined, [string]>("getCommandResult", command.requestId);
    if (result) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!result) { response.status(503).json({ok:false,message:"Your action is saved and still processing. Refresh to see its outcome."}); return; }
  response.status(result.ok ? 200 : 409).json(result);
});
app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  console.error(error);
  response.status(503).json({ ok: false, message: "The salon service is reconnecting. Existing offers are saved. Please try again.", detail: error instanceof Error ? error.message : "Unexpected error" });
});
const port = Number(process.env.PORT ?? 3000);
app.listen(port, "127.0.0.1", () => console.log("Juniper Salon is available at http://localhost:" + port));
