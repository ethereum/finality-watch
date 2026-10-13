// Expert finality model: decoupled-consensus finality gadgets on a slot clock.
//
// Time is measured in slots. Block B_t is proposed at the start of slot t, one
// block per slot, with every validator honest and online. The full validator set
// is split into R equal cohorts, one voting per slot, so a full-set round is R
// consecutive slot-aligned slots (R comes from the capacity model in model.ts).
//
// Timing conventions (all in slots):
// - A transaction arriving in (t − 1, t] is included in B_t: half a slot on average.
// - B_t is fast-confirmed by the end of its own slot. The cohort voting in slot
//   u reads its finality-gadget input from the confirmed chain, which ends at
//   B_{u − 1}. Stabilization follows one slot later and does not gate the FG.
// - Justification and height progress are on-chain: they take effect once the
//   next block includes the quorum-completing votes, and that block becomes the
//   new height's entry.
// - Finality is observed locally as soon as the last needed votes are cast.
//   Later votes that carry the same finality vote are tracked for the timeline
//   but change no expected value.
// - As in DC's attestation rules, a finality pair must name a height below its
//   vote's height pair, and a target is never re-sent. A vote whose confirmed
//   view still shows a closed height therefore carries no finality pair.
// - Quorums count whole cohorts: ⌈2R/3⌉ to justify, ⌈5R/6⌉ for one-round finality.
//
// Each design is a periodic schedule of finality-gadget targets, exposed per
// block by createFinalitySchedule(). The expected values enumerate every block a
// transaction can land in over one period of that schedule. The README gives the
// same values in closed form, and the tests check both against an independent
// vote-by-vote simulation.

import type { RoundImprovementId } from "./model.ts";

export type ConsensusProtocolId =
  | "coupled"
  | "dc-today"
  | "dc-height-progress"
  | "dc-rolling-ffg";

export type FinalityRoundCount = 1 | 2;

export const CONFIRMATION_SLOTS = 1;
export const STABILIZATION_SLOTS = 1;
export const ON_CHAIN_VOTE_SLOTS = 1;
export const LOCAL_FINALITY_SLOTS = 0;
export const DC_MIN_ROUND_SLOTS = 2;
export const JUSTIFICATION_QUORUM = 2 / 3;
export const ONE_ROUND_QUORUM = 5 / 6;

export type ConsensusProtocol = {
  id: ConsensusProtocolId;
  label: string;
  shortLabel: string;
  decoupled: boolean;
  summary: string;
  mechanism: string;
  strokeClass: string;
};

export const CONSENSUS_PROTOCOLS = [
  {
    id: "coupled",
    label: "Coupled · today’s structure",
    shortLabel: "Coupled",
    decoupled: false,
    summary: "No DC: the site’s standard round model",
    mechanism:
      "The coupled reference keeps the standard model: a round-boundary checkpoint is voted for one full round to justify it and one more to finalize it. It has no separate fast-confirmation step.",
    strokeClass: "protocol-coupled",
  },
  {
    id: "dc-today",
    label: "DC today · one height per round",
    shortLabel: "DC today",
    decoupled: true,
    summary: "Each round votes the entry fixed by the previous round",
    mechanism:
      "Votes are round-locked: every cohort of a round votes the height that the round’s opening view shows, so heights advance once per round. The quorum block becomes the next entry, the next round votes it, and that round’s votes also finalize the previous entry. A round lasts long enough for its quorum to be on-chain and confirmed before the next round opens. A block waits for the next entry, then for the round that votes it.",
    strokeClass: "protocol-dc-today",
  },
  {
    id: "dc-height-progress",
    label: "DC + height progress",
    shortLabel: "Height progress",
    decoupled: true,
    summary: "A height closes at its quorum; voters switch at once",
    mechanism:
      "A height closes as soon as its quorum is on-chain, and each cohort votes the newest entry its confirmed view shows. Heights therefore advance every quorum plus one confirmation, not every round. The votes that justify the next height also finalize the previous one.",
    strokeClass: "protocol-height-progress",
  },
  {
    id: "dc-rolling-ffg",
    label: "DC + Rolling FFG",
    shortLabel: "Rolling FFG",
    decoupled: true,
    summary: "Every slot is a checkpoint; no wait for a target",
    mechanism:
      "Every slot is a checkpoint: each cohort votes its newest confirmed block, so a block never waits for a target. It is justified once two-thirds of a round has voted after it, and finalized once two-thirds more lock votes follow.",
    strokeClass: "protocol-rolling-ffg",
  },
] as const satisfies readonly ConsensusProtocol[];

