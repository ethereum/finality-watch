"use client";

import { useEffect, useMemo, useState } from "react";

const COHORT_COUNT = 8;
const VALIDATORS_PER_COHORT = 8;
const FIRST_VOTE_PHASE = 2;
const FINAL_PHASE = FIRST_VOTE_PHASE + COHORT_COUNT;
const STEP_MS = 1800;

const AC_SAMPLES = [
  [1, 12, 35, 54],
  [6, 19, 40, 57],
  [2, 25, 38, 63],
  [9, 20, 47, 58],
  [4, 17, 42, 55],
  [7, 28, 33, 60],
  [0, 23, 44, 51],
  [11, 30, 37, 62],
] as const;

export function DcVotingPattern() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let timer: number | null = null;

    const stop = () => {
      if (timer === null) return;
      window.clearInterval(timer);
      timer = null;
    };
    const start = () => {
      if (timer !== null || document.hidden || reducedMotion.matches) return;
      timer = window.setInterval(
        () => setPhase((current) => (current >= FINAL_PHASE ? 0 : current + 1)),
        STEP_MS,
      );
    };
    const sync = () => {
      if (document.hidden) stop();
      else if (reducedMotion.matches) {
        stop();
        setPhase(FINAL_PHASE);
      } else start();
    };

    document.addEventListener("visibilitychange", sync);
    reducedMotion.addEventListener("change", sync);
    sync();
    return () => {
      stop();
      document.removeEventListener("visibilitychange", sync);
      reducedMotion.removeEventListener("change", sync);
    };
  }, []);

  const activeSlot =
    phase >= FIRST_VOTE_PHASE && phase < FINAL_PHASE
      ? phase - FIRST_VOTE_PHASE
      : null;
  const roundComplete = phase === FINAL_PHASE;
  const votedSlots = roundComplete
    ? COHORT_COUNT
    : Math.max(0, phase - FIRST_VOTE_PHASE);
  const sampledValidators = useMemo(
    () => new Set(activeSlot === null ? [] : AC_SAMPLES[activeSlot]),
    [activeSlot],
  );
  const cohorts = Array.from({ length: COHORT_COUNT }, (_, index) => index);
  const stateLabel =
    phase === 0
      ? "1 · Full validator set"
      : phase === 1
        ? "2 · Split into eight slot cohorts"
        : roundComplete
          ? "Round complete · all eight cohorts voted"
          : `Slot ${activeSlot! + 1} · one FG cohort + a fresh AC sample`;

  return (
    <div
      className={`dc-voting-pattern ${phase === 0 ? "is-overview" : "is-split"} ${roundComplete ? "is-finalized" : ""}`}
      role="img"
      aria-label="The complete validator set first appears as one group, then separates into eight cohorts assigned to the eight slots of a finality round. In each slot, the assigned cohort casts finality votes while a fresh small available-chain committee is sampled from validators spread across the whole set."
    >
      <p className="dc-voting-state" aria-hidden="true">{stateLabel}</p>

      <div className="dc-cohort-field">
        {cohorts.map((cohort) => (
          <div
            className={`dc-cohort-column ${activeSlot === cohort ? "is-assigned" : ""}`}
            key={cohort}
          >
            <span>slot {cohort + 1}</span>
            <div>
              {Array.from({ length: VALIDATORS_PER_COHORT }, (_, validator) => {
                const index = cohort * VALIDATORS_PER_COHORT + validator;
                return (
                  <i
                    className={sampledValidators.has(index) ? "is-sampled" : ""}
                    key={validator}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="dc-simple-key" aria-hidden="true">
        <span><i className="is-sample" />AC: fresh sample across the full set</span>
        <span><i className="is-assignment" />FG: cohort assigned to this slot</span>
      </div>

      <div className="dc-simple-progress" aria-hidden="true">
        <span>{roundComplete ? "8 / 8 cohorts · round complete" : `${votedSlots} / 8 cohorts`}</span>
        <div>
          {cohorts.map((slot) => (
            <i
              className={`${slot < votedSlots || roundComplete ? "has-voted" : ""} ${activeSlot === slot ? "is-active" : ""}`}
              key={slot}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
