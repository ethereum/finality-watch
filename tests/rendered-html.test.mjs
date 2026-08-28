import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { access, readFile } from "node:fs/promises";
import { createServer } from "node:net";
import test, { after, before } from "node:test";
import { fileURLToPath } from "node:url";

const projectDirectory = fileURLToPath(new URL("..", import.meta.url));
const nextCli = fileURLToPath(
  new URL("../node_modules/next/dist/bin/next", import.meta.url),
);
let serverOrigin = "";
let serverProcess;
let serverOutput = "";

function findAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate a local test port"));
        return;
      }

      server.close((error) => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });
}

before(async () => {
  const port = await findAvailablePort();
  serverOrigin = `http://127.0.0.1:${port}`;
  serverProcess = spawn(
    process.execPath,
    [nextCli, "start", "--hostname", "127.0.0.1", "--port", String(port)],
    {
      cwd: projectDirectory,
      env: { ...process.env, NODE_ENV: "production" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  const recordOutput = (chunk) => {
    serverOutput = `${serverOutput}${chunk}`.slice(-12_000);
  };
  serverProcess.stdout.on("data", recordOutput);
  serverProcess.stderr.on("data", recordOutput);

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (serverProcess.exitCode !== null) {
      throw new Error(`Next.js test server exited early:\n${serverOutput}`);
    }

    try {
      const response = await fetch(serverOrigin, { redirect: "manual" });
      if (response.status < 500) return;
    } catch {
      // The server is still starting.
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Next.js test server did not become ready:\n${serverOutput}`);
}, { timeout: 35_000 });

after(async () => {
  if (!serverProcess || serverProcess.exitCode !== null) return;
  serverProcess.kill("SIGTERM");
  await Promise.race([
    once(serverProcess, "exit"),
    new Promise((resolve) => setTimeout(resolve, 3_000)),
  ]);
});

async function render(pathname = "/", requestHeaders = {}) {
  return fetch(`${serverOrigin}${pathname}`, {
    headers: {
      accept: "text/html",
      "x-forwarded-host": "finality.watch",
      "x-forwarded-proto": "https",
      ...requestHeaders,
    },
    redirect: "manual",
  });
}

test("server-renders the consolidation explorer", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  const snapshot = JSON.parse(
    await readFile(new URL("../app/data/network-snapshot.json", import.meta.url), "utf8"),
  );
  const fragmentTargets = new Set(
    [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]),
  );
  const fragmentLinks = [...html.matchAll(/\shref="#([^"]+)"/g)].map(
    (match) => match[1],
  );

  for (const fragment of fragmentLinks) {
    assert.ok(fragmentTargets.has(fragment), `Missing target for #${fragment}`);
  }

  assert.match(html, /<title>finality\.watch — Ethereum finality explorer<\/title>/i);
  assert.match(
    html,
    /<meta name="robots" content="noindex, nofollow"\s*\/?>/i,
  );
  assert.match(html, /finality<span>\.watch<\/span>/);
  assert.match(
    html,
    /Work in progress[\s\S]*?Share feedback/,
  );
  assert.equal(
    html.split(
      'href="https://github.com/ethereum/finality-watch/issues/new/choose"',
    ).length - 1,
    2,
  );
  assert.match(
    html,
    /class="footer-links"[\s\S]*?href="https:\/\/github\.com\/ethereum\/finality-watch"[\s\S]*?View source/,
  );
  assert.match(
    html,
    /href="https:\/\/ethresear\.ch\/t\/unblocking-faster-finality-with-decoupled-consensus\/24527"/,
  );
  assert.match(html, /Finality explorer/);
  assert.match(html, /<a href="#methodology">Model<\/a>/);
  assert.match(html, /id="model"/);
  assert.match(html, /id="methodology"/);
  assert.doesNotMatch(html, /(?:href="#|id=")impact"/);
  assert.doesNotMatch(html, /Consolidate validators\.|Consolidation matters/);
  assert.match(html, /Full-set round/);
  assert.ok(html.includes("Slots / round"));
  assert.match(html, /Modeled expected finality/);
  assert.match(html, /Consolidation progress/);
  assert.match(
    html,
    /Consolidation progress[\s\S]*?href="https:\/\/pectrified\.com\/mainnet"[\s\S]*?Pectrified/,
  );
  assert.match(
    html,
    /Selected point:[\s\S]*?12 sec[\s\S]*?full-set round/,
  );
  assert.match(html, /class="consensus-title"[^>]*>\s*Consensus changes visualized\./);
  assert.doesNotMatch(html, /Save network work now|What can one staker take off the network\?|Your impact/);
  assert.doesNotMatch(html, /(?:href|id)="(?:#)?(?:calculator|decentralization)"/);
  assert.match(html, /<h2 id="pathways-title">Relevant Proposals<\/h2>/);
  assert.match(
    html,
    /<h2 class="sr-only" id="methodology-title">Methodology<\/h2>/,
  );
  assert.doesNotMatch(html, /Make the trailing lane practical|Simple enough to challenge/);
  assert.match(html, /EIP-7251/);
  assert.match(html, /Simplified model—not a forecast/);
  assert.doesNotMatch(html, /sensitivity/i);
  assert.doesNotMatch(html, /Blocks keep moving\. Finality follows\.|Future consensus improvements|To be cultivated/);
  assert.doesNotMatch(html, /Garden model · leaf venation|Many independent tips/);
  assert.match(html, /Slot time/);
  assert.match(html, /min="1" max="12" step="1"/);
  assert.match(html, /<legend[^>]*>Finality rounds<\/legend>/);
  assert.match(
    html,
    /class="control-heading finality-rounds-heading"[\s\S]*?Finality rounds[\s\S]*?aria-label="About finality rounds"/,
  );
  const finalityRadioInputs = [...html.matchAll(/<input\b[^>]*>/g)]
    .map((match) => match[0])
    .filter((tag) => /name="finality-rounds"/.test(tag));
  assert.equal(finalityRadioInputs.length, 2);
  assert.ok(finalityRadioInputs.every((tag) => /type="radio"/.test(tag)));
  assert.deepEqual(
    finalityRadioInputs.map((tag) => tag.match(/value="([12])"/)?.[1]).sort(),
    ["1", "2"],
  );
  assert.equal(finalityRadioInputs.filter((tag) => /checked=""/.test(tag)).length, 1);
  assert.doesNotMatch(html, /active throughput gain/);
  assert.match(html, /Modeled expected finality[\s\S]*?36 sec/);
  assert.match(
    html.replaceAll("<!-- -->", ""),
    /Exploratory scenario—not a forecast\.[\s\S]*?128k identities[\s\S]*?4× stacked networking gain/,
  );
  assert.match(html, /Coupled today[\s\S]*?16m 6s[\s\S]*?expected/);
  assert.match(html, /384s × identities ÷ 1\.1M ÷ stacked gain/);
  assert.match(html, /ceil\(max\(4s, raw\) ÷ slot\) × slot/);
  assert.match(
    html,
    /½ slot \+ ½ finality-gadget round \+ rounds × round/,
  );
  assert.match(html, /Dynamic timing diagram · schematic widths/);
  assert.match(html, /Transaction arrival → finality/);
  assert.match(
    html,
    /aria-controls="expected-finality-breakdown" aria-expanded="false" class="metric-breakdown-trigger"/,
  );
  assert.match(html, /View calculation/);
  assert.match(
    html,
    /<section class="finality-layer" aria-label="Expected finality explanation" hidden="" id="expected-finality-breakdown">/,
  );
  assert.match(
    html,
    /id="expected-finality-breakdown">[\s\S]*?class="finality-explainer"[\s\S]*?Timing breakdown[\s\S]*?Dynamic timing diagram[\s\S]*?Transaction arrival → finality[\s\S]*?<\/section>/,
  );
  assert.doesNotMatch(html, /finality-equation-expanded|Calculation detail/);
  assert.doesNotMatch(html, /<details class="finality-explainer"/);
  assert.doesNotMatch(html, /Behind the blue number|View timing breakdown/);
  assert.doesNotMatch(html, /More info &amp; visualization/);
  const sliderInputPosition = html.indexOf('id="validator-scenario"');
  const capacityChartPosition = html.indexOf('<svg class="capacity-chart"');
  assert.ok(sliderInputPosition >= 0);
  assert.ok(capacityChartPosition >= 0);
  assert.ok(
    sliderInputPosition < capacityChartPosition,
  );
  assert.match(html, /Inclusion[\s\S]*?6 sec/);
  assert.match(html, /Wait for finality-gadget input[\s\S]*?6 sec/);
  assert.match(html, /Block enters finality-gadget round/);
  assert.match(html, /Expected wait to voting[\s\S]*?12 sec/);
  assert.match(
    html,
    /class="finality-timing-stage is-voting"[\s\S]*?Justification/,
  );
  assert.match(html, /first completed voting round marks justification/);
  assert.doesNotMatch(html, /Round 1 complete/);
  assert.equal(
    (html.match(/class="finality-timing-stage is-voting"/g) ?? []).length,
    2,
  );
  assert.match(
    html,
    /class="finality-timing-stage is-voting"[\s\S]*?12 sec/,
  );
  assert.match(html, /independent half-round wait/);
  assert.doesNotMatch(html, /finality-timing-quantities/);
  assert.doesNotMatch(html, /round up to [\d.]+ slots/);
  assert.match(html, /One-round finality gadget/);
  assert.match(html, /EIP-8198/);
  assert.match(html, /EIP-8243/);
  assert.match(html, /EIP-8334/);
  assert.doesNotMatch(html, /EIP-7732|\bePBS\b/);
  assert.doesNotMatch(html, /EIP-7805|FOCIL/);
  assert.equal((html.match(/class="proposal-row role-/g) ?? []).length, 7);
  assert.match(
    html,
    /class="proposal-tracker"[\s\S]*?Decoupled consensus[\s\S]*?One-round finality gadget/,
  );
  assert.doesNotMatch(html, /Awaiting measurements/);
  assert.match(html, /<span>DC<\/span>[\s\S]*?<b>4×<\/b>[\s\S]*?Included/);
  assert.match(html, /<span>Bundling<\/span>[\s\S]*?<b>2×<\/b>/);
  assert.match(html, /<span>Bundling<\/span>[\s\S]*?Add to model/);
  assert.match(html, /<span>Source batching<\/span>[\s\S]*?<b>1×<\/b>[\s\S]*?Add to model/);
  assert.doesNotMatch(html, /Included ·|Add ·/);
  const improvementCards = [
    ...html.matchAll(
      /<button[^>]*class="improvement-button[^"]*"[^>]*>([\s\S]*?)<\/button>/g,
    ),
  ].map((match) => match[1]);
  assert.equal(improvementCards.length, 3);
  for (const card of improvementCards) {
    assert.equal(
      (card.match(/(?:up to )?\d+(?:\.\d+)?×/g) ?? []).length,
      1,
      "Each networking card should render exactly one multiplier",
    );
  }
  assert.match(html, /Round networking ·[\s\S]*?4×[\s\S]*?active/);
  assert.doesNotMatch(html, /Modeled full-set networking speedup/);
  assert.doesNotMatch(html, /Compared with today’s full-set voting path/);
  assert.equal((html.match(/class="info-surface-trigger"/g) ?? []).length, 7);
  assert.doesNotMatch(html, /aria-haspopup="dialog"/);
  assert.doesNotMatch(html, /class="control-help-panel/);
  assert.doesNotMatch(html, /<details class="control-help/);
  assert.match(html, /id="proposal-dc"[\s\S]*?tabindex="-1"/);
  for (const proposalId of [
    "dc",
    "eip-8334",
    "eip-8243",
    "one-round-finality",
    "eip-8198",
    "eip-7251",
  ]) {
    assert.match(html, new RegExp(`id="proposal-${proposalId}"`));
  }
  assert.doesNotMatch(html, /4× source batching/);
  assert.match(html, /34,375[\s\S]*?assigned attesters per current slot/);
  assert.match(html, /Historical workload reference/);
  assert.match(html, /131,072[\s\S]*?not measured throughput/);
  assert.match(html, /Decentralization floor[\s\S]*?<strong>4[\s\S]*?sec<\/strong>/);
  assert.match(
    html,
    /Assumed guardrail for geographic fairness and reasonable node[\s\S]*?requirements—not a measured limit/,
  );
  assert.match(html, /Current 12-second slot[\s\S]*?0–4s[\s\S]*?4–8s[\s\S]*?8–12s/);
  assert.match(html, /Local EIP snapshot[\s\S]*?2026-08-28/);
  assert.match(html, /reviewed[\s\S]*?2026-08-28/);
  assert.match(
    html,
    new RegExp(
      `Network snapshot[\\s\\S]*?${snapshot.activeValidators.toLocaleString("en-US")}`,
    ),
  );
  assert.match(
    html,
    new RegExp(`Epoch ${snapshot.epoch.toLocaleString("en-US")}`),
  );
  assert.match(html, /beaconscan\.com/);
  assert.match(html, /EIP-8061[\s\S]*?Review[\s\S]*?Scheduled · Glamsterdam/);
  assert.match(html, /EIP-8198[\s\S]*?Hegotá PFI · meta update pending/);
  assert.match(html, /EIP-8243[\s\S]*?Hegotá · proposed for inclusion/);
  assert.match(html, /EIP-8334[\s\S]*?Draft PR[\s\S]*?Hegotá PFI · meta update pending/);
  assert.match(html, /North star/);
  assert.match(html, /1-sec blocks · 2-sec protocol finality lag/);
  assert.match(html, /4× finality speedup/);
  assert.match(html, /32[\s\S]*?slots \/ round[\s\S]*?32 slots to justify · 64 to finalize/);
  assert.match(html, /8[\s\S]*?slots \/ round[\s\S]*?16-slot finality lag/);
  assert.match(html, /North star[\s\S]*?<b>2<\/b>[\s\S]*?slots \/ round[\s\S]*?finality follows every 1 sec/);
  assert.match(html, /Today \+ DC[\s\S]*?12× sped up/);
  assert.match(html, /fast confirmed/);
  assert.match(html, /Stabilization follows fast confirmation/);
  assert.match(html, /justified today · stabilized in DC/);
  assert.doesNotMatch(html, />available<\/span>/);
  assert.match(html, /One visual step = one slot[\s\S]*?finality flips at 100%/);
  assert.match(
    html,
    /id="proposal-dc"[\s\S]*?<\/details>[\s\S]*?href="#voting-pattern"[\s\S]*?id="voting-pattern"/,
  );
  const dcProposalStart = html.indexOf('id="proposal-dc"');
  const dcProposalEnd = html.indexOf("</article>", dcProposalStart);
  const votingPatternAnchor = html.indexOf('id="voting-pattern"');
  assert.ok(dcProposalStart >= 0);
  assert.ok(dcProposalEnd > dcProposalStart);
  assert.ok(votingPatternAnchor > dcProposalStart);
  assert.ok(votingPatternAnchor < dcProposalEnd);
  assert.match(html, /Visualization/);
  assert.doesNotMatch(html, /Decoupled voting pattern/);
  assert.doesNotMatch(html, /One validator set\. Eight slot cohorts\./);
  assert.doesNotMatch(html, /proposal-voting-disclosure/);
  assert.doesNotMatch(html, /proposal-voting-panel/);
  assert.doesNotMatch(html, /class="dc-voting-pattern/);
  assert.equal((html.match(/class="dc-pipeline(?:\s|")/g) ?? []).length, 3);
  assert.equal((html.match(/<small>finality votes<\/small>/g) ?? []).length, 3);
  assert.equal((html.match(/<small>justification<\/small>/g) ?? []).length, 2);
  assert.equal((html.match(/>Pause animations<\/button>/g) ?? []).length, 1);
  assert.match(html, /16k scenario/);
  assert.doesNotMatch(html, /16\.0k scenario/);
  assert.doesNotMatch(html, /100k reference/);
  assert.doesNotMatch(html, /100k base target/);
  assert.match(html, /128k target/);
  assert.doesNotMatch(html, /32k stretch target/);
  assert.match(
    html,
    /aria-label="Modeled full-set round time falls as consolidation increases" aria-describedby="capacity-chart-description"/,
  );
  assert.doesNotMatch(html, /<title id="capacity-chart-title">/);
  assert.match(html, /https:\/\/finality\.watch\/og-wip\.png/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Building your site/);

  const resultsPosition = html.indexOf('class="model-primary-results"');
  const controlsPosition = html.indexOf('class="improvement-toolbar"');
  const networkingPosition = html.indexOf('class="improvement-group improvement-networking"');
  const roundsPosition = html.indexOf('class="improvement-group improvement-rounds"');
  const slotTimePosition = html.indexOf('class="improvement-group slot-time-control"');
  const finalityLayerPosition = html.indexOf('class="finality-layer"');
  const rangePosition = html.indexOf('class="range-control chart-axis-control"');
  const chartPosition = html.indexOf('class="chart-wrap"');
  const chartSvgPosition = html.indexOf('<svg class="capacity-chart"');
  const modelPosition = html.indexOf('id="model"');
  const methodologyPosition = html.indexOf('id="methodology"');
  const pathwaysPosition = html.indexOf('id="pathways"');
  const decouplingPosition = html.indexOf('id="decoupling"');
  assert.ok(resultsPosition < controlsPosition);
  assert.ok(resultsPosition < finalityLayerPosition);
  assert.ok(finalityLayerPosition < controlsPosition);
  assert.ok(controlsPosition < networkingPosition);
  assert.ok(networkingPosition < roundsPosition);
  assert.ok(roundsPosition < slotTimePosition);
  assert.ok(slotTimePosition < rangePosition);
  assert.ok(controlsPosition < rangePosition);
  assert.ok(chartPosition < rangePosition);
  assert.ok(rangePosition < chartSvgPosition);
  assert.ok(modelPosition < methodologyPosition);
  assert.ok(methodologyPosition < pathwaysPosition);
  assert.ok(pathwaysPosition < decouplingPosition);
  assert.match(html, /<details class="methodology-disclosure">/);
  assert.doesNotMatch(html, /<details class="methodology-disclosure" open/);
  assert.match(
    html,
    /<details class="methodology-disclosure">[\s\S]*?<summary>[\s\S]*?Methodology[\s\S]*?Simplified model—not a forecast[\s\S]*?View details[\s\S]*?<\/summary>[\s\S]*?Raw full-set round[\s\S]*?<\/details>/,
  );
  assert.doesNotMatch(html, /class="model-caveat"/);
});

test("removes the disposable starter and uses product metadata", async () => {
  const [
    page,
    layout,
    packageJson,
    pipeline,
    styles,
    nextConfig,
    netlifyConfig,
    readme,
    updater,
    snapshotText,
  ] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../app/components/DcPipeline.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../next.config.ts", import.meta.url), "utf8"),
    readFile(new URL("../netlify.toml", import.meta.url), "utf8"),
    readFile(new URL("../README.md", import.meta.url), "utf8"),
    readFile(
      new URL("../scripts/update-network-snapshot.mjs", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../app/data/network-snapshot.json", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(page, /api\/network-summary/);
  assert.match(page, /network-snapshot\.json/);
  assert.match(page, /calculateRoundModel/);
  assert.match(page, /<span>\{improvement\.shortLabel\}<\/span>/);
  assert.match(page, /<b>\{formatGain\(displayedGain\)\}<\/b>/);
  assert.match(
    page,
    /calculateRoundImprovementGain\([\s\S]*?improvement\.id[\s\S]*?model\.validators/,
  );
  assert.match(page, /active \? "Included" : "Add to model"/);
  assert.doesNotMatch(page, /Included ·|Add ·/);
  assert.match(page, /candidate\.shortLabel[\s\S]*?candidate\.gainLabel/);
  assert.doesNotMatch(page, /tickMs=\{12_000\}/);
  assert.equal((page.match(/tickMs=\{1_000\}/g) ?? []).length, 3);
  assert.match(page, /roundSlots=\{2\}[\s\S]*?finalityRounds=\{1\}/);
  assert.doesNotMatch(pipeline, /stagePosition/);
  assert.match(pipeline, /position = config\.headPosition/);
  assert.match(styles, /container-type: inline-size/);
  assert.match(styles, /\.finality-timing-track \{[\s\S]*?display: flex/);
  assert.match(
    styles,
    /\.finality-timing-finish \{[\s\S]*?top: -24px;[\s\S]*?margin-left: -6px;/,
  );
  assert.match(
    styles,
    /@media \(max-width: 780px\)[\s\S]*?\.finality-timing-track \{[\s\S]*?display: grid/,
  );
  assert.match(
    styles,
    /@media \(max-width: 780px\)[\s\S]*?\.finality-timing-finish::after \{[\s\S]*?left: -14px;/,
  );
  assert.match(
    styles,
    /grid-template-columns: minmax\(330px, 1\.3fr\) minmax\(205px, 0\.58fr\) minmax\(225px, 0\.72fr\)/,
  );
  assert.match(
    styles,
    /\.model-primary-results \.finality-result \{[\s\S]*?border-radius: 0;[\s\S]*?background: transparent;[\s\S]*?box-shadow: none;/,
  );
  assert.match(styles, /--surface-blue: #dfe6e8/);
  assert.doesNotMatch(
    styles,
    /\.model-primary-results \.finality-result strong \.approximate-value/,
  );
  assert.match(styles, /@media \(forced-colors: active\)/);
  assert.match(
    styles,
    /\.improvement-rounds > \.round-options \{[\s\S]*?background: var\(--surface-mint\)/,
  );
  assert.match(
    styles,
    /\.improvement-rounds label > span \{[\s\S]*?min-height: 44px[\s\S]*?border-radius: 10px/,
  );
  assert.match(
    styles,
    /\.improvement-rounds input:checked \+ span \{[\s\S]*?background: var\(--surface\)/,
  );
  assert.match(
    styles,
    /\.improvement-buttons \{[\s\S]*?grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/,
  );
  assert.match(
    styles,
    /\.model-toolbar \.model-primary-results > div > strong \{[\s\S]*?2\.15rem[\s\S]*?white-space: nowrap/,
  );
  assert.match(
    styles,
    /\.finality-explainer \{[\s\S]*?border: 1px solid rgba\(54, 111, 121, 0\.32\)[\s\S]*?border-left: 3px solid var\(--teal\)[\s\S]*?background: var\(--surface\)/,
  );
  assert.match(
    styles,
    /\.metric-breakdown-trigger \{[\s\S]*?width: auto[\s\S]*?background: transparent/,
  );
  assert.match(
    styles,
    /\.metric-breakdown-trigger \{[\s\S]*?white-space: nowrap/,
  );
  assert.match(
    styles,
    /\.approximation-mark \{[\s\S]*?transform: translateY\(-0\.1em\)/,
  );
  assert.match(
    styles,
    /\.approximate-value \{[\s\S]*?display: inline-flex[\s\S]*?white-space: nowrap/,
  );
  assert.match(styles, /\.model-primary-results > div > span,/);
  assert.doesNotMatch(styles, /\.model-primary-results span,/);
  assert.match(styles, /\.curve-readout > span,/);
  assert.match(styles, /\.lane-label > span,/);
  assert.match(
    styles,
    /\.finality-timing-heading > div:first-child > span,[\s\S]*?\.finality-timing-total > span/,
  );
  assert.match(styles, /\.finality-layer\[hidden\] \{[\s\S]*?display: none/);
  assert.match(
    styles,
    /\.finality-explainer \.finality-timing-diagram \{[\s\S]*?background: transparent/,
  );
  assert.match(
    styles,
    /@media \(min-width: 681px\) and \(max-width: 1040px\)[\s\S]*?\.improvement-networking \{[\s\S]*?grid-column: 1 \/ -1/,
  );
  assert.match(
    styles,
    /\.chart-axis-control \{[\s\S]*?margin: 16px 3\.2609% 0 8\.4783%/,
  );
  assert.match(styles, /\.info-surface-trigger:focus-visible/);
  assert.match(
    styles,
    /\.finality-rounds-heading > \.info-surface-trigger \{[\s\S]*?margin-block: -7px/,
  );
  assert.match(
    styles,
    /\.improvement-control > \.info-surface-trigger \{[\s\S]*?position: absolute/,
  );
  assert.match(
    styles,
    /@media \(max-width: 680px\)[\s\S]*?\.improvement-control \.improvement-button \{[\s\S]*?padding-right: 54px/,
  );
  assert.match(
    styles,
    /\.control-help-panel \{[\s\S]*?grid-column: 1 \/ -1[\s\S]*?border-left: 3px solid var\(--help-accent\)[\s\S]*?background: var\(--surface\)[\s\S]*?background: color-mix\(in srgb, var\(--help-accent\) 7%, var\(--surface\)\)/,
  );
  assert.doesNotMatch(styles, /--help-tint/);
  assert.match(
    styles,
    /\.control-help-panel-content \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/,
  );
  assert.match(
    styles,
    /\.control-help-footer \{[\s\S]*?background: transparent/,
  );
  const finalityExplainerRules = [
    ...styles.matchAll(/\.finality-explainer \{([^}]*)\}/g),
  ];
  const activeFinalityExplainerRule = finalityExplainerRules.at(-1)?.[1] ?? "";
  assert.match(activeFinalityExplainerRule, /background: var\(--surface\)/);
  assert.doesNotMatch(activeFinalityExplainerRule, /linear-gradient/);
  assert.match(styles, /\.control-help-panel\.placement-networking/);
  assert.doesNotMatch(styles, /\.proposal-row:target/);
  assert.match(styles, /\.proposal-row\.is-referenced/);
  assert.match(styles, /@keyframes proposal-reference/);
  assert.doesNotMatch(styles, /\.improvement-rounds label > span::before/);
  assert.match(styles, /@keyframes dc-block-arrive/);
  assert.match(
    page,
    /scenarioMaximum - Number\(event\.target\.value\)/,
  );
  assert.doesNotMatch(page, /dismissOnOutsidePress|aria-haspopup="dialog"/);
  assert.match(page, /event\.key !== "Escape"/);
  assert.match(page, /role="region"/);
  assert.match(page, /What it changes/);
  assert.match(page, /Effect in this model/);
  assert.match(page, /Find in proposal tracker/);
  assert.match(page, /target\.focus\(\{ preventScroll: true \}\)/);
  assert.match(page, /finality-breakdown-trigger/);
  assert.match(page, /hidden=\{!showFinalityExplainer\}/);
  assert.match(page, /target\.classList\.add\("is-referenced"\)/);
  assert.match(page, /1_800/);
  assert.match(page, /left: 78/);
  assert.match(page, /translate\(13 \$\{chart\.top \+ plotHeight \/ 2\}\)/);
  assert.match(layout, /finality\.watch/);
  assert.match(layout, /robots:\s*\{[\s\S]*?index: false,[\s\S]*?follow: false/);
  assert.match(layout, /themeColor: "#f7f2e8"/);
  assert.match(layout, /card: "summary_large_image"/);
  assert.match(layout, /\/og-wip\.png/);
  assert.match(packageJson, /"name": "finality-watch"/);
  assert.match(packageJson, /"snapshot:network"/);
  assert.match(packageJson, /"dev": "next dev --webpack"/);
  assert.match(packageJson, /"build": "next build --webpack"/);
  assert.match(packageJson, /"start": "next start"/);
  assert.doesNotMatch(packageJson, /vinext|wrangler|@cloudflare\/vite-plugin|@vitejs/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.doesNotMatch(page, /SkeletonPreview|codex-preview/);
  assert.match(nextConfig, /Content-Security-Policy/);
  assert.match(nextConfig, /Netlify serves the native Next\.js build/);
  assert.match(netlifyConfig, /command = "npm run build"/);
  assert.match(netlifyConfig, /publish = "\.next"/);
  assert.match(readme, /\[finality\.watch\]\(https:\/\/finality\.watch\)/);
  assert.match(readme, /Production is hosted on Netlify/);
  assert.doesNotMatch(readme, /chatgpt\.site|\.openai\/hosting\.json|canonical Sites project/);
  assert.doesNotMatch(layout, /chatgpt\.site|SITES_ORIGIN|SITES_HOST/);
  assert.match(updater, /apikey: apiKey/);
  assert.doesNotMatch(updater, /searchParams\.set\(["']apikey/);

  const snapshot = JSON.parse(snapshotText);
  assert.ok(Number.isSafeInteger(snapshot.activeValidators));
  assert.ok(snapshot.activeValidators >= 32_000);
  assert.ok(snapshot.activeValidators <= 2_000_000);
  assert.ok(Number.isSafeInteger(snapshot.epoch));
  assert.ok(snapshot.epoch > 0);
  assert.ok(!Number.isNaN(Date.parse(snapshot.observedAt)));
  assert.equal(snapshot.source, "beaconscan.com");

  await access(new URL("../public/og-wip.png", import.meta.url));
  await assert.rejects(access(new URL("../app/_sites-preview/", import.meta.url)));
  await assert.rejects(access(new URL("../.openai/hosting.json", import.meta.url)));
  await assert.rejects(access(new URL("../vite.config.ts", import.meta.url)));
  await assert.rejects(access(new URL("../worker/index.ts", import.meta.url)));
  await assert.rejects(
    access(new URL("../build/sites-vite-plugin.ts", import.meta.url)),
  );
  await assert.rejects(
    access(new URL("../app/api/network-summary/route.ts", import.meta.url)),
  );
});

test("adds security headers to server-rendered responses", async () => {
  const response = await render();

  assert.match(
    response.headers.get("content-security-policy") ?? "",
    /frame-ancestors 'none'/,
  );
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(
    response.headers.get("referrer-policy"),
    "strict-origin-when-cross-origin",
  );
  assert.equal(response.headers.get("strict-transport-security"), "max-age=31536000");
});

test("falls back to the canonical origin for unrecognized forwarded hosts", async () => {
  const response = await render("/", {
    "x-forwarded-host": "attacker.chatgpt.site",
  });
  const html = await response.text();

  assert.doesNotMatch(html, /attacker\.chatgpt\.site/);
  assert.match(
    html,
    /https:\/\/finality\.watch\/og-wip\.png/,
  );
});
