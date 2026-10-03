import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { test } from "node:test";

test("ESM and CommonJS consumers resolve both entry points", async () => {
  const require = createRequire(import.meta.url);
  for (const load of [name => import(name), name => require(name)]) {
    assert.equal(typeof (await load("@pubb/sdk")).Pubb, "function");
    assert.equal(typeof (await load("@pubb/sdk/server")).PubbServer, "function");
    assert.equal((await load("@pubb/sdk")).PubbServer, undefined);
  }
});

test("browser bundle loads without Node globals or server cryptography", async () => {
  const code = await readFile(new URL("../dist/pubb.min.global.js", import.meta.url), "utf8");
  const context = {};
  runInNewContext(code, context);
  assert.equal(typeof context.Pubb.Pubb, "function");
  assert.equal(new context.Pubb.Pubb("public-key").getState(), "initialized");
  assert.doesNotMatch(code, /node:crypto|createHmac|PubbServer|@pubb\/shared|process\.env/);
});

test("published metadata and declarations are independent of the monorepo", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.doesNotMatch(JSON.stringify(pkg), /workspace:|file:|OldRepos/);
  for (const entry of ["index", "server"]) {
    for (const suffix of ["d.ts", "d.cts"]) {
      const types = await readFile(new URL(`../dist/${entry}.${suffix}`, import.meta.url), "utf8");
      assert.doesNotMatch(types, /@pubb\/shared|@pubb\/typescript-config/);
    }
  }
});
