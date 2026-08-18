import assert from "node:assert/strict";
import test from "node:test";

import {
  DECENTRALIZATION_FLOOR_SECONDS,
  MAX_ASSIGNED_ATTESTERS_PER_SLOT,
  REFERENCE_ATTESTERS_PER_SLOT,
  REFERENCE_VALIDATORS,
  calculateFinalityTiming,
  calculateRoundImprovementGain,
  calculateRoundModel,
  calculateSourceBatchingGain,
  formatDuration,
} from "../app/lib/model.ts";

function round(validators, slotSeconds = 12, enabledImprovements = []) {
  return calculateRoundModel({
    validators,
    slotSeconds,
    enabledImprovements,
  });
}

test("round model uses the fixed 1.1M workload calibration", () => {
  const result = round(REFERENCE_VALIDATORS);

  assert.equal(result.assignedAttestersPerCurrentSlot, 34_375);
  assert.equal(result.assignedAttestersPerCurrentSlot, REFERENCE_ATTESTERS_PER_SLOT);
  assert.equal(result.baselineRoundSeconds, 384);
  assert.equal(result.roundSlots, 32);
  assert.equal(result.roundSeconds, 384);
  assert.equal(result.finality.totalSeconds, 966);
  assert.equal(result.finality.finalityRounds, 2);
  assert.equal(result.validatorReductionFromReference, 0);
  assert.equal(MAX_ASSIGNED_ATTESTERS_PER_SLOT, 131_072);
});

test("live network counts do not renormalize the fixed workload model", () => {
  const commonInput = {
    validators: 128_000,
    slotSeconds: 12,
    enabledImprovements: ["dc"],
  };
  const lowerLiveCount = calculateRoundModel({
    ...commonInput,
    liveValidators: 700_000,
  });
  const higherLiveCount = calculateRoundModel({
    ...commonInput,
    liveValidators: 1_300_000,
  });

  assert.deepEqual(lowerLiveCount, higherLiveCount);
  assert.equal(lowerLiveCount.baselineRoundSeconds, (384 * 128_000) / 1_100_000);
});

test("DC changes throughput while shorter slots only change pipeline span", () => {
  const twelveSecond = round(REFERENCE_VALIDATORS, 12, ["dc"]);
  const oneSecond = round(REFERENCE_VALIDATORS, 1, ["dc"]);
  const fiveSecond = round(REFERENCE_VALIDATORS, 5, ["dc"]);

  assert.equal(twelveSecond.gains.total, 4);
  assert.equal(twelveSecond.unflooredRoundSeconds, 96);
  assert.equal(twelveSecond.roundSlots, 8);
  assert.equal(twelveSecond.roundSeconds, 96);
  assert.equal(oneSecond.unflooredRoundSeconds, 96);
  assert.equal(oneSecond.roundSlots, 96);
  assert.equal(oneSecond.roundSeconds, 96);
  assert.equal(fiveSecond.unflooredRoundSeconds, 96);
  assert.equal(fiveSecond.roundSlots, 20);
  assert.equal(fiveSecond.roundSeconds, 100);
});

test("networking sensitivities stack and source batching fades with consolidation", () => {
  const stacked = round(REFERENCE_VALIDATORS, 12, [
    "dc",
    "eip-8334",
    "eip-8243",
  ]);
  const floorLimited = round(16_000, 1, [
    "dc",
    "eip-8334",
    "eip-8243",
  ]);
  const fiveSecondFloor = round(16_000, 5, [
    "dc",
    "eip-8334",
    "eip-8243",
  ]);
  const twelveSecondFloor = round(16_000, 12, [
    "dc",
    "eip-8334",
    "eip-8243",
  ]);

  assert.equal(stacked.gains.total, 16);
  assert.equal(stacked.unflooredRoundSeconds, 24);
  assert.equal(stacked.roundSlots, 2);
  assert.equal(stacked.roundSeconds, 24);
  assert.equal(calculateSourceBatchingGain(500_000), 2);
  assert.equal(calculateSourceBatchingGain(314_000), 1.5);
  assert.equal(calculateSourceBatchingGain(128_000), 1);
  assert.equal(calculateSourceBatchingGain(16_000), 1);
  assert.equal(calculateRoundImprovementGain("dc", 26_000), 4);
  assert.equal(calculateRoundImprovementGain("eip-8334", 26_000), 2);
  assert.equal(calculateRoundImprovementGain("eip-8243", 314_000), 1.5);
  assert.equal(floorLimited.gains.total, 8);
  assert.equal(DECENTRALIZATION_FLOOR_SECONDS, 4);
  assert.equal(floorLimited.rawRoundSeconds, 4);
  assert.equal(floorLimited.floorLimited, true);
  assert.equal(floorLimited.roundSlots, 4);
  assert.equal(formatDuration(floorLimited.roundSeconds), "4 sec");
  assert.equal(fiveSecondFloor.roundSlots, 1);
  assert.equal(fiveSecondFloor.roundSeconds, 5);
  assert.equal(twelveSecondFloor.roundSlots, 1);
  assert.equal(twelveSecondFloor.roundSeconds, 12);
});

test("expected finality adds half-slot inclusion and an independent half-round gadget wait", () => {
  const current = calculateFinalityTiming(384, 12, 2);
  const consolidated = calculateFinalityTiming(12, 12, 2);
  const oneRound = calculateFinalityTiming(12, 12, 1);
  const unifiedOneRound = calculateRoundModel({
    validators: 128_000,
    slotSeconds: 12,
    enabledImprovements: ["dc"],
    finalityRounds: 1,
  });
  const quickSlots = calculateFinalityTiming(56, 8, 2);

  assert.deepEqual(current, {
    slotSeconds: 12,
    roundSlots: 32,
    roundSeconds: 384,
    finalityRounds: 2,
    expectedInclusionSeconds: 6,
    expectedFinalityGadgetWaitSeconds: 192,
    expectedPreVotingSeconds: 198,
    votingSeconds: 768,
    totalSeconds: 966,
  });
  assert.equal(consolidated.expectedFinalityGadgetWaitSeconds, 6);
  assert.equal(consolidated.expectedPreVotingSeconds, 12);
  assert.equal(consolidated.totalSeconds, 36);
  assert.equal(oneRound.totalSeconds, 24);
  assert.equal(unifiedOneRound.finality.totalSeconds, 24);
  assert.equal(quickSlots.expectedInclusionSeconds, 4);
  assert.equal(quickSlots.expectedFinalityGadgetWaitSeconds, 28);
  assert.equal(quickSlots.expectedPreVotingSeconds, 32);
  assert.equal(quickSlots.totalSeconds, 144);

  for (const timing of [current, consolidated, oneRound, quickSlots]) {
    assert.equal(
      timing.expectedFinalityGadgetWaitSeconds,
      timing.roundSeconds / 2,
    );
    assert.equal(
      timing.totalSeconds,
      timing.expectedInclusionSeconds +
        (timing.finalityRounds + 0.5) * timing.roundSeconds,
    );
  }

  const normalizedRound = calculateFinalityTiming(61, 12, 2);
  assert.equal(normalizedRound.roundSlots, 6);
  assert.equal(normalizedRound.roundSeconds, 72);
  assert.equal(normalizedRound.expectedFinalityGadgetWaitSeconds, 36);
  assert.equal(normalizedRound.totalSeconds, 186);
});
