import assert from "node:assert/strict";
import { test } from "node:test";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { salonWorkflow } from "../src/workflows";
import type { Command, CommandResult, SalonState } from "../src/types";
import * as activities from "../src/activities";

test("Temporal persists offers across worker restart, expires timers, rejects stale replies and confirms the next client", {timeout:120000}, async () => {
  // Exercise full server persistence and replay, with workflow caching disabled.
  const environment=await TestWorkflowEnvironment.createLocal();
  const opts={maxCachedWorkflows:0,connection:environment.nativeConnection,taskQueue:'juniper-test',workflowsPath:require.resolve('../src/workflows'),activities};
  const handle=await environment.client.workflow.start(salonWorkflow,{workflowId:'salon-recovery-test',taskQueue:'juniper-test'});
  const query=()=>Promise.race([
    handle.query<SalonState>('getSalonState'),
    new Promise<never>((_resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Query timed out')),8000);timer.unref();}),
  ]);
  const update=async(cmd:Command):Promise<CommandResult>=>{
    await handle.signal('salonCommand',cmd);
    for(let i=0;i<100;i++) {
      const result=await handle.query<CommandResult|undefined, [string]>('getCommandResult',cmd.requestId);
      if(result)return result;
      await new Promise(r=>setTimeout(r,20));
    }
    throw new Error('Command receipt timed out');
  };
  let originalOffer='';
  try {
    const worker=await Worker.create(opts);
    await worker.runUntil(async()=>{
      const now=await environment.currentTimeMs();
      assert.equal((await update({requestId:'create-test',kind:'create',opening:{service:'Haircut',stylist:'Maya',startAt:now+3600000,durationMinutes:60,stopAt:now+1800000,responseSeconds:5}})).ok,true);
      for(let i=0;i<50;i++){const s=await query();if(s.openings[0].phase==='waiting'){originalOffer=s.openings[0].currentOfferId!;break;}await new Promise(r=>setTimeout(r,20));}
      assert.ok(originalOffer,'first offer was delivered');
    });
    await new Promise(resolve => setTimeout(resolve, 6000));
    const worker2=await Worker.create(opts);
    await worker2.runUntil(async()=>{
      let state:SalonState|undefined;
      for(let i=0;i<100;i++){state=await query();if(state.openings[0].offers.length>=2&&state.openings[0].phase==='waiting')break;await new Promise(r=>setTimeout(r,20));}
      assert.equal(state!.openings[0].offers[0].status,'timed_out');
      const second=state!.openings[0].currentOfferId!;
      assert.equal((await update({requestId:'late',kind:'respond',openingId:'create-test',offerId:originalOffer,response:'accept'})).ok,false);
      assert.equal((await update({requestId:'yes',kind:'respond',openingId:'create-test',offerId:second,response:'accept'})).ok,true);
      assert.equal((await query()).openings[0].bookedClientId,'sam');
      const history=await handle.fetchHistory();
      assert.ok(history.events?.some(e=>e.timerStartedEventAttributes),'real durable timer was scheduled');
      assert.ok(history.events?.some(e=>e.activityTaskScheduledEventAttributes),'real messaging activity was scheduled');
      await handle.terminate('Test complete');
    });
  } finally {await environment.teardown();}
});
