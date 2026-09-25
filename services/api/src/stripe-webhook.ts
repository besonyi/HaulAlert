import { createHmac, timingSafeEqual } from "node:crypto";

import type { SqlExecutor } from "@haulalert/notification-service";

export type StripePaymentStatus = "paid" | "failed" | "refunded" | "disputed";
export type StripeSubscriptionStatus = "active" | "cancelled";

export interface StripeSubscriptionEvent {
  readonly eventId: string;
  readonly eventType: "checkout.session.completed" | "invoice.paid" | "invoice.payment_failed" | "charge.refunded" | "charge.dispute.created" | "customer.subscription.deleted";
  readonly userId: string | undefined;
  readonly customerId: string | undefined;
  readonly subscriptionId: string | undefined;
  readonly paymentStatus: StripePaymentStatus | undefined;
  readonly subscriptionStatus: StripeSubscriptionStatus | undefined;
  readonly planId: "free" | "essential" | undefined;
}

export type StripeWebhookDisposition = "processed" | "duplicate" | "ignored";

export interface StripeWebhookEventProcessor {
  process(event: StripeSubscriptionEvent): Promise<StripeWebhookDisposition>;
}

export class InvalidStripeWebhookSignatureError extends Error {}
export class InvalidStripeWebhookPayloadError extends Error {}

/** Verifies the Stripe signature against the untouched request bytes. */
export function verifyStripeWebhookSignature(
  payload: Buffer,
  signatureHeader: string | undefined,
  endpointSecret: string,
  nowMilliseconds: number = Date.now(),
  toleranceSeconds: number = 300
): void {
  if (signatureHeader === undefined || endpointSecret.trim().length === 0) throw new InvalidStripeWebhookSignatureError();
  const values = signatureValues(signatureHeader);
  const timestamp = values.timestamps[0];
  if (timestamp === undefined || Math.abs(nowMilliseconds - timestamp * 1_000) > toleranceSeconds * 1_000) {
    throw new InvalidStripeWebhookSignatureError();
  }
  const expected = createHmac("sha256", endpointSecret).update(`${timestamp}.${payload.toString("utf8")}`).digest();
  const matches = values.signatures.some((signature) => {
    if (!/^[0-9a-f]{64}$/i.test(signature)) return false;
    const supplied = Buffer.from(signature, "hex");
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  });
  if (!matches) throw new InvalidStripeWebhookSignatureError();
}

/** Accepts only payment lifecycle events that can affect HaulAlert referrals. */
export function parseStripeSubscriptionEvent(payload: Buffer): StripeSubscriptionEvent | undefined {
  let event: unknown;
  try {
    event = JSON.parse(payload.toString("utf8")) as unknown;
  } catch {
    throw new InvalidStripeWebhookPayloadError();
  }
  if (!isRecord(event) || typeof event.id !== "string" || !isRecord(event.data) || !isRecord(event.data.object)) {
    throw new InvalidStripeWebhookPayloadError();
  }
  const eventType = event.type;
  if (eventType !== "checkout.session.completed" && eventType !== "invoice.paid" && eventType !== "invoice.payment_failed" && eventType !== "charge.refunded"
    && eventType !== "charge.dispute.created" && eventType !== "customer.subscription.deleted") return undefined;
  const object = event.data.object;
  const userId = metadataUserId(object.metadata) ?? metadataUserId(subscriptionMetadata(object)) ?? clientReferenceUserId(object.client_reference_id);
  const customerId = optionalStripeId(object.customer, "cus_");
  const subscriptionId = eventType === "customer.subscription.deleted"
    ? optionalStripeId(object.id, "sub_")
    : optionalStripeId(object.subscription, "sub_");
  return {
    eventId: requiredEventId(event.id), eventType, userId, customerId, subscriptionId,
    paymentStatus: eventType === "invoice.paid" || (eventType === "checkout.session.completed" && object.payment_status === "paid") ? "paid" : eventType === "invoice.payment_failed" ? "failed"
      : eventType === "charge.refunded" ? "refunded" : eventType === "charge.dispute.created" ? "disputed" : undefined,
    subscriptionStatus: eventType === "checkout.session.completed" ? undefined : "active",
    planId: eventType === "invoice.paid" || (eventType === "checkout.session.completed" && object.payment_status === "paid") ? "essential"
      : eventType === "invoice.payment_failed" || eventType === "charge.refunded" || eventType === "charge.dispute.created" || eventType === "customer.subscription.deleted" ? "free" : undefined
  };
}

/** Atomically deduplicates a provider event and refreshes the referral's paid state. */
export class PostgresStripeWebhookEventProcessor implements StripeWebhookEventProcessor {
  public constructor(private readonly database: SqlExecutor) {}

