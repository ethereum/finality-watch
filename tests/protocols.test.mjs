import assert from "node:assert/strict";
import test from "node:test";

import {
  MIN_SCENARIO_VALIDATORS,
  calculateRoundModel,
} from "../app/lib/model.ts";
import {
  CONFIRMATION_SLOTS,
  CONSENSUS_PROTOCOLS,
  DC_MIN_ROUND_SLOTS,
  LOCAL_FINALITY_SLOTS,
  ON_CHAIN_VOTE_SLOTS,
  calculateProtocolTiming,
  createFinalitySchedule,
  improvementsForProtocol,
  quorumCohorts,
} from "../app/lib/protocols.ts";

const e = CONFIRMATION_SLOTS;
const aJ = ON_CHAIN_VOTE_SLOTS;
const aF = LOCAL_FINALITY_SLOTS;
const quorum = (R, rounds) => quorumCohorts(R, rounds === 2 ? 2 / 3 : 5 / 6);

// An independent vote-by-vote simulation of the height designs. Cohort u votes
// at time u with its confirmed view (blocks up to u − e) and on-chain knowledge
// up to u. Its votes reach the chain at u + aJ and are seen locally at u + aF.
// As in DC's attestation rules, a finality pair counts only when it names a
// height below the vote's own height pair, and a cohort never votes the same
// height twice. It also records the slots whose votes carry each height's
// finality vote, needed or not. DC today runs rounds of `roundLength` slots,
// with its R cohorts voting in the first R; a round whose opening view shows a
// closed height sends nothing and counts as dead.
function simulateHeights(design, R, rounds, slots, roundLength = R) {
  const entries = [0, 0];
  const justifiedAt = new Map([[0, 0]]);
  const finalizedAt = new Map();
  let finalizedHeight = 0;
  const q = quorum(R, rounds);
  const carriers = new Map();
  let deadRounds = 0;
  const carry = (height, slot) => {
    if (!carriers.has(height)) carriers.set(height, []);
    carriers.get(height).push(slot);
  };
  const latestJustified = (time) => {
    let height = 0;
    for (const [candidate, at] of justifiedAt) {
      if (at <= time && candidate > height) height = candidate;
    }
    return height;
  };
  const confirmedHeight = (time) => {
    let height = 0;
    entries.forEach((entry, candidate) => {
      if (entry <= time - e) height = candidate;
    });
    return height;
  };

  if (design === "dc-today") {
    for (let round = 0; round * roundLength < slots; round += 1) {
      const start = round * roundLength;
      const voted = confirmedHeight(start);
      const current = entries.length - 1;
      if (voted >= 1 && voted < current) deadRounds += 1;
      const onChain = start + q - 1 + aJ;
      const local = start + q - 1 + aF;
      // Every cohort of a round votes from the round's opening view.
      const wholeRound = (height) => {
        for (let u = start; u < start + R; u += 1) carry(height, u);
      };
      if (rounds === 2) {
        const finalityPair = latestJustified(start);
        if (finalityPair > finalizedHeight && finalityPair < voted) {
          finalizedAt.set(finalityPair, local);
          finalizedHeight = finalityPair;
          wholeRound(finalityPair);
        }
        if (voted === current && voted >= 1) {
          justifiedAt.set(current, onChain);
          entries.push(onChain);
        }
      } else if (voted === current && voted >= 1) {
        finalizedAt.set(current, local);
        wholeRound(current);
        entries.push(onChain);
      }
    }
  } else {
    const landing = [];
    let targetVotes = 0;
    const finalityVotes = new Map();
    const finalizedOnChainAt = new Map([[0, 0]]);
    const lastVoted = new Array(R).fill(-1);
    const finalizedOnChain = (time) => {
      let height = 0;
      for (const [candidate, at] of finalizedOnChainAt) {
        if (at <= time && candidate > height) height = candidate;
      }
      return height;
    };
    for (let u = 0; u < slots; u += 1) {
      for (const vote of landing.filter((candidate) => candidate.at === u)) {
        const current = entries.length - 1;
        if (vote.height === current && ++targetVotes >= q) {
          if (rounds === 2) justifiedAt.set(current, u);
          entries.push(u);
          targetVotes = 0;
        }
      }
      const height = confirmedHeight(u);
      const finalityPair = latestJustified(u);
      landing.push({ at: u + aJ, height: height >= 1 ? height : -1 });
      // The finality vote a fresh cohort sends: the pair its head has justified
      // but not finalized (two rounds), or its vote for its height (one round).
      const cohort = u % R;
      if (height >= 1 && lastVoted[cohort] !== height) {
        lastVoted[cohort] = height;
        if (rounds === 1) carry(height, u);
        else if (finalityPair < height && finalityPair > finalizedOnChain(u)) {
          carry(finalityPair, u);
        }
      }
      if (rounds === 2 && finalityPair > finalizedHeight && finalityPair < height) {
        const count = (finalityVotes.get(finalityPair) ?? 0) + 1;
        finalityVotes.set(finalityPair, count);
        if (count >= q) {
          finalizedAt.set(finalityPair, u + aF);
          finalizedOnChainAt.set(finalityPair, u + aJ);
          finalizedHeight = finalityPair;
        }
      }
      if (rounds === 1 && height === entries.length - 1 && height >= 1) {
        const count = (finalityVotes.get(height) ?? 0) + 1;
        finalityVotes.set(height, count);
        if (count === q) finalizedAt.set(height, u + aF);
      }
    }
  }

  return {
    deadRounds,
    lagFor: (slot) => {
      let best = Infinity;
      entries.forEach((entry, height) => {
        if (height >= 1 && entry >= slot && finalizedAt.has(height)) {
          best = Math.min(best, finalizedAt.get(height));
        }
      });
      return best - slot;
    },
    // The slots carrying the finality vote of the height that covers the block.
    finalityVotesFor: (slot) => {
      const height = entries.findIndex((entry, index) => index >= 1 && entry >= slot);
      return carriers.get(height) ?? [];
    },
  };
}

