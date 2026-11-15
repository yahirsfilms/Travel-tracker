// Presentation of canonical summary fields; no budget projection or record mutation.
export function dailyHero(summary){
 const over=Math.max(0,summary.spent-summary.allowance);
 if(over>0&&summary.status==='In progress')return {kind:'over',label:"Over today's allowance",amount:over,suffix:' over'};
 if(summary.scheduled||summary.status==='Upcoming')return {kind:'upcoming',label:'Planned first-day amount',amount:summary.safeToday,suffix:''};
 if(['Completed','Closed'].includes(summary.status))return {kind:'complete',label:'Trip complete',amount:summary.safeToday,suffix:''};
 return {kind:'normal',label:'Left today',amount:summary.safeToday,suffix:''};
}
