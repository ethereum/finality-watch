"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { formatDuration } from "../lib/model";
import {
  PROTOCOL_BY_ID,
  createFinalitySchedule,
  type BlockFinalityEvents,
  type ConsensusProtocolId,
  type FinalitySchedule,
  type ProtocolTiming,
} from "../lib/protocols";

type BlockStage = "proposed" | "confirmed" | "stabilized" | "justified" | "finalized";
type VoteKind =
  | "is-idle"
  | "is-vote"
  | "is-stale"
  | "is-quorum"
  | "is-quorum-later"
  | "is-finality"
  | "is-finality-later";

type TrackedTransaction = {
  slot: number;
  arrival: number;
};

type JourneyState = {
  now: number;
  tx: TrackedTransaction;
};

type JourneyStyle = CSSProperties & {
  "--journey-columns"?: number;
  "--journey-step"?: string;
  "--journey-x"?: string;
  "--journey-width"?: string;
};

type Playback = {
  stride: number;
  steps: number;
  holdSteps: number;
  tickMs: number;
};

const START_SLOT = 10_000;
const MIN_STEPS = 14;
const MAX_STEPS = 120;
const TARGET_STEPS = 90;

function stageAt(events: BlockFinalityEvents, now: number): BlockStage {
  if (events.finalizedAt <= now) return "finalized";
  if (events.justifiedAt !== null && events.justifiedAt <= now) return "justified";
  if (events.stabilizedAt !== null && events.stabilizedAt <= now) return "stabilized";
  if (events.confirmedAt !== null && events.confirmedAt <= now) return "confirmed";
  return "proposed";
}

// A journey runs until the last vote that carries its finality vote, which in
// a round-locked design comes after finality is already seen.
function journeyEndFor(events: BlockFinalityEvents) {
  return Math.max(events.finalizedAt, events.laterFinalityVotes?.[1] ?? events.finalizedAt);
}

// Arrival times are random within a slot, so offsets keep one decimal below a
// minute and whole seconds above it.
function formatOffset(seconds: number) {
  const rounded = seconds < 60 ? Math.round(seconds * 10) / 10 : Math.round(seconds);
  return rounded === 0 ? "0 sec" : `+${formatDuration(rounded)}`;
}

// Long rounds make a journey span hundreds of slots. A visual step then covers
// several slots, so the whole journey stays on screen and plays in ~15 s.
function playbackFor(maxLagSlots: number): Playback {
  const stride = Math.max(1, Math.ceil((maxLagSlots + 4) / TARGET_STEPS));
  const lagSteps = Math.ceil(maxLagSlots / stride);
  const tickMs = Math.min(1_000, Math.max(160, Math.round(15_000 / (lagSteps + 6))));
  const holdSteps = Math.min(10, Math.max(2, Math.ceil(1_800 / tickMs)));
  const steps = Math.min(MAX_STEPS, Math.max(MIN_STEPS, lagSteps + holdSteps + 3));
  return { stride, steps, holdSteps, tickMs };
}

function nextTransaction(
  now: number,
  schedule: FinalitySchedule,
  playback: Playback,
  phaseDraw: number,
  arrivalDraw: number,
): TrackedTransaction {
  // A random gap moves the next transaction to a new phase of the schedule.
  const gap = Math.floor(
    phaseDraw * Math.min(schedule.targetIntervalSlots, 12 * playback.stride),
  );
  return {
    slot: now + playback.stride + 1 + gap,
    arrival: 0.08 + arrivalDraw * 0.84,
  };
}

function advanceJourney(
  state: JourneyState,
  schedule: FinalitySchedule,
  playback: Playback,
  phaseDraw: number,
  arrivalDraw: number,
): JourneyState {
  const now = state.now + playback.stride;
  const done =
    journeyEndFor(schedule.eventsFor(state.tx.slot)) +
    playback.holdSteps * playback.stride;
  if (now < done) return { ...state, now };
  return { now, tx: nextTransaction(now, schedule, playback, phaseDraw, arrivalDraw) };
}

