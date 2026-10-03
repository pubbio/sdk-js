import { createHmac } from "node:crypto";

export interface PubbServerOptions {
  appId: string;
  key: string;
  secret: string;
  apiHost?: string;
}

export interface TriggerOptions {
  /** Exclude this socket from delivery. */
  socketId?: string;
  /** Reuse for a retry of the same publication. */
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export interface TriggerResponse {
  success: boolean;
  accepted: boolean;
  channels: string[];
  publicationId: string;
  duplicate: boolean;
}

export class PubbApiError extends Error {
  constructor(public readonly status: number) {
    super(`Pubb publish failed (HTTP ${status})`);
    this.name = "PubbApiError";
  }
}

/** Trusted server code only. Never import this entry point in a client bundle. */
export class PubbServer {
  private readonly options: PubbServerOptions;
  private readonly endpoint: string;

  constructor(options: PubbServerOptions) {
    if (!options.appId || !options.key || !options.secret) {
      throw new Error("PubbServer requires an appId, key and secret");
    }
    this.options = { ...options };
    this.endpoint = `${(options.apiHost ?? "https://api.pubb.io").replace(/\/+$/, "")}/api/apps/${encodeURIComponent(options.appId)}/events`;
  }

  /** HTTP 202 confirms acceptance, not delivery to a subscriber. */
  async trigger(channel: string | string[], event: string, data: unknown, options: TriggerOptions = {}): Promise<TriggerResponse> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.options.secret}`,
        ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
      },
      body: JSON.stringify({ channel, name: event, data, socket_id: options.socketId }),
      signal: options.signal,
    });
    if (!response.ok) {
      // Do not include response bodies that may echo sensitive request headers.
      await response.body?.cancel();
      throw new PubbApiError(response.status);
    }
    return response.json() as Promise<TriggerResponse>;
  }

  /** Call only after authenticating the user and authorizing channel access. */
  authenticatePrivateChannel(socketId: string, channelName: string): { auth: string } {
    return { auth: this.sign(`${socketId}:${channelName}`) };
  }

  /** Derive userId from the trusted session, never from unchecked client input. */
  authenticatePresenceChannel(socketId: string, channelName: string, userId: string, userInfo: Record<string, unknown> = {}): { auth: string; channel_data: string } {
    const channel_data = JSON.stringify({ user_id: userId, user_info: userInfo });
    return { auth: this.sign(`${socketId}:${channelName}:${channel_data}`), channel_data };
  }

  private sign(message: string): string {
    const signature = createHmac("sha256", this.options.secret).update(message).digest("hex");
    return `${this.options.key}:${signature}`;
  }
}
