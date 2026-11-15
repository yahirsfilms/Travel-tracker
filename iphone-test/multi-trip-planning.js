// Paired multi-trip planning journal. Canonical cash remains in accounting.js.
// The normal app enters through the explicitly reviewed coordinated adapter.
import {dayNumber} from './core.js';
import {createPlan,validatePlan,projectPlan,recordPlanningPurchase,correctPlanningPurchase,ENVELOPES} from './planning.js';
const sum=xs=>xs.reduce((n,x)=>n+x,0),need=(ok,m)=>{if(!ok)throw Error(m);},money=x=>Number.isSafeInteger(x)&&x>=0&&x<=1e11;
const text=x=>typeof x==='string'&&x.trim().length>0&&x.length<=500;
const same=(a,b)=>(a.tripId||null)===(b.tripId||null)&&a.envelope===b.envelope;
const total=p=>sum(Object.values(p.opening));
function account(b,a){need(a&&ENVELOPES.includes(a.envelope),'Choose a valid budget.');if(!a.tripId){need(a.envelope==='unassigned','Only unassigned money is shared outside a trip.');return;}need(b.trips.some(t=>t.id===a.tripId),'Choose a known trip.');}
export function validateMultiTrip(b){
 need(b?.version===1&&text(b.id)&&money(b.openingCash)&&Array.isArray(b.trips)&&b.trips.length<=100&&Array.isArray(b.moves)&&b.moves.length<=10000&&Array.isArray(b.ledger)&&b.ledger.length<=20000&&['USD','CNY','JPY','EUR','MXN','HKD','GBP'].includes(b.currency),'Invalid multi-trip planning preview.');
 const trips=new Set();for(const t of b.trips){need(text(t.id)&&text(t.name)&&!trips.has(t.id),'Duplicate or invalid trip.');trips.add(t.id);validatePlan(t.plan);need(t.plan.currency===b.currency,'Trip planning currencies must match the shared fund.');need(t.plan.transactions.every(x=>x.kind!=='funding'&&!x.id.startsWith('multi:')),'External cash cannot be invented inside a trip plan.');}
 need(sum(b.trips.map(t=>total(t.plan)))<=b.openingCash,'Opening trip allocations exceed shared money.');
 const ids=new Set();for(const x of b.moves){need(text(x.id)&&!ids.has(x.id)&&money(x.amount)&&x.amount>0&&text(x.note),'Invalid or duplicate budget move.');ids.add(x.id);dayNumber(x.date);account(b,x.from);account(b,x.to);need(!same(x.from,x.to),'Choose a different budget.');for(const a of [x.from,x.to])if(a.tripId){dayNumber(x.dates?.[a.tripId]);}if(x.from.envelope==='emergency')need(x.acknowledgeEmergency===true,'Explicitly acknowledge an emergency reserve move.');}
 for(const x of b.moves.filter(x=>x.reversalOf)){const original=b.moves.find(o=>o.id===x.reversalOf);need(original&&!original.reversalOf&&same(x.from,original.to)&&same(x.to,original.from)&&x.amount===original.amount&&x.date>=original.date&&b.moves.filter(a=>a.reversalOf===original.id).length===1,'Invalid or repeated reversal.');}
 const deposits=new Set();for(const x of b.ledger){need(text(x.id)&&!deposits.has(x.id)&&Number.isSafeInteger(x.amount)&&money(Math.abs(x.amount))&&x.amount!==0&&text(x.note),'Invalid shared cash record.');dayNumber(x.date);deposits.add(x.id);}
 for(const t of b.trips)validatePlan(materializeTrip(b,t));
 return b;
}
export function createMultiTrip({id,currency='USD',cash}){need(['USD','CNY','JPY','EUR','MXN','HKD','GBP'].includes(currency),'Choose a supported shared currency.');return validateMultiTrip({version:1,id,currency,openingCash:cash,trips:[],moves:[],ledger:[]});}
export function materializeTrip(b,t){const p=structuredClone(t.plan);for(const m of b.moves){
 const outgoing=m.from.tripId===t.id,incoming=m.to.tripId===t.id;
 if(outgoing&&incoming){p.transfers.push({id:'multi:'+m.id,date:m.dates[t.id],from:m.from.envelope,to:m.to.envelope,amount:m.amount,note:m.note});continue;}
 if(outgoing){if(m.from.envelope!=='unassigned')p.transfers.push({id:'multi:'+m.id+':out',date:m.dates[t.id],from:m.from.envelope,to:'unassigned',amount:m.amount,note:m.note});p.transactions.push({id:'multi:'+m.id+':sent',date:m.dates[t.id],amount:m.amount,envelope:'unassigned',kind:'funding'});}
 if(incoming){p.transactions.push({id:'multi:'+m.id+':received',date:m.dates[t.id],amount:-m.amount,envelope:'unassigned',kind:'funding'});if(m.to.envelope!=='unassigned')p.transfers.push({id:'multi:'+m.id+':in',date:m.dates[t.id],from:'unassigned',to:m.to.envelope,amount:m.amount,note:m.note});}
 }return p;}
