// Read-only presentation adapters over the existing cash and planning engines.
// Hypothetical purchases are applied only to an in-memory clone, never storage.
import {safeSummary,saveExpense,poolBudget,spent,commitment,fundStats} from './accounting.js';
import {fixedProjection} from './fixed-budget.js';
import {dayNumber} from './core.js';
export function dailyOutlook(state,tripId,date,{instant}={}){
 const t=state.trips.find(t=>t.id===tripId);if(!t)throw Error('Choose a trip.');
 const context=state.coordination?state.coordination.book.trips.find(t=>t.id===tripId)?.plan:state.fixedBudget?.plan;
 const fixed=!!t.included&&!!state.fixedBudget&&(!state.coordination?state.fixedBudget.tripId===tripId:!!context)&&date>=context.activationDate;
 const rolling=safeSummary(state,t,date);
 if(!fixed)return {mode:'Rolling',...rolling,target:rolling.allowance,overspent:Math.max(0,rolling.spent-rolling.allowance),dailyRemaining:rolling.available||0,dailyAssigned:poolBudget(t,'daily'),dailyPaid:spent(t,'daily'),unpaid:commitment(t,'daily'),gap:rolling.shortfall||0,savings:null,cash:fundStats(state).actual};
 // Projection uses the selected trip exactly as the app does, without editing state.
 const view=state.active===tripId?state:{...state,active:tripId};
 const x=fixedProjection(view,date,{instant}),next=x.days.find(d=>dayNumber(d.date)===dayNumber(date)+1);
 return {mode:'Fixed',days:Math.max(0,dayNumber(t.end)-Math.max(dayNumber(t.start),dayNumber(date))+1),target:x.target,allowance:x.target,spent:x.spentToday,safeToday:x.backedLeftToday,overspent:Math.max(0,x.spentToday-x.target),tomorrow:next?.target??null,dailyRemaining:x.balances.daily,dailyAssigned:x.balances.daily+spent(t,'daily'),dailyPaid:spent(t,'daily'),unpaid:x.plan.commitments.filter(b=>b.envelope==='daily').reduce((n,b)=>n+b.unpaid,0),gap:x.fundingShortfall,savings:x.savingsAvailable,clockReview:!!x.clock?.review,cash:x.actual};
}
export function previewDailyPurchase(state,tripId,date,amount,options){
 if(!Number.isSafeInteger(amount)||amount<=0||amount>1e11)throw Error('Enter a positive amount.');
 const next=structuredClone(state),t=next.trips.find(t=>t.id===tripId);
 if(!t?.included||t.closed||date<t.start||date>t.end)throw Error('Choose an open travel day for this preview.');
 let id='preview-daily-purchase';while(t.transactions.some(x=>x.id===id))id+='-';
 saveExpense(t,{id,date,amount,currency:t.currency,rate:1,base:amount,pool:'daily',...(next.fixedBudget?{fundingSource:'daily'}:{}),category:'Food & drink',note:'Preview only — never saved'},undefined,date);
 return dailyOutlook(next,tripId,date,options);
}
