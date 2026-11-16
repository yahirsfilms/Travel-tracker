// Presentation only. Original dates, categories, amounts and notes stay in records.
export function compactDate(date,year=new Date().getUTCFullYear()){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date||''))return String(date||'Date not recorded');
 return new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',...(Number(date.slice(0,4))===year?{}:{year:'numeric'}),timeZone:'UTC'}).format(new Date(date+'T12:00:00Z'));
}
export function transactionTone(base){return base>0?'expense-amount':base<0?'refund-amount':'neutral-amount';}
export function fundingLabel(pool,fallback=''){return {daily:'Daily',hotels:'Hotels',transport:'Transport',emergency:'Emergency',savings:'Savings',shopping:'Shopping',activities:'Activities',unassigned:'Available money'}[pool]||fallback||pool;}
export function transactionIcon(category,pool){
 const c=String(category).toLowerCase();
 const paths=/food|drink|meal|coffee/.test(c)?'M5 3v6c0 3 6 3 6 0V3M8 3v18M17 3v18M17 3c-4 4-4 9 0 9':/hotel|accommodation/.test(c)||pool==='hotels'?'M3 21V8l9-5 9 5v13M9 21v-6h6v6M7 9h1M16 9h1':/transport|travel|train|flight/.test(c)||pool==='transport'?'M5 16V7a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v9H5ZM5 10h14M8 20l2-4M16 20l-2-4M8 13h1M15 13h1':/shop|cloth|gift|souvenir|keychain/.test(c)?'M4 8h16l-1 13H5L4 8ZM8 8V6a4 4 0 0 1 8 0v2':'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM8 12h8M12 8v8';
 return `<svg class="pool-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths}"/></svg>`;
}
