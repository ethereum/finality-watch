import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the consolidation explorer", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
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
  assert.match(html, /finality<span>\.watch<\/span>/);
  assert.match(html, /Finality explorer/);
  assert.match(html, /<a href="#methodology">Model<\/a>/);
  assert.match(html, /id="model"/);
  assert.match(html, /id="methodology"/);
  assert.doesNotMatch(html, /(?:href="#|id=")impact"/);
  assert.doesNotMatch(html, /Consolidate validators\.|Consolidation matters/);
  assert.match(html, /Full-set round/);
  assert.ok(html.includes("Slots / round"));
  assert.match(html, /Expected finality/);
  assert.match(html, /validator identities remaining · fewer →/);
  assert.match(
    html,
    /Selected point:[\s\S]*?12 sec[\s\S]*?full-set round/,
  );
  assert.match(html, /class="consensus-title"[^>]*>\s*Consensus changes visualized\./);
  assert.doesNotMatch(html, /Save network work now|What can one staker take off the network\?|Your impact/);
  assert.doesNotMatch(html, /(?:href|id)="(?:#)?(?:calculator|decentralization)"/);
  assert.match(html, /<h2 id="pathways-title">Relevant Proposals<\/h2>/);
  assert.match(html, /<h2 id="methodology-title">Methodology<\/h2>/);
  assert.doesNotMatch(html, /Make the trailing lane practical|Simple enough to challenge/);
  assert.match(html, /EIP-7251/);
  assert.match(html, /Sensitivity model—not a forecast/);
  assert.doesNotMatch(html, /Blocks keep moving\. Finality follows\.|Future consensus improvements|To be cultivated/);
  assert.doesNotMatch(html, /Garden model · leaf venation|Many independent tips/);
  assert.match(html, /Slot time/);
  assert.match(html, /min="1" max="12" step="1"/);
  assert.match(html, /<legend>Finality rounds<\/legend>/);
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
  assert.match(html, /Expected finality[\s\S]*?36 sec/);
  assert.match(html, /Coupled today[\s\S]*?16m 12s[\s\S]*?expected/);
  assert.match(html, /384s × identities ÷ 1\.1M ÷ stacked gain/);
  assert.match(html, /ceil\(max\(8s, raw\) ÷ slot\) × slot/);
  assert.match(html, /ceil\(\(½ slot \+ ½ round \+ rounds × round\) ÷ slot\) × slot/);
  assert.match(html, /One-round finality gadget/);
  assert.match(html, /EIP-8198/);
  assert.match(html, /EIP-8243/);
  assert.match(html, /EIP-8334/);
  assert.doesNotMatch(html, /Awaiting measurements/);
  assert.match(html, /<span>DC<\/span>[\s\S]*?<b>4×<\/b>[\s\S]*?Included/);
  assert.match(html, /<span>Bundling<\/span>[\s\S]*?<b>2×<\/b>/);
  assert.match(html, /<span>Bundling<\/span>[\s\S]*?Add · 2×/);
  assert.match(html, /<span>Source batching<\/span>[\s\S]*?<b>up to 2×<\/b>[\s\S]*?Add · up to 2×/);
  assert.doesNotMatch(html, /4× source batching/);
  assert.match(html, /34,375[\s\S]*?assigned attesters per current slot/);
  assert.match(html, /Historical workload reference/);
  assert.match(html, /131,072[\s\S]*?not measured throughput/);
  assert.match(html, /4 sec delivery \+ 4 sec aggregation/);
  assert.match(html, /Current 12-second slot[\s\S]*?0–4s[\s\S]*?4–8s[\s\S]*?8–12s/);
  assert.match(html, /Local EIP snapshot[\s\S]*?2026-07-23/);
  assert.match(html, /North star/);
  assert.match(html, /1-sec blocks · 2-sec finality · 384× finality speedup/);
  assert.match(html, /4× finality speedup/);
  assert.match(html, /32[\s\S]*?slots \/ round[\s\S]*?32 slots to justify · 64 to finalize/);
  assert.match(html, /8[\s\S]*?slots \/ round[\s\S]*?16-slot finality lag/);
  assert.match(html, /North star[\s\S]*?<b>2<\/b>[\s\S]*?slots \/ round[\s\S]*?finality follows every 1 sec/);
  assert.match(html, /Today \+ DC[\s\S]*?12× sped up/);
  assert.match(html, /justified today · stabilized in DC/);
  assert.match(html, /One visual step = one slot[\s\S]*?finality flips at 100%/);
  assert.match(html, /Decoupled voting pattern/);
  assert.match(html, /One validator set\. Eight slot cohorts\./);
  assert.match(html, /class="dc-voting-pattern/);
  assert.match(html, /full validator set/i);
  assert.match(html, /AC: fresh sample across the full set/);
  assert.match(html, /cohort assigned to this slot/);
  assert.equal((html.match(/class="dc-pipeline(?:\s|")/g) ?? []).length, 3);
  assert.equal((html.match(/<small>finality votes<\/small>/g) ?? []).length, 3);
  assert.equal((html.match(/<small>justification<\/small>/g) ?? []).length, 2);
  assert.match(html, /16k scenario/);
  assert.doesNotMatch(html, /16\.0k scenario/);
  assert.doesNotMatch(html, /100k reference/);
  assert.doesNotMatch(html, /100k base target/);
  assert.match(html, /128k target/);
  assert.doesNotMatch(html, /32k stretch target/);
  assert.match(html, /aria-labelledby="capacity-chart-title capacity-chart-description"/);
  assert.match(html, /og-finality\.png/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Building your site/);

  const resultsPosition = html.indexOf('class="model-primary-results"');
  const controlsPosition = html.indexOf('class="improvement-toolbar"');
  const networkingPosition = html.indexOf('class="improvement-group improvement-networking"');
  const roundsPosition = html.indexOf('class="improvement-group improvement-rounds"');
  const slotTimePosition = html.indexOf('class="improvement-group slot-time-control"');
  const rangePosition = html.indexOf('class="range-control range-control-above-chart"');
  const chartPosition = html.indexOf('class="chart-wrap"');
  assert.ok(resultsPosition < controlsPosition);
  assert.ok(controlsPosition < networkingPosition);
  assert.ok(networkingPosition < roundsPosition);
  assert.ok(roundsPosition < slotTimePosition);
  assert.ok(slotTimePosition < rangePosition);
  assert.ok(controlsPosition < rangePosition);
  assert.ok(rangePosition < chartPosition);
});

