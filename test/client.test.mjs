import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { Pubb, PresenceChannel } from "@pubb/sdk";

class Socket {
  static OPEN = 1;
  static instances = [];
  readyState = 1;
  sent = [];
  closed = false;
  constructor(url) { this.url = url; Socket.instances.push(this); }
  send(message) { this.sent.push(JSON.parse(message)); }
  close() { this.closed = true; this.onclose?.({}); }
  receive(message) { this.onmessage?.({ data: JSON.stringify(message) }); }
  establish(id = "1.2") { this.receive({ event: "pubb:connection_established", data: JSON.stringify({ socket_id: id }) }); }
}

let clients;
const nativeWebSocket = globalThis.WebSocket;
const nativeFetch = globalThis.fetch;
beforeEach(() => {
  Socket.instances = [];
  clients = [];
  globalThis.WebSocket = Socket;
});
afterEach(() => {
  for (const client of clients) client.disconnect();
  globalThis.WebSocket = nativeWebSocket;
  globalThis.fetch = nativeFetch;
  mock.timers.reset();
});
function client(key = "public-key") {
  const pubb = new Pubb(key, { wsHost: "ws://localhost:38001/" });
  clients.push(pubb);
  return pubb;
}

test("encodes public keys, connects once and delivers Pubb application frames", () => {
  const pubb = client('key&? /"');
  const received = [];
  const states = [];
  pubb.onConnectionStateChange(state => states.push(state));
  pubb.subscribe("notifications").bind("message.sent", data => received.push(data));
  pubb.connect().connect();
  assert.equal(Socket.instances.length, 1);
  const socket = Socket.instances[0];
  assert.equal(new URL(socket.url).pathname, "/socket");
  assert.equal(new URL(socket.url).searchParams.get("protocol"), "2");
  assert.equal(new URL(socket.url).searchParams.get("appKey"), 'key&? /"');
  socket.establish();
  assert.deepEqual(socket.sent, [{ action: "subscribe", channel: "notifications" }]);
  socket.receive({ channel: "notifications", data: JSON.stringify({ name: "message.sent", data: { message: "Hello" } }) });
  socket.receive({ channel: "unrelated", data: JSON.stringify({ name: "message.sent", data: "ignore" }) });
  socket.onmessage({ data: "invalid json" });
  assert.deepEqual(received, [{ message: "Hello" }]);
  assert.deepEqual(states, ["connecting", "connected"]);
  assert.equal(pubb.getSocketId(), "1.2");
});

test("manual disconnect cancels reconnects, ignores old callbacks and allows explicit reconnect", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const pubb = client().connect();
  const socket = Socket.instances[0];
  const staleMessage = socket.onmessage;
  socket.establish();
  socket.close();
  pubb.disconnect();
  mock.timers.tick(60_000);
  staleMessage({ data: JSON.stringify({ event: "pubb:connection_established", data: '{"socket_id":"old"}' }) });
  assert.equal(Socket.instances.length, 1);
  assert.equal(pubb.getState(), "disconnected");
  assert.equal(pubb.getSocketId(), null);
  pubb.connect();
  assert.equal(Socket.instances.length, 2);
});

test("disconnecting an open socket does not schedule a reconnect", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const pubb = client().connect();
  Socket.instances[0].establish();
  pubb.disconnect();
  mock.timers.tick(60_000);
  assert.equal(Socket.instances.length, 1);
  assert.equal(Socket.instances[0].closed, true);
});

test("unexpected closes reconnect with bounded backoff and resubscribe", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const pubb = client();
  pubb.subscribe("notifications");
  pubb.connect();
  Socket.instances[0].establish();
  Socket.instances[0].close();
  mock.timers.tick(1999);
  assert.equal(Socket.instances.length, 1);
  mock.timers.tick(1);
  Socket.instances[1].establish("3.4");
  assert.deepEqual(Socket.instances[1].sent, [{ action: "subscribe", channel: "notifications" }]);
  for (const delay of [2000, 4000, 8000, 16000, 30000]) {
    Socket.instances.at(-1).close();
    mock.timers.tick(delay);
  }
  Socket.instances.at(-1).close();
  assert.equal(pubb.getState(), "failed");
  const count = Socket.instances.length;
  mock.timers.tick(60_000);
  assert.equal(Socket.instances.length, count);
});

test("presence handles native and legacy events, string payloads and disconnect cleanup", () => {
  const pubb = client();
  const channel = pubb.subscribe("presence-room");
  const added = [], legacyAdded = [];
  assert(channel instanceof PresenceChannel);
  channel.bind("pubb:member_added", member => added.push(member));
  channel.bind("pusher:member_added", member => legacyAdded.push(member));
  pubb.connect();
  const socket = Socket.instances[0];
  socket.receive({ event: "pusher_internal:subscription_succeeded", channel: "presence-room", data: JSON.stringify({ presence: { ids: ["a"], hash: { a: { name: "A" } }, count: 1 } }) });
  socket.receive({ event: "pubb:member_added", channel: "presence-room", data: JSON.stringify({ user_id: "b", user_info: { name: "B" } }) });
  assert.equal(channel.getMemberCount(), 2);
  assert.equal(channel.getMembers().get("b").name, "B");
  assert.equal(added.length, 1);
  assert.deepEqual(added, legacyAdded);
  channel.getMembers().clear();
  assert.equal(channel.getMemberCount(), 2);
  socket.receive({ event: "pusher_internal:member_removed", channel: "presence-room", data: { user_id: "a" } });
  assert.equal(channel.getMemberCount(), 1);
  pubb.disconnect();
  assert.equal(channel.getMemberCount(), 0);
});