  public async process(event: StripeSubscriptionEvent): Promise<StripeWebhookDisposition> {
    const result = await this.database.query(
      `WITH matched_subscription AS (
        SELECT subscriptions.user_id
        FROM subscriptions
        WHERE ($3::uuid IS NOT NULL AND subscriptions.user_id = $3::uuid)
          OR ($3::uuid IS NULL AND (
            ($4::text IS NOT NULL AND subscriptions.stripe_customer_id = $4::text)
            OR ($5::text IS NOT NULL AND subscriptions.stripe_subscription_id = $5::text)
          ))
        LIMIT 1
      ), inserted_event AS (
        INSERT INTO stripe_webhook_events (event_id, event_type, user_id)
        SELECT $1, $2, user_id FROM matched_subscription
        ON CONFLICT (event_id) DO NOTHING
        RETURNING user_id
      ), updated_subscription AS (
        UPDATE subscriptions
        SET stripe_customer_id = COALESCE($4::text, subscriptions.stripe_customer_id),
          stripe_subscription_id = COALESCE($5::text, subscriptions.stripe_subscription_id),
          latest_payment_status = COALESCE($6::text, subscriptions.latest_payment_status),
          status = COALESCE($7::text, subscriptions.status),
          plan_id = COALESCE($9::text, subscriptions.plan_id), updated_at = now()
        FROM inserted_event
        WHERE subscriptions.user_id = inserted_event.user_id
        RETURNING subscriptions.user_id, subscriptions.status, subscriptions.latest_payment_status
      ), updated_referral AS (
        UPDATE referrals
        SET status = CASE WHEN updated_subscription.status = 'active' AND updated_subscription.latest_payment_status = 'paid'
            THEN 'active_paid' ELSE 'inactive' END,
          activated_at = CASE WHEN updated_subscription.status = 'active' AND updated_subscription.latest_payment_status = 'paid'
            THEN COALESCE(referrals.activated_at, now()) ELSE referrals.activated_at END,
          deactivated_at = CASE WHEN updated_subscription.status = 'active' AND updated_subscription.latest_payment_status = 'paid'
            THEN referrals.deactivated_at ELSE now() END,
          updated_at = now()
        FROM updated_subscription
        WHERE $8::boolean AND referrals.referred_user_id = updated_subscription.user_id AND referrals.status <> 'invalidated'
      )
      SELECT (SELECT count(*) FROM matched_subscription) AS matched_count,
        (SELECT count(*) FROM inserted_event) AS inserted_count`,
      [event.eventId, event.eventType, event.userId ?? null, event.customerId ?? null, event.subscriptionId ?? null,
        event.paymentStatus ?? null, event.subscriptionStatus ?? null, event.paymentStatus !== undefined || event.planId === "free", event.planId ?? null]
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error("Expected Stripe webhook processing result");
    if (count(row.matched_count, "matched_count") === 0) return "ignored";
    return count(row.inserted_count, "inserted_count") === 1 ? "processed" : "duplicate";
  }
}

export class StripeWebhookHandler {
  public constructor(
    private readonly endpointSecret: string,
    private readonly processor: StripeWebhookEventProcessor
  ) {}

  public async handle(payload: Buffer, signatureHeader: string | undefined): Promise<StripeWebhookDisposition> {
    verifyStripeWebhookSignature(payload, signatureHeader, this.endpointSecret);
    const event = parseStripeSubscriptionEvent(payload);
    return event === undefined ? "ignored" : this.processor.process(event);
  }
}

function signatureValues(value: string): { readonly timestamps: readonly number[]; readonly signatures: readonly string[] } {
  const timestamps: number[] = [];
  const signatures: string[] = [];
  for (const component of value.split(",")) {
    const [key, item] = component.trim().split("=", 2);
    if (key === "t" && item !== undefined && /^\d+$/.test(item)) timestamps.push(Number(item));
    if (key === "v1" && item !== undefined) signatures.push(item);
  }
  return { timestamps, signatures };
}

function metadataUserId(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const userId = value.haulalert_user_id;
  return typeof userId === "string" && isUuid(userId) ? userId : undefined;
}

function clientReferenceUserId(value: unknown): string | undefined {
  return typeof value === "string" && isUuid(value) ? value : undefined;
}

function subscriptionMetadata(object: Record<string, unknown>): unknown {
  const direct = object.subscription_details;
  if (isRecord(direct)) return direct.metadata;
  const parent = object.parent;
  if (isRecord(parent) && isRecord(parent.subscription_details)) return parent.subscription_details.metadata;
  return undefined;
}

function optionalStripeId(value: unknown, prefix: string): string | undefined {
  return typeof value === "string" && value.startsWith(prefix) ? value : undefined;
}

function requiredEventId(value: string): string {
  if (!value.startsWith("evt_") || value.length > 255) throw new InvalidStripeWebhookPayloadError();
  return value;
}

function count(value: unknown, name: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`Expected ${name}`);
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
