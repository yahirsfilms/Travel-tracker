// One copy-on-write candidate: optional existing budget move, then one purchase.
import {poolBudget,spent,saveExpense,bookingTransaction,validateState,fundStats,transferableBudget} from './accounting.js';
import {dailyOutlook} from './daily-clarity.js';
import {previewLegacyBudget} from './budget-preview.js';
import {fixedMove,fixedProjection,settleFixedFunding} from './fixed-budget.js';
export function suggestedBudget(category){
 return category==='Accommodation'?'hotels':['Local transport','Intercity travel','Travel between cities'].includes(category)?'transport':'daily';
}
export function expenseBalance(state,pool,date,{instant=Date.now()}={}){
 if(state.fixedBudget){const x=fixedProjection(state,date,{instant});return (x.balances[pool]||0)-(x.deficits?.[pool]||0);}
 if(pool==='unassigned')return fundStats(state).unallocated;
 const t=state.trips.find(t=>t.id===state.active);return poolBudget(t,pool)-spent(t,pool);
}
function sourceAvailable(state,pool,date,instant){
 if(state.fixedBudget){const x=fixedProjection(state,date,{instant});return pool==='unassigned'?(x.global?.availableToAllocate??x.transferable.unassigned):x.transferable[pool];}
 if(pool==='unassigned')return Math.max(0,fundStats(state).unallocated);
 return transferableBudget(state.trips.find(t=>t.id===state.active),pool);
}
export function previewExpense(state,{record,oldId,bookingId,move,date,instant=Date.now()}){
 let candidate=structuredClone(state);
 const pool=record.fundingSource||record.pool;
 if(move){
  if(record.base<=0||oldId)throw Error('Move budgets separately when correcting or refunding a purchase.');
  if(move.from===pool)throw Error('Choose a different source budget.');
  if(move.from==='emergency'&&!move.acknowledgeEmergency)throw Error('Confirm use of the emergency reserve.');
  if(candidate.fixedBudget){
   const x=fixedProjection(candidate,date,{instant});if(x.clock?.review)throw Error('Review the travel clock before moving money. You can still record the purchase without a move.');
   candidate=fixedMove(candidate,{...move,to:pool,date,note:'Cover purchase · '+record.category,...(candidate.coordination?{fromTripId:candidate.active,toTripId:candidate.active,instant}:{})},date);
  }else candidate=previewLegacyBudget(candidate,{mode:move.from==='unassigned'?'add':'transfer',pool:move.from==='unassigned'?pool:move.from,toPool:pool,targetTripId:candidate.active,amount:move.amount,date,note:'Cover purchase · '+record.category,operationId:move.id}).candidate;
 }
 const t=candidate.trips.find(t=>t.id===candidate.active);
 const booking=bookingId&&t.bookings.find(b=>b.id===bookingId);
 if(bookingId&&!booking)throw Error('Booking no longer exists. Review the purchase again.');
 if(booking){if(oldId||record.base<=0||booking.pool!==record.pool)throw Error('Choose a matching booking for this payment.');bookingTransaction(t,booking,{...record,operationId:record.id,asOf:date});}
 else saveExpense(t,record,oldId,date);
 t.rates={...t.rates,[record.currency]:record.rate};t.expenseCurrency=record.currency;
 if(candidate.fixedBudget)settleFixedFunding(candidate,date);
 validateState(candidate);
 return {candidate,sourceBefore:move?sourceAvailable(state,move.from,date,instant):null,sourceAfter:move?sourceAvailable(candidate,move.from,date,instant):null,before:expenseBalance(state,pool,date,{instant}),after:expenseBalance(candidate,pool,date,{instant}),dailyBefore:dailyOutlook(state,state.active,date,{instant}),dailyAfter:dailyOutlook(candidate,candidate.active,date,{instant})};
}