export const PROTOCOL_BY_ID = new Map<ConsensusProtocolId, ConsensusProtocol>(
  CONSENSUS_PROTOCOLS.map((protocol) => [protocol.id, protocol]),
);

export function isDecoupledProtocol(protocol: ConsensusProtocolId) {
  return protocol !== "coupled";
}

export function quorumCohorts(roundSlots: number, fraction: number) {
  const safeRoundSlots = Math.max(1, Math.round(roundSlots));
  // A small tolerance keeps exact fractions such as 2/3 of 3 at 2 cohorts.
  return Math.max(1, Math.ceil(fraction * safeRoundSlots - 1e-9));
}

function normalizeFinalityRounds(finalityRounds: number): FinalityRoundCount {
  return Number.isFinite(finalityRounds) && Math.round(finalityRounds) === 1 ? 1 : 2;
}

export type ProtocolTimingStatus = "ok" | "research-needed";

export type ProtocolStages = {
  inclusion: number;
  confirmation: number;
  wait: number;
  justification: number;
  finalization: number;
};

export type ProtocolTiming = {
  protocol: ConsensusProtocolId;
  status: ProtocolTimingStatus;
  available: boolean;
  slotSeconds: number;
  // Vote slots per round: the full validator set, one cohort per slot.
  roundSlots: number;
  // Slots per protocol round. Only DC today's round can run past its vote
  // slots, when its quorum would otherwise land too late for the next round.
  roundLengthSlots: number;
  finalityRounds: FinalityRoundCount;
  quorumCohorts: number;
  targetIntervalSlots: number;
  stageSlots: ProtocolStages;
  stageSeconds: ProtocolStages;
  totalSlots: number;
  totalSeconds: number;
  confirmationSeconds: number | null;
  minSlots: number;
  maxSlots: number;
  minSeconds: number;
  maxSeconds: number;
};

type ScheduleParameters = {
  roundSlots: number;
  roundLengthSlots: number;
  finalityRounds: FinalityRoundCount;
  justificationQuorum: number;
  oneRoundQuorum: number;
  quorum: number;
  targetIntervalSlots: number;
  onChainOffset: number;
};

export type BlockFinalityEvents = {
  slot: number;
  confirmedAt: number | null;
  stabilizedAt: number | null;
  targetSlot: number;
  votingStartsAt: number;
  quorumVotes: readonly [number, number];
  justifiedAt: number | null;
  finalityVotes: readonly [number, number] | null;
  // Votes after the needed ones that carry the same finality vote: in DC today
  // every cohort of a round votes from the round's opening view, so the rest of
  // the finality round repeats it. They arrive after finality is seen.
  laterFinalityVotes: readonly [number, number] | null;
  finalizedAt: number;
};

export type FinalitySchedule = {
  protocol: ConsensusProtocolId;
  roundSlots: number;
  roundLengthSlots: number;
  finalityRounds: FinalityRoundCount;
  quorumCohorts: number;
  targetIntervalSlots: number;
  eventsFor: (slot: number) => BlockFinalityEvents;
  isTarget: (slot: number) => boolean;
  // False for the slots of a stretched DC-today round, where no cohort votes.
  hasVote: (slot: number) => boolean;
  isStaleVote: (slot: number) => boolean;
};

