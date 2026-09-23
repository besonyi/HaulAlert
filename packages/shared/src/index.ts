/** Creates a nominal type without changing the runtime representation. */
export type Brand<Value, Name extends string> = Value & {
  readonly __brand: Name;
};

/** LoadBoard providers planned for the initial HaulAlert release. */
export const supportedProviders = [
  "central-dispatch",
  "super-dispatch",
  "shipcars"
] as const;

export type SupportedProvider = (typeof supportedProviders)[number];

/** Provider-neutral identifiers used across services. */
export type AlertId = Brand<string, "AlertId">;
export type LoadId = Brand<string, "LoadId">;
export type ProviderId = Brand<SupportedProvider, "ProviderId">;
export type SourceFilterHash = Brand<string, "SourceFilterHash">;
export type TelegramUserId = Brand<string, "TelegramUserId">;

/** An ISO 8601 instant represented as a string at system boundaries. */
export type IsoTimestamp = Brand<string, "IsoTimestamp">;
