export const CURRENT_ROUND_SLOTS = 32;
export const SLOT_SECONDS = 12;
export const MIN_SCENARIO_VALIDATORS = 16_000;
export const REFERENCE_VALIDATORS = 1_100_000;
export const REFERENCE_ATTESTERS_PER_SLOT = 34_375;
export const REFERENCE_ROUND_SECONDS = CURRENT_ROUND_SLOTS * SLOT_SECONDS;
export const SINGLE_COHORT_FLOOR_SECONDS = 8;
export const MAX_ASSIGNED_ATTESTERS_PER_SLOT = 131_072;

export type RoundImprovementId = "dc" | "eip-8334" | "eip-8243";

export type RoundModelInput = {
  validators: number;
  slotSeconds: number;
  enabledImprovements: readonly RoundImprovementId[];
  finalityRounds?: number;
};

export type RoundModel = {
  validators: number;
  slotSeconds: number;
  assignedAttestersPerCurrentSlot: number;
  baselineRoundSeconds: number;
  gains: {
    dc: number;
    bundled: number;
    source: number;
    total: number;
  };
  unflooredRoundSeconds: number;
  rawRoundSeconds: number;
  floorLimited: boolean;
  roundSlots: number;
  roundSeconds: number;
  finality: FinalityTiming;
  validatorReductionFromReference: number;
};

export type FinalityTiming = {
  slotSeconds: number;
  roundSlots: number;
  roundSeconds: number;
  finalityRounds: number;
  expectedInclusionSeconds: number;
  expectedRoundAlignmentSeconds: number;
  expectedPreVotingSeconds: number;
  votingSeconds: number;
  totalSeconds: number;
};

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(Math.max(value, minimum), maximum);

export function calculateSourceBatchingGain(validators: number) {
  const safeValidators = Number.isFinite(validators)
    ? Math.max(1, Math.round(validators))
    : MIN_SCENARIO_VALIDATORS;

  if (safeValidators <= 128_000) return 1;
  if (safeValidators >= 500_000) return 2;

  return 1 + (safeValidators - 128_000) / (500_000 - 128_000);
}

export function calculateRoundModel({
  validators,
  slotSeconds,
  enabledImprovements,
  finalityRounds = 2,
}: RoundModelInput): RoundModel {
  const safeValidators = Number.isFinite(validators)
    ? Math.max(1, Math.round(validators))
    : MIN_SCENARIO_VALIDATORS;
  const safeSlotSeconds = Number.isFinite(slotSeconds)
    ? clamp(Math.round(slotSeconds), 1, SLOT_SECONDS)
    : SLOT_SECONDS;
  const enabled = new Set(enabledImprovements);
  const dcGain = enabled.has("dc") ? 4 : 1;
  const bundledGain = enabled.has("eip-8334") ? 2 : 1;
  const sourceGain = enabled.has("eip-8243")
    ? calculateSourceBatchingGain(safeValidators)
    : 1;
  const totalGain = dcGain * bundledGain * sourceGain;
  const baselineRoundSeconds =
    (REFERENCE_ROUND_SECONDS * safeValidators) / REFERENCE_VALIDATORS;
  const unflooredRoundSeconds = baselineRoundSeconds / totalGain;
  const rawRoundSeconds = Math.max(
    SINGLE_COHORT_FLOOR_SECONDS,
    unflooredRoundSeconds,
  );
  const roundSlots = Math.max(1, Math.ceil(rawRoundSeconds / safeSlotSeconds));
  const roundSeconds = roundSlots * safeSlotSeconds;

  return {
    validators: safeValidators,
    slotSeconds: safeSlotSeconds,
    assignedAttestersPerCurrentSlot:
      safeValidators / CURRENT_ROUND_SLOTS,
    baselineRoundSeconds,
    gains: {
      dc: dcGain,
      bundled: bundledGain,
      source: sourceGain,
      total: totalGain,
    },
    unflooredRoundSeconds,
    rawRoundSeconds,
    floorLimited: unflooredRoundSeconds < SINGLE_COHORT_FLOOR_SECONDS,
    roundSlots,
    roundSeconds,
    finality: calculateFinalityTiming(
      roundSeconds,
      safeSlotSeconds,
      finalityRounds,
    ),
    validatorReductionFromReference:
      1 - safeValidators / REFERENCE_VALIDATORS,
  };
}

export function calculateFinalityTiming(
  roundSeconds: number,
  slotSeconds: number,
  finalityRounds: number,
): FinalityTiming {
  const safeSlotSeconds = Number.isFinite(slotSeconds)
    ? Math.max(1, Math.round(slotSeconds))
    : SLOT_SECONDS;
  const finiteRoundSeconds = Number.isFinite(roundSeconds) ? roundSeconds : 1;
  const roundSlots = Math.max(
    1,
    Math.ceil(Math.max(1, finiteRoundSeconds) / safeSlotSeconds),
  );
  const safeRoundSeconds = roundSlots * safeSlotSeconds;
  const safeFinalityRounds = Math.max(1, Math.round(finalityRounds));
  const expectedInclusionSeconds = safeSlotSeconds / 2;
  const expectedRoundAlignmentSeconds =
    (safeRoundSeconds - safeSlotSeconds) / 2;
  const expectedPreVotingSeconds =
    expectedInclusionSeconds + expectedRoundAlignmentSeconds;
  const votingSeconds = safeFinalityRounds * safeRoundSeconds;
  const totalSeconds = expectedPreVotingSeconds + votingSeconds;

  return {
    slotSeconds: safeSlotSeconds,
    roundSlots,
    roundSeconds: safeRoundSeconds,
    finalityRounds: safeFinalityRounds,
    expectedInclusionSeconds,
    expectedRoundAlignmentSeconds,
    expectedPreVotingSeconds,
    votingSeconds,
    totalSeconds,
  };
}

export function formatDuration(seconds: number) {
  if (seconds < 60) return `${seconds} sec`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes}m ${remainder}s` : `${minutes} min`;
}

export function formatCompactCount(value: number) {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}M`;
  }

  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)}k`;
  }

  return new Intl.NumberFormat("en-US").format(value);
}