const ceilDiv = (value: number, divisor: number) => Math.ceil(value / divisor);
const modulo = (value: number, divisor: number) =>
  ((value % divisor) + divisor) % divisor;

// The cohorts of a round after its needed votes, or null when the round's
// quorum is the whole round.
function restOfRound(
  needed: readonly [number, number],
  roundStart: number,
  roundSlots: number,
): readonly [number, number] | null {
  const roundEnd = roundStart + roundSlots - 1;
  return needed[1] < roundEnd ? [needed[1] + 1, roundEnd] : null;
}

function scheduleParameters(
  protocol: ConsensusProtocolId,
  roundSlots: number,
  finalityRounds: FinalityRoundCount,
): ScheduleParameters {
  const R = roundSlots;
  const J = quorumCohorts(R, JUSTIFICATION_QUORUM);
  const Q = quorumCohorts(R, ONE_ROUND_QUORUM);
  const quorum = finalityRounds === 2 ? J : Q;
  const e = CONFIRMATION_SLOTS;
  // Offset from the first counted vote to the on-chain quorum block.
  const onChainOffset = quorum - 1 + ON_CHAIN_VOTE_SLOTS;

  const shared = {
    roundSlots: R,
    finalityRounds,
    justificationQuorum: J,
    oneRoundQuorum: Q,
    quorum,
    onChainOffset,
  };

  if (protocol === "coupled") {
    return { ...shared, roundLengthSlots: R, targetIntervalSlots: R };
  }

  if (protocol === "dc-today") {
    // Every cohort votes from the round's opening view, so the next round can
    // vote the quorum block only if it is confirmed by then. Rounds are sized
    // for this: when the quorum needs every vote slot, the round runs one slot
    // past its R vote slots, and it always lasts at least two slots. Heights
    // then advance once per round.
    const roundLengthSlots = Math.max(DC_MIN_ROUND_SLOTS, R, onChainOffset + e);
    return { ...shared, roundLengthSlots, targetIntervalSlots: roundLengthSlots };
  }

  if (protocol === "dc-height-progress") {
    return { ...shared, roundLengthSlots: R, targetIntervalSlots: e + onChainOffset };
  }

  return { ...shared, roundLengthSlots: R, targetIntervalSlots: 1 };
}

