import type { SqlExecutor } from "@haulalert/notification-service";

export interface StripeCheckoutSession {
  readonly url: string;
}

export interface StripeCheckoutConfig {
  readonly secretKey: string;
  readonly essentialPriceId: string;
  readonly successUrl: string;
  readonly cancelUrl: string;
  readonly portalReturnUrl: string;
}

export class StripeCheckoutUnavailableError extends Error {}
export class SubscriptionAlreadyEssentialError extends Error {}

/** Creates hosted Stripe Checkout sessions without exposing payment credentials to the Mini App. */
export class StripeCheckoutClient {
  public constructor(
    private readonly config: StripeCheckoutConfig,
    private readonly request: typeof fetch = fetch
  ) {}

  public async createEssentialCheckout(userId: string, customerId: string | null): Promise<StripeCheckoutSession> {
    const form = new URLSearchParams({
      mode: "subscription",
      client_reference_id: userId,
      success_url: this.config.successUrl,
      cancel_url: this.config.cancelUrl,
      "line_items[0][price]": this.config.essentialPriceId,
      "line_items[0][quantity]": "1",
      "metadata[haulalert_user_id]": userId,
      "subscription_data[metadata][haulalert_user_id]": userId
    });
    if (customerId !== null) form.set("customer", customerId);
    const response = await this.request("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.config.secretKey}`,
        "content-type": "application/x-www-form-urlencoded"
      },
      body: form
    });
    const payload = await response.json().catch(() => undefined) as unknown;
    if (!response.ok || !isRecord(payload) || typeof payload.url !== "string" || !isHttpUrl(payload.url)) {
      throw new StripeCheckoutUnavailableError();
    }
    return { url: payload.url };
  }

  public async createBillingPortal(customerId: string): Promise<StripeCheckoutSession> {
    const response = await this.request("https://api.stripe.com/v1/billing_portal/sessions", {
      method: "POST",
      headers: { authorization: `Bearer ${this.config.secretKey}`, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ customer: customerId, return_url: this.config.portalReturnUrl })
    });
    const payload = await response.json().catch(() => undefined) as unknown;
    if (!response.ok || !isRecord(payload) || typeof payload.url !== "string" || !isHttpUrl(payload.url)) {
      throw new StripeCheckoutUnavailableError();
    }
    return { url: payload.url };
  }
}

/** Limits a customer to a hosted Essential checkout when they are currently on Free. */
export class PostgresSubscriptionCheckoutService {
  public constructor(
    private readonly database: SqlExecutor,
    private readonly checkout: StripeCheckoutClient
  ) {}

  public async createEssentialCheckout(userId: string): Promise<StripeCheckoutSession> {
    const result = await this.database.query(
      `SELECT plan_id, stripe_customer_id FROM subscriptions WHERE user_id = $1::uuid`,
      [userId]
    );
    const row = result.rows[0];
    if (row === undefined) throw new StripeCheckoutUnavailableError();
    if (row.plan_id === "essential") throw new SubscriptionAlreadyEssentialError();
    if (row.plan_id !== "free") throw new StripeCheckoutUnavailableError();
    const customerId = typeof row.stripe_customer_id === "string" && row.stripe_customer_id.startsWith("cus_")
      ? row.stripe_customer_id : null;
    return this.checkout.createEssentialCheckout(userId, customerId);
  }
}

/** Makes Stripe the sole customer-facing place for cancellation and payment-method changes. */
export class PostgresSubscriptionPortalService {
  public constructor(
    private readonly database: SqlExecutor,
    private readonly checkout: StripeCheckoutClient
  ) {}

  public async createPortal(userId: string): Promise<StripeCheckoutSession> {
    const result = await this.database.query(
      `SELECT plan_id, stripe_customer_id FROM subscriptions WHERE user_id = $1::uuid`,
      [userId]
    );
    const row = result.rows[0];
    if (row === undefined || row.plan_id !== "essential" || typeof row.stripe_customer_id !== "string" || !row.stripe_customer_id.startsWith("cus_")) {
      throw new StripeCheckoutUnavailableError();
    }
    return this.checkout.createBillingPortal(row.stripe_customer_id);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && url.username === "" && url.password === "";
  } catch {
    return false;
  }
}