// Rolling FFG with per-validator windows. Position q's checkpoint is B_{q − e};
// it is justified by J votes in ticks q … q + R − 1 whose source is an earlier
// position, and finalized once the positions up to a later one are justified
// and J votes of that later window have a source at or after q.
function simulateRolling(R, slot) {
  const J = quorum(R, 2);
  const size = slot + 8 * R + 20;
  const onChain = new Array(size).fill(Infinity);
  const local = new Array(size).fill(Infinity);
  onChain[0] = 0;
  local[0] = 0;
  const source = (tick) => {
    let position = -1;
    for (let q = 0; q < tick; q += 1) if (onChain[q] <= tick) position = q;
    return position;
  };
  for (let q = 1; q < size - R; q += 1) {
    let count = 0;
    for (let tick = q; tick <= q + R - 1; tick += 1) {
      const from = source(tick);
      if (from >= 0 && from < q && ++count === J) {
        onChain[q] = tick + aJ;
        local[q] = tick + aF;
        break;
      }
    }
  }
  const p = slot + e;
  let best = Infinity;
  for (let pStar = p + 1; pStar < p + 4 * R + 4; pStar += 1) {
    let runJustified = 0;
    for (let q = p; q <= pStar; q += 1) runJustified = Math.max(runJustified, local[q]);
    let locks = 0;
    let lockTime = Infinity;
    for (let tick = pStar; tick <= pStar + R - 1; tick += 1) {
      if (source(tick) >= p && ++locks === J) {
        lockTime = tick + aF;
        break;
      }
    }
    best = Math.min(best, Math.max(runJustified, lockTime));
  }
  // Every tick from the on-chain justification on has a source at or after p,
  // so a whole round of cohorts lock it.
  const lockVotes = [];
  for (let tick = onChain[p]; tick < onChain[p] + R; tick += 1) {
    if (source(tick) >= p) lockVotes.push(tick);
  }
  return { lag: best - slot, lockVotes };
}

function scheduleLags(schedule, from, count) {
  return Array.from({ length: count }, (_, index) => {
    const slot = from + index;
    return schedule.eventsFor(slot).finalizedAt - slot;
  });
}

// All the slots whose votes carry a block's finality vote, as one range.
function finalityVoteRange(events) {
  const needed = events.finalityVotes ?? events.quorumVotes;
  return [needed[0], events.laterFinalityVotes?.[1] ?? needed[1]];
}

