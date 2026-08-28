import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

import {
  MIN_SCENARIO_VALIDATORS,
  REFERENCE_ROUND_SECONDS,
  REFERENCE_VALIDATORS,
  SLOT_SECONDS,
  calculateRoundModel,
} from "../app/lib/model.ts";
import { PROPOSALS } from "../app/lib/proposals.ts";

const WIDTH = 1734;
const HEIGHT = 907;
const outputUrl = new URL("../public/og-wip.png", import.meta.url);
const outputPath = fileURLToPath(outputUrl);
const networkSnapshotUrl = new URL(
  "../app/data/network-snapshot.json",
  import.meta.url,
);
const geistFontUrl = new URL(
  "../node_modules/next/dist/compiled/@vercel/og/Geist-Regular.ttf",
  import.meta.url,
);

const network = JSON.parse(await readFile(networkSnapshotUrl, "utf8"));
const geistFont = (await readFile(geistFontUrl)).toString("base64");

const chart = {
  width: 920,
  height: 600,
  left: 34,
  right: 30,
  top: 34,
  bottom: 34,
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
const maximumReduction = 1 - MIN_SCENARIO_VALIDATORS / scenarioMaximum;
const xFor = (validators) => {
  const reduction = 1 - validators / scenarioMaximum;
  return (
    chart.left +
    (reduction / Math.max(maximumReduction, 0.001)) * plotWidth
  );
};
const yFor = (seconds) =>
  chart.top +
  plotHeight -
  (seconds / maximumRoundSeconds) * plotHeight;

function buildCurvePath(improvements) {
  const parts = [];
  let previousDuration = null;

  for (
    let validators = scenarioMaximum;
    validators >= MIN_SCENARIO_VALIDATORS;
    validators -= 1_000
  ) {
    const result = calculateRoundModel({
      validators,
      slotSeconds: SLOT_SECONDS,
      enabledImprovements: improvements,
    });
    const x = xFor(validators);
    const y = yFor(result.roundSeconds);

    if (parts.length === 0) {
      parts.push(`M ${x} ${y}`);
    } else if (result.roundSeconds === previousDuration) {
      parts.push(`H ${x}`);
    } else {
      parts.push(`H ${x}`, `V ${y}`);
    }

    previousDuration = result.roundSeconds;
  }

  if ((scenarioMaximum - MIN_SCENARIO_VALIDATORS) % 1_000 !== 0) {
    const result = calculateRoundModel({
      validators: MIN_SCENARIO_VALIDATORS,
      slotSeconds: SLOT_SECONDS,
      enabledImprovements: improvements,
    });
    const x = xFor(MIN_SCENARIO_VALIDATORS);
    const y = yFor(result.roundSeconds);
    parts.push(`H ${x}`);
    if (result.roundSeconds !== previousDuration) parts.push(`V ${y}`);
  }

  return parts.join(" ");
}

const baselinePath = buildCurvePath([]);
const dcPath = buildCurvePath(["dc"]);
const bundledPath = buildCurvePath(["dc", "eip-8334"]);
const combinedPath = buildCurvePath(["dc", "eip-8334", "eip-8243"]);
const areaPath = `${baselinePath} L ${xFor(MIN_SCENARIO_VALIDATORS)} ${yFor(0)} L ${xFor(scenarioMaximum)} ${yFor(0)} Z`;
const roundTimeTicks = [0, 96, 192, 288, 384];

const gridMarkup = roundTimeTicks
  .map(
    (tick) => `
      <line class="chart-grid" x1="${chart.left}" x2="${chart.width - chart.right}" y1="${yFor(tick)}" y2="${yFor(tick)}" />`,
  )
  .join("");

const eipLabels = PROPOSALS.filter((proposal) => proposal.eip !== null).map(
  (proposal) => `EIP-${proposal.eip}`,
);
const eipTrackerLabelWidth = 180;
const eipTrackerGap = 10;
const eipTrackerWidth = chart.width - eipTrackerLabelWidth;
const eipChipWidth =
  (eipTrackerWidth - eipTrackerGap * (eipLabels.length - 1)) /
  eipLabels.length;
const eipTrackerMarkup = eipLabels
  .map((label, index) => {
    const x =
      eipTrackerLabelWidth + index * (eipChipWidth + eipTrackerGap);

    return `
      <g transform="translate(${x} 0)">
        <rect width="${eipChipWidth}" height="50" rx="25" fill="#f3eee4" stroke="#d8cdba" stroke-width="1.5" />
        <text x="${eipChipWidth / 2}" y="33" text-anchor="middle" fill="#2e281e" font-size="22" font-weight="560">${label}</text>
      </g>`;
  })
  .join("");

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <style>
      @font-face {
        font-family: "Geist OG";
        src: url("data:font/truetype;base64,${geistFont}") format("truetype");
        font-weight: 100 900;
      }
      text { font-family: "Geist OG", Arial, sans-serif; }
      .chart-grid { stroke: #e5dccd; stroke-width: 1.5; }
      .curve { fill: none; vector-effect: non-scaling-stroke; }
      .legend-line { fill: none; stroke-width: 4; }
    </style>
    <filter id="card-shadow" x="-20%" y="-20%" width="140%" height="150%">
      <feDropShadow dx="0" dy="18" stdDeviation="24" flood-color="#5b4b36" flood-opacity="0.09" />
    </filter>
    <linearGradient id="page-glow" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#edf5ff" stop-opacity="0.8" />
      <stop offset="1" stop-color="#e1e8d7" stop-opacity="0" />
    </linearGradient>
  </defs>

  <rect width="${WIDTH}" height="${HEIGHT}" fill="#f7f2e8" />
  <circle cx="1620" cy="56" r="330" fill="url(#page-glow)" />
  <circle cx="85" cy="868" r="210" fill="#eee5d7" opacity="0.48" />

  <g aria-label="finality.watch">
    <g transform="translate(99 79)">
      <rect x="0" y="25" width="10" height="15" rx="5" fill="#84b6ef" />
      <rect x="18" y="14" width="10" height="26" rx="5" fill="#2f6247" />
      <rect x="36" y="0" width="10" height="40" rx="5" fill="#366f79" />
    </g>
    <text x="166" y="118" font-size="43" font-weight="650" letter-spacing="-1.9">
      <tspan fill="#2e281e">finality</tspan><tspan fill="#2f6247">.watch</tspan>
    </text>
  </g>

  <text x="94" y="349" fill="#2e281e" font-size="98" font-weight="520" letter-spacing="-5.8">Ethereum</text>
  <text x="94" y="445" fill="#2e281e" font-size="98" font-weight="520" letter-spacing="-5.8">finality</text>
  <text x="94" y="541" fill="#2f6247" font-size="98" font-weight="520" letter-spacing="-5.8">explorer</text>

  <rect x="648" y="58" width="1026" height="791" rx="26" fill="#fcf9f2" stroke="#d8cdba" stroke-width="1.5" filter="url(#card-shadow)" />

  <text x="702" y="119" fill="#2e281e" font-size="30" font-weight="620" letter-spacing="-0.8">Round-time dashboard</text>

  <g transform="translate(1026 111)" fill="#5d5549" font-size="20" font-weight="520">
    <line class="legend-line" x1="0" x2="32" y1="0" y2="0" stroke="#2f6247" />
    <text x="43" y="7">Baseline</text>

    <line class="legend-line" x1="140" x2="172" y1="0" y2="0" stroke="#2f6247" />
    <text x="183" y="7">+ DC</text>

    <line class="legend-line" x1="250" x2="282" y1="0" y2="0" stroke="#366f79" stroke-dasharray="10 7" />
    <text x="293" y="7">+ EIP-8334</text>

    <line class="legend-line" x1="430" x2="462" y1="0" y2="0" stroke="#244635" stroke-dasharray="15 6 3 6" />
    <text x="473" y="7">+ EIP-8243</text>
  </g>

  <g transform="translate(702 118)">
    ${gridMarkup}

    <path d="${areaPath}" fill="#e1e8d8" opacity="0.92" />
    <path class="curve" d="${baselinePath}" stroke="#2f6247" stroke-width="4.4" />
    <path class="curve" d="${dcPath}" stroke="#2f6247" stroke-width="4" />
    <path class="curve" d="${bundledPath}" stroke="#366f79" stroke-width="4.2" stroke-dasharray="12 8" />
    <path class="curve" d="${combinedPath}" stroke="#244635" stroke-width="4.6" stroke-dasharray="18 7 3 7" />
  </g>

  <line x1="702" x2="1622" y1="724" y2="724" stroke="#e5dccd" stroke-width="1.5" />
  <g transform="translate(702 754)">
    <text x="0" y="33" fill="#2f6247" font-size="24" font-weight="620">EIP tracker</text>
    ${eipTrackerMarkup}
  </g>
</svg>`;

await sharp(Buffer.from(svg))
  .png({ compressionLevel: 9, effort: 10 })
  .toFile(outputPath);

console.log(`Generated ${outputPath} (${WIDTH}×${HEIGHT})`);
