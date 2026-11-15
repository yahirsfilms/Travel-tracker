// Presentation only: callers supply already calculated/formatted money.
const esc=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function reserveCard({pool,label,amountText,unpaidText='',spentText='',assignedText='',negative=false}){
 if(!['hotels','transport','emergency'].includes(pool))throw Error('Choose a supported reserve category.');
 const display=pool==='transport'?'Transport':label,meaning=negative?'over budget':'remaining';
 // Long currency strings receive a full-width layout instead of tiny/clipped type.
 const roomy=amountText.length>9||display.length>16||unpaidText.length>9;
 return `<button class="card detail-card reserved-card reserve-card${roomy?' reserve-wide':''}" data-action="pool-detail" data-pool="${pool}" aria-label="${esc(label)}, ${esc(amountText)} ${meaning}${spentText&&assignedText?', '+esc(spentText)+' spent of '+esc(assignedText)+' assigned':''}${unpaidText?', '+esc(unpaidText)+' unpaid':''}. View budget details"><span class="reserve-name">${esc(display)}</span><strong class="reserve-amount${negative?' negative':''}">${esc(amountText)}</strong><span class="reserve-caption">${meaning}</span>${spentText&&assignedText?`<span class="reserve-spent">Spent ${esc(spentText)} of ${esc(assignedText)}</span>`:''}<span class="reserve-hint" aria-hidden="true">Details ›</span>${unpaidText?`<span class="reserve-commitment">${esc(unpaidText)} unpaid</span>`:''}</button>`;
}

// Keep spent amounts from inflating assigned funds when the engine exposes a deficit.
export function reserveValues({remaining,deficit=0,paid}){const signed=remaining-deficit;return {remaining:signed,assigned:signed+paid};}
