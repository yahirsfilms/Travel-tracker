// Presentation only. Ledger types and calculations remain in fund-preview.js.
const actions = Object.freeze({
 deposit: Object.freeze({title:'Add money', amount:'Amount received', help:'Record new money you received: a gift or extra travel savings. Use the original purchase for refunds or repayments.', empty:'Enter the new money received. Your budgets stay unchanged.', review:'Review money added', confirm:'Confirm money added'}),
 withdrawal: Object.freeze({title:'Remove money', amount:'Amount removed', help:'Record money taken out of your tracked travel money. Use Add expense for a purchase.', empty:'Enter the money leaving your tracked balance. Your budgets stay unchanged.', review:'Review money removed', confirm:'Confirm money removed'}),
 reconciliation: Object.freeze({title:'Check balance', amount:'Total balance you counted', help:'Count all cash and accounts included in Roam. Enter their total, not the difference.', empty:'Enter your counted total to compare it with the recorded balance.', review:'Review balance correction', confirm:'Confirm balance correction'})
});
export function moneyActionCopy(mode){
 if(!Object.hasOwn(actions,mode))throw Error('Choose a money action.');
 return actions[mode];
}
export function moneyEntryLabel(type){return ({deposit:'Money added',withdrawal:'Money removed',reconciliation:'Balance correction',opening:'Starting balance'}[type])||type;}
