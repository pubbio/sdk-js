import { Channel, PresenceChannel } from "./channel.js";
import { INTERNAL_EVENTS, PUSHER_EVENTS, PUBB_EVENTS, EVENT_ALIASES, EVENT_ALIASES_REVERSE, PRESENCE_CHANNEL_PREFIX, PRIVATE_CHANNEL_PREFIX } from "./protocol.js";

export interface PubbOptions {
  wsHost?: string;
  authEndpoint?: string;
  auth?: {
    headers?: Record<string, string>;
    params?: Record<string, string>;
  };
  debug?: boolean;
}

export type ConnectionState = "initialized" | "connecting" | "connected" | "disconnected" | "failed";
type ConnectionCallback = (state: ConnectionState) => void;
type EventCallback = (data: unknown) => void;

function decode(data: unknown): any {
  if (typeof data !== "string") return data;
  try { return JSON.parse(data); }
  catch { return data; }
}

export class Pubb {
  private readonly appKey: string;
  private readonly options: PubbOptions;
  private socket: WebSocket | null = null;
  private socketId: string | null = null;
  private channels = new Map<string, Channel>();
  private connectionState: ConnectionState = "initialized";
  private connectionCallbacks = new Set<ConnectionCallback>();
  private globalBindings = new Map<string, Set<EventCallback>>();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private stopped = true;

  constructor(appKey: string, options: PubbOptions = {}) {
    this.appKey = appKey;
    this.options = { wsHost: "wss://ws.pubb.io", authEndpoint: "/api/pubb/auth", ...options };
  }

  connect(): this {
    if (this.socket) return this;
    if (typeof WebSocket === "undefined") {
      throw new Error("Pubb requires a runtime with native WebSocket (a browser or Node.js 22+)");
    }
    if (this.reconnectTimer !== undefined) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    const endpoint = new URL("/socket", this.options.wsHost);
    endpoint.searchParams.set("appKey", this.appKey);
    endpoint.searchParams.set("protocol", "2");
    const socket = new WebSocket(endpoint.toString());
    this.socket = socket;
    this.stopped = false;

    socket.onmessage = event => {
      if (this.socket === socket) this.handleMessage(event.data);
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.socketId = null;
      this.clearPresence();
      this.setState("disconnected");
      this.attemptReconnect();
    };
    socket.onerror = () => {
      if (this.socket === socket) this.setState("failed");
    };
    this.setState("connecting");
    return this;
  }

  disconnect(): this {
    this.stopped = true;
    if (this.reconnectTimer !== undefined) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.reconnectAttempts = 0;
    const socket = this.socket;
    this.socket = null;
    this.socketId = null;
    if (socket) {
      socket.onmessage = socket.onclose = socket.onerror = null;
      socket.close();
    }
    this.clearPresence();
    this.setState("disconnected");
    return this;
  }

  subscribe(channelName: `presence-${string}`): PresenceChannel;
  subscribe(channelName: string): Channel;
  subscribe(channelName: string): Channel {
    const existing = this.channels.get(channelName);
    if (existing) return existing;
    const channel = channelName.startsWith(PRESENCE_CHANNEL_PREFIX) ? new PresenceChannel(channelName) : new Channel(channelName);
    this.channels.set(channelName, channel);
    if (this.connectionState === "connected") void this.subscribeToChannel(channelName);
    return channel;
  }

  unsubscribe(channelName: string): this {
    const channel = this.channels.get(channelName);
    if (channel) {
      channel.unbindAll();
      if (channel instanceof PresenceChannel) channel._setMembers([], {});
      this.channels.delete(channelName);
      this.send({ action: "unsubscribe", channel: channelName });
    }
    return this;
  }

  channel(name: string): Channel | undefined { return this.channels.get(name); }
  getState(): ConnectionState { return this.connectionState; }
  getSocketId(): string | null { return this.socketId; }

  onConnectionStateChange(callback: ConnectionCallback): this {
    this.connectionCallbacks.add(callback);
    return this;
  }

  offConnectionStateChange(callback: ConnectionCallback): this {
    this.connectionCallbacks.delete(callback);
    return this;
  }

  bind(event: string, callback: EventCallback): this {
    if (!this.globalBindings.has(event)) this.globalBindings.set(event, new Set());
    this.globalBindings.get(event)!.add(callback);
    return this;
  }

  unbind(event: string, callback?: EventCallback): this {
    if (callback) this.globalBindings.get(event)?.delete(callback);
    else this.globalBindings.delete(event);
    return this;
  }

  private emitGlobal(event: string, data: unknown): void {
    for (const name of new Set([event, EVENT_ALIASES[event], EVENT_ALIASES_REVERSE[event]])) {
      if (!name) continue;
      this.globalBindings.get(name)?.forEach(callback => this.invoke(() => callback(data)));
    }
  }

