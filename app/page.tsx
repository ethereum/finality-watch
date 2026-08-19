"use client";

import { useEffect, useMemo, useState } from "react";
import {
  MAX_ASSIGNED_ATTESTERS_PER_SLOT,
  MIN_SCENARIO_VALIDATORS,
  REFERENCE_ATTESTERS_PER_SLOT,
  REFERENCE_ROUND_SECONDS,
  REFERENCE_VALIDATORS,
  DECENTRALIZATION_FLOOR_SECONDS,
  SLOT_SECONDS,
  calculateFinalityTiming,
  calculateRoundImprovementGain,
  calculateRoundModel,
  formatCompactCount,
  formatDuration,
  type FinalityTiming,
  type RoundImprovementId,
} from "./lib/model";
import { DcPipeline } from "./components/DcPipeline";
import { DcVotingPattern } from "./components/DcVotingPattern";
import {
  DEFAULT_ROUND_IMPROVEMENTS,
  LOCAL_EIP_SNAPSHOT,
  PROPOSALS,
  PROPOSAL_LAST_CHECKED,
  ROUND_IMPROVEMENTS,
  type ProposalId,
} from "./lib/proposals";
import networkSnapshot from "./data/network-snapshot.json";

const numberFormatter = new Intl.NumberFormat("en-US");
const rawRoundEquation = `${REFERENCE_ROUND_SECONDS}s × identities ÷ ${formatCompactCount(REFERENCE_VALIDATORS)} ÷ stacked gain`;
const displayedRoundEquation = `ceil(max(${DECENTRALIZATION_FLOOR_SECONDS}s, raw) ÷ slot) × slot`;

type ControlHelpPlacement = "networking" | "rounds" | "slot" | "chart";
type ControlHelpTone = "leaf" | "teal" | "clay";

type ControlHelpDefinition = {
  id: string;
  label: string;
  eyebrow: string;
  meta: string;
  description: string;
  modelEffect: string;
  caution: string;
  placement: ControlHelpPlacement;
  tone: ControlHelpTone;
  proposalId?: ProposalId;
  sourceUrl?: string;
};

function proposalHelp(
  id: string,
  proposalId: ProposalId,
  placement: ControlHelpPlacement,
  tone: ControlHelpTone,
): ControlHelpDefinition {
  const proposal = PROPOSALS.find((candidate) => candidate.id === proposalId);

  if (!proposal) {
    throw new Error(`Missing proposal help content for ${proposalId}`);
  }

  return {
    id,
    label: proposal.title,
    eyebrow: proposal.eip ? `Model note · EIP-${proposal.eip}` : "Model note · Research",
    meta: proposal.statusLabel,
    description: proposal.summary,
    modelEffect: proposal.plotEffect,
    caution: proposal.caution,
    placement,
    tone,
    proposalId,
    sourceUrl: proposal.sourceUrl,
  };
}

const CONTROL_HELP_ITEMS: readonly ControlHelpDefinition[] = [
  proposalHelp("improvement-dc", "dc", "networking", "leaf"),
  proposalHelp(
    "improvement-eip-8334",
    "eip-8334",
    "networking",
    "teal",
  ),
  proposalHelp(
    "improvement-eip-8243",
    "eip-8243",
    "networking",
    "clay",
  ),
  {
    id: "networking",
    label: "Round networking",
    eyebrow: "Model note · Combined gain",
    meta: "Exploratory stack",
    description:
      "The active value combines the assumed increase in full-set vote throughput from every enabled networking change, compared with today at the same validator count.",
    modelEffect:
      "Selected gains multiply before the four-second decentralization floor and whole-slot rounding. Consolidation and slot time are handled separately.",
    caution:
      "The stacked result is an exploratory scenario, not a jointly measured performance prediction.",
    placement: "networking",
    tone: "leaf",
  },
  proposalHelp(
    "finality-rounds",
    "one-round-finality",
    "rounds",
    "teal",
  ),
  proposalHelp("slot-time", "eip-8198", "slot", "teal"),
  proposalHelp(
    "validator-consolidation",
    "eip-7251",
    "chart",
    "leaf",
  ),
];

const CONTROL_HELP_BY_ID = new Map(
  CONTROL_HELP_ITEMS.map((item) => [item.id, item]),
);

function formatObservedAt(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(new Date(value));
}

function ExternalArrow() {
  return <span aria-hidden="true">↗</span>;
}

function formatGain(value: number) {
  return `${Number.isInteger(value) ? value : value.toFixed(1)}×`;
}

function Approximate({ value }: { value: string }) {
  return (
    <span className="approximate-value">
      <span className="sr-only">approximately </span>
      <span aria-hidden="true" className="approximation-mark">≈</span>
      <span>{value}</span>
    </span>
  );
}

const proposalHighlightTimers = new Map<ProposalId, number>();

function revealProposal(proposalId: ProposalId) {
  const target = document.getElementById(`proposal-${proposalId}`);
  if (!target) return;

  const disclosure = target.querySelector("details");
  if (disclosure instanceof HTMLDetailsElement) disclosure.open = true;

  const existingTimer = proposalHighlightTimers.get(proposalId);
  if (existingTimer) window.clearTimeout(existingTimer);

  target.classList.remove("is-referenced");
  void target.offsetWidth;
  target.classList.add("is-referenced");
  target.focus({ preventScroll: true });
  target.scrollIntoView({
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "auto"
      : "smooth",
    block: "center",
  });

  proposalHighlightTimers.set(
    proposalId,
    window.setTimeout(() => {
      target.classList.remove("is-referenced");
      proposalHighlightTimers.delete(proposalId);
    }, 1_800),
  );
}

function ControlHelpTrigger({
  helpId,
  isOpen,
  onToggle,
  triggerLabel = "More info",
}: {
  helpId: string;
  isOpen: boolean;
  onToggle: () => void;
  triggerLabel?: string;
}) {
  const panelId = `control-help-panel-${helpId}`;

  return (
    <button
      aria-controls={panelId}
      aria-expanded={isOpen}
      aria-label={triggerLabel}
      className="info-surface-trigger"
      id={`control-help-trigger-${helpId}`}
      onClick={onToggle}
      title={triggerLabel}
      type="button"
    >
      <i aria-hidden="true">i</i>
    </button>
  );
}

