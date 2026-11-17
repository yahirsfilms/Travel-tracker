// Presentation only: callers supply already calculated/formatted money.
const esc=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function reserveProgress(spent,assigned){
 if(!Number.isFinite(spent)||!Number.isFinite(assigned))return null;
 if(assigned<=0)return {percent:spent>0?100:0,text:spent>0?'Spending recorded with no assigned budget':'No assigned budget'};
 const ratio=Math.max(0,spent)/assigned;
 return {percent:Math.min(100,ratio*100),text:ratio>1?'Assigned budget exceeded':`${Math.floor(ratio*100)}% of assigned budget spent`};
}
export const compactReserveMoney=text=>String(text).replace(/\.00(?=\D*$)/,'');
export function reserveCard({pool,label,amountText,unpaidText='',spentText='',assignedText='',negative=false,spent,assigned}){
 if(!['hotels','transport','emergency'].includes(pool))throw Error('Choose a supported reserve category.');
 const display=label,meaning=negative?'over budget':'remaining';
 const roomy=amountText.length>9||display.length>16||unpaidText.length>9,progress=reserveProgress(spent,assigned);
 const path={hotels:'M3 21V8l9-5 9 5v13M9 21v-6h6v6M7 9h1M16 9h1',transport:'M5 16V7a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v9H5ZM5 10h14M8 20l2-4M16 20l-2-4',emergency:'M9 3h6v6h6v6h-6v6H9v-6H3V9h6Z'}[pool];
 return `<button class="card detail-card reserved-card reserve-card${roomy?' reserve-wide':''}" data-action="pool-detail" data-pool="${pool}" aria-label="${esc(label)}, ${esc(amountText)} ${meaning}${spentText&&assignedText?', '+esc(spentText)+' spent of '+esc(assignedText)+' assigned':''}${unpaidText?', '+esc(unpaidText)+' unpaid':''}. View budget details"><svg class="reserve-icon pool-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg><span class="reserve-name">${esc(display)}</span><strong class="reserve-amount${negative?' negative':''}">${esc(compactReserveMoney(amountText))}${negative?' <span class="reserve-over-label">over budget</span>':''}</strong>${negative?'':`<span class="reserve-caption">${meaning}</span>`}${progress?`<span class="reserve-progress" role="img" aria-label="${esc(progress.text)}"><span style="width:${progress.percent}%"></span></span>`:''}${spentText&&assignedText?`<span class="reserve-spent">${esc(compactReserveMoney(spentText))} / ${esc(compactReserveMoney(assignedText))} ${spent<0?'net spent':'spent'}</span>`:''}${unpaidText?`<span class="reserve-commitment">${esc(unpaidText)} unpaid</span>`:''}</button>`;
}

// Keep spent amounts from inflating assigned funds when the engine exposes a deficit.
export function reserveValues({remaining,deficit=0,paid}){const signed=remaining-deficit;return {remaining:signed,assigned:signed+paid};}
