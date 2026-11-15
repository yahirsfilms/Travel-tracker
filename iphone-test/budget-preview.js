// Copy-on-write review of existing legacy budget commands; no persistence.
import {adjustBudget,transferBudget,fundStats,safeSummary,validateState} from './accounting.js';
export function previewLegacyBudget(state,{mode,pool,toPool,targetTripId,amount,date,note='Budget change',operationId}){
 if(!Number.isSafeInteger(amount)||amount<=0||amount>1e11)throw Error('Enter a positive budget amount.');
 if(state.fixedBudget)throw Error('Use the fixed-budget move workflow.');
 if(!['add','remove','transfer'].includes(mode))throw Error('Choose a budget action.');
 const next=structuredClone(state),source=next.trips.find(t=>t.id===next.active);
 if(!source||source.closed)throw Error('Choose an open trip.');
 if(mode==='transfer'){const target=next.trips.find(t=>t.id===targetTripId);if(!target||target.closed)throw Error('Choose an open destination trip.');transferBudget(next,source,target,pool,toPool,amount,date,note,operationId);}
 else adjustBudget(next,source,pool,mode==='add'?amount:-amount,date,note);
 validateState(next);
 if(fundStats(next).actual!==fundStats(state).actual)throw Error('A budget move must not change recorded money.');
 return {candidate:next,before:fundStats(state),after:fundStats(next),dailyBefore:safeSummary(state,state.trips.find(t=>t.id===state.active),date),dailyAfter:safeSummary(next,source,date)};
}