// A contiguous list of slots as "first,last" relative to the block, or null.
function relativeRange(slots, slot) {
  const contiguous = slots.every((value, index) => index === 0 || value === slots[index - 1] + 1);
  return slots.length && contiguous ? `${slots[0] - slot},${slots.at(-1) - slot}` : null;
}

const sorted = (values) => [...values].sort((a, b) => a - b);
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;

test("closed forms and schedules match the vote-by-vote simulation", () => {
  for (const protocol of ["dc-today", "dc-height-progress"]) {
    for (const rounds of [1, 2]) {
      for (let R = 1; R <= 33; R += 1) {
        const schedule = createFinalitySchedule(protocol, R, rounds);
        const timing = calculateProtocolTiming({
          protocol,
          slotSeconds: 12,
          roundSlots: R,
          finalityRounds: rounds,
        });
        const period = schedule.targetIntervalSlots;
        const scenarioName = `${protocol}, R = ${R}, ${rounds} rounds`;

        if (protocol === "dc-today") {
          // The model's round is the fastest a protocol could pick: simulate
          // every round length from R up, dead rounds included.
          let best = Infinity;
          for (let length = R; length <= R + 4; length += 1) {
            const run = simulateHeights(protocol, R, rounds, 80 * length, length);
            const from = 30 * length;
            const window = 6 * length;
            let sum = 0;
            for (let slot = from; slot < from + window; slot += 1) sum += run.lagFor(slot);
            best = Math.min(best, sum / window);
          }
          assert.equal(timing.totalSlots, 0.5 + best, `${scenarioName}: fastest round`);
          assert.ok(schedule.roundLengthSlots >= Math.max(R, DC_MIN_ROUND_SLOTS), scenarioName);
          const atModel = simulateHeights(protocol, R, rounds, 80 * period, period);
          assert.equal(atModel.deadRounds, 0, `${scenarioName}: one height per round`);
        }

        const simulated = simulateHeights(
          protocol,
          R,
          rounds,
          60 * R + 12 * period,
          schedule.roundLengthSlots,
        );
        const from = 20 * R + 4 * period;
        const simulatedLags = Array.from({ length: period }, (_, index) =>
          simulated.lagFor(from + index),
        );
        const plannedLags = scheduleLags(schedule, 10 * period, period);
        const scenario = scenarioName;

        assert.deepEqual(sorted(plannedLags), sorted(simulatedLags), scenario);

        // Every slot whose vote carries the block's finality vote, needed or later.
        const simulatedRanges = Array.from({ length: period }, (_, index) =>
          relativeRange(simulated.finalityVotesFor(from + index), from + index),
        );
        const plannedRanges = Array.from({ length: period }, (_, index) => {
          const slot = 10 * period + index;
          const [first, last] = finalityVoteRange(schedule.eventsFor(slot));
          return `${first - slot},${last - slot}`;
        });
        assert.deepEqual(plannedRanges.sort(), simulatedRanges.sort(), `${scenario}: finality votes`);
        assert.equal(timing.totalSlots, 0.5 + mean(simulatedLags), scenario);
        assert.equal(timing.minSlots, Math.min(...simulatedLags), scenario);
        assert.equal(timing.maxSlots, Math.max(...simulatedLags) + 1, scenario);
      }
    }
  }

  for (let R = 1; R <= 24; R += 1) {
    const schedule = createFinalitySchedule("dc-rolling-ffg", R, 2);
    const timing = calculateProtocolTiming({
      protocol: "dc-rolling-ffg",
      slotSeconds: 12,
      roundSlots: R,
      finalityRounds: 2,
    });
    const slot = 12 * R + 7;
    const simulated = simulateRolling(R, slot);
    const events = schedule.eventsFor(slot);
    assert.equal(events.finalizedAt - slot, simulated.lag, `R = ${R}`);
    assert.equal(timing.totalSlots, 0.5 + simulated.lag, `R = ${R}`);
    assert.equal(simulated.lockVotes.length, R, `R = ${R}: a round of lock votes`);
    assert.deepEqual(
      finalityVoteRange(events),
      [simulated.lockVotes[0], simulated.lockVotes.at(-1)],
      `R = ${R}: lock votes`,
    );
  }
});

