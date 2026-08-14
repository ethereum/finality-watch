"use client";

import { useEffect, useMemo, useState } from "react";
import {
  MAX_ASSIGNED_ATTESTERS_PER_SLOT,
  MIN_SCENARIO_VALIDATORS,
  REFERENCE_ATTESTERS_PER_SLOT,
  REFERENCE_ROUND_SECONDS,
  REFERENCE_VALIDATORS,
  SINGLE_COHORT_FLOOR_SECONDS,
  SLOT_SECONDS,
  calculateFinalityTiming,
  calculateRoundModel,
  formatCompactCount,
  formatDuration,
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
} from "./lib/proposals";

type NetworkSummary = {
  activeValidators: number;
  epoch: number | null;
  observedAt: string;
  source: string;
  stale: boolean;
};

const FALLBACK_NETWORK: NetworkSummary = {
  activeValidators: 887_995,
  epoch: 463_868,
  observedAt: "2026-07-25T03:15:35.000Z",
  source: "Pectrified snapshot",
  stale: true,
};

const numberFormatter = new Intl.NumberFormat("en-US");
const rawRoundEquation = `${REFERENCE_ROUND_SECONDS}s × identities ÷ ${formatCompactCount(REFERENCE_VALIDATORS)} ÷ stacked gain`;
const displayedRoundEquation = `ceil(max(${SINGLE_COHORT_FLOOR_SECONDS}s, raw) ÷ slot) × slot`;

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