// Manual steps skip the frames autoplay idles on: a step forward from a
// finished journey brings in the next transaction at its arrival, and a step
// back stops at the frame where the transaction arrives.
function stepJourney(
  state: JourneyState,
  schedule: FinalitySchedule,
  playback: Playback,
  direction: 1 | -1,
  phaseDraw: number,
  arrivalDraw: number,
): JourneyState {
  const { stride } = playback;
  const { now, tx } = state;
  const end = journeyEndFor(schedule.eventsFor(tx.slot));

  if (direction === -1) {
    if (now < tx.slot) return state;
    // Every frame held after the journey ends shows the same picture, so one
    // step back goes to the last frame before the end.
    const stepsBack = now >= end ? Math.ceil((now - end + 1) / stride) : 1;
    return { ...state, now: now - stepsBack * stride };
  }
  if (now < tx.slot - stride) return { ...state, now: tx.slot - stride };
  if (now < end) return { ...state, now: now + stride };
  const next = nextTransaction(now, schedule, playback, phaseDraw, arrivalDraw);
  return { now: next.slot - stride, tx: next };
}

function JourneyLane({
  heading,
  schedule,
  slotSeconds,
  paused,
  onTogglePause,
  onPause,
}: {
  heading: ReactNode;
  schedule: FinalitySchedule;
  slotSeconds: number;
  paused: boolean;
  onTogglePause: () => void;
  onPause: () => void;
}) {
  // The window holds the longest journey, up to its last later vote; the +1
  // covers the transaction arriving up to a slot before its block.
  const longestJourneySlots = useMemo(() => {
    let longest = 0;
    for (let slot = 0; slot < schedule.targetIntervalSlots; slot += 1) {
      longest = Math.max(longest, journeyEndFor(schedule.eventsFor(slot)) - slot);
    }
    return longest + 1;
  }, [schedule]);
  const playback = useMemo(
    () => playbackFor(longestJourneySlots),
    [longestJourneySlots],
  );
  const { stride, steps, tickMs } = playback;
  const [state, setState] = useState<JourneyState>({
    now: START_SLOT - stride - 1,
    tx: { slot: START_SLOT, arrival: 0.45 },
  });
  // Set while the reader steps by hand, so a pause keeps their frame.
  const steppedRef = useRef(false);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let timer: number | null = null;

    const stop = () => {
      if (timer === null) return;
      window.clearInterval(timer);
      timer = null;
    };
    const start = () => {
      if (timer !== null || document.hidden || reducedMotion.matches || paused) return;
      timer = window.setInterval(() => {
        // A step pauses playback; a tick queued before the pause lands is dropped.
        if (steppedRef.current) return;
        const phaseDraw = Math.random();
        const arrivalDraw = Math.random();
        setState((current) =>
          advanceJourney(current, schedule, playback, phaseDraw, arrivalDraw),
        );
      }, playback.tickMs);
    };
    // A static frame shows the whole journey of one transaction.
    const showFinishedJourney = () =>
      setState((current) => ({
        ...current,
        now: Math.max(current.now, journeyEndFor(schedule.eventsFor(current.tx.slot))),
      }));
    const sync = () => {
      if (document.hidden) {
        stop();
        return;
      }
      if (reducedMotion.matches || paused) {
        stop();
        if (steppedRef.current) return;
        if (reducedMotion.matches) {
          showFinishedJourney();
          return;
        }
        // A lane paused before its transaction is included would show an
        // empty frame, so it shows the finished journey instead.
        setState((current) =>
          current.now < current.tx.slot
            ? { ...current, now: journeyEndFor(schedule.eventsFor(current.tx.slot)) }
            : current,
        );
        return;
      }
      steppedRef.current = false;
      start();
    };

    document.addEventListener("visibilitychange", sync);
    reducedMotion.addEventListener("change", sync);
    sync();
    return () => {
      stop();
      document.removeEventListener("visibilitychange", sync);
      reducedMotion.removeEventListener("change", sync);
    };
  }, [paused, playback, schedule]);

  // A step pauses playback, so the reader moves on at their own pace.
  const step = (direction: 1 | -1) => {
    steppedRef.current = true;
    const phaseDraw = Math.random();
    const arrivalDraw = Math.random();
    setState((current) =>
      stepJourney(current, schedule, playback, direction, phaseDraw, arrivalDraw),
    );
    if (!paused) onPause();
  };

  const { now, tx } = state;
  // Round boundaries follow the protocol round, which for DC today can run
  // past its vote slots.
  const R = schedule.roundLengthSlots;
  const twoRounds = schedule.finalityRounds === 2;
  const windowSlots = steps * stride;
  const firstSlot = now - windowSlots + 1;
  // One extra step on the right holds the block being built next.
  const spanSlots = windowSlots + stride;
  const percentFor = (slot: number, offset = 0.5) =>
    `${((slot - firstSlot + offset) / spanSlots) * 100}%`;
  const events = schedule.eventsFor(tx.slot);
  const arrivalAt = tx.slot - 1 + tx.arrival;
  const included = now >= tx.slot;
  const arriving = !included && now >= tx.slot - stride;
  const waiting = !included && !arriving;
  const journeyEnd = journeyEndFor(events);
  const finalized = included && now >= events.finalizedAt;
  const finished = included && now >= journeyEnd;
  const showTargets = schedule.protocol !== "dc-rolling-ffg";
  const roundBracketStart = Math.floor(now / R) * R - R;
  const showRoundBracket =
    R >= stride && R <= windowSlots - 2 * stride && roundBracketStart >= firstSlot;
  const boundaries =
    R >= stride && windowSlots / R <= 60
      ? Array.from(
          { length: Math.floor(now / R) - Math.ceil(firstSlot / R) + 1 },
          (_, index) => (Math.ceil(firstSlot / R) + index) * R,
        )
      : [];

  const within = (window: readonly [number, number] | null, slot: number) =>
    window !== null && slot >= window[0] && slot <= window[1];
  const voteKind = (slot: number): VoteKind => {
    if (!schedule.hasVote(slot)) return "is-idle";
    if (included && within(events.finalityVotes, slot)) return "is-finality";
    // With one-round finality the quorum votes are the finality votes.
    if (included && within(events.laterFinalityVotes, slot)) {
      return twoRounds ? "is-finality-later" : "is-quorum-later";
    }
    if (included && within(events.quorumVotes, slot)) return "is-quorum";
    return schedule.isStaleVote(slot) ? "is-stale" : "is-vote";
  };
  const voteRank: Record<VoteKind, number> = {
    "is-idle": 0,
    "is-stale": 1,
    "is-vote": 2,
    "is-quorum-later": 3,
    "is-quorum": 4,
    "is-finality-later": 5,
    "is-finality": 6,
  };

  // Each step shows its newest block, or the tracked block when it holds it.
  const cells = Array.from({ length: steps }, (_, index) => {
    const end = now - (steps - 1 - index) * stride;
    const start = end - stride + 1;
    const holdsTx = included && tx.slot >= start && tx.slot <= end;
    let target = false;
    let kind: VoteKind = "is-idle";
    for (let slot = start; slot <= end; slot += 1) {
      if (showTargets && schedule.isTarget(slot)) target = true;
      const slotKind = voteKind(slot);
      if (voteRank[slotKind] > voteRank[kind]) kind = slotKind;
    }
    return {
      end,
      center: (start + end) / 2,
      stage: stageAt(schedule.eventsFor(holdsTx ? tx.slot : end), now),
      holdsTx,
      target,
      kind,
    };
  });

  const milestones = [
    { key: "arrival", label: "Arrives", at: arrivalAt },
    { key: "included", label: "Included", at: tx.slot },
    ...(events.confirmedAt !== null
      ? [{ key: "confirmed", label: "Confirmed", at: events.confirmedAt }]
      : []),
    // A block finalized before its stabilization slot needs no stabilization.
    ...(events.stabilizedAt !== null && events.stabilizedAt < events.finalizedAt
      ? [{ key: "stabilized", label: "Stabilized", at: events.stabilizedAt }]
      : []),
    { key: "voting", label: "First vote for its target", at: events.votingStartsAt },
    ...(events.justifiedAt !== null
      ? [{ key: "justified", label: "Justified", at: events.justifiedAt }]
      : []),
    { key: "finalized", label: "Finalized", at: events.finalizedAt },
    ...(events.laterFinalityVotes !== null
      ? [{ key: "last-vote", label: "Last finality vote", at: events.laterFinalityVotes[1] }]
      : []),
  ].sort((a, b) => a.at - b.at);
  // The arrival frame shows the transaction arriving, so it counts as reached.
  const isReached = (milestone: { key: string; at: number }) =>
    !waiting && (milestone.key === "arrival" || now >= milestone.at);
  const journeySlots = Math.max(...milestones.map((milestone) => milestone.at)) - arrivalAt;
  const elapsedSlots = Math.min(journeySlots, Math.max(0, now - arrivalAt));
  const journeyStyle: JourneyStyle = {
    "--journey-width": `${(elapsedSlots / journeySlots) * 100}%`,
  };
  // The coupled reference counts a whole round; the decoupled designs a quorum.
  const quorumVotesNeeded = events.quorumVotes[1] - events.quorumVotes[0] + 1;
  const quorumVotesCast = Math.min(
    quorumVotesNeeded,
    Math.max(0, now - events.quorumVotes[0] + 1),
  );
  const finalityVotesNeeded = events.finalityVotes
    ? events.finalityVotes[1] - events.finalityVotes[0] + 1
    : 0;
  const finalityVotesCast = events.finalityVotes
    ? Math.min(finalityVotesNeeded, Math.max(0, now - events.finalityVotes[0] + 1))
    : 0;
  const laterVotes = events.laterFinalityVotes;
  const laterVotesTotal = laterVotes ? laterVotes[1] - laterVotes[0] + 1 : 0;
  const laterVotesCast = laterVotes
    ? Math.min(laterVotesTotal, Math.max(0, now - laterVotes[0] + 1))
    : 0;

  let status: string;
  if (waiting) status = "Waiting for the next transaction.";
  else if (arriving) status = "The transaction arrives; the next block includes it.";
  else if (finished) {
    status = `Finalized ${formatOffset((events.finalizedAt - arrivalAt) * slotSeconds).slice(1)} after arrival.${
      paused ? " Step brings in the next transaction." : ""
    }`;
  } else if (finalized) {
    // The rest of the round still sends the finality vote.
    status = `Finalized at ${formatOffset((events.finalizedAt - arrivalAt) * slotSeconds)}. Later ${
      schedule.protocol === "dc-rolling-ffg" ? "lock" : "finality"
    } votes: ${laterVotesCast} of ${laterVotesTotal}.`;
  } else if (events.confirmedAt !== null && now < events.confirmedAt) {
    status = "Included. The available chain confirms the block by the end of its slot.";
  } else if (now < events.votingStartsAt) {
    const reached =
      events.stabilizedAt !== null && now >= events.stabilizedAt ? "Stabilized" : "Confirmed";
    status =
      schedule.protocol === "dc-today"
        ? `${reached}. Waiting for the round that votes the target covering it.`
        : schedule.protocol === "dc-height-progress"
          ? `${reached}. Waiting for the next height’s entry to be confirmed.`
          : "Waiting for the round-boundary checkpoint.";
  } else if (events.justifiedAt === null || now < events.justifiedAt) {
    status = `Votes for its target: ${quorumVotesCast} of ${quorumVotesNeeded} cohorts${
      twoRounds ? " needed to justify" : " needed to finalize"
    }.`;
  } else {
    status = `Justified. ${schedule.protocol === "dc-rolling-ffg" ? "Lock" : "Finality"} votes: ${finalityVotesCast} of ${finalityVotesNeeded}.`;
  }

  // Time since arrival, from inclusion until finality.
  const clock =
    included && !finished ? formatOffset((now - arrivalAt) * slotSeconds) : null;
  const stepSize = stride === 1 ? "one slot" : `${stride} slots`;
  const canStepBack = included;

  const speed = Math.round((stride * slotSeconds * 1_000) / tickMs);
  const laneStyle: JourneyStyle = {
    "--journey-columns": steps + 1,
    "--journey-step": `${Math.min(320, tickMs - 40)}ms`,
  };

  return (
    <>
      <div className="journey-heading">
        {heading}
        <div aria-label="Timeline playback" className="journey-controls" role="group">
          {/* aria-disabled keeps focus on the button at the first frame. */}
          <button
            aria-disabled={!canStepBack}
            aria-label={`Step back ${stepSize}`}
            className="motion-control-button journey-step-button"
            onClick={() => {
              if (canStepBack) step(-1);
            }}
            type="button"
          >
            <span aria-hidden="true">‹</span> Back
          </button>
          <button
            aria-pressed={paused}
            className="motion-control-button"
            onClick={onTogglePause}
            type="button"
          >
            {paused ? "Resume" : "Pause"}
          </button>
          <button
            aria-label={finished ? "Step to the next transaction" : `Step forward ${stepSize}`}
            className="motion-control-button journey-step-button"
            onClick={() => step(1)}
            type="button"
          >
            Step <span aria-hidden="true">›</span>
          </button>
        </div>
      </div>

      <div className="journey">
        <div className="journey-lane" style={laneStyle} aria-hidden="true">
          {showRoundBracket ? (
            <span
              className="journey-round-bracket"
              style={{
                left: percentFor(roundBracketStart, 0),
                width: `${(R / spanSlots) * 100}%`,
              }}
            >
              <span>
                1 round · {R} {R === 1 ? "slot" : "slots"} · {formatDuration(R * slotSeconds)}
              </span>
            </span>
          ) : null}
          {boundaries.map((slot) => (
            <span
              className="journey-boundary"
              key={`boundary-${slot}`}
              style={{ left: percentFor(slot, 0) }}
            />
          ))}
          <span className="journey-rail" />
          {cells.map((cell) => (
            <span
              className={`journey-block is-${cell.stage} ${cell.holdsTx ? "is-tracked" : ""}`}
              key={cell.end}
              style={{ "--journey-x": percentFor(cell.center) } as JourneyStyle}
            >
              <span className="journey-block-face" />
              {cell.target ? <span className="journey-target" /> : null}
              {cell.holdsTx ? <span className="journey-tx-tag">tx</span> : null}
            </span>
          ))}
          <span
            className={`journey-next ${arriving ? "is-arriving" : ""}`}
            style={{ "--journey-x": percentFor(now + (stride + 1) / 2) } as JourneyStyle}
          >
            {arriving ? <span className="journey-tx-tag">tx</span> : null}
          </span>
          {cells.map((cell) => (
            <span
              className={`journey-vote ${cell.kind}`}
              key={`vote-${cell.end}`}
              style={{ "--journey-x": percentFor(cell.center) } as JourneyStyle}
            />
          ))}
        </div>

        <p aria-hidden="true" className="journey-status">
          {clock ? <span className="journey-clock">{clock}</span> : null}
          {clock ? " " : null}
          {status}
        </p>
        {/* Screen readers hear the status only while paused, as the reader steps;
            the region stays in place so the first step is announced too. */}
        <p aria-live="polite" className="sr-only">
          {paused ? `${clock ? `${clock} · ` : ""}${status}` : ""}
        </p>

        <div className="journey-track" aria-hidden="true">
          <span className="journey-track-fill" style={journeyStyle} />
          {milestones.map((milestone) => (
            <span
              className={`journey-track-dot is-${milestone.key} ${isReached(milestone) ? "is-reached" : ""}`}
              key={milestone.key}
              style={{
                left: `${((milestone.at - arrivalAt) / journeySlots) * 100}%`,
              }}
            />
          ))}
        </div>
        <ol className="journey-milestones">
          {milestones.map((milestone) => (
            <li
              className={`is-${milestone.key} ${isReached(milestone) ? "is-reached" : ""}`}
              key={milestone.key}
            >
              <span>{milestone.label}</span>
              <strong>{formatOffset((milestone.at - arrivalAt) * slotSeconds)}</strong>
            </li>
          ))}
        </ol>
        <p className="journey-playback">
          {stride === 1
            ? `One step = one ${slotSeconds}-second slot`
            : `One step = ${stride} slots (${formatDuration(stride * slotSeconds)}); times stay slot-exact`}{" "}
          ·{" "}
          {paused
            ? "paused: Back and Step move one step at a time"
            : speed < 2
              ? "shown at about real time"
              : `shown ${speed}× faster than real time`}
        </p>
      </div>
    </>
  );
}

