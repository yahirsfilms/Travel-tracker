import {coordinatedTripView,coordinatedMove,coordinatedTarget,coordinatedDates,coordinatedArchive,coordinatedReviewClock,refreshCoordinatedClock,settleCoordinatedFunding} from './coordinated-budget.js';
// Integration: canonical cash stays in the existing ledger; this module owns only
// planning classification. The immutable activation snapshot supports recovery.
import {uid,dayNumber} from './core.js';
import {makeBackup,parseBackup,validateState,fundStats,poolBudget,spent,bookingStatus,fundValue} from './accounting.js';
import {createPlan,validatePlan,projectPlan,splitSavings,moveEnvelope,reverseMove,setFutureTarget,ENVELOPES} from './planning.js';
import {inspectClock,advanceClock,acknowledgeClock} from './planning-clock.js';
const need=(x,m)=>{if(!x)throw Error(m);};
const sum=xs=>xs.reduce((a,b)=>a+b,0);
const key=(t,x)=>t.id+':'+x.id;
const raw=s=>{const x={...s,schemaVersion:2};delete x.fixedBudget;return x;};
export function activateFixedBudget(source,{tripId,start,target,asOf,instant=Date.now()}){
 validateState(source);need(!source.fixedBudget,'Fixed daily mode is already enabled.');dayNumber(start);dayNumber(asOf);
 const t=source.trips.find(t=>t.id===tripId),live=source.trips.filter(t=>t.included&&!t.closed);
 need(t&&live.length===1&&live[0]===t,'Enable fixed mode with one open live trip. Other notebooks stay unchanged.');
 need(source.fund.initialized&&t.currency===source.fund.currency&&t.fundRate===1,'Fixed mode needs the trip and shared money to use the same planning currency.');
 need(start>=asOf&&start>=t.start&&start<=t.end,'Choose today or a future travel day inside this trip.');
 need(Number.isSafeInteger(target)&&target>0,'Enter a positive daily limit.');
 const stats=fundStats(source);need(stats.shortfall===0&&stats.actual>=0,'Resolve the existing funding shortage first.');
 need(source.trips.filter(x=>x.included&&x!==t).every(x=>poolBudget(x,'daily')+poolBudget(x,'hotels')+poolBudget(x,'transport')+poolBudget(x,'emergency')-spent(x)===0),'Resolve other live trip allocations before switching this notebook.');
 need(!t.bookings.some(b=>b.pool==='daily'&&bookingStatus(t,b).unpaid>0),'Resolve daily-funded bookings before switching.');
 need(['daily','hotels','transport','emergency'].every(p=>!(t.reserved?.[p]>0)),'Link or clear the old unpaid holds before switching, so no bill is reserved twice.');
 const remaining=Object.fromEntries(['daily','hotels','transport','emergency'].map(p=>[p,poolBudget(t,p)-spent(t,p)]));
 need(Object.values(remaining).every(x=>x>=0),'Resolve overspent categories before switching.');
 // Today starts prospectively: existing same-day purchases count toward its
 // limit but are never deducted again from opening cash.
 const todaySpent=start===asOf?sum(t.transactions.filter(x=>x.pool==='daily'&&x.date===start).map(x=>x.base)):0;
 const dailyNeeded=(dayNumber(t.end)-dayNumber(start)+1)*target-Math.min(target,Math.max(0,todaySpent));
 need(dailyNeeded<=remaining.daily,'The daily reserve cannot back this limit. Choose a lower limit or fund it first.');
 const assigned=dailyNeeded+remaining.hotels+remaining.transport+remaining.emergency;
 need(assigned<=stats.actual,'The proposed budgets exceed recorded money.');
 const plan=createPlan({id:uid(),start:t.start,end:t.end,activationDate:start,zone:t.zone,currency:t.currency,target,opening:{daily:dailyNeeded,hotels:remaining.hotels,transport:remaining.transport,emergency:remaining.emergency,unassigned:stats.actual-assigned}});
 plan.openingDaySpent=Math.max(0,todaySpent);plan.transactions=[];
 plan.fundingDates=Array.from({length:dayNumber(t.end)-dayNumber(start)+1},(_,i)=>({date:new Date((dayNumber(start)+i)*86400000).toISOString().slice(0,10),amount:target}));
 const next=structuredClone(source);next.schemaVersion=3;
 next.fixedBudget={version:1,tripId,baseline:makeBackup(source),baselineRevision:source.revision,plan};
 next.fixedBudget.plan=advanceClock(plan,instant).plan;
 next.trips.find(x=>x.id===tripId).fixedBudget=true;
 validateFixedBudget(next);return next;
}
export function deriveFixedPlan(s){
 const f=s.fixedBudget,p=structuredClone(f.plan),baseline=parseBackup(f.baseline);
 const old=new Map(baseline.trips.filter(t=>t.included).flatMap(t=>t.transactions.map(x=>[key(t,x),{...x,trip:t}])));
 p.transactions=[];p.priorPurchases=[];p.commitments=[];
 const t=s.trips.find(t=>t.id===f.tripId);
 for(const b of t.bookings){const st=bookingStatus(t,b);if(!b.estimated&&st.unpaid)p.commitments.push({id:b.id,envelope:b.pool,unpaid:st.unpaid});
  const oldTrip=baseline.trips.find(x=>x.id===t.id),before=oldTrip.bookings.find(x=>x.id===b.id);
  const oldRefunds=before?bookingStatus(oldTrip,before).refunded:0;
  p.priorPurchases.push({id:'booking:'+b.id,date:t.transactions.filter(x=>x.bookingId===b.id&&x.base>0).map(x=>x.date).sort()[0]||p.activationDate,amount:Math.max(0,st.paid-oldRefunds),envelope:b.pool});
 }
 const deltaRecord=(id,amount,envelope,kind='correction')=>{
  if(!amount)return;
  let refundOf;if(amount<0&&envelope!=='unassigned'){refundOf='adjustment-ref:'+id;p.priorPurchases.push({id:refundOf,date:p.activationDate,amount:-amount,envelope});}
  p.transactions.push({id,date:p.activationDate,amount,envelope,refundOf,kind});
 };
 const currentKeys=new Set();
 for(const tr of s.trips.filter(t=>t.included))for(const x of tr.transactions){const k=key(tr,x),before=old.get(k);currentKeys.add(k);
  if(before){
   const amount=fundValue(tr,x.base),oldAmount=fundValue(before.trip,before.base);
   const originalBefore=before.refundOf?old.get(tr.id+':'+before.refundOf):before;
   const dayEligible=before.pool==='daily'&&originalBefore?.date===p.activationDate&&originalBefore.base>0;
   if(dayEligible&&before.base>0&&(x.date!==before.date||(x.fundingSource||x.pool)!=='daily')){
    deltaRecord('reclassify-old:'+k,-oldAmount,'daily');
    let envelope=x.date>=p.activationDate?(x.fundingSource||x.pool):'unassigned';
    p.transactions.push({id:'reclassify-new:'+k,date:x.date,amount,envelope,kind:'correction'});
   }else deltaRecord('correction:'+k,amount-oldAmount,before.bookingId?before.pool:dayEligible?'daily':'unassigned');
   continue;
  }
  let envelope=x.fundingSource||x.pool,refundOf;
  if((x.date<p.activationDate&&!x.bookingId)||tr.id!==t.id)envelope='unassigned';
  if(x.base<0){
   if(x.bookingId)refundOf='booking:'+x.bookingId;
   else if(x.refundOf){const o=tr.transactions.find(o=>o.id===x.refundOf),oldOriginal=old.get(tr.id+':'+x.refundOf);
    if(oldOriginal){envelope=oldOriginal.date===p.activationDate&&oldOriginal.pool==='daily'?'daily':'unassigned';const already=-sum(tr.transactions.filter(a=>old.has(tr.id+':'+a.id)&&a.refundOf===o.id).map(a=>a.base));const ref='prior:'+tr.id+':'+o.id;if(!p.priorPurchases.some(a=>a.id===ref))p.priorPurchases.push({id:ref,date:o.date,amount:Math.max(0,fundValue(tr,o.base-already)),envelope});refundOf=ref;}
    else if(o){refundOf=tr.id+':'+o.id;envelope=o.fundingSource||o.pool;}
   }else envelope='unassigned';
  }
  p.transactions.push({id:k,date:x.date,amount:fundValue(tr,x.base),envelope,refundOf,bookingId:x.bookingId,category:x.category,note:x.note});
 }
 for(const [k,x]of old)if(!currentKeys.has(k))deltaRecord('deleted:'+k,-fundValue(x.trip,x.base),x.bookingId?x.pool:x.pool==='daily'&&(x.base>0?x.date:old.get(x.trip.id+':'+x.refundOf)?.date)===p.activationDate?'daily':'unassigned');
 const deposits=sum(s.fund.ledger.map(x=>x.amount))-sum(baseline.fund.ledger.map(x=>x.amount));
 if(deposits)p.transactions.push({id:'fund-ledger-difference',date:p.activationDate,amount:-deposits,envelope:'unassigned',kind:'funding'});
 return validatePlan(p);
}
export function fixedProjection(s,date,{instant}={}){if(s.coordination)return coordinatedTripView(s,date,{instant});const p=deriveFixedPlan(s),clock=instant!==undefined?inspectClock(p,instant):p.clockReview?{review:true,date:p.clock.date,...p.clockReview}:null;const asOf=clock?.review?clock.date:date;const x=projectPlan(p,asOf);const actual=fundStats(raw(s)).actual;need(x.actual===actual,'Fixed budgets do not reconcile with the cash ledger. Preserve the notebook and review its records.');return {...x,clock,plan:p};}
export function validateFixedBudget(s){
 need(s.schemaVersion===3&&s.fixedBudget?.version===1,'Unsupported fixed budget notebook.');validateState(raw(s));
 const f=s.fixedBudget,t=s.trips.find(t=>t.id===f.tripId);need(t&&t.included,'Missing live fixed-budget trip.');
 need(f.baseline?.version===2&&f.plan&&Array.isArray(f.plan.transactions)&&f.plan.transactions.length===0,'Invalid fixed-budget activation snapshot.');
 const baseline=parseBackup(f.baseline),priorTrip=baseline.trips.find(x=>x.id===t.id);
 need(JSON.stringify(t.budgets)===JSON.stringify(priorTrip.budgets)&&JSON.stringify(t.adjustments)===JSON.stringify(priorTrip.adjustments),'Use fixed-budget moves instead of modifying the preserved legacy allocation.');
 need(['daily','hotels','transport','emergency'].every(p=>!(t.reserved?.[p]>0)),'Use linked bookings instead of loose unpaid holds in fixed mode.');
 need(baseline.fund.currency===s.fund.currency&&t.currency===s.fund.currency&&t.fundRate===1,'Changing planning currency requires a separate notebook.');
 need(t.zone===f.plan.zone&&t.start===f.plan.start&&t.end===f.plan.end,'Use the fixed daily plan controls to change dates or travel clock.');
 need(!!t.closed===!!f.plan.archived,'Fixed trip closure must use its audited archive controls.');
 if(f.plan.archived){dayNumber(f.plan.archived.date);need(f.plan.archived.date>f.plan.end&&t.closedDate===f.plan.archived.date&&typeof f.plan.archived.reason==='string'&&f.plan.archived.reason.trim(),'Invalid fixed trip archive.');}
 need(s.trips.filter(t=>t.included&&!t.closed).length===(t.closed?0:1),'Add another trip in a separate notebook until multi-trip fixed planning is supported.');
 need(sum(Object.values(f.plan.opening))===fundStats(baseline).actual,'Fixed opening money was changed.');
 for(const x of t.transactions){if(x.fundingSource)need(ENVELOPES.includes(x.fundingSource),'Invalid funding budget.');if(x.refundOf){const o=t.transactions.find(a=>a.id===x.refundOf);need(!x.fundingSource||x.fundingSource===(o.fundingSource||o.pool),'A refund must return to its original funding budget.');}}
 const p=deriveFixedPlan(s);const x=projectPlan(p,p.activationDate);need(x.actual===fundStats(raw(s)).actual,'Fixed budget cash differs from recorded funds.');return s;
}
export function fixedMove(s,command,asOf){
 if(s.coordination)return coordinatedMove(s,command,asOf);
 validateFixedBudget(s);need(!s.fixedBudget.plan.archived,'Reopen the archived trip before moving its budgets.');need(!s.fixedBudget.plan.clockReview,"Review the travel clock before moving saved money.");need(command.date===asOf&&asOf>=s.fixedBudget.plan.activationDate,"Budget moves use the current travel day after fixed mode starts.");const p=deriveFixedPlan(s);const nextPlan=command.type==='split'?splitSavings(p,command,{}):command.type==='reverse'?reverseMove(p,command.originalId,command):moveEnvelope(p,command);
 const next=structuredClone(s);next.fixedBudget.plan.transfers=nextPlan.transfers;validateFixedBudget(next);return next;
}
export function fixedTarget(s,{date,amount,reason},asOf){if(s.coordination)return coordinatedTarget(s,{date,amount,reason},asOf);need(!s.fixedBudget.plan.archived,'Reopen the archived trip before changing its plan.');const next=structuredClone(s),p=setFutureTarget(deriveFixedPlan(s),{date,amount,reason},asOf);next.fixedBudget.plan.targets=p.targets;next.fixedBudget.plan.audit=p.audit;validateFixedBudget(next);return next;}
export function reviewFixedClock(s,instant,reason){if(s.coordination)return coordinatedReviewClock(s,instant,reason);const next=structuredClone(s);next.fixedBudget.plan=acknowledgeClock(next.fixedBudget.plan,instant,reason);validateFixedBudget(next);return next;}
export function refreshFixedClock(s,instant){if(s.coordination)return refreshCoordinatedClock(s,instant);const next=structuredClone(s);next.fixedBudget.plan=advanceClock(next.fixedBudget.plan,instant).plan;validateFixedBudget(next);return next;}
export function settleFixedFunding(s,asOf){
 if(s.coordination)return settleCoordinatedFunding(s,{[s.active]:asOf});
 if(!s.fixedBudget)return s;
 const p=deriveFixedPlan(s),x=projectPlan(p,asOf);
 if(s.fixedBudget.plan.clockReview)return s;
 let backing=Math.max(0,x.balances.daily+Math.min(x.spentToday,x.target)-sum(p.commitments.filter(c=>c.envelope==='daily').map(c=>c.unpaid)));
 const prior=s.fixedBudget.plan.fundingDates||[];
 const updated=x.days.map(d=>{if(d.date<asOf)return prior.find(x=>x.date===d.date)||{date:d.date,amount:d.entitlement};const amount=Math.min(d.target,backing);backing-=amount;return {date:d.date,amount};});
 s.fixedBudget.plan.fundingDates=updated;return s;
}
export function changeFixedDates(s,{end,zone,reason},asOf,instant=Date.now()){
 if(s.coordination)return coordinatedDates(s,{end,zone,reason},asOf,instant);
 validateFixedBudget(s);need(!s.fixedBudget.plan.archived,'Reopen the archived trip before changing its dates.');dayNumber(end);dayNumber(asOf);new Intl.DateTimeFormat('en',{timeZone:zone});need(reason?.trim()&&end>=asOf&&end>=s.fixedBudget.plan.activationDate,'Keep at least the current travel day and enter a reason.');
 const next=structuredClone(s),p=next.fixedBudget.plan,t=next.trips.find(t=>t.id===next.fixedBudget.tripId);
 need(!next.trips.find(t=>t.id===next.fixedBudget.tripId).transactions.some(x=>x.date>end&&x.date>=p.activationDate),'Review transactions after the proposed trip end first.');
 p.audit=[...(p.audit||[]),{type:'trip dates/clock',date:asOf,reason,before:{end:p.end,zone:p.zone},after:{end,zone}}];
 p.end=end;p.zone=zone;t.end=end;t.zone=zone;p.pausedDates=(p.pausedDates||[]).filter(x=>x<=end);p.targets=p.targets.filter(x=>x.date<=end);p.fundingDates=(p.fundingDates||[]).filter(x=>x.date<=end);
 next.fixedBudget.plan=advanceClock(p,instant).plan;settleFixedFunding(next,asOf);validateFixedBudget(next);return next;
}