export default function Home() {
  const [network, setNetwork] = useState<NetworkSummary>(FALLBACK_NETWORK);
  const [scenarioValidators, setScenarioValidators] = useState(128_000);
  const [enabledImprovementIds, setEnabledImprovementIds] = useState<
    RoundImprovementId[]
  >([...DEFAULT_ROUND_IMPROVEMENTS]);
  const [slotSeconds, setSlotSeconds] = useState(SLOT_SECONDS);
  const [oneRoundFinality, setOneRoundFinality] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    async function refreshNetworkSummary() {
      try {
        const response = await fetch("/api/network-summary", {
          cache: "no-store",
          signal: controller.signal,
        });

        if (!response.ok) return;
        const summary = (await response.json()) as NetworkSummary;

        if (
          Number.isFinite(summary.activeValidators) &&
          summary.activeValidators >= MIN_SCENARIO_VALIDATORS
        ) {
          setNetwork(summary);
        }
      } catch {
        // The dated, clearly labelled snapshot remains visible when live data fails.
      }
    }

    void refreshNetworkSummary();
    return () => controller.abort();
  }, []);

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
    { label: "Today", shortLabel: "Today", value: network.activeValidators },
    { label: "128k target", shortLabel: "128k", value: 128_000 },
    { label: "16k scenario", shortLabel: "16k", value: 16_000 },
  ];

  const chart = {
    width: 920,
    height: 360,
    left: 62,
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
        .map((candidate) => candidate.shortLabel)
        .join(" + "),
      strokeClass:
        index === enabledImprovements.length - 1 && isCombined
          ? "curve-combined"
          : improvement.strokeClass,
      assumption: isCombined
        ? "Exploratory stack. The selected gains multiply before the physical floor and whole-slot rounding."
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

  return (
    <main>
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
          <a href="#decoupling">Decoupling</a>
          <a href="#methodology">Model</a>
          <a href="#pathways">Research</a>
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
            className={`network-status ${network.stale ? "is-stale" : ""}`}
            aria-label={
              network.stale
                ? "Using a dated network snapshot"
                : "Using live network data"
            }
          >
            <span className="status-dot" aria-hidden="true" />
            {network.stale ? "Dated snapshot" : "Live network data"}
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
                <small>{formatGain(model.gains.total)} active throughput gain</small>
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
                <strong>≈{formatDuration(model.roundSeconds)}</strong>
                <small>
                  {model.roundSlots} {model.roundSlots === 1 ? "slot" : "slots"} × {slotSeconds} sec
                  {model.floorLimited ? " · 8-sec floor active" : ""}
                </small>
              </div>
              <div className="finality-result">
                <span>Expected finality</span>
                <strong>≈{formatDuration(finalityTiming.totalSeconds)}</strong>
                <small>
                  {finalityTiming.totalSlots} slots total ·{" "}
                  {finalityTiming.finalityRounds === 1 ? "one round" : "two rounds"}
                </small>
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
          </div>

          <div className="improvement-toolbar" aria-label="Timing improvements">
            <div className="improvement-group improvement-networking">
              <span>Round networking · {formatGain(model.gains.total)} active</span>
              <div className="improvement-buttons">
                {ROUND_IMPROVEMENTS.map((improvement) => {
                  const active = enabledImprovementIds.includes(improvement.id);
                  const improvementGain =
                    improvement.id === "dc"
                      ? 4
                      : improvement.id === "eip-8334"
                        ? 2
                        : calculateRoundModel({
                            validators: model.validators,
                            slotSeconds,
                            enabledImprovements: ["eip-8243"],
                          }).gains.source;

                  return (
                    <button
                      className={`improvement-button ${improvement.strokeClass} ${active ? "is-result" : ""}`}
                      type="button"
                      key={improvement.id}
                      aria-pressed={active}
                      onClick={() => toggleImprovement(improvement.id)}
                    >
                      <i aria-hidden="true" />
                      <span>{improvement.shortLabel}</span>
                      <small>
                        {active
                          ? `Included · ${formatGain(improvementGain)}`
                          : improvement.id === "eip-8243"
                            ? "Add · up to 2×"
                            : "Add"}
                      </small>
                    </button>
                  );
                })}
              </div>
            </div>

            <fieldset className="improvement-group improvement-rounds">
              <legend>
                Finality rounds <small>· select one</small>
              </legend>
              <div>
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
              <label htmlFor="slot-time">
                Slot time
                <output htmlFor="slot-time">{slotSeconds} sec</output>
              </label>
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
              <small>Changes slot count and inclusion—not FG throughput</small>
            </div>
          </div>

          <div className="range-control range-control-above-chart">
            <div className="range-labels">
              <label htmlFor="validator-scenario">
                Consolidate validator identities
              </label>
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
            </div>
            <p className="sr-only">
              {numberFormatter.format(model.validators)} validator identities
              remain, with a modeled round of {model.roundSlots} slots, or{" "}
              {formatDuration(model.roundSeconds)}, at a total modeled gain of{" "}
              {formatGain(model.gains.total)}.
            </p>
          </div>

          <div className="chart-wrap">
            <svg
              className="capacity-chart"
              viewBox={`0 0 ${chart.width} ${chart.height}`}
              role="img"
              aria-labelledby="capacity-chart-title capacity-chart-description"
            >
              <title id="capacity-chart-title">
                Modeled full-set round time falls as consolidation increases
              </title>
              <desc id="capacity-chart-description">
                A descending whole-slot capacity proxy. The x-axis shows the
                validator identities remaining, from {scenarioMaximum}
                on the left to {MIN_SCENARIO_VALIDATORS} on the right. The
                selected scenario leaves {model.validators} identities and
                requires {model.roundSlots} whole slots at {slotSeconds}
                seconds each, or {model.roundSeconds} seconds. Today is marked
                separately at the unchanged 32-slot protocol cadence.
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
                transform={`translate(17 ${chart.top + plotHeight / 2}) rotate(-90)`}
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
                className="selected-label"
                x={selectedX > chart.width - 150 ? selectedX - 12 : selectedX + 12}
                y={selectedY - 15}
                textAnchor={selectedX > chart.width - 150 ? "end" : "start"}
              >
                ≈{formatDuration(model.roundSeconds)}
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
              <text
                className="x-axis-title"
                x={chart.left + plotWidth / 2}
                y={chart.height - 6}
                textAnchor="middle"
              >
                validator identities remaining · fewer →
              </text>
            </svg>
            <div className="mobile-chart-axis" aria-hidden="true">
              <span>{formatCompactCount(scenarioMaximum)} reference</span>
              <span>{formatCompactCount(MIN_SCENARIO_VALIDATORS)} remain →</span>
            </div>
            <p className="mobile-chart-result">
              Selected point: ≈{formatDuration(model.roundSeconds)} full-set round
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
                    <b>≈{formatDuration(curve.result.roundSeconds)}</b>
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

          <section
            className="finality-layer"
            aria-label="Expected finality formula"
          >
            <div className="finality-equation">
              <span>{formatDuration(finalityTiming.expectedInclusionSeconds)} inclusion</span>
              <i aria-hidden="true">+</i>
              <span>{formatDuration(finalityTiming.expectedRoundAlignmentSeconds)} alignment</span>
              <i aria-hidden="true">+</i>
              <span>{finalityTiming.finalityRounds} × {formatDuration(finalityTiming.roundSeconds)}</span>
              <i aria-hidden="true">→</i>
              <span>round up to {finalityTiming.totalSlots} slots</span>
              <strong>= {formatDuration(finalityTiming.totalSeconds)}</strong>
            </div>

            <details className="finality-explainer">
              <summary>How this estimate works <span aria-hidden="true">+</span></summary>
              <p>
                Expected finality adds half a slot for inclusion, half a round
                for alignment, and the selected voting rounds, then rounds up to
                the next slot boundary. Shorter slots reduce that boundary;
                one-round finality removes one voting round.
              </p>
            </details>
          </section>
        </div>

        <div className="model-caveat">
          <span aria-hidden="true">i</span>
          <p>
            <strong>Sensitivity model—not a forecast.</strong> Safe parameters
            still depend on protocol, networking, participation, and clients.
          </p>
        </div>

      </section>

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
            Decoupled consensus gives availability and finality separate lanes.
          </p>
        </div>

        <div
          className="two-lane-visual"
          role="img"
          aria-label={
            "Moving comparison with one normalized animation step per second; the today and decoupled-candidate lanes are shown twelve times faster than wall clock. Today has 32-slot rounds, green justified blocks after one round, and finality after two rounds or 64 slots. The decoupled candidate has 8-slot rounds, green stabilization after one round, and finality after two rounds or 16 slots. Both show justification above finality-vote progress. The north-star example has one-second blocks, fast confirmation, two-slot one-round finality after two seconds, and finality following the head every slot at a one-second distance."
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
              <small>12-sec blocks · finality speed baseline · ≈{formatDuration(currentFinalityTiming.totalSeconds)} expected</small>
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
              />
            </div>
          </div>
          <div className="consensus-lane lane-decoupled">
            <div className="lane-label">
              <span>Decoupled candidate</span>
              <strong>Stabilization follows the available chain</strong>
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
              />
            </div>
          </div>
          <div className="consensus-lane lane-north-star">
            <div className="lane-label">
              <span>North star</span>
              <strong>One-round finality</strong>
              <small>1-sec blocks · 2-sec finality · 384× finality speedup</small>
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
              />
            </div>
          </div>
          <div className="lane-key" aria-hidden="true">
            <span><i className="key-dot is-teal" />available</span>
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
        <DcVotingPattern />
      </section>

      <section className="pathways-section" id="pathways" aria-labelledby="pathways-title">
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
                  : proposal.role === "timeline"
                    ? "Changes arrival time"
                    : "Tracked, not plotted";

            return (
              <article className={`proposal-row role-${proposal.role}`} key={proposal.id} role="listitem">
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

      <section className="methodology-section" id="methodology" aria-labelledby="methodology-title">
        <div className="methodology-heading">
          <div>
            <h2 id="methodology-title">Methodology</h2>
          </div>
          <p>
            An explicit workload baseline—not a forecast.
          </p>
        </div>

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
          multiply as an exploratory sensitivity. Slot length never changes the
          raw finality-vote throughput.
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
            <span>One-cohort floor</span>
            <strong>{SINGLE_COHORT_FLOOR_SECONDS} sec</strong>
            <small>4 sec delivery + 4 sec aggregation</small>
          </div>
        </div>

        <div className="slot-phase-model" aria-label="Current 12-second slot timing reference">
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

        <div className="finality-method-equation" aria-label="Expected time-to-finality equation">
          <span>Expected time to finality</span>
          <strong>ceil((½ slot + ½ round + rounds × round) ÷ slot) × slot</strong>
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
                <li>Displayed windows round up to whole slots after the eight-second floor.</li>
                <li>Transactions arrive uniformly, giving an expected half-slot wait.</li>
                <li>Finality eligibility aligns at round boundaries, giving an expected half-round wait.</li>
                <li>Stake weight is preserved as identities consolidate.</li>
                <li>Enabled networking gains multiply before the physical floor.</li>
              </ul>
            </div>
            <div>
              <h3>It does not model</h3>
              <ul>
                <li>Safety, recovery, or adversary thresholds of a specific finality gadget.</li>
                <li>Censorship, fee competition, builder delay, or non-uniform transaction arrival.</li>
                <li>Peer topology, loss, geographic latency, or client limits.</li>
                <li>Committee security, aggregation, safety, or liveness.</li>
                <li>The exact historical validator-count record or raw gossip message count.</li>
                <li>Measured interactions between DC, EIP-8334, and EIP-8243.</li>
                <li>A numeric timing effect for ePBS or FOCIL.</li>
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
              The live count attempts a server-side refresh from Beaconcha.in and
              falls back to a visibly dated snapshot, but it is only a chart marker.
              The model uses 1.1M as a rounded historical-high workload scenario,
              not an exact record. Proposal wording was checked against the local
              EIP and EthResearch corpora.
            </p>
            <div className="source-links">
              <a href="https://ethresear.ch/t/lmd-ghost-with-256-validators-and-a-fast-following-finality-gadget/22856" target="_blank" rel="noreferrer">Mainnet attestation workload <ExternalArrow /></a>
              <a href="https://ethresear.ch/t/unblocking-faster-finality-with-decoupled-consensus/24527" target="_blank" rel="noreferrer">Decoupled consensus <ExternalArrow /></a>
              <a href="https://eips.ethereum.org/EIPS/eip-8198" target="_blank" rel="noreferrer">EIP-8198 · Quick Slots <ExternalArrow /></a>
              <a href="https://eips.ethereum.org/EIPS/eip-8243" target="_blank" rel="noreferrer">EIP-8243 · source batching <ExternalArrow /></a>
              <a href="https://ethereum-magicians.org/t/eip-8334-bundled-attestation-propagation/29008" target="_blank" rel="noreferrer">EIP-8334 · bundled propagation <ExternalArrow /></a>
              <a href="https://strawmap.org/" target="_blank" rel="noreferrer">Strawmap roadmap <ExternalArrow /></a>
              <a href="https://pectrified.com/mainnet/validator" target="_blank" rel="noreferrer">Pectrified analytics <ExternalArrow /></a>
              <a href="https://docs.beaconcha.in/api-reference/epochs/epoch-overview" target="_blank" rel="noreferrer">Beaconcha.in epoch API <ExternalArrow /></a>
            </div>
          </div>
        </details>
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
        <a href="#top">Back to top ↑</a>
      </footer>
    </main>
  );
}