test("stages add up and every block reaches its milestones in order", () => {
  for (const protocol of ["coupled", "dc-today", "dc-height-progress", "dc-rolling-ffg"]) {
    for (const rounds of [1, 2]) {
      for (const R of [1, 2, 3, 5, 8, 13, 32]) {
        const timing = calculateProtocolTiming({
          protocol,
          slotSeconds: 8,
          roundSlots: R,
          finalityRounds: rounds,
        });
        if (!timing.available) continue;

        const stages = Object.values(timing.stageSlots);
        assert.ok(stages.every((value) => value >= 0), `${protocol} ${R} ${rounds}`);
        assert.equal(
          stages.reduce((sum, value) => sum + value, 0),
          timing.totalSlots,
        );
        assert.equal(timing.totalSeconds, timing.totalSlots * 8);

        const schedule = createFinalitySchedule(protocol, R, rounds);
        for (let slot = 100; slot < 100 + 3 * schedule.targetIntervalSlots; slot += 1) {
          const events = schedule.eventsFor(slot);
          assert.ok(events.targetSlot >= slot);
          assert.ok(events.votingStartsAt >= events.targetSlot);
          assert.ok(events.votingStartsAt >= (events.confirmedAt ?? slot));
          if (events.justifiedAt !== null) {
            assert.ok(events.justifiedAt > events.quorumVotes[1]);
            assert.ok(events.finalizedAt >= events.justifiedAt);
          }
          assert.ok(events.finalizedAt >= events.quorumVotes[1]);
        }
      }
    }
  }
});

test("schedules agree with their targets, stale votes and closed forms", () => {
  for (const protocol of ["coupled", "dc-today", "dc-height-progress", "dc-rolling-ffg"]) {
    for (const rounds of [1, 2]) {
      for (let R = 1; R <= 40; R += 1) {
        const schedule = createFinalitySchedule(protocol, R, rounds);
        if (!schedule) continue;
        const timing = calculateProtocolTiming({
          protocol,
          slotSeconds: 1,
          roundSlots: R,
          finalityRounds: rounds,
        });
        const period = schedule.targetIntervalSlots;
        const from = 50 * Math.max(period, R);
        const scenario = `${protocol}, R = ${R}, ${rounds} rounds`;

        // A block's target is the first target slot at or after it.
        const lags = [];
        for (let slot = from; slot < from + period; slot += 1) {
          const events = schedule.eventsFor(slot);
          let target = slot;
          while (!schedule.isTarget(target)) target += 1;
          assert.equal(events.targetSlot, target, scenario);
          lags.push(events.finalizedAt - slot);
        }
        assert.equal(timing.totalSlots, 0.5 + mean(lags), scenario);
        assert.equal(timing.minSlots, Math.min(...lags), scenario);
        assert.equal(timing.maxSlots, Math.max(...lags) + 1, scenario);

        // A vote is stale exactly when it counts toward no block's quorum and
        // carries no block's finality vote. Later finality votes follow the
        // needed ones directly.
        const counted = new Set();
        for (let slot = from - 6 * period - 4 * R; slot < from + 6 * period + 4 * R; slot += 1) {
          const events = schedule.eventsFor(slot);
          const later = events.laterFinalityVotes;
          if (later) {
            const needed = events.finalityVotes ?? events.quorumVotes;
            assert.equal(later[0], needed[1] + 1, scenario);
            assert.ok(later[1] >= later[0], scenario);
          }
          for (const window of [events.quorumVotes, events.finalityVotes, later]) {
            if (!window) continue;
            for (let vote = window[0]; vote <= window[1]; vote += 1) counted.add(vote);
          }
        }
        for (let vote = from; vote < from + 2 * period + R; vote += 1) {
          if (!schedule.hasVote(vote)) {
            assert.ok(!counted.has(vote), `${scenario}, slot ${vote} has no vote`);
            continue;
          }
          assert.equal(schedule.isStaleVote(vote), !counted.has(vote), `${scenario}, slot ${vote}`);
        }
      }
    }
  }
});

