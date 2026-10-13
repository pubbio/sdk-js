# @pubb/sdk

JavaScript and TypeScript SDK for [Pubb](https://pubb.io). Subscribe from a browser
or a runtime with native WebSocket; publish and sign channel subscriptions from
a trusted Node.js server. ESM, CommonJS, TypeScript declarations and a browser
script bundle are included. There are no runtime dependencies.

This is the standalone [pubbio/sdk-js](https://github.com/pubbio/sdk-js) package.
It does not depend on the Pubb monorepo.
This source checkout has not been published to npm as part of its extraction.
Verify that the intended version exists before installing from the registry.

## Runtime support

- Modern browsers with WebSocket, fetch and URL.
- Node.js 22+ for subscribing and publishing.
- The client can run in other environments that provide compatible WebSocket,
  fetch and URL globals. Bun and Deno have not been verified by this test suite.
- `@pubb/sdk/server` uses Node's crypto API and must stay in trusted server code.
  It is an entry point in this package, not a second package to install.

For another language, use its verified official Pubb SDK if one is available, or
implement Pubb's HTTP/WebSocket protocol with that runtime's networking tools.
An npm package is not required to integrate Pubb.

## Install

After the package version is published:

```sh
npm install @pubb/sdk
```

Before publication, build a tarball locally and install the generated file in the
consumer project:

```sh
# In this package directory (Node.js 22+):
npm ci
npm pack
# In a JavaScript/TypeScript consumer project:
npm install /absolute/path/to/pubb-sdk-0.2.0.tgz
```

Use the consumer project's existing package manager. `npm pack` runs type checks,
builds and tests through `prepack`; it does not publish anything.

## Subscribe

```ts
import { Pubb } from "@pubb/sdk";

const pubb = new Pubb("YOUR_PUBLIC_APP_KEY", {
  wsHost: "wss://ws.pubb.io",
  authEndpoint: "/api/pubb/auth", // Only needed for private/presence channels.
});

pubb.onConnectionStateChange(state => console.log(state));
pubb.subscribe("notifications")
  .bind("message.sent", data => console.log(data))
  .bind("pubb:subscription_error", error => console.error(error));
pubb.connect();

// On component cleanup, worker shutdown or application teardown:
// pubb.disconnect();
```

Create connections in the client's lifecycle (for example a React effect), never
during server-side rendering. Repeated `connect()` calls reuse a pending/open
socket. Unexpected disconnections retry up to five times with exponential
backoff; a successful handshake resets that budget and resubscribes. Explicit
`disconnect()` cancels reconnect timers. Call `connect()` to restart manually.
Refetch durable application state after reconnecting; missed events are not replayed.

Use `unsubscribe(name)`, `channel.unbind(event, callback)` and
`offConnectionStateChange(callback)` to remove subscriptions/listeners.

For CommonJS, use `const { Pubb } = require("@pubb/sdk")`. The browser script file
`dist/pubb.min.global.js` exposes `Pubb.Pubb`, `Pubb.Channel` and
`Pubb.PresenceChannel`; serve that file from your own app before publication.

## Publish from your server

```ts
import { PubbServer } from "@pubb/sdk/server";

const pubb = new PubbServer({
  appId: process.env.PUBB_APP_ID!,
  key: process.env.PUBB_APP_KEY!,
  secret: process.env.PUBB_APP_SECRET!,
  apiHost: "https://api.pubb.io",
});

const result = await pubb.trigger("notifications", "message.sent", {
  message: "Hello from Pubb!",
});
console.log(result.accepted, result.publicationId);
```

HTTP 202 confirms acceptance; a connected subscriber is required for delivery.
Failures throw `PubbApiError` with an HTTP `status`; network errors propagate.
An optional fourth argument supports `socketId` (exclude the sender),
`idempotencyKey` (reuse for retries of the same publication) and an `AbortSignal`
as `signal`. The SDK does not retry publications automatically.

Authenticate and authorize callers of any application route that publishes.
Keep `PUBB_APP_SECRET` in server configuration, never a public environment
variable, browser/mobile bundle, committed file or copied AI prompt.

## Private and presence channels

The client sends JSON `{ socket_id, channel_name }` to your `authEndpoint`.
Optional `auth.headers` and `auth.params` can carry your existing authentication
context. Your server must authenticate the user and authorize access to the
requested channel before returning a signature:

```ts
// After verifying the session and permission for channelName:
const privateAuth = pubb.authenticatePrivateChannel(socketId, channelName);
// Return privateAuth as JSON to the client.

// For a presence channel, derive identity from the verified session:
const presenceAuth = pubb.authenticatePresenceChannel(
  socketId, "presence-room", session.user.id, { name: session.user.name },
);
// Return presenceAuth as JSON to the client.
```

Client-side presence:

```ts
const room = pubb.subscribe("presence-room");
room.bind("pubb:subscription_succeeded", () => {
  console.log(room.getMemberCount(), room.getMembers());
});
room.bind("pubb:member_added", member => console.log(member));
room.bind("pubb:member_removed", member => console.log(member));
```

`getMembers()` returns a copy of the member map. Disconnecting clears presence
state. Native `pubb:*` events and the corresponding legacy `pusher:*` aliases
are supported. Public channels must not carry sensitive data.

## Development and release

```sh
npm ci
npm run check
npm pack --dry-run
```

Tests cover HTTP request contracts, signing, WebSocket frames, reconnect cleanup,
authorization races, presence and each package format. They run locally with
mocked transports; they do not establish a live connection to Pubb.

When preparing a release, verify the npm scope and version, inspect the tarball,
and run a live publish/subscribe check against your intended deployment. Publish
only after explicit release approval with an npm account allowed to publish
`@pubb/sdk`. Publishing this GitHub repository does not publish the package to npm.

The initial extraction retains the `0.2.0` source version. The original monorepo
package remains in place for its existing consumers. This package uses the
current events/auth protocol; it does not advertise the old SDK's channel-listing
helpers because the current API does not expose those routes.

## License

MIT. See [LICENSE](LICENSE).

## Subscription protocol compatibility

This client requests `protocol=2` when opening its WebSocket connection and handles
`pubb:subscription_succeeded`. It still accepts the legacy acknowledgement from
older servers. Current pubb servers send one acknowledgement per subscription:
existing clients without `protocol=2` keep their legacy wire event.
