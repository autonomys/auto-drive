// Terminal-state decision for the intent-payment polling loop, extracted from
// useTransactionConfirmation so the hook and its unit tests share one source of
// truth (no React renderer needed) — that drift is what let `failed` slip through.

export interface IntentStatusDecision {
  completed: boolean;
  overCap: boolean;
  failed: boolean;
  shouldContinue: boolean;
}

// `failed` is terminal: the backend marks a payment FAILED permanently (e.g. a
// dust payment that credits zero bytes), so polling can never change the
// outcome — stop and surface it, exactly as with over_cap.
export const evaluateIntentStatus = (status: string): IntentStatusDecision => {
  if (status === 'completed') {
    return { completed: true, overCap: false, failed: false, shouldContinue: false };
  }
  if (status === 'over_cap') {
    return { completed: false, overCap: true, failed: false, shouldContinue: false };
  }
  if (status === 'failed') {
    return { completed: false, overCap: false, failed: true, shouldContinue: false };
  }
  return { completed: false, overCap: false, failed: false, shouldContinue: true };
};