test("presence handles protocol 2 acknowledgement, string payloads and disconnect cleanup", () => {
  const pubb = client();
  const channel = pubb.subscribe("presence-room");
  const added = [], legacyAdded = [];
  assert(channel instanceof PresenceChannel);
  channel.bind("pubb:member_added", member => added.push(member));
  channel.bind("pusher:member_added", member => legacyAdded.push(member));
  pubb.connect();
  const socket = Socket.instances[0];
  socket.receive({ event: "pubb:subscription_succeeded", channel: "presence-room", data: JSON.stringify({ presence: { ids: ["a"], hash: { a: { name: "A" } }, count: 1 } }) });
  socket.receive({ event: "pubb:member_added", channel: "presence-room", data: JSON.stringify({ user_id: "b", user_info: { name: "B" } }) });
  assert.equal(channel.getMemberCount(), 2);
  assert.equal(channel.getMembers().get("b").name, "B");
  assert.equal(added.length, 1);
  assert.deepEqual(added, legacyAdded);
  channel.getMembers().clear();
  assert.equal(channel.getMemberCount(), 2);
  socket.receive({ event: "pusher_internal:member_removed", channel: "presence-room", data: { user_id: "a" } });
  assert.equal(channel.getMemberCount(), 1);
  pubb.disconnect();
  assert.equal(channel.getMemberCount(), 0);
});

test("plain-text subscription errors reach channel and global callbacks", () => {
  const pubb = client();
  const channelErrors = [], errors = [];
  pubb.subscribe("notifications").bind("pubb:subscription_error", error => channelErrors.push(error));
  pubb.bind("pubb:subscription_error", error => errors.push(error));
  pubb.connect();
  Socket.instances[0].receive({ event: "subscription_error", channel: "notifications", data: "Channel unavailable" });
  assert.deepEqual(channelErrors, ["Channel unavailable"]);
  assert.deepEqual(errors, [{ channel: "notifications", data: "Channel unavailable" }]);
});

test("private auth uses current socket identity and discards an unsubscribed channel's response", async () => {
  let resolveAuth, request;
  globalThis.fetch = (url, init) => {
    request = { url, ...init };
    return new Promise(resolve => { resolveAuth = resolve; });
  };
  const pubb = client();
  pubb.subscribe("private-room");
  pubb.connect();
  const socket = Socket.instances[0];
  socket.establish();
  assert.equal(request.url, "/api/pubb/auth");
  assert.deepEqual(JSON.parse(request.body), { socket_id: "1.2", channel_name: "private-room" });
  pubb.unsubscribe("private-room");
  resolveAuth(Response.json({ auth: "public-key:signature" }));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(socket.sent, [{ action: "unsubscribe", channel: "private-room" }]);
});

test("auth responses from a previous connection cannot subscribe a new socket", async () => {
  const pending = [];
  globalThis.fetch = () => new Promise(resolve => pending.push(resolve));
  const pubb = client();
  pubb.subscribe("private-room");
  pubb.connect();
  Socket.instances[0].establish();
  pubb.disconnect().connect();
  Socket.instances[1].establish("3.4");
  pending[0](Response.json({ auth: "old-signature" }));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(Socket.instances[1].sent, []);
  pending[1](Response.json({ auth: "new-signature" }));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(Socket.instances[1].sent, [{ action: "subscribe", channel: "private-room", auth: "new-signature" }]);
});

test("authorization failures notify listeners without sending a subscription", async () => {
  globalThis.fetch = async () => new Response(null, { status: 403 });
  const pubb = client();
  const errors = [];
  pubb.subscribe("private-room").bind("pubb:subscription_error", error => errors.push(error));
  pubb.connect();
  Socket.instances[0].establish();
  await new Promise(resolve => setImmediate(resolve));
  assert.match(errors[0].message, /403/);
  assert.deepEqual(Socket.instances[0].sent, []);
});

test("removed callbacks and channels stop receiving events", () => {
  const pubb = client();
  const events = [], states = [];
  const receive = data => events.push(data);
  const state = data => states.push(data);
  const channel = pubb.subscribe("notifications").bind("message.sent", receive);
  channel.unbind("message.sent", receive);
  pubb.onConnectionStateChange(state).offConnectionStateChange(state);
  pubb.connect();
  Socket.instances[0].establish();
  Socket.instances[0].receive({ channel: "notifications", data: { name: "message.sent", data: "ignore" } });
  pubb.unsubscribe("notifications");
  assert.equal(pubb.channel("notifications"), undefined);
  assert.deepEqual(events, []);
  assert.deepEqual(states, []);
});