test("coupled reference keeps the standard model with whole-slot waits", () => {
  // Half a slot to inclusion, a round wait of 0 … R − 1 slots (a block at a
  // round start is voted in that round), then one full round per finality round.
  for (const R of [1, 2, 3, 8, 32]) {
    for (const rounds of [1, 2]) {
      const timing = calculateProtocolTiming({
        protocol: "coupled",
        slotSeconds: 12,
        roundSlots: R,
        finalityRounds: rounds,
      });
      assert.equal(timing.totalSeconds, (0.5 + (R - 1) / 2 + rounds * R) * 12);
      assert.equal(timing.confirmationSeconds, null);
    }
  }
});

test("headline scenarios at 12-second slots", () => {
  const seconds = (protocol, R, rounds) =>
    calculateProtocolTiming({
      protocol,
      slotSeconds: 12,
      roundSlots: R,
      finalityRounds: rounds,
    }).totalSeconds;

  // Eight-slot rounds: today's validator count with DC's 4× gain.
  assert.equal(seconds("dc-today", 8, 2), 228);
  assert.equal(seconds("dc-height-progress", 8, 2), 198);
  assert.equal(seconds("dc-rolling-ffg", 8, 2), 150);
  assert.equal(seconds("dc-today", 8, 1), 132);
  assert.equal(seconds("dc-height-progress", 8, 1), 132);

  // One-slot rounds: DC today's round runs a second slot for its quorum to
  // land, which matches height progress.
  assert.equal(seconds("dc-today", 1, 2), 48);
  assert.equal(seconds("dc-today", 1, 1), 24);
  assert.equal(seconds("dc-height-progress", 1, 2), 48);
  assert.equal(seconds("dc-height-progress", 1, 1), 24);
  assert.equal(seconds("dc-rolling-ffg", 1, 2), 30);

  // Two-slot rounds: three-slot DC-today rounds, no faster than one-slot ones.
  assert.equal(seconds("dc-today", 2, 2), 78);

  // Fast confirmation: half a slot of inclusion plus one slot.
  const timing = calculateProtocolTiming({
    protocol: "dc-today",
    slotSeconds: 12,
    roundSlots: 8,
    finalityRounds: 2,
  });
  assert.equal(timing.confirmationSeconds, 18);
});

test("DC today runs a round past its votes instead of skipping one", () => {
  // The round lasts until its quorum is on-chain and confirmed: R vote slots,
  // plus one when the quorum needs every vote slot, and never below two slots.
  const cases = [
    [1, 2, 2],
    [2, 2, 3],
    [3, 2, 3],
    [8, 2, 8],
    [1, 1, 2],
    [2, 1, 3],
    [5, 1, 6],
    [6, 1, 6],
    [8, 1, 8],
  ];
  for (const [R, rounds, length] of cases) {
    const schedule = createFinalitySchedule("dc-today", R, rounds);
    const scenario = `R = ${R}, ${rounds} rounds`;
    assert.equal(schedule.roundSlots, R, scenario);
    assert.equal(schedule.roundLengthSlots, length, scenario);
    assert.equal(schedule.targetIntervalSlots, length, scenario);
    for (let slot = 0; slot < 3 * length; slot += 1) {
      assert.equal(schedule.hasVote(slot), slot % length < R, `${scenario}, slot ${slot}`);
      assert.equal(schedule.isStaleVote(slot), false, `${scenario}, slot ${slot}`);
    }
  }

  // The other designs vote in every slot.
  for (const protocol of ["coupled", "dc-height-progress", "dc-rolling-ffg"]) {
    const schedule = createFinalitySchedule(protocol, 2, 2);
    assert.equal(schedule.roundLengthSlots, 2, protocol);
    assert.ok([0, 1, 2, 3].every((slot) => schedule.hasVote(slot)), protocol);
  }
});