// Per-block events in steady state. Slot indices are absolute; the schedules
// are periodic, so any window of slots shows representative behavior.
function blockEvents(
  protocol: ConsensusProtocolId,
  parameters: ScheduleParameters,
  slot: number,
): BlockFinalityEvents {
  const R = parameters.roundSlots;
  const J = parameters.justificationQuorum;
  const twoRounds = parameters.finalityRounds === 2;
  const e = CONFIRMATION_SLOTS;
  const confirmedAt = protocol === "coupled" ? null : slot + e;
  const stabilizedAt =
    protocol === "coupled" ? null : slot + e + STABILIZATION_SLOTS;

  if (protocol === "coupled") {
    // The standard model: the next round-boundary block is the checkpoint, voted
    // for one full round per finality round.
    const targetSlot = ceilDiv(slot, R) * R;
    return {
      slot,
      confirmedAt,
      stabilizedAt,
      targetSlot,
      votingStartsAt: targetSlot,
      quorumVotes: [targetSlot, targetSlot + R - 1],
      justifiedAt: twoRounds ? targetSlot + R : null,
      finalityVotes: twoRounds ? [targetSlot + R, targetSlot + 2 * R - 1] : null,
      laterFinalityVotes: null,
      finalizedAt: targetSlot + parameters.finalityRounds * R,
    };
  }

  if (protocol === "dc-today") {
    const period = parameters.targetIntervalSlots;
    const offset = parameters.onChainOffset;
    // Each round opens with its R vote slots. Its quorum block, `offset` slots
    // in, is the entry that the next round votes.
    const targetSlot = ceilDiv(slot - offset, period) * period + offset;
    const votingStartsAt = targetSlot + period - offset;
    const quorumVotes = [
      votingStartsAt,
      votingStartsAt + parameters.quorum - 1,
    ] as const;

    if (!twoRounds) {
      return {
        slot,
        confirmedAt,
        stabilizedAt,
        targetSlot,
        votingStartsAt,
        quorumVotes,
        justifiedAt: null,
        finalityVotes: null,
        // The whole round votes the entry; its first quorum finalizes it.
        laterFinalityVotes: restOfRound(quorumVotes, votingStartsAt, R),
        finalizedAt: quorumVotes[1] + LOCAL_FINALITY_SLOTS,
      };
    }

    const justifiedAt = targetSlot + period;
    // The next round votes the next entry, and its votes carry this entry's
    // finality pair: a pair below their height pair.
    const nextVotingRound = votingStartsAt + period;
    const finalityVotes = [nextVotingRound, nextVotingRound + J - 1] as const;
    return {
      slot,
      confirmedAt,
      stabilizedAt,
      targetSlot,
      votingStartsAt,
      quorumVotes,
      justifiedAt,
      finalityVotes,
      laterFinalityVotes: restOfRound(finalityVotes, nextVotingRound, R),
      finalizedAt: finalityVotes[1] + LOCAL_FINALITY_SLOTS,
    };
  }

  if (protocol === "dc-height-progress") {
    const height = parameters.targetIntervalSlots;
    const targetSlot = ceilDiv(slot, height) * height;
    const votingStartsAt = targetSlot + e;
    const quorumVotes = [
      votingStartsAt,
      votingStartsAt + parameters.quorum - 1,
    ] as const;

    if (!twoRounds) {
      return {
        slot,
        confirmedAt,
        stabilizedAt,
        targetSlot,
        votingStartsAt,
        quorumVotes,
        justifiedAt: null,
        finalityVotes: null,
        // Until the next entry is confirmed, cohorts still vote this height. A
        // cohort that already voted it sends nothing, so this needs fresh cohorts.
        laterFinalityVotes:
          parameters.quorum + e <= R
            ? [quorumVotes[1] + 1, quorumVotes[1] + e]
            : null,
        finalizedAt: quorumVotes[1] + LOCAL_FINALITY_SLOTS,
      };
    }

    const justifiedAt = targetSlot + height;
    // A finality pair must name a height below the vote's height pair, so a
    // cohort whose confirmed view still shows the closed height cannot carry
    // it. The votes that justify the next height also finalize this one.
    const nextVotes = justifiedAt + e;
    const finalityVotes = [nextVotes, nextVotes + J - 1] as const;
    return {
      slot,
      confirmedAt,
      stabilizedAt,
      targetSlot,
      votingStartsAt,
      quorumVotes,
      justifiedAt,
      finalityVotes,
      // Later cohorts vote newer heights, whose finality pairs name newer heights.
      laterFinalityVotes: null,
      finalizedAt: finalityVotes[1] + LOCAL_FINALITY_SLOTS,
    };
  }

  // Rolling FFG: the cohort of slot u votes B_{u − e}, so B_t's checkpoint
  // collects votes from slot t + e. Justification needs J of them on-chain;
  // the lock votes come from the J cohorts that already know it.
  const votingStartsAt = slot + e;
  const quorumVotes = [votingStartsAt, votingStartsAt + J - 1] as const;
  const justifiedAt = quorumVotes[1] + ON_CHAIN_VOTE_SLOTS;
  const finalityVotes = [justifiedAt, justifiedAt + J - 1] as const;
  return {
    slot,
    confirmedAt,
    stabilizedAt,
    targetSlot: slot,
    votingStartsAt,
    quorumVotes,
    justifiedAt,
    finalityVotes,
    // Every cohort that knows the justification locks it: a round of lock votes.
    laterFinalityVotes: restOfRound(finalityVotes, justifiedAt, R),
    finalizedAt: finalityVotes[1] + LOCAL_FINALITY_SLOTS,
  };
}

