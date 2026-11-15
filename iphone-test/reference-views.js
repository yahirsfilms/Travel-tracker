import {coordinatedProjection,coordinatedTripView} from "./coordinated-budget.js";
import {parseBackup,fundStats,bookingStatus} from './accounting.js';
import {fixedProjection} from './fixed-budget.js';
// A frozen source notebook is informational only. Never project it at today's
// date or fold its money into the destination's live balances.
export function fixedReferenceSummary(archive){
 if(!archive?.notebook)throw Error('No preserved fixed-budget notebook.');
 const source=parseBackup(archive.notebook),plan=source.fixedBudget.plan,date=source.coordination?source.coordination.book.trips[0].plan.clock.date:plan.clock?.date||plan.activationDate,global=source.coordination?coordinatedProjection(source):null,view=global?{balances:global.balances,uncovered:global.uncovered,earnedSavings:global.book.trips.reduce((n,t)=>n+coordinatedTripView(source,global.dates[t.id],{tripId:t.id}).earnedSavings,0)}:fixedProjection(source,date);
 const endpoint=a=>a.tripId?source.trips.find(t=>t.id===a.tripId).name+' · '+a.envelope:'Available to allocate';
 const originalTransfers=structuredClone(plan.transfers).map(t=>({...t,fromLabel:source.trips.find(x=>x.id===source.fixedBudget.tripId).name+' · '+t.from,toLabel:source.trips.find(x=>x.id===source.fixedBudget.tripId).name+' · '+t.to}));
 const transfers=global?originalTransfers.concat(global.book.moves.map(m=>({...m,fromLabel:endpoint(m.from),toLabel:endpoint(m.to)}))):structuredClone(plan.transfers),audit=global?[...structuredClone(plan.audit||[]),...global.book.trips.flatMap(t=>(t.plan.audit||[]).map(a=>({...a,reason:t.name+' · '+(a.reason||'')})))]:structuredClone(plan.audit||[]);
 return {date,exportedAt:archive.notebook.exportedAt,currency:source.fund.currency,actual:fundStats(source).actual,balances:view.balances,uncovered:view.uncovered,earnedSavings:view.earnedSavings,transfers,audit,trips:source.trips.map(t=>({id:t.id,name:t.name,included:t.included,transactions:t.transactions.length,currency:t.currency,bookings:t.bookings.map(b=>({name:b.name,city:b.city||"",estimated:!!b.estimated,cancelled:!!b.cancelled,...bookingStatus(t,b)}))})),clockReview:global?global.book.trips.some(t=>!!t.plan.clockReview):!!plan.clockReview};
}