test("finality never gets slower with fewer validators", () => {
  for (const protocol of CONSENSUS_PROTOCOLS.map(({ id }) => id)) {
    for (const rounds of [1, 2]) {
      // Directly in round length…
      let previous = -Infinity;
      for (let R = 1; R <= 60; R += 1) {
        const timing = calculateProtocolTiming({
          protocol,
          slotSeconds: 12,
          roundSlots: R,
          finalityRounds: rounds,
        });
        if (!timing.available) continue;
        assert.ok(timing.totalSlots >= previous, `${protocol}, ${rounds} rounds, R = ${R}`);
        previous = timing.totalSlots;
      }

      // …and through the capacity model, at every slot time.
      for (let slotSeconds = 1; slotSeconds <= 12; slotSeconds += 1) {
        let slower = -Infinity;
        for (
          let validators = MIN_SCENARIO_VALIDATORS;
          validators <= 2_000_000;
          validators += 5_000
        ) {
          const round = calculateRoundModel({
            validators,
            slotSeconds,
            enabledImprovements: improvementsForProtocol(protocol, []),
            finalityRounds: rounds,
          });
          const timing = calculateProtocolTiming({
            protocol,
            slotSeconds,
            roundSlots: round.roundSlots,
            finalityRounds: rounds,
          });
          if (!timing.available) continue;
          assert.ok(
            timing.totalSeconds >= slower,
            `${protocol}, ${rounds} rounds, ${slotSeconds}-sec slots, ${validators} validators`,
          );
          slower = timing.totalSeconds;
        }
      }
    }
  }
});

test("one-round Rolling FFG is left open as research", () => {
  const timing = calculateProtocolTiming({
    protocol: "dc-rolling-ffg",
    slotSeconds: 12,
    roundSlots: 8,
    finalityRounds: 1,
  });
  assert.equal(timing.status, "research-needed");
  assert.equal(timing.available, false);
  assert.ok(Number.isNaN(timing.totalSeconds));
  assert.equal(timing.confirmationSeconds, 18);
  assert.equal(createFinalitySchedule("dc-rolling-ffg", 8, 1), null);
});

test("long rounds converge to the ideal closed forms", () => {
  const ratio = (protocol, rounds) => {
    const R = 6_000;
    return (
      calculateProtocolTiming({
        protocol,
        slotSeconds: 1,
        roundSlots: R,
        finalityRounds: rounds,
      }).totalSlots / R
    );
  };
  const close = (actual, expected) =>
    assert.ok(Math.abs(actual - expected) < 2e-3, `${actual} vs ${expected}`);

  close(ratio("dc-today", 2), 5 / 2);
  close(ratio("dc-today", 1), 3 / 2);
  close(ratio("dc-height-progress", 2), 5 / 3);
  close(ratio("dc-height-progress", 1), 5 / 4);
  close(ratio("dc-rolling-ffg", 2), 4 / 3);
  close(ratio("coupled", 2), 5 / 2);
});

test("the README's closed forms match the model", () => {
  const slots = (protocol, R, rounds) =>
    calculateProtocolTiming({
      protocol,
      slotSeconds: 1,
      roundSlots: R,
      finalityRounds: rounds,
    }).totalSlots;

  for (let R = 1; R <= 40; R += 1) {
    const J = quorum(R, 2);
    const Q = quorum(R, 1);
    const scenario = `R = ${R}`;

    const P = Math.max(R, J + 1);
    const P1 = Math.max(R, Q + 1);
    assert.equal(slots("dc-today", R, 2), (5 * P) / 2 - 1, scenario);
    assert.equal(slots("dc-today", R, 1), (3 * P1) / 2 - 1, scenario);
    assert.equal(slots("dc-height-progress", R, 2), (5 * (J + 1)) / 2 - 1, scenario);
    assert.equal(slots("dc-height-progress", R, 1), (3 * (Q + 1)) / 2 - 1, scenario);
    assert.equal(slots("dc-rolling-ffg", R, 2), 2 * J + 0.5, scenario);
    assert.equal(slots("coupled", R, 2), 2.5 * R, scenario);
    assert.equal(slots("coupled", R, 1), 1.5 * R, scenario);
  }
});

test("decoupled protocols carry the DC networking gain", () => {
  assert.deepEqual(improvementsForProtocol("dc-today", ["eip-8334"]), ["dc", "eip-8334"]);
  assert.deepEqual(improvementsForProtocol("dc-rolling-ffg", ["dc", "eip-8243"]), [
    "dc",
    "eip-8243",
  ]);
  assert.deepEqual(improvementsForProtocol("coupled", ["dc", "eip-8334"]), ["eip-8334"]);
});