export function projectMultiTrip(b,dates,{actual}={}){
 validateMultiTrip(b);const views=Object.fromEntries(b.trips.map(t=>{dayNumber(dates[t.id]);return [t.id,projectPlan(materializeTrip(b,t),dates[t.id])];}));
 const sharedRaw=b.openingCash-sum(b.trips.map(t=>total(t.plan)))+sum(b.ledger.map(x=>x.amount))+sum(b.moves.map(m=>!m.to.tripId?m.amount:!m.from.tripId?-m.amount:0));
 const recorded=b.openingCash+sum(b.ledger.map(x=>x.amount))-sum(b.trips.map(t=>sum(t.plan.transactions.map(x=>x.amount))));
 need(Number.isSafeInteger(recorded)&&Math.abs(recorded)<=1e11,'Shared cash exceeds the supported range.');
 const uncovered=sum(Object.values(views).map(v=>v.uncovered))+Math.max(0,-sharedRaw),commitmentShortfall=sum(Object.values(views).map(v=>v.commitmentShortfall)),assigned=sum(Object.values(views).map(v=>v.reconciliation.planned)),shared=Math.max(0,sharedRaw);
 need(actual===undefined||actual===recorded,'Multi-trip budgets do not reconcile with canonical actual money.');need(assigned+shared-uncovered===recorded,'Multi-trip planning money is counted more than once.');
 const dailyFundingShortfall=sum(Object.values(views).map(v=>v.dailyFundingShortfall));
 // Do not add overlapping warning amounts. Cover negative envelopes, then
 // confirmed obligations and the remaining fixed daily plan exactly once.
 const tripFundingShortfalls=Object.fromEntries(b.trips.map(t=>[t.id,views[t.id].fundingShortfall]));
 const fundingShortfall=Math.max(0,-sharedRaw)+sum(Object.values(tripFundingShortfalls));
 return {actual:recorded,sharedUnassigned:shared,availableToAllocate:Math.max(0,shared-fundingShortfall),views,uncovered,commitmentShortfall,dailyFundingShortfall,fundingShortfall,tripFundingShortfalls,reconciliation:{assigned,shared,uncovered,total:assigned+shared-uncovered,actual:recorded}};
}
export function addMultiTrip(b,{id,name,start,end,activationDate=start,zone,currency=b.currency,target,opening},dates){
 validateMultiTrip(b);need(!b.trips.some(t=>t.id===id)&&currency===b.currency,'Choose a new trip in the shared planning currency.');const p=createPlan({id,start,end,activationDate,zone,currency,target,opening});
 const current=projectMultiTrip(b,dates),required=(dayNumber(end)-dayNumber(activationDate)+1)*target;need(p.opening.daily>=required,'Back the fixed daily limits before allocating the new trip.');need(total(p)<=current.availableToAllocate,'New trip allocation exceeds genuinely available shared money.');const next=structuredClone(b);next.trips.push({id,name,plan:p});validateMultiTrip(next);return next;
}
export function moveMultiBudget(b,{id,date,from,to,amount,note,acknowledgeEmergency=false},dates){
 validateMultiTrip(b);account(b,from);account(b,to);dayNumber(date);need(text(id)&&!b.moves.some(m=>m.id===id)&&text(note)&&money(amount)&&amount>0&&!same(from,to),'Enter a new positive budget move and reason.');
 for(const a of [from,to])if(a.tripId){const p=b.trips.find(t=>t.id===a.tripId).plan;need(!p.clockReview&&!p.archived,'Review or reopen the trip before moving its budgets.');dayNumber(dates[a.tripId]);}
 const eventDay=dates[from.tripId||to.tripId];need(date===eventDay,'Review this move on the current source travel day.');need(from.envelope!=='emergency'||acknowledgeEmergency,'Explicitly acknowledge an emergency reserve move.');
 const before=projectMultiTrip(b,dates),source=from.tripId?before.views[from.tripId]:null;
 const available=source?Math.max(0,source.transferable[from.envelope]-(before.uncovered-source.uncovered)-(before.commitmentShortfall-source.commitmentShortfall)):before.availableToAllocate;
 const sourcePlan=from.tripId?b.trips.find(t=>t.id===from.tripId).plan:null,obligation=sourcePlan?sum(sourcePlan.commitments.filter(c=>c.envelope===from.envelope).map(c=>c.unpaid)):0,future=source&&from.envelope==='daily'?sum(source.days.filter(d=>d.date>=dates[from.tripId]).map(d=>Math.max(0,d.target-d.spent))):0;
 const gross=source?Math.max(0,source.balances[from.envelope]-obligation-future):before.sharedUnassigned;
 need(amount<=gross,'Source money is spent, committed, short or needed for future fixed limits.');
 const next=structuredClone(b),boundaryDates=Object.fromEntries([from,to].filter(a=>a.tripId).map(a=>[a.tripId,dates[a.tripId]]));next.moves.push({id,date,from:structuredClone(from),to:structuredClone(to),amount,note,acknowledgeEmergency,dates:boundaryDates});validateMultiTrip(next);const after=projectMultiTrip(next,dates),relief=Math.max(0,before.fundingShortfall-after.fundingShortfall);need(amount<=available+relief,'Source money is spent, committed, short or needed for future fixed limits.');need(after.actual===before.actual,'Budget moves cannot change shared cash.');return next;
}
export function splitMultiSavings(b,{id,date,fromTripId,allocations,note},dates){
 need(Array.isArray(allocations)&&allocations.length>0&&text(id),'Enter a savings split.');let next=structuredClone(b);const destinations=new Set();for(let i=0;i<allocations.length;i++){const a=allocations[i],key=JSON.stringify(a.to);need(!destinations.has(key),'Choose distinct destination budgets.');destinations.add(key);next=moveMultiBudget(next,{id:id+':'+i,date,from:{tripId:fromTripId,envelope:'savings'},to:a.to,amount:a.amount,note},dates);}return next;
}
export function reverseMultiMove(b,originalId,{id,date,note,acknowledgeEmergency},dates){const original=b.moves.find(x=>x.id===originalId);need(original&&!original.reversalOf&&!b.moves.some(m=>m.reversalOf===originalId),'Choose an unreversed original move.');const next=moveMultiBudget(b,{id,date,from:original.to,to:original.from,amount:original.amount,note,acknowledgeEmergency},dates);next.moves.at(-1).reversalOf=originalId;validateMultiTrip(next);return next;}
export function recordMultiPurchase(b,tripId,record,asOf){validateMultiTrip(b);need(record.kind!=='funding'&&!record.id?.startsWith('multi:'),'Choose an ordinary purchase or received refund.');const next=structuredClone(b),t=next.trips.find(t=>t.id===tripId);need(t,'Choose a known trip.');t.plan=recordPlanningPurchase(t.plan,record,asOf);validateMultiTrip(next);return next;}
export function correctMultiPurchase(b,tripId,recordId,replacement,{reason,asOf}){validateMultiTrip(b);need(replacement.kind!=='funding'&&!replacement.id?.startsWith('multi:'),'Cannot edit a planning transfer as a purchase.');const next=structuredClone(b),t=next.trips.find(t=>t.id===tripId);need(t,'Choose a known trip.');t.plan=correctPlanningPurchase(t.plan,recordId,replacement,{reason,asOf});validateMultiTrip(next);return next;}
export function multiTripBackup(b){validateMultiTrip(b);return {format:'roam-multi-trip-planning-preview',version:1,book:structuredClone(b)};}
export function parseMultiTripBackup(data){need(data?.format==='roam-multi-trip-planning-preview'&&data.version===1,'Not a multi-trip planning preview. This is not a complete Roam backup.');return validateMultiTrip(structuredClone(data.book));}
