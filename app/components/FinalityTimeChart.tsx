"use client";

import { useMemo } from "react";
import {
  MIN_SCENARIO_VALIDATORS,
  REFERENCE_ROUND_SECONDS,
  SLOT_SECONDS,
  calculateRoundModel,
  formatCompactCount,
  formatDuration,
  type RoundImprovementId,
} from "../lib/model";
import {
  CONFIRMATION_SLOTS,
  CONSENSUS_PROTOCOLS,
  calculateProtocolTiming,
  improvementsForProtocol,
  type ConsensusProtocolId,
  type ProtocolTiming,
} from "../lib/protocols";

export type ChartGeometry = {
  width: number;
  height: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
};

type CurveSample = {
  validators: number;
  seconds: number | null;
};

const LOG_TICKS = [5, 10, 20, 30, 60, 120, 300, 600, 900, 1_800, 3_600];
const LINEAR_STEPS = [5, 10, 15, 30, 60, 120, 180, 300, 600];

// Durations are shown to a tenth of a second at most.
export function roundedSeconds(value: number) {
  return Math.round(value * 10) / 10;
}

export function plottedSeconds(timing: ProtocolTiming) {
  return timing.available ? roundedSeconds(timing.totalSeconds) : null;
}

// One protocol at one validator count: the round model (with the DC gain for
// decoupled protocols) feeds the protocol's slot-level timing.
export function protocolTimingAt({
  protocol,
  validators,
  slotSeconds,
  finalityRounds,
  networkingImprovements,
}: {
  protocol: ConsensusProtocolId;
  validators: number;
  slotSeconds: number;
  finalityRounds: number;
  networkingImprovements: readonly RoundImprovementId[];
}) {
  const round = calculateRoundModel({
    validators,
    slotSeconds,
    enabledImprovements: improvementsForProtocol(protocol, networkingImprovements),
    finalityRounds,
  });
  return {
    round,
    timing: calculateProtocolTiming({
      protocol,
      slotSeconds: round.slotSeconds,
      roundSlots: round.roundSlots,
      finalityRounds,
    }),
  };
}

