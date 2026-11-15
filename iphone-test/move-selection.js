// UI defaults only. Available amounts are supplied by canonical projections.
export function defaultMove(pools,selected,available={}){
 const to=pools.includes(selected)&&selected!=='unassigned'?selected:'daily';
 const order=[...new Set(['unassigned','savings',...pools])];
 const from=order.find(p=>pools.includes(p)&&p!==to&&available[p]>0)||'unassigned';
 return {from,to};
}
