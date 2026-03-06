export interface EntryGateResult {
  allowed: boolean;
  reason: string | null;
}

export function checkEntryGate(
  version: string,
  tier: string | null,
  minutesSinceOpen: number,
): EntryGateResult {
  const v7_0 = version >= "v7.0";
  const v7_1 = version >= "v7.1" && version < "v7.2";

  if (v7_0 && tier !== "A") {
    return { allowed: false, reason: v7_1 ? "NOT_TIER_A" : "TIER_A_ONLY" };
  }
  if (v7_1 && minutesSinceOpen <= 240) {
    return { allowed: false, reason: "NOT_POWER_SESSION" };
  }
  return { allowed: true, reason: null };
}
