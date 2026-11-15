import 'fake-indexeddb/auto';
import {IDBObjectStore} from 'fake-indexeddb';
import test from 'node:test';
import assert from 'node:assert/strict';
import {read,write,notebookName} from '../db.js';
import {backupFingerprint} from '../core.js';
import {migrateState,restoreBackup,makeBackup,initializeFund,fundStats} from '../accounting.js';
test('recovery URL selects separate database and rejects arbitrary namespace',()=>{assert.equal(notebookName(''),'travel-tracker-v1');assert.equal(notebookName('?notebook=bad'),'travel-tracker-v1');assert.notEqual(notebookName('?notebook=recovery-11111111-1111-1111-1111-111111111111'),notebookName(''));});
test('quota failure aborts state replacement and permits retry',async()=>{const old=await write({trips:[{id:'preserved'}]},0),put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(){throw new DOMException('Injected quota failure','QuotaExceededError');};try{await assert.rejects(write({...old,trips:[]},old.revision));}finally{IDBObjectStore.prototype.put=put;}assert.deepEqual((await read()).trips,old.trips);const saved=await write({...old,lastBackup:'test'},old.revision);assert.equal(saved.revision,old.revision+1);});
test('duplicate identity ignores timestamp/key order and prevents second reference import',async()=>{const source=migrateState({trips:[],revision:0});initializeFund(source,100000,'USD',{},'2027-06-01');const data=makeBackup(source),hash=await backupFingerprint(data),again={...data,exportedAt:'later'};assert.equal(await backupFingerprint(again),hash);const target=migrateState({trips:[],revision:0});initializeFund(target,200000,'USD',{},'2027-06-01');restoreBackup(target,data,'copies',hash);assert.equal(fundStats(target).actual,200000);const before=structuredClone(target);assert.throws(()=>restoreBackup(target,data,'copies',hash));assert.deepEqual(target,before);assert.deepEqual(makeBackup(target).importedBackupHashes,[hash]);});

test('full recovery remembers the source fingerprint and rejects reimport into recovered notebook',async()=>{const source=migrateState({trips:[],revision:0});initializeFund(source,100000,'USD',{},'2027-06-01');const data=makeBackup(source),hash=await backupFingerprint(data);const target=restoreBackup(migrateState({trips:[],revision:0}),data,'full',hash);assert.equal(fundStats(target).actual,100000);assert.throws(()=>restoreBackup(target,data,'copies',hash));});
