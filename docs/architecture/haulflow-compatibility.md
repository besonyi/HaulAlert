# HaulFlow compatibility boundary

HaulAlert is a separate customer product, but it is designed to consume the same session-backed provider behavior already implemented in HaulFlow. The shared boundary is a normalized load feed plus provider-native search plans; customer credentials and desktop UI concerns do not cross it.

## Observed provider behavior

| Provider | HaulFlow session-backed search behavior | HaulAlert compiler behavior |
| --- | --- | --- |
| Central Dispatch | Applies route/radius, vehicle min/max, trailer, ready window, minimum pay, minimum RPM, and uses `showTaggedOnTop`. | Pushes every equivalent canonical field; uses `tagged-top` as the new-load collection strategy. |
| Super Dispatch | Applies pickup/delivery venues and radius, vehicle minimum, and sorts by `posted_to_loadboard_at`. | Pushes route and vehicle minimum; retains maximum vehicles, pay, and RPM for internal matching; uses `newest-first`. |
| Ship.Cars | Applies route/radius, vehicle min/max, trailer, ready window, minimum pay, minimum RPM, and orders by `-create_time`. | Pushes every equivalent canonical field; uses `newest-first`. |

## Data contract

HaulFlow normalizes a provider candidate before it reaches its UI. Its stable identity is `source:externalId`, with provider-shaped records containing pickup/delivery stops, vehicle details, cents-based payment, distance, rate per mile, post time, source URL, and optional broker/payment details.

HaulAlert preserves the same two key invariants:

1. `provider:providerLoadId` is the global deduplication key.
2. A provider search may narrow the result set, but HaulAlert performs the final user-specific match for any condition the provider cannot represent exactly.

## Integration rules

- Keep provider request construction inside provider adapters or the browser runtime; it must not leak into Telegram-facing applications.
- Use explicit field-level capability declarations. A partial capability, such as Super Dispatch vehicle minimum, must leave the unsupported remainder in the internal matcher.
- Treat provider sorting as a delta-collection aid, not a substitute for global deduplication.
- Validate live session behavior before declaring a new capability supported; these profiles reflect the current HaulFlow implementation, not a guarantee of third-party UI permanence.
