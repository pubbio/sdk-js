import { EVENT_ALIASES } from "./protocol.js";

type EventCallback = (data: unknown) => void;

// Reverse alias mapping (pubb -> pusher)
const REVERSE_ALIASES: Record<string, string> = Object.entries(
  EVENT_ALIASES
).reduce(
  (acc, [pusher, pubb]) => {
    acc[pubb] = pusher;
    return acc;
  },
  {} as Record<string, string>
);

export class Channel {
  private name: string;
  private bindings: Map<string, Set<EventCallback>> = new Map();
  private _onSubscribed?: () => void;

  constructor(name: string) {
    this.name = name;
  }

  /**
   * Bind to an event on this channel
   */
  bind(eventName: string, callback: EventCallback): this {
    if (!this.bindings.has(eventName)) {
      this.bindings.set(eventName, new Set());
    }
    this.bindings.get(eventName)!.add(callback);
    return this;
  }

  /**
   * Unbind from an event
   */
  unbind(eventName: string, callback?: EventCallback): this {
    if (!callback) {
      this.bindings.delete(eventName);
    } else {
      this.bindings.get(eventName)?.delete(callback);
    }
    return this;
  }

  /**
   * Unbind all events
   */
  unbindAll(): this {
    this.bindings.clear();
    this._onSubscribed = undefined;
    return this;
  }

  /**
   * Trigger callbacks for an event
   * Emits to both pusher:* and pubb:* listeners for aliased events
   * @internal
   */
  _emit(eventName: string, data: unknown): void {
    // Collect all event names to emit (original + alias)
    const eventsToEmit = new Set<string>([eventName]);

    // Add alias if exists (pusher -> pubb)
    if (EVENT_ALIASES[eventName]) {
      eventsToEmit.add(EVENT_ALIASES[eventName]);
    }
    // Add reverse alias (pubb -> pusher)
    if (REVERSE_ALIASES[eventName]) {
      eventsToEmit.add(REVERSE_ALIASES[eventName]);
    }


    // Emit to all matching bindings
    eventsToEmit.forEach((event) => {
      const callbacks = this.bindings.get(event);
      if (callbacks) {
        callbacks.forEach((cb) => {
          try {
            cb(data);
          } catch (e) {
            console.error(`[Pubb] Error in event handler for ${event}:`, e);
          }
        });
      }
    });
  }

  /**
   * Called when subscription succeeds
   * @internal
   */
  _subscribed(): void {
    this._onSubscribed?.();
  }

  /**
   * Set subscription success callback
   */
  onSubscribed(callback: () => void): this {
    this._onSubscribed = callback;
    return this;
  }

  getName(): string {
    return this.name;
  }
}

export class PresenceChannel extends Channel {
  private members: Map<string, unknown> = new Map();

  /**
   * Get all members in this channel
   */
  getMembers(): Map<string, unknown> {
    return new Map(this.members);
  }

  /**
   * Get member count
   */
  getMemberCount(): number {
    return this.members.size;
  }

  /**
   * @internal
   */
  _setMembers(
    ids: string[],
    hash: Record<string, unknown>
  ): void {
    this.members.clear();
    ids.forEach((id) => {
      this.members.set(id, hash[id] || {});
    });
  }

  /**
   * @internal
   */
  _addMember(userId: string, userInfo: unknown): void {
    this.members.set(userId, userInfo);
  }

  /**
   * @internal
   */
  _removeMember(userId: string): void {
    this.members.delete(userId);
  }
}