export function TransactionJourney({
  protocol,
  roundSlots,
  slotSeconds,
  finalityRounds,
  timing,
  paused,
  onTogglePause,
  onPause,
}: {
  protocol: ConsensusProtocolId;
  roundSlots: number;
  slotSeconds: number;
  finalityRounds: 1 | 2;
  timing: ProtocolTiming;
  paused: boolean;
  onTogglePause: () => void;
  onPause: () => void;
}) {
  const schedule = useMemo(
    () => createFinalitySchedule(protocol, roundSlots, finalityRounds),
    [finalityRounds, protocol, roundSlots],
  );
  const definition = PROTOCOL_BY_ID.get(protocol);
  const extraSlots = timing.roundLengthSlots - timing.roundSlots;
  // Every block of a schedule has the same structure, so any block tells.
  const hasLaterVotes = schedule?.eventsFor(0).laterFinalityVotes != null;
  const hasStaleVotes = schedule
    ? Array.from(
        { length: schedule.targetIntervalSlots + schedule.roundSlots },
        (_, slot) => schedule.isStaleVote(slot),
      ).some(Boolean)
    : false;
  const heading = (
    <div>
      <span>Slot-accurate timeline</span>
      <h2 id="journey-title">One transaction, arrival to finality</h2>
      <p>
        {definition?.label} · {timing.roundLengthSlots}-slot rounds
        {extraSlots > 0
          ? ` (votes take ${timing.roundSlots} ${timing.roundSlots === 1 ? "slot" : "slots"}; the round’s last block carries the quorum and is confirmed before the next round)`
          : ""}{" "}
        · {slotSeconds}-second slots ·{" "}
        {finalityRounds === 1 ? "one-round" : "two-round"} finality
      </p>
    </div>
  );

  return (
    <section
      aria-labelledby="journey-title"
      className="journey-section"
      id="transaction-journey"
    >
      {/* The lane owns the playback state, so it renders the heading with its controls. */}
      {schedule ? (
        <JourneyLane
          heading={heading}
          key={`${protocol}-${schedule.roundSlots}-${finalityRounds}-${slotSeconds}`}
          onPause={onPause}
          onTogglePause={onTogglePause}
          paused={paused}
          schedule={schedule}
          slotSeconds={slotSeconds}
        />
      ) : (
        <>
          <div className="journey-heading">{heading}</div>
          <p className="journey-research">
            One-round finality for Rolling FFG is an open research question, so this
            view has no schedule to animate. Two-round Rolling FFG is modeled.
          </p>
        </>
      )}

      {schedule ? (
        <div className="journey-key" aria-hidden="true">
          <span><i className="is-proposed" />proposed</span>
          {protocol !== "coupled" ? (
            <>
              <span><i className="is-confirmed" />confirmed</span>
              <span><i className="is-stabilized" />stabilized</span>
            </>
          ) : null}
          {finalityRounds === 2 ? <span><i className="is-justified" />justified</span> : null}
          <span><i className="is-finalized" />finalized</span>
          {protocol !== "dc-rolling-ffg" ? (
            <span><i className="is-target" />FG target</span>
          ) : null}
          <span><i className="is-quorum-vote" />votes that {finalityRounds === 2 ? "justify" : "finalize"} the tx</span>
          {finalityRounds === 2 ? (
            <span><i className="is-finality-vote" />votes that finalize it</span>
          ) : null}
          {hasLaterVotes ? (
            <span>
              <i className={finalityRounds === 2 ? "is-finality-later-vote" : "is-quorum-later-vote"} />
              later finality votes
            </span>
          ) : null}
          {hasStaleVotes ? (
            <span><i className="is-stale-vote" />vote that counts toward nothing</span>
          ) : null}
          {extraSlots > 0 ? (
            <span><i className="is-idle-vote" />no new votes: this block carries the quorum</span>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