// Archiving retains every category and saving. It never releases or creates cash.
// Early completion requires an explicit date adjustment followed by the last day.
export function archiveFixedTrip(s,{date,reason},asOf){
 if(s.coordination)return coordinatedArchive(s,{date,reason},asOf);
 validateFixedBudget(s);dayNumber(date);dayNumber(asOf);const p=s.fixedBudget.plan,t=s.trips.find(t=>t.id===s.fixedBudget.tripId);
 need(!p.archived&&date===asOf&&date>p.end,'Archive only after the final travel day has ended.');
 need(typeof reason==='string'&&reason.trim()&&reason.length<=800,'Enter an archive reason.');
 need(!p.clockReview,'Review the travel clock before archiving.');
 need(t.bookings.every(b=>{const x=bookingStatus(t,b);return !x.unpaid&&!x.pendingRefund;}),'Resolve unpaid bookings and pending refunds before archiving.');
 const x=fixedProjection(s,date);need(!x.uncovered&&!x.commitmentShortfall,'Resolve the planning shortfall before archiving.');
 const next=structuredClone(s),plan=next.fixedBudget.plan,tr=next.trips.find(t=>t.id===next.fixedBudget.tripId);
 plan.archived={date,reason:reason.trim()};plan.audit=[...(plan.audit||[]),{type:'fixed trip archived',date,reason:reason.trim()}];tr.closed=true;tr.closedDate=date;tr.changes.push({id:uid(),type:'fixed trip archived',date,note:reason.trim()});
 validateFixedBudget(next);need(fixedProjection(next,date).actual===x.actual,'Archiving must preserve actual money.');return next;
}
export function reopenFixedTrip(s,{date,reason}){
 if(s.coordination)return coordinatedArchive(s,{date,reason},date,true);
 validateFixedBudget(s);dayNumber(date);need(s.fixedBudget.plan.archived,'Choose an archived fixed trip.');need(typeof reason==='string'&&reason.trim()&&reason.length<=800,'Enter a reopening reason.');
 need(date>=s.fixedBudget.plan.archived.date,'Reopening cannot predate archiving.');
 const next=structuredClone(s),p=next.fixedBudget.plan,t=next.trips.find(t=>t.id===next.fixedBudget.tripId);p.audit=[...(p.audit||[]),{type:'fixed trip reopened',date,reason:reason.trim(),before:structuredClone(p.archived)}];delete p.archived;t.closed=false;delete t.closedDate;t.changes.push({id:uid(),type:'fixed trip reopened',date,note:reason.trim()});validateFixedBudget(next);return next;
}
