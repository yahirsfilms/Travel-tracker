import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { read, write } from "../db.js";
test("IndexedDB persists after reopening; concurrent stale writes cannot overwrite records", async () => {
  let s = await read();
  assert.equal(s.revision, 0);
  s = await write({ ...s, trips: [{ id: "fictional" }] }, s.revision);
  assert.deepEqual((await read()).trips, [{ id: "fictional" }]);
  await assert.rejects(write({ ...s, trips: [] }, 0), /Another window/);
  assert.deepEqual((await read()).trips, [{ id: "fictional" }]);
  const restored = await write(
    { ...s, trips: [...s.trips, { id: "restored-copy" }] },
    s.revision,
  );
  assert.equal((await read()).trips.length, 2);
  assert.equal(restored.revision, 2);
});
