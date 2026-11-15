import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";
test("service worker installs complete shell, serves offline navigation and assets, preserves unrelated caches", async () => {
  const handlers = {},
    stored = new Map(),
    deleted = [];
  const scope = "https://example.test/Travel-tracker/";
  const cache = {
    addAll: async (list) => {
      for (const p of list) {
        assert.ok(
          fs.existsSync(
            new URL("../" + (p === "./" ? "index.html" : p), import.meta.url),
          ),
        );
        stored.set(new URL(p, scope).href, "cached:" + p);
      }
    },
    match: async (req) =>
      stored.get(
        new URL(typeof req === "string" ? req : req.url, scope).href.split(
          "?",
        )[0],
      ),
  };
  const keys = ["roam-shell-old", "unrelated-app"];
  const self = {
    location: { origin: "https://example.test" },
    registration: { scope },
    clients: { claim: async () => {} },
    skipWaiting: () => {},
    addEventListener: (n, fn) => (handlers[n] = fn),
  };
  vm.runInNewContext(
    fs.readFileSync(new URL("../sw.js", import.meta.url), "utf8"),
    {
      self,
      URL,
      caches: {
        open: async () => cache,
        keys: async () => keys,
        delete: async (k) => deleted.push(k),
      },
      fetch: () => {
        throw Error("OFFLINE");
      },
    },
  );
  let promise;
  handlers.install({ waitUntil: (p) => (promise = p) });
  await promise;
  handlers.activate({ waitUntil: (p) => (promise = p) });
  await promise;
  assert.deepEqual(deleted, ["roam-shell-old"]);
  function request(path, mode = "navigate") {
    let result;
    handlers.fetch({
      request: { method: "GET", url: new URL(path, scope).href, mode },
      respondWith: (p) => (result = p),
    });
    return result;
  }
  assert.equal(await request("history"), "cached:./index.html");
  assert.equal(await request("app.js", "cors"), "cached:./app.js");
  assert.equal(await request("style.css?v=2", "cors"), "cached:./style.css");
  let readiness;
  handlers.message({data:{type:"CHECK_OFFLINE"},ports:[{postMessage: x => readiness=x}],waitUntil:p=>promise=p});
  await promise;
  assert.equal(readiness.ready,true);
  stored.delete(new URL("app.js",scope).href);
  handlers.message({data:{type:"CHECK_OFFLINE"},ports:[{postMessage: x => readiness=x}],waitUntil:p=>promise=p});
  await promise;
  assert.equal(readiness.ready,false);
});
