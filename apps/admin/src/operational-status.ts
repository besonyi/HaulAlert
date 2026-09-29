import type { AdminSystemOverview } from "./api.js";

export interface OperationalStatus {
  readonly tone: "healthy" | "attention";
  readonly title: string;
  readonly detail: string;
}

/** Summarizes the existing protected operations data without exposing individual records. */
export function operationalStatus(overview: AdminSystemOverview): OperationalStatus {
  if (overview.recovery.length > 0) {
    return {
      tone: "attention",
      title: "Recovery needed",
      detail: `${overview.recovery.length} runtime recovery item${plural(overview.recovery.length)} needs review.`
    };
  }

  const deadLetters = overview.deliveries.find((delivery) => delivery.key === "dead_letter")?.count ?? 0;
  if (deadLetters > 0) {
    return {
      tone: "attention",
      title: "Delivery attention needed",
      detail: `${deadLetters} notification${plural(deadLetters)} reached dead letter status.`
    };
  }

  return {
    tone: "healthy",
    title: "No active recovery needed",
    detail: "No runtime recovery items or dead-letter deliveries are currently recorded."
  };
}

function plural(count: number): string {
  return count === 1 ? "" : "s";
}
