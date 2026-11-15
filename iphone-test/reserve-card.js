// Presentation only: callers supply already calculated/formatted money.
const esc=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function reserveCard({pool,label,amountText,unpaidText='',negative=false}){
 if(!['hotels','transport','emergency'].includes(pool))throw Error('Choose a supported reserve category.');
 const display=pool==='transport'?'Transport':label;
 // Long currency strings receive a full-width layout instead of tiny/clipped type.
 const roomy=amountText.length>9||display.length>16||unpaidText.length>9;
 return `<button class="card detail-card reserved-card reserve-card${roomy?' reserve-wide':''}" data-action="pool-detail" data-pool="${pool}" aria-label="${esc(label)}, ${esc(amountText)} remaining${unpaidText?', '+esc(unpaidText)+' unpaid':''}. View budget details"><span class="reserve-name">${esc(display)}</span><strong class="reserve-amount${negative?' negative':''}">${esc(amountText)}</strong><span class="reserve-hint" aria-hidden="true">Details ›</span>${unpaidText?`<span class="reserve-commitment">${esc(unpaidText)} unpaid</span>`:''}</button>`;
}
