import { formatDuration } from "../lib/model";
import {
  CONFIRMATION_SLOTS,
  JUSTIFICATION_QUORUM,
  ONE_ROUND_QUORUM,
  PROTOCOL_BY_ID,
  STABILIZATION_SLOTS,
  quorumCohorts,
  type ProtocolTiming,
} from "../lib/protocols";

type Stage = {
  key: "inclusion" | "confirmation" | "wait" | "justification" | "finalization";
  label: string;
  detail: string;
  seconds: number;
  milestone: string;
};

function seconds(value: number) {
  return formatDuration(Math.round(value * 10) / 10);
}

function slotsLabel(value: number) {
  const rounded = Math.round(value * 100) / 100;
  return `${rounded} ${rounded === 1 ? "slot" : "slots"}`;
}

export function ExpertTimingDiagram({ timing }: { timing: ProtocolTiming }) {
  const protocol = PROTOCOL_BY_ID.get(timing.protocol);
  const R = timing.roundSlots;
  const J = quorumCohorts(R, JUSTIFICATION_QUORUM);
  const Q = quorumCohorts(R, ONE_ROUND_QUORUM);
  const twoRounds = timing.finalityRounds === 2;
  const decoupled = timing.protocol !== "coupled";

  if (!timing.available) {
    return (
      <figure className="finality-timing-diagram expert-timing-diagram">
        <div className="finality-timing-heading">
          <div>
            <span>Slot-accurate timing · {protocol?.shortLabel}</span>
            <h3>Transaction arrival → finality</h3>
          </div>
          <div className="finality-timing-total">
            <span>Expected total</span>
            <output>Research needed</output>
          </div>
        </div>
        <p className="timing-assumption">
          One-round finality for Rolling FFG is an open research question, so the
          model gives no number for it. Switch to two rounds to compare Rolling FFG,
          or pick a height-based design for one-round finality.
        </p>
      </figure>
    );
  }

  const stageSeconds = timing.stageSeconds;
  const waitLabel =
    timing.protocol === "dc-today"
      ? "Wait for the voting round"
      : timing.protocol === "dc-height-progress"
        ? "Wait for the next entry"
        : timing.protocol === "dc-rolling-ffg"
          ? "No wait for a target"
          : "Wait for the round boundary";
  const waitDetail =
    timing.protocol === "dc-today"
      ? `Next entry, then the round that votes it · ${slotsLabel(timing.roundLengthSlots)} per round`
      : timing.protocol === "dc-height-progress"
        ? `Heights every ${slotsLabel(timing.targetIntervalSlots)}`
        : timing.protocol === "dc-rolling-ffg"
          ? "Every slot is a checkpoint"
          : `Checkpoints every ${slotsLabel(R)}`;
  const justificationDetail =
    timing.protocol === "coupled"
      ? `A full round · ${slotsLabel(R)}`
      : `${J} of ${R} cohorts, then the next block`;
  const finalizationDetail = !twoRounds
    ? timing.protocol === "coupled"
      ? `A full round · ${slotsLabel(R)}`
      : `${Q} of ${R} cohorts, seen locally`
    : timing.protocol === "dc-today"
      ? `The next voting round’s first ${J} votes`
      : timing.protocol === "dc-rolling-ffg"
        ? `${J} lock votes, seen locally`
        : timing.protocol === "dc-height-progress"
          ? `The next height’s first ${J} votes`
          : `A full round · ${slotsLabel(R)}`;

  const stages: Stage[] = [
    {
      key: "inclusion",
      label: "Inclusion",
      detail: "Half a slot on average",
      seconds: stageSeconds.inclusion,
      milestone: "Transaction arrives",
    },
    ...(decoupled
      ? [
          {
            key: "confirmation" as const,
            label: "Fast confirmation",
            detail: `${slotsLabel(CONFIRMATION_SLOTS)} after proposal`,
            seconds: stageSeconds.confirmation,
            milestone: "Included",
          },
        ]
      : []),
    {
      key: "wait",
      label: waitLabel,
      detail: waitDetail,
      seconds: stageSeconds.wait,
      milestone: decoupled ? "Confirmed" : "Included",
    },
    ...(twoRounds
      ? [
          {
            key: "justification" as const,
            label: "Justification",
            detail: justificationDetail,
            seconds: stageSeconds.justification,
            milestone: "Voting starts",
          },
        ]
      : []),
    {
      key: "finalization",
      label: twoRounds ? "Finalization" : "One-round finalization",
      detail: finalizationDetail,
      seconds: stageSeconds.finalization,
      milestone: twoRounds ? "Justified" : "Voting starts",
    },
  ];

  return (
    <figure
      className="finality-timing-diagram expert-timing-diagram"
      aria-labelledby="expert-timing-title"
      aria-describedby="expert-timing-copy"
    >
      <div className="finality-timing-heading">
        <div>
          <span>Slot-accurate timing · expected values · {protocol?.shortLabel}</span>
          <h3 id="expert-timing-title">Transaction arrival → finality</h3>
        </div>
        <div className="finality-timing-total">
          <span>Expected total</span>
          <output aria-live="polite" aria-atomic="true">
            ≈{seconds(timing.totalSeconds)}
          </output>
        </div>
      </div>

      <div className="expert-timing-track" aria-hidden="true">
        {stages.map((stage) => (
          <div
            className={`expert-timing-stage is-${stage.key} ${stage.seconds === 0 ? "is-zero" : ""}`}
            key={stage.key}
            style={{ flexGrow: Math.max(stage.seconds, 0.001) }}
          >
            <span className="expert-timing-milestone">{stage.milestone}</span>
            <b>{stage.label}</b>
            <strong>{seconds(stage.seconds)}</strong>
            <small>{stage.detail}</small>
          </div>
        ))}
        <span className="expert-timing-finish">Finalized</span>
      </div>

      <div className="expert-timing-facts">
        <div>
          <span>Range over arrival time</span>
          <strong>
            {seconds(timing.minSeconds)} – {seconds(timing.maxSeconds)}
          </strong>
        </div>
        {timing.confirmationSeconds !== null ? (
          <div>
            <span>Expected fast confirmation</span>
            <strong>{seconds(timing.confirmationSeconds)}</strong>
          </div>
        ) : null}
        <div>
          <span>Quorum</span>
          <strong>
            {timing.protocol === "coupled" ? `${R} of ${R}` : `${timing.quorumCohorts} of ${R}`} cohorts
          </strong>
        </div>
        <div>
          <span>{timing.protocol === "dc-rolling-ffg" ? "Checkpoints" : "FG targets"}</span>
          <strong>every {slotsLabel(timing.targetIntervalSlots)}</strong>
        </div>
      </div>

      <p className="timing-assumption" id="expert-timing-copy">
        {protocol?.mechanism}{" "}
        {timing.roundLengthSlots > R
          ? `Votes take ${slotsLabel(R)}, and the ${twoRounds ? "2/3" : "5/6"} quorum needs every vote slot, so it completes in the round’s last one. The round then runs one more slot while the block that carries the quorum is confirmed, so the next round can vote it. `
          : ""}
        {!twoRounds && decoupled && Q === R
          ? `With ${slotsLabel(R)} per round, ⌈5R/6⌉ = R, so one-round finality needs every cohort of the round. `
          : ""}
        Stages are expected values for a uniformly arriving transaction and add up
        to the total.
      </p>

      <details className="method-details expert-assumptions">
        <summary>
          Expert model assumptions <span aria-hidden="true">+</span>
        </summary>
        <ul>
          <li>
            Every validator is honest and online, and every slot has a block. The
            validator set splits into one cohort per slot of the full-set round.
          </li>
          <li>
            A block is fast-confirmed {slotsLabel(CONFIRMATION_SLOTS)} after its
            proposal, and the finality gadget votes only confirmed blocks.
            Stabilization follows {slotsLabel(STABILIZATION_SLOTS)} later and does
            not gate finality.
          </li>
          <li>
            Justification and height progress are on-chain: they count once the
            next block includes the votes. Finality is seen locally as soon as the
            last needed votes are cast.
          </li>
          <li>
            Quorums count whole cohorts: ⌈2R/3⌉ to justify and ⌈5R/6⌉ for
            one-round finality.
          </li>
          <li>
            A finality pair must name a height below its vote’s height pair, and
            a target is never re-sent. A cohort that still sees a closed height
            therefore carries no finality pair, and the next height’s votes
            finalize the previous one.
          </li>
          <li>
            Finality needs only the first quorum of votes that carry it. The
            timeline also shows the later ones: DC today’s cohorts all vote from
            the round’s opening view, so the rest of the round repeats the
            finality vote, and Rolling FFG gets a full round of lock votes.
          </li>
          <li>
            DC today votes once per round from the round’s opening view. A
            round lasts long enough for its quorum to be on-chain and confirmed
            before the next round opens, so heights advance once per round. When
            the quorum needs every vote slot, the round runs one more slot.
            Height progress closes a height at its quorum, and one-round height
            progress closes it at 5/6. One-round Rolling FFG is left open.
          </li>
          <li>
            The coupled reference keeps the standard model. It has no fast
            confirmation, and a full round of votes justifies or finalizes. Its
            round wait counts whole slots: a block at a round start is voted in
            that round.
          </li>
        </ul>
      </details>
    </figure>
  );
}
