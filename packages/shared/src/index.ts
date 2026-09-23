/** Creates a nominal type without changing the runtime representation. */
export type Brand<Value, Name extends string> = Value & {
  readonly __brand: Name;
};

/** Provider-neutral identifiers used across services. */
export type AlertId = Brand<string, "AlertId">;
export type LoadId = Brand<string, "LoadId">;
export type ProviderId = Brand<string, "ProviderId">;
export type SourceFilterHash = Brand<string, "SourceFilterHash">;
export type TelegramUserId = Brand<string, "TelegramUserId">;

/** An ISO 8601 instant represented as a string at system boundaries. */
export type IsoTimestamp = Brand<string, "IsoTimestamp">;
