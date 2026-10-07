import assert from "node:assert/strict";
import { test } from "node:test";
import { SalonEngine, matches } from "../src/salon";
import type { Command, Opening } from "../src/types";
const T = 1_800_000_000_000;
let sequence = 0;
function action(engine: SalonEngine, cmd: Omit<Command, 'requestId'>, at = T) { return engine.command({ requestId: 'cmd-' + (++sequence), ...cmd }, at); }
function create(engine: SalonEngine, id='slot', extra: Partial<NonNullable<Command['opening']>> = {}) {
  const result = engine.command({ requestId:id, kind:'create', opening:{service:'Haircut',stylist:'Maya',startAt:T+3600000,durationMinutes:60,stopAt:T+1800000,responseSeconds:900,...extra}},T);
  assert.equal(result.ok,true,result.message); return engine.state.openings.find(o=>o.id===id)!;
}
function deliver(engine: SalonEngine, opening: Opening, ok=true, at=T) { engine.delivered(opening.id,opening.currentOfferId!,ok,at); return opening.offers.at(-1)!; }

test('matching checks service, stylist and full duration, with oldest eligible client first',()=>{
  const e=new SalonEngine(T), o=create(e);
  assert.deepEqual(o.candidates,['alex','sam','jordan']);
  assert.equal(matches({...e.state.clients[0],availableTo:o.startAt+30*60000},o),false);
  assert.equal(matches({...e.state.clients[0],stylist:'Noor'},o),false);
  assert.equal(matches({...e.state.clients[0],service:'Color'},o),false);
  assert.equal(o.offers[0].clientId,'alex');
});
test('timeouts advance; old and duplicate replies cannot change the winner',()=>{
  const e=new SalonEngine(T), o=create(e), first=deliver(e,o);
  e.advance(T+900000); assert.equal(first.status,'timed_out');
  const second=deliver(e,o,true,T+900000); assert.equal(second.clientId,'sam');
  assert.equal(action(e,{kind:'respond',openingId:o.id,offerId:first.id,response:'accept'},T+900001).ok,false);
  assert.equal(action(e,{kind:'respond',openingId:o.id,offerId:second.id,response:'accept'},T+900002).ok,true);
  assert.equal(action(e,{kind:'respond',openingId:o.id,offerId:second.id,response:'accept'},T+900003).ok,true);
  assert.equal(o.bookedClientId,'sam'); assert.equal(e.state.events.filter(x=>x.kind==='booked').length,1);
});
test('a reply arriving exactly at expiry is rejected even before timer processing',()=>{
  const e=new SalonEngine(T),o=create(e),f=deliver(e,o);
  assert.equal(action(e,{kind:'respond',openingId:o.id,offerId:f.id,response:'accept'},T+900000).ok,false);
  assert.equal(f.status,'timed_out'); assert.equal(o.offers.at(-1)!.clientId,'sam');
});
test('failed delivery pauses without retry, manual decisions resume explicitly',()=>{
  const e=new SalonEngine(T),o=create(e),f=deliver(e,o,false);
  e.advance(T+900000); assert.equal(o.phase,'needs_staff'); assert.equal(o.offers.length,1); assert.equal(e.pendingDelivery(),undefined);
  assert.equal(action(e,{kind:'respond',openingId:o.id,offerId:f.id,response:'accept'},T+900001).ok,false);
  assert.equal(action(e,{kind:'manual_decline',openingId:o.id,offerId:f.id,actor:'Carla'},T+900002).ok,true);
  assert.equal(o.offers.at(-1)!.clientId,'sam'); assert.equal(e.state.clients.some(c=>c.id==='alex'),true);
});
test('staff can record phone acceptance after a delivery failure',()=>{
  const e=new SalonEngine(T),o=create(e),f=deliver(e,o,false);
  assert.equal(action(e,{kind:'manual_accept',openingId:o.id,offerId:f.id,actor:'Carla'},T+1000).ok,true);
  assert.equal(o.phase,'booked');
});
test('global cutoff truncates offers and closes staff pauses',()=>{
  const e=new SalonEngine(T),o=create(e,'slot',{stopAt:T+300000}),f=deliver(e,o);
  assert.equal(f.deadline,T+300000); e.advance(T+300000); assert.equal(o.phase,'unfilled');
  const e2=new SalonEngine(T),o2=create(e2,'paused',{stopAt:T+300000});deliver(e2,o2,false);
  e2.advance(T+300000); assert.equal(o2.phase,'unfilled');
  assert.equal(action(e2,{kind:'manual_accept',openingId:o2.id,offerId:o2.offers[0].id},T+300001).ok,false);
});
test('booking cancels only overlapping offers and competing accepts cannot double book',()=>{
  const e=new SalonEngine(T),a=create(e,'a'),b=create(e,'b',{stylist:'Noor'}),c=create(e,'c',{startAt:T+10800000});
  const fa=deliver(e,a),fb=deliver(e,b),fc=deliver(e,c);
  assert.equal(action(e,{kind:'respond',openingId:a.id,offerId:fa.id,response:'accept'},T+100).ok,true);
  assert.equal(fb.status,'conflict'); assert.equal(b.offers.at(-1)!.clientId,'sam');
  assert.equal(fc.status,'waiting');
  assert.equal(action(e,{kind:'respond',openingId:b.id,offerId:fb.id,response:'accept'},T+100).ok,false);
  assert.equal(action(e,{kind:'respond',openingId:c.id,offerId:fc.id,response:'accept'},T+100).ok,true);
});
test('canceled booking waits for reopening, preserving queue and skipping previous candidates',()=>{
  const e=new SalonEngine(T),o=create(e);const first=deliver(e,o);
  action(e,{kind:'respond',openingId:o.id,offerId:first.id,response:'decline'},T+100);
  const second=deliver(e,o,true,T+100);action(e,{kind:'respond',openingId:o.id,offerId:second.id,response:'accept'},T+200);
  action(e,{kind:'cancel_booking',openingId:o.id},T+300);assert.equal(o.phase,'awaiting_reopen');assert.equal(e.pendingDelivery(),undefined);
  e.advance(T+500);assert.equal(o.offers.length,2);
  action(e,{kind:'reopen',openingId:o.id},T+600);assert.equal(o.offers.at(-1)!.clientId,'jordan');
  assert.equal(first.status,'declined');assert.equal(second.status,'booking_canceled');
});
test('staff closures immediately withdraw offers and distinguish final outcomes',()=>{
  for(const [kind,phase] of [['fill','filled_by_staff'],['close','canceled']] as const){
    const e=new SalonEngine(T),o=create(e),f=deliver(e,o);action(e,{kind,openingId:o.id},T+10);
    assert.equal(o.phase,phase);assert.equal(f.status,'withdrawn');assert.match(f.message,/no longer available/);
    assert.equal(action(e,{kind:'respond',openingId:o.id,offerId:f.id,response:'accept'},T+20).ok,false);
  }
});
test('no matches and exhausted queues become unfilled; repeated request IDs are idempotent',()=>{
  const e=new SalonEngine(T),o=create(e,'empty',{service:'Color',stylist:'Noor'});assert.equal(o.phase,'unfilled');
  const e2=new SalonEngine(T),o2=create(e2);const cmd:Command={requestId:'same',kind:'skip',openingId:o2.id,offerId:o2.currentOfferId!};
  const one=e2.command(cmd,T+10),count=o2.offers.length;assert.deepEqual(e2.command(cmd,T+20),one);assert.equal(o2.offers.length,count);
  while(o2.currentOfferId)action(e2,{kind:'skip',openingId:o2.id,offerId:o2.currentOfferId},T+30);
  assert.equal(o2.phase,'unfilled');
});
test('a late activity completion cannot revive a canceled opening',()=>{
  const e=new SalonEngine(T),o=create(e),id=o.currentOfferId!;action(e,{kind:'close',openingId:o.id},T+10);
  e.delivered(o.id,id,true,T+20);assert.equal(o.phase,'canceled');assert.equal(o.currentOfferId,null);
});