test("removes the disposable starter and uses product metadata", async () => {
  const [page, layout, packageJson, pipeline, styles] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../app/components/DcPipeline.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /api\/network-summary/);
  assert.match(page, /calculateRoundModel/);
  assert.match(page, /<span>\{improvement\.shortLabel\}<\/span>/);
  assert.match(page, /<b>\{improvement\.gainLabel\}<\/b>/);
  assert.match(page, /candidate\.shortLabel[\s\S]*?candidate\.gainLabel/);
  assert.doesNotMatch(page, /tickMs=\{12_000\}/);
  assert.equal((page.match(/tickMs=\{1_000\}/g) ?? []).length, 3);
  assert.match(page, /roundSlots=\{2\}[\s\S]*?finalityRounds=\{1\}/);
  assert.doesNotMatch(pipeline, /stagePosition/);
  assert.match(pipeline, /position = config\.headPosition/);
  assert.match(styles, /container-type: inline-size/);
  assert.match(
    styles,
    /grid-template-columns: minmax\(330px, 1\.3fr\) minmax\(205px, 0\.58fr\) minmax\(225px, 0\.72fr\)/,
  );
  assert.match(styles, /\.model-primary-results \.finality-result \{[\s\S]*?background:/);
  assert.match(styles, /@media \(forced-colors: active\)/);
  assert.match(
    styles,
    /\.improvement-rounds > div \{[\s\S]*?background: var\(--surface-mint\)/,
  );
  assert.match(
    styles,
    /\.improvement-rounds label > span \{[\s\S]*?min-height: 44px[\s\S]*?border-radius: 10px/,
  );
  assert.match(
    styles,
    /\.improvement-rounds input:checked \+ span \{[\s\S]*?background: var\(--surface\)/,
  );
  assert.doesNotMatch(styles, /\.improvement-rounds label > span::before/);
  assert.match(styles, /@keyframes dc-block-arrive/);
  assert.match(
    page,
    /scenarioMaximum - Number\(event\.target\.value\)/,
  );
  assert.match(layout, /finality\.watch/);
  assert.match(layout, /themeColor: "#f7f2e8"/);
  assert.match(layout, /card: "summary_large_image"/);
  assert.match(layout, /\/og-finality\.png/);
  assert.match(packageJson, /"name": "finality-watch"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.doesNotMatch(page, /SkeletonPreview|codex-preview/);

  await access(new URL("../public/og-finality.png", import.meta.url));
  await assert.rejects(access(new URL("../app/_sites-preview/", import.meta.url)));
});

test("serves a usable, explicitly stale network snapshot without a key", async () => {
  const response = await render("/api/network-summary");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^application\/json\b/i);

  const summary = await response.json();
  assert.deepEqual(Object.keys(summary).sort(), [
    "activeValidators",
    "epoch",
    "observedAt",
    "source",
    "stale",
  ]);
  assert.equal(summary.activeValidators, 887_995);
  assert.equal(summary.epoch, 463_868);
  assert.equal(summary.source, "Pectrified snapshot");
  assert.equal(summary.stale, true);
});
