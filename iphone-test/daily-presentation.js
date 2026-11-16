// Presentation of canonical summary fields; no budget projection or record mutation.
export function dailyHero(summary){
 const over=Math.max(0,summary.spent-summary.allowance);
 if(over>0&&summary.status==='In progress')return {kind:'over',label:"Over today's allowance",amount:over,suffix:' over'};
 if(summary.scheduled||summary.status==='Upcoming')return {kind:'upcoming',label:'Planned first-day amount',amount:summary.safeToday,suffix:''};
 if(['Completed','Closed'].includes(summary.status))return {kind:'complete',label:'Trip complete',amount:summary.safeToday,suffix:''};
 return {kind:'normal',label:'Left today',amount:summary.safeToday,suffix:''};
}

// Display-only ratio over canonical cents; it never computes a budget or writes records.
export function dailyProgress({spent,allowance}){
 const used=Number.isFinite(spent)?Math.max(0,spent):0;
 const limit=Number.isFinite(allowance)?Math.max(0,allowance):0;
 if(!limit)return {percent:used?100:0,tone:used?'over':'empty',text:used?'Spending recorded · no daily allowance':'No daily allowance'};
 const ratio=used/limit;
 const percent=Math.min(100,Math.max(0,ratio*100));
 const tone=ratio>=1?'over':ratio>=.8?'near':'safe';
 // Avoid rounding 99.9% into “100%” while still below the allowance.
 const shown=Math.floor(Math.min(ratio*100,999));
 return {percent,tone,text:ratio>1?'Daily allowance exceeded':ratio===1?'Daily allowance fully used':`${shown}% of daily allowance used`};
}