function scheduleStatus(
  protocol: ConsensusProtocolId,
  finalityRounds: FinalityRoundCount,
): ProtocolTimingStatus {
  return protocol === "dc-rolling-ffg" && finalityRounds === 1
    ? "research-needed"
    : "ok";
}

function safeRoundSlots(roundSlots: number) {
  return Number.isFinite(roundSlots) ? Math.max(1, Math.round(roundSlots)) : 1;
}

// Returns null when the design has no defined schedule (one-round Rolling FFG).
export function createFinalitySchedule(
  protocol: ConsensusProtocolId,
  roundSlots: number,
  finalityRounds: number,
): FinalitySchedule | null {
  const rounds = normalizeFinalityRounds(finalityRounds);
  if (scheduleStatus(protocol, rounds) === "research-needed") return null;

  const R = safeRoundSlots(roundSlots);
  const parameters = scheduleParameters(protocol, R, rounds);
  const period = parameters.targetIntervalSlots;

  return {
    protocol,
    roundSlots: R,
    roundLengthSlots: parameters.roundLengthSlots,
    finalityRounds: rounds,
    quorumCohorts: parameters.quorum,
    targetIntervalSlots: period,
    eventsFor: (slot) => blockEvents(protocol, parameters, slot),
    isTarget: (slot) => {
      if (protocol === "dc-rolling-ffg") return true;
      if (protocol === "dc-today") {
        return modulo(slot - parameters.onChainOffset, period) === 0;
      }
      return modulo(slot, period) === 0;
    },
    hasVote: (slot) => protocol !== "dc-today" || modulo(slot, period) < R,
    // A vote is stale when it counts toward no quorum and carries no finality
    // vote. Finality pairs ride only on votes for the current height, so a
    // stale vote carries nothing. Every DC-today vote counts: the round's late
    // cohorts carry the previous entry's finality vote.
    isStaleVote: (slot) => {
      if (protocol === "dc-height-progress") {
        // Until the new entry is confirmed, cohorts still see the closed height.
        // With one-round finality a fresh cohort's vote for it is a later
        // finality vote; with two rounds it carries nothing.
        const sinceEntry = modulo(slot, period);
        const seesClosedHeight = sinceEntry < CONFIRMATION_SLOTS;
        const laterVote =
          rounds === 1 && parameters.quorum + CONFIRMATION_SLOTS <= R;
        return (
          (seesClosedHeight && !laterVote) ||
          sinceEntry >= CONFIRMATION_SLOTS + parameters.quorum
        );
      }
      return false;
    },
  };
}

const EMPTY_STAGES: ProtocolStages = {
  inclusion: Number.NaN,
  confirmation: Number.NaN,
  wait: Number.NaN,
  justification: Number.NaN,
  finalization: Number.NaN,
};

function scaleStages(stages: ProtocolStages, factor: number): ProtocolStages {
  return {
    inclusion: stages.inclusion * factor,
    confirmation: stages.confirmation * factor,
    wait: stages.wait * factor,
    justification: stages.justification * factor,
    finalization: stages.finalization * factor,
  };
}

type SlotTiming = {
  stages: ProtocolStages;
  minLag: number;
  maxLag: number;
};

// The chart asks for the same few round lengths at many validator counts.
const slotTimingCache = new Map<string, SlotTiming>();

