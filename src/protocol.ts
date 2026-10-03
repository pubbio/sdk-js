// Channel prefixes
export const PRIVATE_CHANNEL_PREFIX = "private-";
export const PRESENCE_CHANNEL_PREFIX = "presence-";

// Internal protocol events (sent by server)
export const INTERNAL_EVENTS = {
  SUBSCRIPTION_SUCCEEDED: "pusher_internal:subscription_succeeded",
  SUBSCRIPTION_ERROR: "pusher_internal:subscription_error",
  MEMBER_ADDED: "pusher_internal:member_added",
  MEMBER_REMOVED: "pusher_internal:member_removed",
} as const;

// Pusher-compatible events (for backwards compatibility)
export const PUSHER_EVENTS = {
  CONNECTION_ESTABLISHED: "pusher:connection_established",
  SUBSCRIBE: "pusher:subscribe",
  UNSUBSCRIBE: "pusher:unsubscribe",
  SUBSCRIPTION_SUCCEEDED: "pusher:subscription_succeeded",
  SUBSCRIPTION_ERROR: "pusher:subscription_error",
  MEMBER_ADDED: "pusher:member_added",
  MEMBER_REMOVED: "pusher:member_removed",
  ERROR: "pusher:error",
  PING: "pusher:ping",
  PONG: "pusher:pong",
} as const;

// Pubb-native events (primary for new users)
export const PUBB_EVENTS = {
  CONNECTION_ESTABLISHED: "pubb:connection_established",
  CONNECTION_COUNT: "pubb:connection_count",
  SUBSCRIBE: "pubb:subscribe",
  UNSUBSCRIBE: "pubb:unsubscribe",
  SUBSCRIPTION_SUCCEEDED: "pubb:subscription_succeeded",
  SUBSCRIPTION_ERROR: "pubb:subscription_error",
  MEMBER_ADDED: "pubb:member_added",
  MEMBER_REMOVED: "pubb:member_removed",
  ERROR: "pubb:error",
  PING: "pubb:ping",
  PONG: "pubb:pong",
} as const;

// Event alias mapping (pusher -> pubb) for user-facing events
export const EVENT_ALIASES: Record<string, string> = {
  [PUSHER_EVENTS.CONNECTION_ESTABLISHED]: PUBB_EVENTS.CONNECTION_ESTABLISHED,
  [PUSHER_EVENTS.SUBSCRIPTION_SUCCEEDED]: PUBB_EVENTS.SUBSCRIPTION_SUCCEEDED,
  [PUSHER_EVENTS.SUBSCRIPTION_ERROR]: PUBB_EVENTS.SUBSCRIPTION_ERROR,
  [PUSHER_EVENTS.MEMBER_ADDED]: PUBB_EVENTS.MEMBER_ADDED,
  [PUSHER_EVENTS.MEMBER_REMOVED]: PUBB_EVENTS.MEMBER_REMOVED,
  [PUSHER_EVENTS.ERROR]: PUBB_EVENTS.ERROR,
};

// Reverse alias mapping (pubb -> pusher) for backwards compatibility
export const EVENT_ALIASES_REVERSE: Record<string, string> = {
  [PUBB_EVENTS.CONNECTION_ESTABLISHED]: PUSHER_EVENTS.CONNECTION_ESTABLISHED,
  [PUBB_EVENTS.CONNECTION_COUNT]: "pusher:connection_count",
  [PUBB_EVENTS.SUBSCRIPTION_SUCCEEDED]: PUSHER_EVENTS.SUBSCRIPTION_SUCCEEDED,
  [PUBB_EVENTS.SUBSCRIPTION_ERROR]: PUSHER_EVENTS.SUBSCRIPTION_ERROR,
  [PUBB_EVENTS.MEMBER_ADDED]: PUSHER_EVENTS.MEMBER_ADDED,
  [PUBB_EVENTS.MEMBER_REMOVED]: PUSHER_EVENTS.MEMBER_REMOVED,
  [PUBB_EVENTS.ERROR]: PUSHER_EVENTS.ERROR,
};
