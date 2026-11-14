import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { read, write, readLegacyRecovery } from "../db.js";
import {
  migrateState,
  initializeFund,
  makeBackup,
  restoreBackup,
  fundStats,
} from "../accounting.js";
test("transactional migration preserves one untouched V1 recovery and survives reopen/backup recovery", async () => {
  const trip = {
    id: "fictional",
    name: "Fictional old notebook",
    start: "2027-06-01",
    end: "2027-06-10",
    zone: "Asia/Shanghai",
    currency: "USD",
    budgets: { daily: 100000, hotels: 0, transport: 0, emergency: 0 },
    reserved: {},
    adjustments: [],
    transactions: [],
  };
  let old = await write({ trips: [trip], active: trip.id }, 0);
  let next = await write(migrateState(old), old.revision);
  assert.deepEqual(await readLegacyRecovery(), old);
  initializeFund(next, 100000, "USD", {}, "2027-06-01");
  next = await write(next, next.revision);
  assert.deepEqual(await readLegacyRecovery(), old);
  assert.equal((await read()).fund.initialized, true);
  const data = JSON.parse(JSON.stringify(makeBackup(await read())));
  const recovered = restoreBackup(
    migrateState({ trips: [], revision: 0 }),
    data,
    "full",
  );
  assert.equal(fundStats(recovered).actual, 100000);
  await assert.rejects(write({ ...next, trips: [] }, 0), /Another window/);
  assert.equal((await read()).trips.length, 1);
  assert.deepEqual(await readLegacyRecovery(), old);
});