// Expected values by enumeration. A uniformly arriving transaction is equally
// likely to land in any block of one period of the schedule, so a stage is the
// mean over those blocks of the time between two of the block's milestones:
// inclusion, its own confirmation, the first vote for a target that covers it,
// justification and local finality. The lag of a block is its proposal to its
// finality.
function slotTiming(schedule: FinalitySchedule): SlotTiming {
  const key = `${schedule.protocol}:${schedule.roundSlots}:${schedule.finalityRounds}`;
  const cached = slotTimingCache.get(key);
  if (cached) return cached;

  const period = schedule.targetIntervalSlots;
  let confirmation = 0;
  let wait = 0;
  let justification = 0;
  let finalization = 0;
  let minLag = Number.POSITIVE_INFINITY;
  let maxLag = Number.NEGATIVE_INFINITY;
  for (let slot = 0; slot < period; slot += 1) {
    const events = schedule.eventsFor(slot);
    const confirmed = events.confirmedAt ?? slot;
    const justified = events.justifiedAt ?? events.votingStartsAt;
    confirmation += confirmed - slot;
    wait += events.votingStartsAt - confirmed;
    justification += justified - events.votingStartsAt;
    finalization += events.finalizedAt - justified;
    minLag = Math.min(minLag, events.finalizedAt - slot);
    maxLag = Math.max(maxLag, events.finalizedAt - slot);
  }

  const timing = {
    stages: {
      inclusion: 0.5,
      confirmation: confirmation / period,
      wait: wait / period,
      justification: justification / period,
      finalization: finalization / period,
    },
    minLag,
    maxLag,
  };
  slotTimingCache.set(key, timing);
  return timing;
}

// Expected arrival-to-finality time and its stages for one design.
export function calculateProtocolTiming({
  protocol,
  slotSeconds,
  roundSlots,
  finalityRounds,
}: {
  protocol: ConsensusProtocolId;
  slotSeconds: number;
  roundSlots: number;
  finalityRounds: number;
}): ProtocolTiming {
  const s = Number.isFinite(slotSeconds) ? Math.max(1, Math.round(slotSeconds)) : 12;
  const rounds = normalizeFinalityRounds(finalityRounds);
  const R = safeRoundSlots(roundSlots);
  const parameters = scheduleParameters(protocol, R, rounds);
  const schedule = createFinalitySchedule(protocol, R, rounds);
  const shared = {
    protocol,
    slotSeconds: s,
    roundSlots: R,
    roundLengthSlots: parameters.roundLengthSlots,
    finalityRounds: rounds,
    quorumCohorts: parameters.quorum,
    targetIntervalSlots: parameters.targetIntervalSlots,
    confirmationSeconds: protocol === "coupled" ? null : (0.5 + CONFIRMATION_SLOTS) * s,
  };

  if (!schedule) {
    return {
      ...shared,
      status: "research-needed",
      available: false,
      stageSlots: EMPTY_STAGES,
      stageSeconds: EMPTY_STAGES,
      totalSlots: Number.NaN,
      totalSeconds: Number.NaN,
      minSlots: Number.NaN,
      maxSlots: Number.NaN,
      minSeconds: Number.NaN,
      maxSeconds: Number.NaN,
    };
  }

  const { stages, minLag, maxLag } = slotTiming(schedule);
  const totalSlots =
    stages.inclusion +
    stages.confirmation +
    stages.wait +
    stages.justification +
    stages.finalization;

  return {
    ...shared,
    status: "ok",
    available: true,
    stageSlots: stages,
    stageSeconds: scaleStages(stages, s),
    totalSlots,
    totalSeconds: totalSlots * s,
    // A transaction waits between 0 and 1 slot for its block.
    minSlots: minLag,
    maxSlots: maxLag + 1,
    minSeconds: minLag * s,
    maxSeconds: (maxLag + 1) * s,
  };
}

// The round model's DC gain belongs to every decoupled design.
export function improvementsForProtocol(
  protocol: ConsensusProtocolId,
  networkingImprovements: readonly RoundImprovementId[],
): RoundImprovementId[] {
  const withoutDc = networkingImprovements.filter(
    (improvement) => improvement !== "dc",
  );
  return isDecoupledProtocol(protocol) ? ["dc", ...withoutDc] : withoutDc;
}
