import { minimumCashOutCents, type PartnerEarningsSummary } from "./partner-earnings.js";

export const cashOutFixedFeeCents = 100;
export const cashOutProcessingFeeBasisPoints = 150;

export interface PartnerCashOutQuote {
  readonly grossAmountCents: number;
  readonly fixedFeeCents: number;
  readonly processingFeeCents: number;
  readonly totalFeeCents: number;
  readonly netAmountCents: number;
}

export class InvalidPartnerCashOutQuoteAmountError extends Error {}

/** Calculates the customer-visible fee using integer cents and half-up rounding. */
export function quotePartnerCashOut(grossAmountCents: unknown): PartnerCashOutQuote {
  if (typeof grossAmountCents !== "number" || !Number.isSafeInteger(grossAmountCents) || grossAmountCents < minimumCashOutCents
    || grossAmountCents > Math.floor((Number.MAX_SAFE_INTEGER - 5_000) / cashOutProcessingFeeBasisPoints)) {
    throw new InvalidPartnerCashOutQuoteAmountError("Cash-out amount must be a safe integer number of cents at or above the minimum");
  }
  const processingFeeCents = Math.floor((grossAmountCents * cashOutProcessingFeeBasisPoints + 5_000) / 10_000);
  const totalFeeCents = cashOutFixedFeeCents + processingFeeCents;
  const netAmountCents = grossAmountCents - totalFeeCents;
  if (netAmountCents <= 0) throw new InvalidPartnerCashOutQuoteAmountError("Cash-out amount cannot be fully consumed by fees");
  return { grossAmountCents, fixedFeeCents: cashOutFixedFeeCents, processingFeeCents, totalFeeCents, netAmountCents };
}

interface PartnerEarningsReader {
  getForUser(userId: string): Promise<PartnerEarningsSummary | undefined>;
}

/** Produces a quote only for the signed-in partner's currently withdrawable balance. */
export class PartnerCashOutQuoteService {
  public constructor(private readonly earnings: PartnerEarningsReader) {}

  public async quoteForUser(userId: string, grossAmountCents: unknown): Promise<PartnerCashOutQuote | undefined> {
    const quote = quotePartnerCashOut(grossAmountCents);
    const earnings = await this.earnings.getForUser(userId);
    if (earnings === undefined || !earnings.cashOutEligible || quote.grossAmountCents > earnings.availableCents) return undefined;
    return quote;
  }
}
