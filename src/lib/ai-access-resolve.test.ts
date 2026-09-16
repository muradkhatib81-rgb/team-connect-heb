import assert from "node:assert/strict";
import { test } from "node:test";
import {
  NO_AI_ACCESS,
  PLATFORM_OWNER_AI_ACCESS,
  applyBetaAiKillSwitch,
} from "./ai-access-resolve.ts";

test("beta AI kill-switch leaves Platform Owner and enabled-flag access unchanged", () => {
  assert.equal(
    applyBetaAiKillSwitch(PLATFORM_OWNER_AI_ACCESS, {
      betaAiEnabled: false,
      isPlatformOwner: true,
    }).allowed,
    true,
  );
  const granted = { ...NO_AI_ACCESS, allowed: true, reason: null };
  assert.equal(
    applyBetaAiKillSwitch(granted, { betaAiEnabled: true, isPlatformOwner: false }).allowed,
    true,
  );
});

test("beta AI kill-switch blocks non-owners when the flag is off", () => {
  const granted = { ...NO_AI_ACCESS, allowed: true, reason: null };
  const blocked = applyBetaAiKillSwitch(granted, {
    betaAiEnabled: false,
    isPlatformOwner: false,
  });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.reason, "beta_ai_disabled");
});
