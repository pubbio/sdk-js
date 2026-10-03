import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createHmac } from "node:crypto";
import { PubbServer, PubbApiError } from "@pubb/sdk/server";

const nativeFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = nativeFetch; });
const options = { appId: "test-app", key: "public-key", secret: "test-secret" };

test("publishes with the current HTTP contract, idempotency and socket exclusion", async () => {
  let request;
  const accepted = { success: true, accepted: true, channels: ["notifications"], publicationId: "pub-1", duplicate: false };
  globalThis.fetch = async (url, init) => { request = { url, ...init }; return Response.json(accepted, { status: 202 }); };
  const pubb = new PubbServer({ ...options, appId: "id/with space", apiHost: "http://localhost:38000/" });
  const controller = new AbortController();
  assert.deepEqual(await pubb.trigger(["notifications"], "message.sent", { message: "Hello" }, { socketId: "1.2", idempotencyKey: "pub-1", signal: controller.signal }), accepted);
  assert.equal(request.url, "http://localhost:38000/api/apps/id%2Fwith%20space/events");
  assert.equal(request.method, "POST");
  assert.deepEqual(request.headers, { "Content-Type": "application/json", Authorization: "Bearer test-secret", "Idempotency-Key": "pub-1" });
  assert.deepEqual(JSON.parse(request.body), { channel: ["notifications"], name: "message.sent", data: { message: "Hello" }, socket_id: "1.2" });
  assert.equal(request.signal, controller.signal);
});

test("non-success responses throw a status error without echoing a secret", async () => {
  globalThis.fetch = async () => new Response(options.secret, { status: 401 });
  const pubb = new PubbServer(options);
  await assert.rejects(pubb.trigger("notifications", "message.sent", {}), error => {
    assert(error instanceof PubbApiError);
    assert.equal(error.status, 401);
    assert(!String(error).includes(options.secret));
    return true;
  });
});

test("network errors propagate to the caller", async () => {
  globalThis.fetch = async () => { throw new TypeError("Network unavailable"); };
  await assert.rejects(new PubbServer(options).trigger("notifications", "message.sent", {}), /Network unavailable/);
});

test("private and presence signatures match the socket server's HMAC contract", () => {
  const pubb = new PubbServer(options);
  const sign = message => `public-key:${createHmac("sha256", "test-secret").update(message).digest("hex")}`;
  assert.deepEqual(pubb.authenticatePrivateChannel("1.2", "private-room"), { auth: sign("1.2:private-room") });
  const presence = pubb.authenticatePresenceChannel("1.2", "presence-room", "user-a", { name: "Çağrı" });
  assert.equal(presence.auth, sign(`1.2:presence-room:${presence.channel_data}`));
  assert.deepEqual(JSON.parse(presence.channel_data), { user_id: "user-a", user_info: { name: "Çağrı" } });
});

test("missing credentials fail before making a network request", () => {
  assert.throws(() => new PubbServer({ ...options, secret: "" }), /requires an appId, key and secret/);
});
