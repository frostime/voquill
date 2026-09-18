// Telemetry was removed together with the commercial bootstrap
// (Mixpanel init no longer exists, see .dev/docs/upstream-divergence.md).
// These stubs keep call sites intact until the peripheral-cleanup stage
// deletes the remaining trackX() callers.
export const CURRENT_COHORT = "2025-02-a";

export function trackPageView(_pageName: string) {}

export function trackOnboardingStep(_step: string) {}

export function trackDictationStart() {}

export function trackAgentStart() {}

export function trackPaymentComplete() {}

export function trackButtonClick(
  _name: string,
  _props?: Record<string, unknown>,
) {}

export function trackAppUsed(_appName: string) {}