function ControlHelpPanel({
  help,
  onClose,
}: {
  help: ControlHelpDefinition;
  onClose: (restoreFocus?: boolean) => void;
}) {
  const panelId = `control-help-panel-${help.id}`;
  const titleId = `control-help-title-${help.id}`;

  return (
    <section
      aria-labelledby={titleId}
      className={`control-help-panel tone-${help.tone} placement-${help.placement}`}
      id={panelId}
      role="region"
    >
      <div className="control-help-panel-heading">
        <div>
          <span className="control-help-eyebrow">{help.eyebrow}</span>
          <h3 id={titleId}>{help.label}</h3>
        </div>
        <span className="control-help-meta">{help.meta}</span>
        <button
          aria-label={`Close ${help.label} note`}
          className="control-help-close"
          onClick={() => onClose(true)}
          type="button"
        >
          <span>Close</span>
          <i aria-hidden="true">×</i>
        </button>
      </div>

      <div className="control-help-panel-content">
        <div className="control-help-summary">
          <span>What it changes</span>
          <p>{help.description}</p>
        </div>
        <div className="control-help-model-effect">
          <span>Effect in this model</span>
          <p>{help.modelEffect}</p>
        </div>
      </div>

      <div className="control-help-footer">
        <p>
          <strong>Keep in mind</strong>
          {help.caution}
        </p>
        {help.proposalId && help.sourceUrl ? (
          <div className="control-help-actions">
            <a
              className="proposal-jump"
              href={`#proposal-${help.proposalId}`}
              onClick={() => {
                onClose(false);
                revealProposal(help.proposalId as ProposalId);
              }}
            >
              Find in proposal tracker <span aria-hidden="true">↓</span>
            </a>
            <a href={help.sourceUrl} target="_blank" rel="noreferrer">
              Open source <ExternalArrow />
            </a>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function FinalityTimingDiagram({ timing }: { timing: FinalityTiming }) {
  const votingRounds = Array.from(
    { length: timing.finalityRounds },
    (_, index) => index + 1,
  );

  return (
    <figure
      className="finality-timing-diagram"
      aria-labelledby="finality-timing-title"
      aria-describedby="finality-explainer-copy"
    >
      <div className="finality-timing-heading">
        <div>
          <span>Dynamic timing diagram · schematic widths</span>
          <h3 id="finality-timing-title">Transaction arrival → finality</h3>
        </div>
        <div className="finality-timing-total">
          <span>Expected total</span>
          <output aria-live="polite" aria-atomic="true">
            <Approximate value={formatDuration(timing.totalSeconds)} />
          </output>
        </div>
      </div>

      <div className="finality-timing-visual" aria-hidden="true">
        <div className="finality-timing-track">
          <div
            className="finality-timing-stage is-pre-vote"
            style={{ flexGrow: timing.expectedPreVotingSeconds }}
          >
            <span className="finality-timing-milestone">
              Transaction arrives
            </span>
            <div className="finality-timing-stage-heading">
              <span>Expected wait to voting</span>
              <strong>{formatDuration(timing.expectedPreVotingSeconds)}</strong>
            </div>
            <div className="finality-timing-pre-vote-split">
              <span
                className="is-inclusion"
                style={{ flexGrow: timing.expectedInclusionSeconds }}
              >
                <b>Inclusion</b>
                <em>{formatDuration(timing.expectedInclusionSeconds)}</em>
              </span>
              <span
                className="is-round-wait"
                style={{ flexGrow: timing.expectedFinalityGadgetWaitSeconds }}
              >
                <b>Wait for finality-gadget input</b>
                <em>
                  {formatDuration(timing.expectedFinalityGadgetWaitSeconds)}
                </em>
              </span>
            </div>
            <small>Block enters finality-gadget round</small>
          </div>

          {votingRounds.map((round) => (
            <div
              className="finality-timing-stage is-voting"
              key={round}
              style={{ flexGrow: timing.roundSeconds }}
            >
              <span className="finality-timing-milestone">
                {round === 1
                  ? "Voting starts"
                  : round === 2
                    ? "Justification"
                    : `Round ${round - 1} complete`}
              </span>
              <div className="finality-timing-stage-heading">
                <span>Voting round {round}</span>
                <strong>{formatDuration(timing.roundSeconds)}</strong>
              </div>
              <div
                className="finality-timing-slot-grid"
                style={{ backgroundSize: `${100 / timing.roundSlots}% 100%` }}
              >
                <span>
                  {timing.roundSlots} {timing.roundSlots === 1 ? "slot" : "slots"}
                </span>
              </div>
              <small>
                {round === timing.finalityRounds
                  ? "Finality reached"
                  : `Voting round ${round + 1} begins`}
              </small>
            </div>
          ))}
          <span className="finality-timing-finish">Finality</span>
        </div>
      </div>

      <p className="sr-only" id="finality-explainer-copy">
        A transaction waits an expected{" "}
        {formatDuration(timing.expectedInclusionSeconds)} for inclusion and{" "}
        an independent half-round wait of{" "}
        {formatDuration(timing.expectedFinalityGadgetWaitSeconds)} before the
        block becomes input to the finality gadget. Together those
        waits take {formatDuration(timing.expectedPreVotingSeconds)} on average.
        Then{" "}
        {timing.finalityRounds} voting{" "}
        {timing.finalityRounds === 1 ? "round" : "rounds"} of{" "}
        {formatDuration(timing.roundSeconds)} each. {timing.finalityRounds > 1
          ? "The first completed voting round marks justification. "
          : ""}
        Expected finality arrives in{" "}
        {formatDuration(timing.totalSeconds)}.
      </p>
    </figure>
  );
}

function MethodologySection() {
  return (
    <section
      className="methodology-section"
      id="methodology"
      aria-labelledby="methodology-title"
    >
      <h2 className="sr-only" id="methodology-title">Methodology</h2>

      <details className="methodology-disclosure">
        <summary>
          <span className="methodology-summary-copy">
            <span className="methodology-summary-kicker">Methodology</span>
            <strong>Simplified model—not a forecast.</strong>
            <small>
              Safe parameters still depend on protocol and network conditions.
            </small>
          </span>
          <span className="methodology-summary-action">
            View details <i aria-hidden="true">+</i>
          </span>
        </summary>
        <div className="methodology-content">
          <div className="equation" aria-label="Model equation">
            <div>
              <span>Raw full-set round</span>
              <strong>{rawRoundEquation}</strong>
            </div>
            <span className="equation-arrow" aria-hidden="true">→</span>
            <div>
              <span>Displayed round time</span>
              <strong>{displayedRoundEquation}</strong>
            </div>
          </div>
          <p className="equation-note">
            DC contributes an optimistic 4× gain, bundled propagation 2×, and
            source batching 1–2× depending on validator count. Selected gains
            multiply in this simplified scenario. Slot length never changes
            the raw finality-vote throughput.
          </p>

          <div className="capacity-facts" aria-label="Capacity reference points">
            <div>
              <span>Historical workload reference</span>
              <strong>{numberFormatter.format(REFERENCE_ATTESTERS_PER_SLOT)}</strong>
              <small>assigned attesters per current slot · 1.1M ÷ 32</small>
            </div>
            <div>
              <span>Structural ceiling</span>
              <strong>{numberFormatter.format(MAX_ASSIGNED_ATTESTERS_PER_SLOT)}</strong>
              <small>64 committees × 2,048 seats · not measured throughput</small>
            </div>
            <div>
              <span>Decentralization floor</span>
              <strong>{DECENTRALIZATION_FLOOR_SECONDS} sec</strong>
              <small>
                Assumed guardrail for geographic fairness and reasonable node
                requirements—not a measured limit
              </small>
            </div>
          </div>

          <div
            className="slot-phase-model"
            aria-label="Current 12-second slot timing reference"
          >
            <span>Current 12-second slot</span>
            <div>
              <strong>0–4s</strong>
              <small>block propagation + vote target</small>
            </div>
            <div>
              <strong>4–8s</strong>
              <small>attestation propagation + aggregation</small>
            </div>
            <div>
              <strong>8–12s</strong>
              <small>global aggregate propagation</small>
            </div>
          </div>

          <div
            className="finality-method-equation"
            aria-label="Expected time-to-finality equation"
          >
            <span>Expected time to finality</span>
            <strong>½ slot + ½ finality-gadget round + rounds × round</strong>
          </div>

          <details className="method-details">
            <summary>
              Assumptions and limits <span aria-hidden="true">+</span>
            </summary>
            <div className="methodology-grid">
              <div>
                <h3>The model assumes</h3>
                <ul>
                  <li>Workload scales linearly with active validator-identity count.</li>
                  <li>A rounded 1.1M-validator, 32-slot epoch is the fixed capacity reference.</li>
                  <li>Shorter slots change slot count and inclusion, not raw FG throughput.</li>
                  <li>
                    Full-set round duration rounds up to whole slots after the
                    four-second decentralization floor.
                  </li>
                  <li>
                    Transactions arrive uniformly, giving an expected half-slot
                    inclusion wait.
                  </li>
                  <li>
                    After block inclusion, input to the finality gadget has an
                    independent, uniformly phased half-round expected wait.
                  </li>
                  <li>
                    The block is confirmed and eligible when it becomes a
                    finality-gadget input; no separate confirmation delay is added.
                  </li>
                  <li>Stake weight is preserved as identities consolidate.</li>
                  <li>
                    The four-second floor is a decentralization guardrail for
                    geographic fairness and reasonable node requirements, not a
                    measured network limit.
                  </li>
                  <li>Enabled networking gains multiply before that floor.</li>
                </ul>
              </div>
              <div>
                <h3>It does not model</h3>
                <ul>
                  <li>Safety, recovery, or adversary thresholds of a specific finality gadget.</li>
                  <li>Censorship, fee competition, builder delay, or non-uniform transaction arrival.</li>
                  <li>
                    Peer topology, loss, geographic latency, or client limits;
                    the floor is a guardrail rather than a simulation of them.
                  </li>
                  <li>Committee security, aggregation, safety, or liveness.</li>
                  <li>The exact historical validator-count record or raw gossip message count.</li>
                  <li>Measured interactions between DC, EIP-8334, and EIP-8243.</li>
                  <li>Shadow simulation output; that series remains reserved.</li>
                </ul>
              </div>
            </div>
          </details>

          <details className="source-details">
            <summary>
              Sources and further reading <span aria-hidden="true">+</span>
            </summary>
            <div className="source-content">
              <p>
                The validator count is a manually refreshed network snapshot used only
                as a chart marker. The model uses 1.1M as a rounded historical-high
                workload scenario, not an exact record. Proposal wording was checked
                against the local EIP and EthResearch corpora.
              </p>
              <div className="source-links">
                <a href="https://ethresear.ch/t/lmd-ghost-with-256-validators-and-a-fast-following-finality-gadget/22856" target="_blank" rel="noreferrer">Mainnet attestation workload <ExternalArrow /></a>
                <a href="https://ethresear.ch/t/unblocking-faster-finality-with-decoupled-consensus/24527" target="_blank" rel="noreferrer">Decoupled consensus <ExternalArrow /></a>
                <a href="https://eips.ethereum.org/EIPS/eip-8198" target="_blank" rel="noreferrer">EIP-8198 · Quick Slots <ExternalArrow /></a>
                <a href="https://eips.ethereum.org/EIPS/eip-8243" target="_blank" rel="noreferrer">EIP-8243 · source batching <ExternalArrow /></a>
                <a href="https://ethereum-magicians.org/t/eip-8334-bundled-attestation-propagation/29008" target="_blank" rel="noreferrer">EIP-8334 · bundled propagation <ExternalArrow /></a>
                <a href="https://strawmap.org/" target="_blank" rel="noreferrer">Strawmap roadmap <ExternalArrow /></a>
                <a href="https://pectrified.com/mainnet" target="_blank" rel="noreferrer">Pectrified analytics <ExternalArrow /></a>
                <a href="https://beaconscan.com/validator" target="_blank" rel="noreferrer">Beaconscan validators <ExternalArrow /></a>
                <a href="https://docs.beaconcha.in/api-reference/epochs/epoch-overview" target="_blank" rel="noreferrer">Beaconcha.in epoch API <ExternalArrow /></a>
              </div>
            </div>
          </details>
        </div>
      </details>
    </section>
  );
}

function ProposalTrackerSection() {
  return (
    <section
      className="pathways-section"
      id="pathways"
      aria-labelledby="pathways-title"
    >
      <div className="section-heading pathway-heading">
        <h2 id="pathways-title">Relevant Proposals</h2>
      </div>

      <div className="proposal-tracker-heading">
        <div>
          <p>Proposal tracker</p>
          <span>
            Local EIP snapshot {LOCAL_EIP_SNAPSHOT} · reviewed{" "}
            {PROPOSAL_LAST_CHECKED}
          </span>
        </div>
        <a href="https://strawmap.org/" target="_blank" rel="noreferrer">
          Open Strawmap <ExternalArrow />
        </a>
      </div>

      <div className="proposal-tracker" role="list">
        {PROPOSALS.map((proposal) => {
          const roleLabel =
            proposal.role === "curve"
              ? "Adds a curve"
              : proposal.role === "finality"
                ? proposal.id === "eip-8198"
                  ? "Changes slot timing"
                  : "Changes finality rounds"
                : proposal.role === "x-axis"
                  ? "Moves along x"
                  : "Changes arrival time";

          return (
            <article
              className={`proposal-row role-${proposal.role}`}
              id={`proposal-${proposal.id}`}
              key={proposal.id}
              role="listitem"
              tabIndex={-1}
            >
              <div className="proposal-identity">
                <span>{proposal.eip ? `EIP-${proposal.eip}` : "Research"}</span>
                <strong>{proposal.title}</strong>
              </div>
              <div className="proposal-effect">
                <details>
                  <summary>Why it matters <span aria-hidden="true">+</span></summary>
                  <p>{proposal.effect}</p>
                  <small>{proposal.plotNote}</small>
                </details>
              </div>
              <div className="proposal-meta">
                <span>{roleLabel}</span>
                <small>{proposal.statusLabel}</small>
                <small>{proposal.roadmap}</small>
              </div>
              <a
                className="proposal-link"
                href={proposal.sourceUrl}
                target="_blank"
                rel="noreferrer"
                aria-label={`Read ${proposal.eip ?? proposal.title}`}
              >
                Source <ExternalArrow />
              </a>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export default function Home() {
  const network = networkSnapshot;
  const [scenarioValidators, setScenarioValidators] = useState(128_000);
  const [enabledImprovementIds, setEnabledImprovementIds] = useState<
    RoundImprovementId[]
  >([...DEFAULT_ROUND_IMPROVEMENTS]);
  const [openControlHelpId, setOpenControlHelpId] = useState<string | null>(null);
  const [showFinalityExplainer, setShowFinalityExplainer] = useState(false);
  const [slotSeconds, setSlotSeconds] = useState(SLOT_SECONDS);
  const [oneRoundFinality, setOneRoundFinality] = useState(false);
  const [animationsPaused, setAnimationsPaused] = useState(false);

  useEffect(() => {
    if (!openControlHelpId) return;

    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpenControlHelpId(null);
      document
        .getElementById(`control-help-trigger-${openControlHelpId}`)
        ?.focus();
    };

    document.addEventListener("keydown", dismissOnEscape);

    return () => {
      document.removeEventListener("keydown", dismissOnEscape);
    };
  }, [openControlHelpId]);

  const model = useMemo(
    () =>
      calculateRoundModel({
        validators: scenarioValidators,
        slotSeconds,
        enabledImprovements: enabledImprovementIds,
        finalityRounds: oneRoundFinality ? 1 : 2,
      }),
    [enabledImprovementIds, oneRoundFinality, scenarioValidators, slotSeconds],
  );

  const presets = [
    { label: "Snapshot", shortLabel: "Snapshot", value: network.activeValidators },
    { label: "128k target", shortLabel: "128k", value: 128_000 },
    { label: "16k scenario", shortLabel: "16k", value: 16_000 },
  ];

  const chart = {
    width: 920,
    height: 360,
    left: 78,
    right: 30,
    top: 30,
    bottom: 56,
  };
  const plotWidth = chart.width - chart.left - chart.right;
  const plotHeight = chart.height - chart.top - chart.bottom;
  const scenarioMaximum = Math.max(
    REFERENCE_VALIDATORS,
    network.activeValidators,
  );
  const domainBaseline = calculateRoundModel({
    validators: scenarioMaximum,
    slotSeconds: SLOT_SECONDS,
    enabledImprovements: [],
  });
  const maximumRoundSeconds = Math.max(
    REFERENCE_ROUND_SECONDS,
    domainBaseline.roundSeconds,
  );
  const roundTimeTicks = Array.from(
    new Set(
      [0, 1, 2, 3, 4].map((index) =>
        Math.round((maximumRoundSeconds * index) / 4 / SLOT_SECONDS) *
        SLOT_SECONDS,
      ),
    ),
  );
  const maximumReduction =
    1 - MIN_SCENARIO_VALIDATORS / scenarioMaximum;
  const reductionFor = (validators: number) =>
    1 - validators / scenarioMaximum;
  const xForReduction = (reduction: number) =>
    chart.left +
    (reduction / Math.max(maximumReduction, 0.001)) * plotWidth;
  const xFor = (validators: number) => xForReduction(reductionFor(validators));
  const yFor = (seconds: number) =>
    chart.top +
    plotHeight -
    (seconds / maximumRoundSeconds) * plotHeight;
  const selectedX = xFor(model.validators);
  const currentX = xFor(network.activeValidators);
  const currentY = yFor(REFERENCE_ROUND_SECONDS);
  const maximumX = xFor(MIN_SCENARIO_VALIDATORS);
  const reference128kX = xFor(128_000);
  const validatorTicks = Array.from(
    new Set([
      scenarioMaximum,
      network.activeValidators,
      640_000,
      384_000,
      128_000,
      MIN_SCENARIO_VALIDATORS,
    ]),
  )
    .filter(
      (validators) =>
        validators <= scenarioMaximum &&
        validators >= MIN_SCENARIO_VALIDATORS,
    )
    .sort((a, b) => b - a);
  const enabledImprovements = ROUND_IMPROVEMENTS.filter((improvement) =>
    enabledImprovementIds.includes(improvement.id),
  );
  const curveStages = enabledImprovements.map((improvement, index) => {
    const improvements = enabledImprovements
      .slice(0, index + 1)
      .map((candidate) => candidate.id);
    const isCombined = improvements.length > 1;

    return {
      id: improvements.join("+"),
      label: enabledImprovements
        .slice(0, index + 1)
        .map(
          (candidate) =>
            `${candidate.shortLabel} · ${candidate.gainLabel}`,
        )
        .join(" + "),
      strokeClass:
        index === enabledImprovements.length - 1 && isCombined
          ? "curve-combined"
          : improvement.strokeClass,
      assumption: isCombined
        ? "Exploratory stack. The selected gains multiply before the decentralization floor and whole-slot rounding."
        : improvement.assumption,
      improvements,
    };
  });
  const slotTimingStage =
    curveStages.length === 0 && slotSeconds !== SLOT_SECONDS
      ? {
          id: "slot-timing",
          label: `Coupled structure · ${slotSeconds}-second slots`,
          strokeClass: "curve-quick-slots",
          assumption:
            "The raw FG workload is unchanged; only the number of block slots and whole-slot rounding differ.",
          improvements: [] as RoundImprovementId[],
        }
      : null;
  const plottedCurveStages = slotTimingStage
    ? [...curveStages, slotTimingStage]
    : curveStages;
  const baselineReadoutModel = calculateRoundModel({
    validators: model.validators,
    slotSeconds: SLOT_SECONDS,
    enabledImprovements: [],
  });
  const curveReadouts = [
    {
      id: "baseline",
      label: "Coupled capacity · 12-second slots",
      strokeClass: "curve-baseline",
      assumption:
        "Round length is allowed to shrink linearly from the fixed 1.1M-validator, 32-slot workload reference.",
      result: baselineReadoutModel,
    },
    ...plottedCurveStages.map((stage) => ({
      ...stage,
      result: calculateRoundModel({
        validators: model.validators,
        slotSeconds,
        enabledImprovements: stage.improvements,
      }),
    })),
  ];
  const selectedStageId = plottedCurveStages.at(-1)?.id ?? "baseline";
  const finalityTiming = model.finality;
  const selectedY = yFor(model.roundSeconds);
  const currentFinalityTiming = calculateFinalityTiming(
    REFERENCE_ROUND_SECONDS,
    SLOT_SECONDS,
    2,
  );
  const buildCurvePath = (
    improvements: readonly RoundImprovementId[],
    effectiveSlotSeconds: number,
  ) => {
    const validatorSamples: number[] = [];

    for (
      let validators = scenarioMaximum;
      validators > MIN_SCENARIO_VALIDATORS;
      validators -= 1_000
    ) {
      validatorSamples.push(validators);
    }
    validatorSamples.push(MIN_SCENARIO_VALIDATORS);

    const parts: string[] = [];
    let previousDuration: number | null = null;

    validatorSamples.forEach((validators, index) => {
      const result = calculateRoundModel({
        validators,
        slotSeconds: effectiveSlotSeconds,
        enabledImprovements: improvements,
      });
      const x = xFor(validators);
      const y = yFor(result.roundSeconds);

      if (index === 0) {
        parts.push(`M ${x} ${y}`);
      } else if (result.roundSeconds === previousDuration) {
        parts.push(`H ${x}`);
      } else {
        parts.push(`H ${x}`, `V ${y}`);
      }

      previousDuration = result.roundSeconds;
    });

    return parts.join(" ");
  };

  const linePath = buildCurvePath([], SLOT_SECONDS);
  const areaPath =
    linePath +
    " L " +
    maximumX +
    " " +
    yFor(0) +
    " L " +
    xFor(scenarioMaximum) +
    " " +
    yFor(0) +
    " Z";
  const rangeMaximum = Math.max(
    1,
    scenarioMaximum - MIN_SCENARIO_VALIDATORS,
  );
  const rangeValue = scenarioMaximum - model.validators;
  const toggleImprovement = (improvementId: RoundImprovementId) => {
    const isActive = enabledImprovementIds.includes(improvementId);

    setEnabledImprovementIds((current) =>
      isActive
        ? current.filter((id) => id !== improvementId)
        : [...current, improvementId],
    );
  };
  const helpTriggerStateFor = (helpId: string) => ({
    helpId,
    isOpen: openControlHelpId === helpId,
    onToggle: () =>
      setOpenControlHelpId((current) => (current === helpId ? null : helpId)),
  });
  const activeControlHelp = openControlHelpId
    ? CONTROL_HELP_BY_ID.get(openControlHelpId) ?? null
    : null;
  const closeControlHelp = (restoreFocus = true) => {
    const helpId = openControlHelpId;
    setOpenControlHelpId(null);

    if (restoreFocus && helpId) {
      window.requestAnimationFrame(() => {
        document.getElementById(`control-help-trigger-${helpId}`)?.focus();
      });
    }
  };
  const closeFinalityExplainer = () => {
    setShowFinalityExplainer(false);
    window.requestAnimationFrame(() => {
      document.getElementById("finality-breakdown-trigger")?.focus();
    });
  };

  return (
    <main>
      <aside className="wip-banner" aria-label="Work in progress notice">
        <div>
          <strong>Work in progress</strong>
          <span>
            This research preview is under active development. {" "}
            <a
              aria-label="Share feedback on GitHub (opens in a new tab)"
              href="https://github.com/yannvon/finality-watch/issues/new/choose"
              rel="noreferrer"
              target="_blank"
            >
              Share feedback <ExternalArrow />
            </a>
          </span>
        </div>
      </aside>

      <header className="site-header" id="top">
        <a className="brand" href="#top" aria-label="finality.watch home">
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          finality<span>.watch</span>
        </a>
        <nav aria-label="Primary navigation">
          <a href="#methodology">Model</a>
          <a href="#pathways">Research</a>
          <a href="#decoupling">Decoupling</a>
        </nav>
      </header>

      <section className="model-section model-first" id="model" aria-labelledby="model-title">
        <div className="model-heading model-heading-first">
          <div>
            <p className="section-kicker">Ethereum consensus model</p>
            <h1 id="model-title">Finality explorer</h1>
          </div>
          <aside className="model-network" aria-label="Ethereum validator identity count">
          <div
            className="network-status is-snapshot"
            aria-label="Using a dated network snapshot"
          >
            <span className="status-dot" aria-hidden="true" />
            Network snapshot
          </div>
          <p>
            <strong>{numberFormatter.format(network.activeValidators)}</strong>
            <span>active validator identities</span>
          </p>
          <small>
            {network.epoch ? `Epoch ${numberFormatter.format(network.epoch)} · ` : ""}
            {formatObservedAt(network.observedAt)} UTC · {network.source}
          </small>
          </aside>
        </div>

        <div className="model-shell">
          <div className="model-toolbar">
            <div className="model-primary-results" aria-live="polite">
              <div className="identity-result">
                <span>Validator identities</span>
                <strong>{formatCompactCount(model.validators)}</strong>
              </div>
              <div className="slots-result">
                <span>Slots / round</span>
                <strong>{model.roundSlots}</strong>
                <small>
                  whole {slotSeconds}-second {model.roundSlots === 1 ? "slot" : "slots"}
                </small>
              </div>
              <div className="round-result">
                <span>Full-set round</span>
                <strong>
                  <Approximate value={formatDuration(model.roundSeconds)} />
                </strong>
                <small>
                  {model.roundSlots} {model.roundSlots === 1 ? "slot" : "slots"} × {slotSeconds} sec
                  {model.floorLimited
                    ? ` · ${DECENTRALIZATION_FLOOR_SECONDS}-sec decentralization floor active`
                    : ""}
                </small>
              </div>
              <div className="finality-result">
                <span>Modeled expected finality</span>
                <strong>
                  <Approximate value={formatDuration(finalityTiming.totalSeconds)} />
                </strong>
                <button
                  aria-controls="expected-finality-breakdown"
                  aria-expanded={showFinalityExplainer}
                  className="metric-breakdown-trigger"
                  id="finality-breakdown-trigger"
                  onClick={() => setShowFinalityExplainer((current) => !current)}
                  type="button"
                >
                  <span>
                    {showFinalityExplainer
                      ? "Hide calculation"
                      : "View calculation"}
                  </span>
                  <i aria-hidden="true">
                    {showFinalityExplainer ? "−" : "+"}
                  </i>
                </button>
              </div>
            </div>

            <div className="preset-group" aria-label="Validator count presets">
              {presets.map((preset) => {
                const active = model.validators === preset.value;
                return (
                  <button
                    className="preset-button"
                    type="button"
                    key={preset.label}
                    aria-pressed={active}
                    onClick={() => setScenarioValidators(preset.value)}
                  >
                    <span className="preset-long">{preset.label}</span>
                    <span className="preset-short">{preset.shortLabel}</span>
                  </button>
                );
              })}
            </div>

            <p className="model-scenario-note">
              <strong>Exploratory scenario—not a forecast.</strong>{" "}
              {formatCompactCount(model.validators)} identities ·{" "}
              {formatGain(model.gains.total)} stacked networking gain ·{" "}
              {slotSeconds}-second slots · {oneRoundFinality ? "one" : "two"}{" "}
              finality {oneRoundFinality ? "round" : "rounds"}
            </p>
          </div>

          <section
            className="finality-layer"
            aria-label="Expected finality explanation"
            hidden={!showFinalityExplainer}
            id="expected-finality-breakdown"
          >
            <div className="finality-explainer">
              <div className="finality-explainer-heading">
                <span>Timing breakdown</span>
                <button
                  onClick={closeFinalityExplainer}
                  type="button"
                >
                  <span>Close</span>
                  <i aria-hidden="true">×</i>
                </button>
              </div>
              <div className="finality-explainer-content">
                <FinalityTimingDiagram timing={finalityTiming} />
              </div>
            </div>
          </section>

          <div className="improvement-toolbar" aria-label="Timing improvements">
            <div className="improvement-group improvement-networking">
              <div className="control-heading networking-heading">
                <span>
                  Round networking · {formatGain(model.gains.total)} active
                </span>
                <ControlHelpTrigger
                  {...helpTriggerStateFor("networking")}
                  triggerLabel="About the active networking gain"
                />
              </div>
              <div className="improvement-buttons">
                {ROUND_IMPROVEMENTS.map((improvement) => {
                  const active = enabledImprovementIds.includes(improvement.id);
                  const displayedGain = calculateRoundImprovementGain(
                    improvement.id,
                    model.validators,
                  );

                  return (
                    <div className="improvement-control" key={improvement.id}>
                      <button
                        className={`improvement-button ${improvement.strokeClass} ${active ? "is-result" : ""}`}
                        type="button"
                        aria-pressed={active}
                        onClick={() => toggleImprovement(improvement.id)}
                      >
                        <i aria-hidden="true" />
                        <span>{improvement.shortLabel}</span>
                        <b>{formatGain(displayedGain)}</b>
                        <small>
                          {active ? "Included" : "Add to model"}
                        </small>
                      </button>
                      <ControlHelpTrigger
                        {...helpTriggerStateFor(`improvement-${improvement.id}`)}
                        triggerLabel={`About ${improvement.shortLabel}`}
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            <fieldset className="improvement-group improvement-rounds">
              <legend className="sr-only">Finality rounds</legend>
              <div className="control-heading finality-rounds-heading">
                <span aria-hidden="true">Finality rounds</span>
                <ControlHelpTrigger
                  {...helpTriggerStateFor("finality-rounds")}
                  triggerLabel="About finality rounds"
                />
              </div>
              <div className="round-options">
                <label>
                  <input
                    type="radio"
                    name="finality-rounds"
                    value="2"
                    checked={!oneRoundFinality}
                    onChange={() => setOneRoundFinality(false)}
                  />
                  <span>Two rounds</span>
                </label>
                <label>
                  <input
                    type="radio"
                    name="finality-rounds"
                    value="1"
                    checked={oneRoundFinality}
                    onChange={() => setOneRoundFinality(true)}
                  />
                  <span>One round</span>
                </label>
              </div>
            </fieldset>

            <div className="improvement-group slot-time-control">
              <div className="control-heading slot-time-heading">
                <label htmlFor="slot-time">Slot time</label>
                <output htmlFor="slot-time">{slotSeconds} sec</output>
                <ControlHelpTrigger
                  {...helpTriggerStateFor("slot-time")}
                  triggerLabel="About slot time"
                />
              </div>
              <input
                id="slot-time"
                className="slot-time-range"
                type="range"
                min="1"
                max="12"
                step="1"
                value={slotSeconds}
                aria-valuetext={`${slotSeconds} second slots`}
                onChange={(event) => setSlotSeconds(Number(event.target.value))}
              />
              <div className="slot-time-bounds">
                <span>12 sec today</span>
                <span>1 sec exploratory</span>
              </div>
            </div>

            {activeControlHelp && activeControlHelp.placement !== "chart" ? (
              <ControlHelpPanel
                help={activeControlHelp}
                onClose={closeControlHelp}
              />
            ) : null}
          </div>

          <div className="chart-wrap">
            <div className="range-control chart-axis-control">
              <div className="range-labels">
                <span className="range-label-copy">
                  <label htmlFor="validator-scenario">
                    Consolidation progress
                  </label>
                  <a
                    className="consolidation-source-link"
                    href="https://pectrified.com/mainnet"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Pectrified <ExternalArrow />
                  </a>
                  <ControlHelpTrigger
                    {...helpTriggerStateFor("validator-consolidation")}
                    triggerLabel="About validator consolidation"
                  />
                </span>
                <output htmlFor="validator-scenario">
                  {numberFormatter.format(model.validators)} remain
                </output>
              </div>
              <input
                id="validator-scenario"
                className="scenario-range"
                type="range"
                min="0"
                max={rangeMaximum}
                step="1000"
                value={rangeValue}
                aria-valuetext={`${numberFormatter.format(model.validators)} validator identities remain`}
                onChange={(event) =>
                  setScenarioValidators(
                    Math.max(
                      MIN_SCENARIO_VALIDATORS,
                      scenarioMaximum - Number(event.target.value),
                    ),
                  )
                }
                aria-describedby="range-help"
              />
              <div className="range-bounds" id="range-help">
                <span>{formatCompactCount(scenarioMaximum)} reference</span>
                <span>Drag or use arrow keys</span>
                <span>{formatCompactCount(MIN_SCENARIO_VALIDATORS)} remain</span>
              </div>
              {activeControlHelp?.placement === "chart" ? (
                <ControlHelpPanel
                  help={activeControlHelp}
                  onClose={closeControlHelp}
                />
              ) : null}
              <p className="sr-only">
                {numberFormatter.format(model.validators)} validator identities
                remain, with a modeled round of {model.roundSlots} slots, or{" "}
                {formatDuration(model.roundSeconds)}, at a total modeled gain of{" "}
                {formatGain(model.gains.total)}.
              </p>
            </div>

            <svg
              className="capacity-chart"
              viewBox={`0 0 ${chart.width} ${chart.height}`}
              role="img"
              aria-label="Modeled full-set round time falls as consolidation increases"
              aria-describedby="capacity-chart-description"
            >
              <desc id="capacity-chart-description">
                A descending whole-slot capacity proxy. The x-axis shows the
                validator identities remaining, from {scenarioMaximum}
                on the left to {MIN_SCENARIO_VALIDATORS} on the right. The
                selected scenario leaves {model.validators} identities and
                requires {model.roundSlots} whole slots at {slotSeconds}
                seconds each, or approximately {model.roundSeconds} seconds.
                Today is marked separately at the unchanged 32-slot protocol
                cadence.
              </desc>

              {roundTimeTicks.map((tick) => (
                <g className="chart-grid" key={tick}>
                  <line
                    x1={chart.left}
                    x2={chart.width - chart.right}
                    y1={yFor(tick)}
                    y2={yFor(tick)}
                  />
                  <text x={chart.left - 14} y={yFor(tick) + 4} textAnchor="end">
                    {tick === 0 ? "0" : formatDuration(tick)}
                  </text>
                </g>
              ))}

              <text
                className="axis-title"
                transform={`translate(13 ${chart.top + plotHeight / 2}) rotate(-90)`}
                textAnchor="middle"
              >
                modeled round time
              </text>

              <path className="chart-area" d={areaPath} />
              <path className="chart-line" d={linePath} />

              {plottedCurveStages.map((curve) => {
                const result = calculateRoundModel({
                  validators: model.validators,
                  slotSeconds,
                  enabledImprovements: curve.improvements,
                });

                return (
                  <g className={`proposal-curve ${curve.strokeClass}`} key={curve.id}>
                    <path d={buildCurvePath(curve.improvements, slotSeconds)} />
                    <circle cx={selectedX} cy={yFor(result.roundSeconds)} r="4.5" />
                  </g>
                );
              })}

              <line
                className="selection-guide"
                x1={selectedX}
                x2={selectedX}
                y1={selectedY}
                y2={yFor(0)}
              />
              <circle className="selected-halo" cx={selectedX} cy={selectedY} r="13" />
              <circle className="selected-point" cx={selectedX} cy={selectedY} r="5" />
              <text
                aria-hidden="true"
                className="selected-label"
                x={selectedX > chart.width - 150 ? selectedX - 12 : selectedX + 12}
                y={selectedY - 15}
                textAnchor={selectedX > chart.width - 150 ? "end" : "start"}
              >
                <tspan className="approximation-mark-svg">≈</tspan>
                <tspan>{formatDuration(model.roundSeconds)}</tspan>
              </text>

              <circle className="current-point" cx={currentX} cy={currentY} r="4" />
              <text
                className="current-label"
                x={currentX + 8}
                y={currentY + 23}
                textAnchor="start"
              >
                today · protocol stays at 32 slots
              </text>

              <line
                className="target-guide"
                x1={reference128kX}
                x2={reference128kX}
                y1={chart.top}
                y2={yFor(0)}
              />
              <text
                className="target-label"
                x={reference128kX - 8}
                y={chart.top + 14}
                textAnchor="end"
              >
                128k target
              </text>

              {validatorTicks.map((validators, index) => {
                  const x = xFor(validators);
                  return (
                  <g className="x-tick" key={validators}>
                    <line
                      x1={x}
                      x2={x}
                      y1={yFor(0)}
                      y2={yFor(0) + 6}
                    />
                    <text
                      x={x}
                      y={yFor(0) + 27}
                      textAnchor={
                        index === 0
                          ? "start"
                          : index === validatorTicks.length - 1
                            ? "end"
                            : "middle"
                      }
                    >
                      {formatCompactCount(validators)}
                    </text>
                  </g>
                  );
                })}
            </svg>

            <p className="mobile-chart-result">
              Selected point:{" "}
              <Approximate value={formatDuration(model.roundSeconds)} /> full-set round
            </p>
            <div className="curve-readouts">
              {curveReadouts.map((curve) => (
                  <div
                    className={`curve-readout ${curve.strokeClass} ${curve.id === selectedStageId ? "is-finality-input" : ""}`}
                    key={curve.id}
                  >
                    <i aria-hidden="true" />
                    <span>
                      <strong>{curve.label}</strong>
                      <small>{curve.assumption}</small>
                    </span>
                    <b>
                      <Approximate value={formatDuration(curve.result.roundSeconds)} />
                    </b>
                    <em>
                      {curve.result.roundSlots}{" "}
                      {curve.result.roundSlots === 1 ? "slot" : "slots"} ×{" "}
                      {curve.result.slotSeconds} sec · {formatGain(curve.result.gains.total)}
                      {curve.id === selectedStageId ? " · finality input" : ""}
                    </em>
                  </div>
                ))}
            </div>
          </div>

        </div>

      </section>

      <MethodologySection />
      <ProposalTrackerSection />

      <section
        className="decoupling-section"
        id="decoupling"
        aria-labelledby="finality-title"
      >
        <div className="section-heading">
          <div>
            <p className="section-kicker">From today to the north star</p>
            <h2 className="consensus-title" id="finality-title">
              Consensus changes visualized.
            </h2>
          </div>
          <p>
            Decoupled consensus gives fast confirmation and finality separate lanes.
          </p>
        </div>

        <div className="motion-control-row">
          <button
            aria-pressed={animationsPaused}
            className="motion-control-button"
            onClick={() => setAnimationsPaused((current) => !current)}
            type="button"
          >
            {animationsPaused ? "Resume animations" : "Pause animations"}
          </button>
        </div>

        <div
          className="two-lane-visual"
          role="img"
          aria-label={
            "Moving comparison with one normalized animation step per second; the today and decoupled-candidate lanes are shown twelve times faster than wall clock. Today has 32-slot rounds, green justified blocks after one round, and finality after two rounds or 64 slots. In the decoupled candidate, stabilization trails the fast-confirmed chain by one eight-slot round, and finality arrives after two rounds or 16 slots. Both show justification above finality-vote progress. The north-star example has one-second blocks, fast confirmation, two-slot one-round finality after two seconds, and finality following the head every slot at a one-second distance."
          }
        >
          <div className="playback-badge" aria-hidden="true">
            <span>Today + DC</span>
            <strong>12× sped up</strong>
          </div>
          <div className="consensus-lane lane-today">
            <div className="lane-label">
              <span>Coupled today</span>
              <strong>Justified after one round</strong>
              <small>
                12-sec blocks · finality speed baseline ·{" "}
                <Approximate value={formatDuration(currentFinalityTiming.totalSeconds)} /> expected
              </small>
              <div className="lane-round-metrics">
                <b>32</b><span>slots / round</span><em>32 slots to justify · 64 to finalize</em>
              </div>
            </div>
            <div className="lane-track dc-track">
              <DcPipeline
                roundSlots={32}
                finalityRounds={2}
                stabilizationLagSlots={32}
                tickMs={1_000}
                paused={animationsPaused}
              />
            </div>
          </div>
          <div className="consensus-lane lane-decoupled">
            <div className="lane-label">
              <span>Decoupled candidate</span>
              <strong>Stabilization follows fast confirmation</strong>
              <small>12-sec blocks · 4× finality speedup</small>
              <div className="lane-round-metrics">
                <b>8</b><span>slots / round</span><em>2 rounds · 16-slot finality lag</em>
              </div>
            </div>
            <div className="lane-track dc-track">
              <DcPipeline
                roundSlots={8}
                finalityRounds={2}
                stabilizationLagSlots={8}
                tickMs={1_000}
                paused={animationsPaused}
              />
            </div>
          </div>
          <div className="consensus-lane lane-north-star">
            <div className="lane-label">
              <span>North star</span>
              <strong>One-round finality</strong>
              <small>1-sec blocks · 2-sec protocol finality lag</small>
              <div className="lane-round-metrics">
                <b>2</b><span>slots / round</span><em>1 round · finality follows every 1 sec</em>
              </div>
            </div>
            <div className="lane-track dc-track">
              <DcPipeline
                roundSlots={2}
                finalityRounds={1}
                checkpointLagSlots={1}
                stabilizationLagSlots={null}
                tickMs={1_000}
                paused={animationsPaused}
              />
            </div>
          </div>
          <div className="lane-key" aria-hidden="true">
            <span><i className="key-dot is-teal" />fast confirmed</span>
            <span><i className="key-dot is-sage" />justified today · stabilized in DC</span>
            <span><i className="key-dot is-clay" />finalized checkpoint</span>
          </div>
        </div>
        <p className="visual-note">
          One visual step = one slot · finality flips at 100% · north star is
          illustrative.
        </p>
      </section>

      <section
        className="voting-section"
        id="voting-pattern"
        aria-labelledby="voting-pattern-title"
      >
        <div className="section-heading voting-heading">
          <div>
            <p className="section-kicker">Decoupled voting pattern</p>
            <h2 id="voting-pattern-title">One validator set. Eight slot cohorts.</h2>
          </div>
          <p>
            Each slot activates one cohort and samples a fresh AC committee from
            the full set.
          </p>
        </div>
        <div className="motion-control-row motion-control-row-voting">
          <button
            aria-pressed={animationsPaused}
            className="motion-control-button"
            onClick={() => setAnimationsPaused((current) => !current)}
            type="button"
          >
            {animationsPaused ? "Resume animations" : "Pause animations"}
          </button>
        </div>
        <DcVotingPattern paused={animationsPaused} />
      </section>

      <footer>
        <a className="brand footer-brand" href="#top">
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          finality<span>.watch</span>
        </a>
        <p>Exploring the path to faster Ethereum finality.</p>
        <div className="footer-links">
          <a
            aria-label="Share feedback on GitHub (opens in a new tab)"
            href="https://github.com/yannvon/finality-watch/issues/new/choose"
            rel="noreferrer"
            target="_blank"
          >
            Share feedback <ExternalArrow />
          </a>
          <a
            aria-label="View finality.watch source on GitHub (opens in a new tab)"
            href="https://github.com/yannvon/finality-watch"
            rel="noreferrer"
            target="_blank"
          >
            View source <ExternalArrow />
          </a>
          <a href="#top">Back to top ↑</a>
        </div>
      </footer>
    </main>
  );
}