  private handleMessage(raw: string): void {
    try {
      const message = JSON.parse(raw);
      const data = decode(message.data);
      const event = message.event;
      if (event === PUBB_EVENTS.CONNECTION_ESTABLISHED || event === PUSHER_EVENTS.CONNECTION_ESTABLISHED) {
        if (typeof data?.socket_id !== "string") return;
        this.socketId = data.socket_id;
        this.reconnectAttempts = 0;
        // Take a snapshot before callbacks can add channels of their own.
        const pending = [...this.channels.keys()];
        this.setState("connected");
        for (const name of pending) void this.subscribeToChannel(name);
        return;
      }

      const channel = this.channels.get(message.channel);
      if (event === INTERNAL_EVENTS.SUBSCRIPTION_SUCCEEDED || event === PUBB_EVENTS.SUBSCRIPTION_SUCCEEDED || event === PUSHER_EVENTS.SUBSCRIPTION_SUCCEEDED) {
        if (channel instanceof PresenceChannel && data?.presence) {
          channel._setMembers(data.presence.ids, data.presence.hash);
        }
        if (channel) {
          this.invoke(() => channel._subscribed());
          channel._emit(PUBB_EVENTS.SUBSCRIPTION_SUCCEEDED, data);
        }
        return;
      }

      if (["subscription_error", INTERNAL_EVENTS.SUBSCRIPTION_ERROR, PUBB_EVENTS.SUBSCRIPTION_ERROR, PUSHER_EVENTS.SUBSCRIPTION_ERROR].includes(event)) {
        channel?._emit(PUBB_EVENTS.SUBSCRIPTION_ERROR, data);
        this.emitGlobal(PUBB_EVENTS.SUBSCRIPTION_ERROR, { channel: message.channel, data });
        return;
      }

      if (channel instanceof PresenceChannel) {
        if ([INTERNAL_EVENTS.MEMBER_ADDED, PUBB_EVENTS.MEMBER_ADDED, PUSHER_EVENTS.MEMBER_ADDED].includes(event)) {
          channel._addMember(data.user_id, data.user_info);
          channel._emit(PUBB_EVENTS.MEMBER_ADDED, data);
          return;
        }
        if ([INTERNAL_EVENTS.MEMBER_REMOVED, PUBB_EVENTS.MEMBER_REMOVED, PUSHER_EVENTS.MEMBER_REMOVED].includes(event)) {
          channel._removeMember(data.user_id);
          channel._emit(PUBB_EVENTS.MEMBER_REMOVED, data);
          return;
        }
      }

      if (!event && channel && data && typeof data.name === "string") channel._emit(data.name, data.data);
      if (event && !message.channel) this.emitGlobal(event, data);
    } catch (error) {
      if (this.options.debug) console.error("[Pubb] Invalid WebSocket message", error);
    }
  }

  private async subscribeToChannel(channelName: string): Promise<void> {
    const channel = this.channels.get(channelName);
    const socket = this.socket;
    const socketId = this.socketId;
    if (!channel || !socket || !socketId || this.connectionState !== "connected") return;
    const current = () => this.socket === socket && this.socketId === socketId && this.channels.get(channelName) === channel;
    if (!channelName.startsWith(PRIVATE_CHANNEL_PREFIX) && !channelName.startsWith(PRESENCE_CHANNEL_PREFIX)) {
      this.send({ action: "subscribe", channel: channelName });
      return;
    }
    try {
      if (!this.options.authEndpoint) throw new Error("An authEndpoint is required");
      const response = await fetch(this.options.authEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...this.options.auth?.headers },
        body: JSON.stringify({ ...this.options.auth?.params, socket_id: socketId, channel_name: channelName }),
      });
      if (!response.ok) throw new Error(`Channel authorization failed (HTTP ${response.status})`);
      const auth = await response.json();
      if (typeof auth?.auth !== "string") throw new Error("Invalid channel authorization response");
      if (current()) this.send({ action: "subscribe", channel: channelName, auth: auth.auth, channel_data: auth.channel_data });
    } catch (error) {
      if (current()) {
        const data = { message: error instanceof Error ? error.message : "Channel authorization failed" };
        channel._emit(PUBB_EVENTS.SUBSCRIPTION_ERROR, data);
        this.emitGlobal(PUBB_EVENTS.SUBSCRIPTION_ERROR, { channel: channelName, data });
      }
    }
  }

  private send(data: unknown): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(data));
  }

  private setState(state: ConnectionState): void {
    this.connectionState = state;
    this.connectionCallbacks.forEach(callback => this.invoke(() => callback(state)));
  }

  private invoke(callback: () => void): void {
    try { callback(); }
    catch (error) { if (this.options.debug) console.error("[Pubb] Callback failed", error); }
  }

  private clearPresence(): void {
    for (const channel of this.channels.values()) {
      if (channel instanceof PresenceChannel) channel._setMembers([], {});
    }
  }

  private attemptReconnect(): void {
    if (this.stopped || this.socket || this.reconnectTimer !== undefined) return;
    if (this.reconnectAttempts >= 5) {
      this.setState("failed");
      return;
    }
    const delay = Math.min(1000 * 2 ** ++this.reconnectAttempts, 30000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      if (!this.stopped) this.connect();
    }, delay);
  }
}
