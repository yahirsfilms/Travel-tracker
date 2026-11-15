// Appearance is local presentation state, independent of financial projections.
export const APPEARANCES=['system','light','dark'];
export function appearanceState(mode='system',systemDark=false){
 const preference=APPEARANCES.includes(mode)?mode:'system';
 const dark=preference==='dark'||(preference==='system'&&!!systemDark);
 return {preference,dark,background:dark?'#0d1714':'#f3f5ef'};
}
export function setAppearance({mode='system',systemDark=false,root,meta,storage}){
 const view=appearanceState(mode,systemDark);root.dataset.theme=view.preference;root.dataset.dark=String(view.dark);if(meta)meta.content=view.background;
 try{storage?.setItem('roam-iphone-test-appearance',view.preference);}catch{}
 return view;
}