export function FinalityTimeChart({
  chart,
  scale,
  xFor,
  validatorTicks,
  scenarioMaximum,
  selectedValidators,
  snapshotValidators,
  slotSeconds,
  finalityRounds,
  networkingImprovements,
  selectedProtocol,
}: {
  chart: ChartGeometry;
  scale: "log" | "linear";
  xFor: (validators: number) => number;
  validatorTicks: readonly number[];
  scenarioMaximum: number;
  selectedValidators: number;
  snapshotValidators: number;
  slotSeconds: number;
  finalityRounds: 1 | 2;
  networkingImprovements: readonly RoundImprovementId[];
  selectedProtocol: ConsensusProtocolId;
}) {
  const compact = chart.width < 600;
  const plotHeight = chart.height - chart.top - chart.bottom;
  const baseline = chart.top + plotHeight;
  const networkingKey = networkingImprovements.join("+");

  const sampledCurves = useMemo(() => {
    const improvements = networkingKey
      ? (networkingKey.split("+") as RoundImprovementId[])
      : [];
    const samples: number[] = [];
    for (
      let validators = scenarioMaximum;
      validators > MIN_SCENARIO_VALIDATORS;
      validators -= 1_000
    ) {
      samples.push(validators);
    }
    samples.push(MIN_SCENARIO_VALIDATORS);

    return CONSENSUS_PROTOCOLS.map((protocol) => ({
      protocol,
      samples: samples.map((validators): CurveSample => {
        const { timing } = protocolTimingAt({
          protocol: protocol.id,
          validators,
          slotSeconds,
          finalityRounds,
          networkingImprovements: improvements,
        });
        return { validators, seconds: plottedSeconds(timing) };
      }),
    }));
  }, [finalityRounds, networkingKey, scenarioMaximum, slotSeconds]);

  const atSelection = new Map(
    CONSENSUS_PROTOCOLS.map((protocol) => [
      protocol.id,
      protocolTimingAt({
        protocol: protocol.id,
        validators: selectedValidators,
        slotSeconds,
        finalityRounds,
        networkingImprovements,
      }).timing,
    ]),
  );

  // Today's protocol, on the same slot-level model as the curves: coupled
  // two-round finality with 32-slot rounds of 12-second slots.
  const todaySeconds = calculateProtocolTiming({
    protocol: "coupled",
    slotSeconds: SLOT_SECONDS,
    roundSlots: REFERENCE_ROUND_SECONDS / SLOT_SECONDS,
    finalityRounds: 2,
  }).totalSeconds;
  const confirmationSeconds = (0.5 + CONFIRMATION_SLOTS) * slotSeconds;
  const plottedValues = sampledCurves.flatMap(({ samples }) =>
    samples.flatMap((sample) => (sample.seconds === null ? [] : [sample.seconds])),
  );
  const domainMinimum = Math.max(
    1,
    Math.min(confirmationSeconds, ...plottedValues) * 0.78,
  );
  const domainMaximum = Math.max(todaySeconds, ...plottedValues) * 1.18;
  const logSpan = Math.log(domainMaximum) - Math.log(domainMinimum);
  const yFor = (seconds: number) =>
    baseline -
    (scale === "log"
      ? (Math.log(Math.max(domainMinimum, seconds)) - Math.log(domainMinimum)) /
        logSpan
      : seconds / domainMaximum) *
      plotHeight;

  let ticks: number[];
  if (scale === "log") {
    ticks = LOG_TICKS.filter(
      (tick) => tick >= domainMinimum && tick <= domainMaximum,
    );
    while (ticks.length > 6) ticks = ticks.filter((_, index) => index % 2 === 0);
  } else {
    const step =
      LINEAR_STEPS.find((candidate) => domainMaximum / candidate <= 5) ?? 900;
    ticks = Array.from(
      { length: Math.floor(domainMaximum / step) + 1 },
      (_, index) => index * step,
    );
  }

  // Step paths: values change only where the whole-slot round length changes.
  const stepPath = (samples: readonly CurveSample[]) => {
    const parts: string[] = [];
    let previous: number | null = null;
    for (const sample of samples) {
      if (sample.seconds === null) break;
      const x = xFor(sample.validators);
      const y = yFor(sample.seconds);
      if (previous === null) parts.push(`M ${x} ${y}`);
      else if (sample.seconds === previous) parts.push(`H ${x}`);
      else parts.push(`H ${x}`, `V ${y}`);
      previous = sample.seconds;
    }
    return parts.join(" ");
  };

  const selectedX = xFor(selectedValidators);
  const todayX = xFor(snapshotValidators);
  const reference128kX = xFor(128_000);
  const selectedTiming = atSelection.get(selectedProtocol);
  const selectedSeconds = selectedTiming ? plottedSeconds(selectedTiming) : null;
  const labelOnLeft = selectedX > chart.width - 150;
  // The today label moves up when it would sit on the selected point's label.
  const restingTodayLabelY = yFor(todaySeconds) - 9;
  const todayLabelY = (() => {
    if (selectedSeconds === null) return restingTodayLabelY;
    const selectedLabelY = yFor(selectedSeconds) - 14;
    const selectedStart = labelOnLeft ? selectedX - 92 : selectedX + 12;
    const todayStart = todayX + 8;
    const todayWidth = compact ? 44 : 116;
    const overlapsX =
      todayStart < selectedStart + 80 && selectedStart < todayStart + todayWidth;
    return overlapsX && Math.abs(selectedLabelY - restingTodayLabelY) < 16
      ? Math.max(12, Math.min(restingTodayLabelY, selectedLabelY) - 16)
      : restingTodayLabelY;
  })();
  const description = CONSENSUS_PROTOCOLS.map((protocol) => {
    const timing = atSelection.get(protocol.id);
    if (!timing?.available) return `${protocol.shortLabel}: research needed`;
    return `${protocol.shortLabel}: about ${formatDuration(roundedSeconds(timing.totalSeconds))}`;
  }).join("; ");

  return (
    <svg
      className="capacity-chart finality-time-chart"
      viewBox={`0 0 ${chart.width} ${chart.height}`}
      role="img"
      aria-label="Expected time to finality for each consensus protocol as consolidation increases"
      aria-describedby="finality-time-chart-description"
    >
      <desc id="finality-time-chart-description">
        Expected time from transaction arrival to finality by consensus protocol,
        as validator identities fall from {formatCompactCount(scenarioMaximum)} to{" "}
        {formatCompactCount(MIN_SCENARIO_VALIDATORS)}, with {slotSeconds}-second
        slots and {finalityRounds === 1 ? "one-round" : "two-round"} finality. At{" "}
        {formatCompactCount(selectedValidators)} identities: {description}. The
        vertical axis uses a {scale} scale.
      </desc>

      {ticks.map((tick) => (
        <g className="chart-grid" key={tick}>
          <line
            x1={chart.left}
            x2={chart.width - chart.right}
            y1={yFor(tick)}
            y2={yFor(tick)}
          />
          <text x={chart.left - 12} y={yFor(tick) + 4} textAnchor="end">
            {tick === 0 ? "0" : formatDuration(tick)}
          </text>
        </g>
      ))}

      <line
        className="confirmation-guide"
        x1={chart.left}
        x2={chart.width - chart.right}
        y1={yFor(confirmationSeconds)}
        y2={yFor(confirmationSeconds)}
      />
      <text
        className="confirmation-label"
        x={chart.left + 6}
        y={yFor(confirmationSeconds) - 7}
        textAnchor="start"
      >
        {compact ? "Fast confirmation" : "DC fast confirmation"} ≈{" "}
        {formatDuration(confirmationSeconds)}
      </text>

      <line
        className="target-guide"
        x1={reference128kX}
        x2={reference128kX}
        y1={chart.top}
        y2={baseline}
      />
      <text
        className="target-label"
        x={reference128kX - 8}
        y={chart.top + 14}
        textAnchor="end"
      >
        {compact ? "128k" : "128k target"}
      </text>

      {sampledCurves.map(({ protocol, samples }) => {
        const path = stepPath(samples);
        if (!path) return null;
        const isSelected = protocol.id === selectedProtocol;
        const timing = atSelection.get(protocol.id);
        const seconds = timing ? plottedSeconds(timing) : null;

        return (
          <g
            className={`protocol-curve ${protocol.strokeClass} ${isSelected ? "is-selected" : ""}`}
            key={protocol.id}
          >
            <path className="protocol-line" d={path} />
            {seconds !== null ? (
              <circle cx={selectedX} cy={yFor(seconds)} r={isSelected ? 5 : 3.5} />
            ) : null}
          </g>
        );
      })}

      <line
        className="selection-guide"
        x1={selectedX}
        x2={selectedX}
        y1={chart.top}
        y2={baseline}
      />
      {selectedSeconds !== null ? (
        <text
          aria-hidden="true"
          className="selected-label"
          x={labelOnLeft ? selectedX - 12 : selectedX + 12}
          y={yFor(selectedSeconds) - 14}
          textAnchor={labelOnLeft ? "end" : "start"}
        >
          <tspan className="approximation-mark-svg">≈</tspan>
          <tspan>{formatDuration(selectedSeconds)}</tspan>
        </text>
      ) : null}

      <circle className="current-point" cx={todayX} cy={yFor(todaySeconds)} r="4" />
      <text
        className="current-label"
        x={todayX + 8}
        y={todayLabelY}
        textAnchor="start"
      >
        {compact ? "Today" : `Today ≈ ${formatDuration(todaySeconds)}`}
      </text>

      {validatorTicks.map((validators, index) => {
        const x = xFor(validators);
        return (
          <g className="x-tick" key={validators}>
            <line x1={x} x2={x} y1={baseline} y2={baseline + 6} />
            <text
              x={x}
              y={baseline + 27}
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
  );
}
