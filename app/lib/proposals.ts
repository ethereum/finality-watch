import type { RoundImprovementId } from "./model.ts";

export const PROPOSALS_LAST_CHECKED = "2026-08-19" as const;
export const PROPOSAL_LAST_CHECKED = PROPOSALS_LAST_CHECKED;
export const LOCAL_EIP_SNAPSHOT = "2026-07-23";

export type ProposalId =
  | "eip-7251"
  | "eip-8061"
  | "eip-8198"
  | "eip-8243"
  | "eip-8334"
  | "one-round-finality"
  | "dc";

export type ProposalStatus = "final" | "review" | "draft" | "research";

export type ProposalPlotRole =
  | "curve"
  | "finality"
  | "x-axis"
  | "timeline";

type ProposalSource = {
  id: ProposalId;
  eip: number | null;
  label: string;
  shortLabel: string;
  status: ProposalStatus;
  statusLabel: string;
  plotRole: ProposalPlotRole;
  roadmapLabel: string;
  summary: string;
  plotEffect: string;
  caution: string;
  sourceUrl: string;
  secondaryUrl?: string;
  lastChecked: typeof PROPOSALS_LAST_CHECKED;
};

export type Proposal = ProposalSource & {
  title: string;
  role: ProposalPlotRole;
  effect: string;
  plotNote: string;
  roadmap: string;
};

const PROPOSAL_SOURCES = [
  {
    id: "eip-7251",
    eip: 7251,
    label: "Increase the MAX_EFFECTIVE_BALANCE",
    shortLabel: "Validator consolidation",
    status: "final",
    statusLabel: "Final · Pectra",
    plotRole: "x-axis",
    roadmapLabel: "Shipped foundation",
    summary:
      "Raises the maximum effective balance to 2,048 ETH while retaining the 32 ETH minimum activation balance, allowing operators to consolidate stake into fewer validator identities.",
    plotEffect:
      "Enables movement toward lower validator counts on the x-axis; it does not change round time at a fixed validator count.",
    caution:
      "Consolidation is opt-in, and validator identities are not a measure of independent operators or people.",
    sourceUrl: "https://eips.ethereum.org/EIPS/eip-7251",
    lastChecked: PROPOSALS_LAST_CHECKED,
  },
  {
    id: "eip-8061",
    eip: 8061,
    label: "Increase exit and consolidation churn",
    shortLabel: "Faster consolidation churn",
    status: "review",
    statusLabel: "Review",
    plotRole: "timeline",
    roadmapLabel: "Considered for Glamsterdam",
    summary:
      "Creates a separate consolidation churn limit and proposes roughly doubling consolidation throughput.",
    plotEffect:
      "Changes how quickly the network could arrive at a lower validator count, not the round-time curve at that count.",
    caution:
      "The proposal trades faster validator-set reconfiguration against a shorter weak-subjectivity period and remains under review.",
    sourceUrl: "https://eips.ethereum.org/EIPS/eip-8061",
    secondaryUrl: "https://eips.ethereum.org/EIPS/eip-7773",
    lastChecked: PROPOSALS_LAST_CHECKED,
  },
  {
    id: "eip-8198",
    eip: 8198,
    label: "Quick Slots",
    shortLabel: "8-second slots",
    status: "draft",
    statusLabel: "Draft",
    plotRole: "finality",
    roadmapLabel: "Strawmap · J*",
    summary:
      "Makes slot duration configurable and currently specifies an eight-second placeholder, down from twelve seconds.",
    plotEffect:
      "Changes expected inclusion time and the slot-boundary quantization of finality. It does not increase full-set finality-gadget attestation throughput.",
    caution:
      "Eight seconds is a draft placeholder. Shorter slots can require a voting cohort to pipeline across slot boundaries; that timing is modeled separately from throughput improvements.",
    sourceUrl: "https://eips.ethereum.org/EIPS/eip-8198",
    lastChecked: PROPOSALS_LAST_CHECKED,
  },
  {
    id: "eip-8243",
    eip: 8243,
    label: "Batching Attestations at Source",
    shortLabel: "Source batching",
    status: "draft",
    statusLabel: "Draft",
    plotRole: "curve",
    roadmapLabel: "Related consensus networking work",
    summary:
      "Lets validators scheduled in the same committee publish one pre-aggregated attestation instead of many individual messages.",
    plotEffect:
      "Uses an optimistic 2× source-side gain at 500,000 validators and above, tapering linearly to no gain at 128,000 validators as consolidation removes overlapping work.",
    caution:
      "The gain is a modeling assumption, not a measured network-wide result. Its taper avoids treating source batching and validator consolidation as independent, multiplicative savings.",
    sourceUrl: "https://eips.ethereum.org/EIPS/eip-8243",
    lastChecked: PROPOSALS_LAST_CHECKED,
  },
  {
    id: "eip-8334",
    eip: 8334,
    label: "Bundled Attestation Propagation",
    shortLabel: "2× bundled propagation",
    status: "draft",
    statusLabel: "Draft · proposed for Hegotá",
    plotRole: "curve",
    roadmapLabel: "Hegotá PFI",
    summary:
      "Uses gossipsub partial messages to deduplicate attestation data during subnet propagation, with a stated upper-bound bandwidth saving of up to 50%.",
    plotEffect:
      "Models the stated upper-bound bandwidth saving as a fixed, optimistic 2× full-set attestation-throughput multiplier.",
    caution:
      "Up to 50% less subnet bandwidth does not establish 2× round throughput; the curve is explicitly optimistic and should be validated with measurements.",
    sourceUrl: "https://github.com/ethereum/EIPs/pull/11905",
    secondaryUrl:
      "https://ethereum-magicians.org/t/eip-8334-bundled-attestation-propagation/29008",
    lastChecked: PROPOSALS_LAST_CHECKED,
  },
  {
    id: "dc",
    eip: null,
    label: "Decoupled consensus",
    shortLabel: "Decoupled consensus",
    status: "research",
    statusLabel: "Core research",
    plotRole: "curve",
    roadmapLabel: "Strawmap · I*",
    summary:
      "Separates a fast available-chain committee from a trailing full-set stabilization and finality pipeline so each cadence can be optimized independently.",
    plotEffect:
      "Models an optimistic 4× full-set voting gain by pipelining finality-gadget attestations across the slot and aggregating in the following slot.",
    caution:
      "The 4× case assumes X = 0: validators vote immediately after fast confirmation, maximizing the propagation window. A later X trades latency or propagation budget for more available-chain stabilization.",
    sourceUrl:
      "https://ethresear.ch/t/unblocking-faster-finality-with-decoupled-consensus/24527",
    secondaryUrl:
      "https://ethresear.ch/t/why-ethereum-needs-a-dynamically-available-protocol/24418",
    lastChecked: PROPOSALS_LAST_CHECKED,
  },
  {
    id: "one-round-finality",
    eip: null,
    label: "One-round finality gadget",
    shortLabel: "One-round finality",
    status: "research",
    statusLabel: "Core research",
    plotRole: "finality",
    roadmapLabel: "Decoupled-consensus finality gadget",
    summary:
      "Uses a finality gadget that can finalize in one full-set voting round under its stated optimistic or adversarial assumptions.",
    plotEffect:
      "Changes the finality formula from two completed voting rounds to one; it does not make an individual round faster.",
    caution:
      "One-round constructions have distinct thresholds, recovery behavior, and safety assumptions. The toggle is a timing scenario, not a protocol commitment.",
    sourceUrl:
      "https://ethresear.ch/t/unblocking-faster-finality-with-decoupled-consensus/24527",
    lastChecked: PROPOSALS_LAST_CHECKED,
  },
] as const satisfies readonly ProposalSource[];

