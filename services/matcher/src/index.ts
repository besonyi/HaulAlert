/**
 * The matcher service will own persistence-backed subscription lookup and event
 * consumption. Its pure matching implementation lives in @haulalert/alert-matcher.
 */
export { findMatchingAlerts, matchLoadToFilter } from "@haulalert/alert-matcher";
export type { AlertMatch, AlertMatchResult, AlertSubscription, MatchFailure } from "@haulalert/alert-matcher";
