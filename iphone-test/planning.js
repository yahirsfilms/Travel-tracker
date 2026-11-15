// Fixed daily planning engine. Deliberately not activated for existing notebooks.
// Pure projections plus copy-on-write commands; amounts are integer minor units.
import {dayNumber} from './core.js';
export const PLANNING_VERSION=1;
export const ENVELOPES=['daily','hotels','transport','emergency','shopping','activities','savings','unassigned'];
const sum=xs=>xs.reduce((a,b)=>a+b,0);
const money=n=>Number.isSafeInteger(n)&&n>=0&&n<=1e11;
const need=(ok,message)=>{if(!ok)throw Error(message);};
const id=x=>typeof x==='string'&&x.trim().length>0&&x.length<=200;
const date=d=>{dayNumber(d);return d;};
const cash=xs=>sum(xs.map(x=>x.amount));
function checkTransaction(x){
 need(id(x.id)&&ENVELOPES.includes(x.envelope)&&money(Math.abs(x.amount))&&x.amount!==0,'Invalid planning transaction.');
 date(x.date);need(!x.refundOf||id(x.refundOf),'Invalid refund link.');
}
export function validatePlan(p){
 need(p?.version===PLANNING_VERSION&&id(p.id),'Unsupported planning model.');
 need(['USD','CNY','EUR','JPY','MXN','HKD','GBP'].includes(p.currency),'Invalid planning currency.');
 date(p.start);date(p.end);date(p.activationDate);
 need(p.end>=p.start&&p.activationDate>=p.start&&p.activationDate<=p.end&&dayNumber(p.end)-dayNumber(p.activationDate)<3660,'Invalid planning dates.');
 need(typeof p.zone==='string','Choose a valid travel time zone.');
 new Intl.DateTimeFormat('en',{timeZone:p.zone});
 need(money(p.originalTarget)&&Array.isArray(p.targets)&&p.targets.length>0,'Invalid daily limit.');
 if(p.openingDaySpent!==undefined)need(money(p.openingDaySpent),'Invalid opening day spending.');
 if(p.fundingDates){const dates=new Set();need(Array.isArray(p.fundingDates)&&p.fundingDates.every(x=>{date(x.date);if(dates.has(x.date)||!money(x.amount)||x.date<p.activationDate||x.date>p.end)return false;dates.add(x.date);return true;}),'Invalid funded day schedule.');}
 const paused=p.pausedDates||[];need(Array.isArray(paused)&&new Set(paused).size===paused.length&&paused.every(d=>{date(d);return d>=p.activationDate&&d<=p.end;}),'Invalid paused travel days.');
 if(p.clock){need(Number.isFinite(p.clock.instant)&&p.clock.instant>=0&&typeof p.clock.zone==='string','Invalid saved planning clock.');date(p.clock.date);new Intl.DateTimeFormat('en',{timeZone:p.clock.zone});}
 const days=new Set();for(const x of p.targets){date(x.date);need(!days.has(x.date)&&money(x.amount)&&x.date>=p.activationDate&&x.date<=p.end,'Invalid dated daily limit.');days.add(x.date);}
 need(Object.keys(p.opening).length===ENVELOPES.length&&ENVELOPES.every(k=>money(p.opening[k])),'Invalid opening envelopes.');
 need(Array.isArray(p.transactions)&&p.transactions.length<=20000&&Array.isArray(p.transfers)&&p.transfers.length<=10000&&Array.isArray(p.commitments)&&p.commitments.length<=5000,'Invalid planning records.');
 const prior=p.priorPurchases||[];need(Array.isArray(prior)&&prior.every(x=>id(x.id)&&money(x.amount)&&ENVELOPES.includes(x.envelope)&&dayNumber(x.date)>=0),'Invalid prior purchase references.');
 const ids=new Set();for(const x of p.transactions){checkTransaction(x);need(!ids.has(x.id),'Duplicate transaction.');ids.add(x.id);}
 for(const x of p.transactions.filter(x=>x.amount<0&&!x.refundOf))need(x.envelope==='unassigned','Unmatched received credits belong in unassigned money, not daily savings.');
 for(const x of p.transactions.filter(x=>x.refundOf)){
  const original=[...p.transactions,...prior].find(o=>o.id===x.refundOf&&o.amount>0);
  need(x.amount<0&&original&&x.envelope===original.envelope&&x.date>=original.date,'Refund must return to its original purchase budget after purchase.');
  need(-cash(p.transactions.filter(r=>r.refundOf===original.id))<=original.amount,'Refund exceeds original purchase.');
 }
 const ops=new Set();for(const x of p.transfers){
  need(id(x.id)&&!ops.has(x.id)&&ENVELOPES.includes(x.from)&&ENVELOPES.includes(x.to)&&x.from!==x.to&&money(x.amount)&&x.amount>0&&id(x.note),'Invalid or duplicate transfer.');
  date(x.date);need(!x.reversalOf||id(x.reversalOf),'Invalid reversal.');ops.add(x.id);
 }
 for(const x of p.transfers.filter(x=>x.reversalOf)){
  const original=p.transfers.find(o=>o.id===x.reversalOf);
  need(original&&!original.reversalOf&&x.from===original.to&&x.to===original.from&&x.amount===original.amount&&x.date>=original.date,'Invalid transfer reversal.');
  need(p.transfers.filter(o=>o.reversalOf===original.id).length===1,'Transfer already reversed.');
 }
 const obligations=new Set();for(const x of p.commitments){
  need(id(x.id)&&!obligations.has(x.id)&&ENVELOPES.includes(x.envelope)&&x.envelope!=='savings'&&money(x.unpaid),'Invalid commitment.');obligations.add(x.id);
 }
 // The day ledger is derived, never blindly replayed as cash or deposits.
 return p;
}
export function createPlan({id:planId,start,end,activationDate=start,zone='Asia/Shanghai',currency='USD',target,opening}){
 const p={version:PLANNING_VERSION,id:planId,start,end,activationDate,zone,currency,pausedDates:[],originalTarget:target,targets:[{date:activationDate,amount:target}],opening:Object.fromEntries(ENVELOPES.map(k=>[k,opening[k]??0])),transactions:[],transfers:[],commitments:[]};
 return validatePlan(p);
}
const targetFor=(p,d)=>p.targets.filter(x=>x.date<=d).sort((a,b)=>b.date.localeCompare(a.date))[0]?.amount||0;
function originalDate(p,x){return x.refundOf?[...p.transactions,...(p.priorPurchases||[])].find(o=>o.id===x.refundOf)?.date:x.date;}
export function projectPlan(p,asOf,{actual,pausedDates=p.pausedDates||[]}={}){
 validatePlan(p);date(asOf);
 need(actual===undefined||Number.isSafeInteger(actual),'Invalid actual balance.');
 need(Array.isArray(pausedDates)&&pausedDates.every(x=>{date(x);return true;}),'Invalid paused days.');
 const openingTotal=sum(Object.values(p.opening));
 const impliedActual=openingTotal-cash(p.transactions);
 const actualBalance=actual??impliedActual;
 const moves=k=>sum(p.transfers.map(x=>x.to===k?x.amount:x.from===k?-x.amount:0));
 const obligation=k=>sum(p.commitments.filter(x=>x.envelope===k).map(x=>x.unpaid));
 // Daily external top-ups are allowed, savings coverage is not fresh entitlement.
 // Outgoing daily moves reduce funding; savings draws/coverage do not change limits.
 const funding=p.opening.daily+sum(p.transfers.map(x=>x.to==='daily'&&x.from!=='savings'?x.amount:x.from==='daily'? -x.amount:0));
 let backing=Math.max(0,funding-obligation('daily'));
 const days=[];const paused=new Set(pausedDates);
 for(let n=dayNumber(p.activationDate);n<=dayNumber(p.end);n++){
  need(days.length<3660,'Planning window exceeds ten years.');
  const d=new Date(n*86400000).toISOString().slice(0,10);
  const target=paused.has(d)?0:targetFor(p,d);
  const fixed=p.fundingDates?.find(x=>x.date===d);
  const entitlement=Math.min(target,fixed?.amount??backing);backing=Math.max(0,backing-entitlement);
  const usage=Math.max(0,(d===p.activationDate?(p.openingDaySpent||0):0)+cash(p.transactions.filter(x=>x.envelope==='daily'&&originalDate(p,x)===d)));
  const closed=d<asOf;
  days.push({key:p.id+':'+d,date:d,target,entitlement,spent:usage,closed,earned:closed?Math.max(0,entitlement-usage):0,deficit:Math.max(0,usage-entitlement)});
 }
 const earned=sum(days.map(x=>x.earned));
 // Daily cash after purchase = remaining daily plans + savings earned;
 // saving-funded shopping/activities are independent envelope cash movements.
 const raw=Object.fromEntries(ENVELOPES.map(k=>[k,p.opening[k]+moves(k)-cash(p.transactions.filter(x=>x.envelope===k))]));
 raw.daily-=earned;raw.savings+=earned;
 const balances=Object.fromEntries(ENVELOPES.map(k=>[k,Math.max(0,raw[k])]));
 const deficits=Object.fromEntries(ENVELOPES.map(k=>[k,Math.max(0,-raw[k])]));
 const planned=sum(Object.values(balances)),deficit=sum(Object.values(deficits));
 // Underlying records may have been corrected outside this projection: never
 // silently withdraw from envelopes; expose the reconciliation difference.
 const externalDifference=actualBalance-impliedActual;
 const uncovered=Math.max(0,deficit-externalDifference);
 const surplus=Math.max(0,externalDifference-deficit);
 const today=days.find(x=>x.date===asOf);
 const commitmentShortfall=sum(ENVELOPES.map(k=>Math.max(0,obligation(k)-balances[k])));
 const transferable=Object.fromEntries(ENVELOPES.map(k=>[k,Math.max(0,balances[k]-obligation(k)-uncovered-commitmentShortfall)]));
 // Earliest funded daily entitlements reserve all scheduled future days.
 const futureRequirement=sum(days.filter(x=>x.date>=asOf).map(x=>Math.max(0,x.target-x.spent)));
 transferable.daily=Math.max(0,balances.daily-obligation('daily')-futureRequirement-uncovered-commitmentShortfall);
 const pendingCapacity=Math.max(0,balances.daily-obligation('daily')-uncovered-commitmentShortfall);
 const fundingShortfall=uncovered+sum(ENVELOPES.filter(k=>k!=='daily').map(k=>Math.max(0,obligation(k)-balances[k])))+Math.max(0,obligation('daily')+futureRequirement-balances.daily);
 return {actual:actualBalance,impliedActual,balances,deficits,uncovered,surplus,commitmentShortfall,fundingShortfall,earnedSavings:earned,days,
  savingsAvailable:transferable.savings,transferable,
  target:today?.target||0,spentToday:today?.spent||0,
  leftToday:Math.max(0,(today?.target||0)-(today?.spent||0)),
  backedLeftToday:Math.min(Math.max(0,(today?.target||0)-(today?.spent||0)),pendingCapacity),
  dailyFundingShortfall:Math.max(0,futureRequirement-pendingCapacity),
  clockReview:asOf<p.activationDate,
  // Every envelope is included once. Trip views are alternate groupings only.
  reconciliation:{planned,uncovered,surplus,total:planned-uncovered+surplus,actual:actualBalance},
 };
}
export function recordPlanningPurchase(p,x,asOf=x.date){
 validatePlan(p);date(asOf);checkTransaction(x);need(x.date<=asOf,'Record future costs as commitments.');
 need(!p.transactions.some(o=>o.id===x.id),'This purchase was already recorded.');
 const next=structuredClone(p);next.transactions.push(structuredClone(x));validatePlan(next);return next;
}
export function correctPlanningPurchase(p,recordId,replacement,{reason,asOf}){
 validatePlan(p);need(id(reason),'Enter a correction reason.');date(asOf);checkTransaction(replacement);
 const index=p.transactions.findIndex(x=>x.id===recordId);need(index>=0&&replacement.id===recordId,'Choose an existing purchase.');need(replacement.date<=asOf,'Cannot record a future purchase.');
 const next=structuredClone(p),before=next.transactions[index];next.transactions[index]=structuredClone(replacement);validatePlan(next);
 next.audit=[...(next.audit||[]),{type:'purchase corrected',date:asOf,reason,before,after:structuredClone(replacement)}];return next;
}
export function splitSavings(p,{id:operationId,date:when,allocations,note},options={}){
 validatePlan(p);date(when);need(id(operationId)&&id(note)&&Array.isArray(allocations)&&allocations.length>0,'Enter an allocation and reason.');
 need(!p.transfers.some(x=>x.id===operationId||x.batchId===operationId),'This allocation was already recorded.');
 const destinations=new Set();for(const a of allocations){need(ENVELOPES.includes(a.to)&&a.to!=='savings'&&money(a.amount)&&!destinations.has(a.to),'Choose distinct budgets and nonnegative amounts.');destinations.add(a.to);}
 const total=sum(allocations.map(x=>x.amount));need(money(total)&&total>0,'Enter a positive allocation.');
 const before=projectPlan(p,when,options);need(total<=before.savingsAvailable,'Not enough available savings. Resolve any shortfall first.');
 const next=structuredClone(p);
 for(const a of allocations.filter(x=>x.amount>0))next.transfers.push({id:operationId+':'+a.to,batchId:operationId,date:when,from:'savings',to:a.to,amount:a.amount,note});
 validatePlan(next);need(projectPlan(next,when,options).actual===before.actual,'Allocation cannot change actual cash.');return next;
}
export function moveEnvelope(p,{id:operationId,date:when,from,to,amount,note},options={}){
 validatePlan(p);date(when);need(ENVELOPES.includes(from)&&ENVELOPES.includes(to)&&from!==to&&money(amount)&&amount>0&&id(operationId)&&id(note),'Enter a valid budget move.');
 need(!p.transfers.some(x=>x.id===operationId),'This budget move was already recorded.');
 const before=projectPlan(p,when,options),obligation=sum(p.commitments.filter(c=>c.envelope===from).map(c=>c.unpaid)),future=from==='daily'?sum(before.days.filter(d=>d.date>=when).map(d=>Math.max(0,d.target-d.spent))):0,gross=Math.max(0,before.balances[from]-obligation-future);
 need(amount<=gross,'Money is spent, committed or needed for future daily limits.');
 const next=structuredClone(p);next.transfers.push({id:operationId,date:when,from,to,amount,note});validatePlan(next);const after=projectPlan(next,when,options),relief=Math.max(0,before.fundingShortfall-after.fundingShortfall);need(amount<=before.transferable[from]+relief,'Money is spent, committed or needed for future daily limits.');return next;
}
export function reverseMove(p,recordId,{id:operationId,date:when,note},options={}){
 const original=p.transfers.find(x=>x.id===recordId);need(original&&!original.reversalOf,'Choose an original budget move.');
 need(!p.transfers.some(x=>x.reversalOf===recordId),'This budget move was already reversed.');
 const next=moveEnvelope(p,{id:operationId,date:when,from:original.to,to:original.from,amount:original.amount,note},options);
 next.transfers.at(-1).reversalOf=recordId;validatePlan(next);return next;
}
export function setFutureTarget(p,{date:when,amount,reason},asOf){
 validatePlan(p);date(when);date(asOf);need(when>=asOf&&when>=p.activationDate&&when<=p.end&&money(amount)&&id(reason),'Choose a current or future limit and reason.');
 const next=structuredClone(p);next.targets=next.targets.filter(x=>x.date!==when);next.targets.push({date:when,amount});next.audit=[...(next.audit||[]),{type:'daily target',date:asOf,effectiveDate:when,amount,reason}];validatePlan(next);return next;
}
// A new format is intentional: older app versions must refuse this model,
// rather than dropping its settlements, transfers or funding provenance.
export function planningBackup(p){validatePlan(p);return {format:'roam-planning-lab',version:1,plan:structuredClone(p)};}
export function parsePlanningBackup(x){need(x?.format==='roam-planning-lab'&&x.version===1,'Unsupported planning checkpoint.');return validatePlan(structuredClone(x.plan));}

export function pauseTravelDay(p,when,{paused=true,reason,asOf}){
 validatePlan(p);date(when);date(asOf);need(when>=asOf&&when>=p.activationDate&&when<=p.end&&id(reason),'Pause only a current or future travel day with a reason.');
 const next=structuredClone(p);next.pausedDates=(next.pausedDates||[]).filter(d=>d!==when);if(paused)next.pausedDates.push(when);next.audit=[...(next.audit||[]),{type:'travel day pause',date:asOf,effectiveDate:when,paused,reason}];return validatePlan(next);
}
