import {fundStats,recordFunds,validateState} from './accounting.js';
import {fixedProjection} from './fixed-budget.js';
function snapshot(s,date){const cash=fundStats(s);if(!s.fixedBudget)return {actual:cash.actual,available:Math.max(0,cash.unallocated),gap:cash.shortfall};const v=fixedProjection(s,date);return {actual:v.actual,available:v.transferable.unassigned,gap:v.global?.fundingShortfall??v.fundingShortfall};}
export function previewFundChange(state,{mode,value,note,date}){
 if(!['deposit','withdrawal','reconciliation'].includes(mode)||!Number.isSafeInteger(value)||value<0||value>1e11)throw Error('Enter a valid money amount.');
 const before=snapshot(state,date),amount=mode==='reconciliation'?value-before.actual:mode==='withdrawal'?-value:value;
 if(!amount)throw Error(mode==='reconciliation'?'Your counted balance already matches. No correction is needed.':'Enter an amount greater than zero.');
 const candidate=structuredClone(state);
 recordFunds(candidate,{type:mode,amount,date,note:note?.trim()||({deposit:'Money added',withdrawal:'Money removed',reconciliation:'Counted balance correction'}[mode]),...(mode==='reconciliation'?{observed:value}:{})});
 validateState(candidate);return {candidate,before,after:snapshot(candidate,date),amount};
}
