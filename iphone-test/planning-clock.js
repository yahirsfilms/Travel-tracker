// Destination-clock guard for the staged planning engine. No background timer,
// cash mutation or device time-zone dependence. Explicit anomalies need review.
import {dayNumber} from './core.js';
import {validatePlan,projectPlan} from './planning.js';
const instant=n=>Number.isFinite(n)&&n>=0&&n<=8640000000000000;
function travelDate(zone,n){return new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(n));}
export function inspectClock(p,now){
 validatePlan(p);if(!instant(now))throw Error('Invalid device time.');
 const observedDate=travelDate(p.zone,now),old=p.clock;
 if(!old)return {date:observedDate,observedDate,review:false,reason:null};
 if(!instant(old.instant)||typeof old.zone!=='string')throw Error('Invalid saved planning clock.');dayNumber(old.date);
 const elapsed=now-old.instant,days=dayNumber(observedDate)-dayNumber(old.date);
 let reason=null;
 if(old.zone!==p.zone)reason='The trip time zone changed. Review the next settlement boundary.';
 else if(elapsed < -300000 || days<0)reason='The device clock moved backward. Closed days must not be settled again.';
 else if(elapsed>7*86400000)reason='More than a week has passed. Check missing purchases before releasing accumulated savings.';
 else if(days>Math.ceil(Math.max(0,elapsed)/86400000)+1)reason='The travel date changed unexpectedly. Review the clock before settling savings.';
 return {date:reason?old.date:observedDate,observedDate,review:!!reason,reason};
}
export function advanceClock(p,now){
 const view=inspectClock(p,now),next=structuredClone(p);
 // Never advance the last trusted boundary while review is pending.
 if(view.review){next.clockReview={observedDate:view.observedDate,reason:view.reason};return {plan:next,clock:view};}
 next.clock={instant:now,date:view.date,zone:p.zone};delete next.clockReview;
 return {plan:next,clock:view};
}
export function acknowledgeClock(p,now,reason){
 validatePlan(p);if(!instant(now)||typeof reason!=='string'||!reason.trim()||reason.length>1000)throw Error('Review the device time and enter a reason.');
 const next=structuredClone(p),observedDate=travelDate(p.zone,now);
 next.audit=[...(next.audit||[]),{type:'clock reviewed',date:observedDate,reason,before:structuredClone(p.clock||null),after:{instant:now,date:observedDate,zone:p.zone}}];
 next.clock={instant:now,date:observedDate,zone:p.zone};delete next.clockReview;return next;
}
export function projectAtClock(p,now,options){const clock=inspectClock(p,now);return {...projectPlan(p,clock.date,options),clock};}
