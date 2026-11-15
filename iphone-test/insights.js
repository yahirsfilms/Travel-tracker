import {fundStats,allocation,spent,protections,fundValue,poolBudget,commitment,bookingStatus} from './accounting.js';
// Read-only data views. Trips and category projections are never added together.
export function moneyBreakdown(s){
 const f=fundStats(s);if(!s.fund.initialized)return {...f,trips:[]};return {...f,trips:s.trips.filter(t=>t.included).map(t=>{
  const held=Math.max(0,fundValue(t,allocation(t))-t.transactions.reduce((n,x)=>n+fundValue(t,x.base),0),fundValue(t,protections(t)));
  let left=held;
  const pools=['hotels','transport','emergency'].map(pool=>{
   const local=Math.max(0,poolBudget(t,pool)-spent(t,pool),commitment(t,pool));
   const amount=Math.min(left,fundValue(t,local));left-=amount;
   return {pool,amount,local,unpaid:commitment(t,pool)};
  });pools.unshift({pool:'daily',amount:left,local:Math.max(0,poolBudget(t,'daily')-spent(t,'daily')),unpaid:commitment(t,'daily')});
  return {id:t.id,name:t.name,currency:t.currency,held,pools};
 })};
}
export function historyRecords(s,{tripId=s.active,from='',to='',category='',pool='',query=''}={}){
 return s.trips.filter(t=>tripId?t.id===tripId:t.included).flatMap(t=>t.transactions.map((x,index)=>({...x,tripId:t.id,tripName:t.name,tripCurrency:t.currency,index,displayAmount:tripId?x.base:fundValue(t,x.base),displayCurrency:tripId?t.currency:s.fund.currency})))
 .filter(x=>(!from||x.date>=from)&&(!to||x.date<=to)&&(!category||x.category===category)&&(!pool||(x.fundingSource||x.pool)===pool)&&`${x.category} ${x.note} ${x.tripName} ${x.date}`.toLowerCase().includes(query.toLowerCase()))
 .sort((a,b)=>b.date.localeCompare(a.date)||b.index-a.index||a.tripId.localeCompare(b.tripId));
}
export function spendingSummary(records){
 const byCategory=new Map();let expenses=0,refunds=0;
 for(const x of records){const n=x.displayAmount??x.base;if(n>0)expenses+=n;else refunds-=n;byCategory.set(x.category,(byCategory.get(x.category)||0)+n);}
 return {expenses,refunds,net:expenses-refunds,categories:[...byCategory].map(([name,amount])=>({name,amount})).sort((a,b)=>b.amount-a.amount)};
}
export function completedTripSummary(t,projection){
 const totals=spendingSummary(t.transactions);
 return {...totals,purchases:t.transactions.filter(x=>x.base>0).length,refundRecords:t.transactions.filter(x=>x.base<0).length,savings:projection?.balances.savings??null,earnedSavings:projection?.earnedSavings??null,unpaid:t.bookings.reduce((n,b)=>n+bookingStatus(t,b).unpaid,0),pendingRefund:t.bookings.reduce((n,b)=>n+bookingStatus(t,b).pendingRefund,0)};
}