export const PROPOSALS: readonly Proposal[] = PROPOSAL_SOURCES.map(
  (proposal) => ({
    ...proposal,
    title: proposal.label,
    role: proposal.plotRole,
    effect: proposal.summary,
    plotNote: `${proposal.plotEffect} ${proposal.caution}`,
    roadmap: proposal.roadmapLabel,
  }),
);

export type RoundImprovement = {
  id: RoundImprovementId;
  label: string;
  shortLabel: string;
  gainLabel: string;
  strokeClass: string;
  assumption: string;
  sourceUrl: string;
};

export const ROUND_IMPROVEMENTS = [
  {
    id: "dc",
    label: "Decoupled consensus · optimistic 4×",
    shortLabel: "DC",
    gainLabel: "4×",
    strokeClass: "curve-decoupled",
    assumption:
      "Optimistic 4× gain from pipelining finality-gadget attestations into the next slot. This assumes X = 0, with votes cast immediately after fast confirmation to maximize propagation time.",
    sourceUrl:
      "https://ethresear.ch/t/unblocking-faster-finality-with-decoupled-consensus/24527",
  },
  {
    id: "eip-8334",
    label: "EIP-8334 · optimistic 2×",
    shortLabel: "Bundling",
    gainLabel: "2×",
    strokeClass: "curve-bundled-propagation",
    assumption:
      "Fixed optimistic 2× throughput multiplier derived from the proposal's upper bound of 50% lower attestation-subnet bandwidth; this is not yet a measured round-time gain.",
    sourceUrl: "https://github.com/ethereum/EIPs/pull/11905",
  },
  {
    id: "eip-8243",
    label: "EIP-8243 · source batching · up to 2×",
    shortLabel: "Source batching",
    gainLabel: "up to 2×",
    strokeClass: "curve-source-batching",
    assumption:
      "Optimistic 2× source-side gain at 500k validators and above, tapering linearly to 1× at 128k because consolidation already removes repeated source traffic.",
    sourceUrl: "https://eips.ethereum.org/EIPS/eip-8243",
  },
] as const satisfies readonly RoundImprovement[];

export const DEFAULT_ROUND_IMPROVEMENTS = [
  "dc",
] as const satisfies readonly RoundImprovementId[];
