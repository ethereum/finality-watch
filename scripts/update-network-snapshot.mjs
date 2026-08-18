import { writeFile } from "node:fs/promises";

const OUTPUT_URL = new URL("../app/data/network-snapshot.json", import.meta.url);
const BEACONCHA_URL = "https://beaconcha.in/api/v1/epoch/latest";
const BEACONSCAN_URL = "https://beaconscan.com/validator";

function parsePositiveInteger(value, label) {
  const parsed = Number(String(value).replaceAll(",", ""));
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return parsed;
}

function validateSnapshot(snapshot) {
  if (
    snapshot.activeValidators < 32_000 ||
    snapshot.activeValidators > 2_000_000
  ) {
    throw new Error(
      `Implausible active validator count: ${snapshot.activeValidators}`,
    );
  }
  if (Number.isNaN(Date.parse(snapshot.observedAt))) {
    throw new Error(`Invalid observation timestamp: ${snapshot.observedAt}`);
  }
  return snapshot;
}

async function fetchBeaconchaSnapshot(apiKey) {
  const response = await fetch(BEACONCHA_URL, {
    headers: {
      accept: "application/json",
      apikey: apiKey,
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`Beaconcha.in responded with ${response.status}`);
  }

  const payload = await response.json();
  if (payload.status !== "OK" || !payload.data) {
    throw new Error("Beaconcha.in returned an unexpected payload");
  }

  return validateSnapshot({
    activeValidators: parsePositiveInteger(
      payload.data.validatorscount,
      "active validator count",
    ),
    epoch: parsePositiveInteger(payload.data.epoch, "epoch"),
    observedAt: payload.data.ts ?? new Date().toISOString(),
    source: "beaconcha.in",
  });
}

async function fetchBeaconscanSnapshot() {
  const response = await fetch(BEACONSCAN_URL, {
    headers: {
      accept: "text/html",
      "user-agent": "Mozilla/5.0 finality.watch snapshot updater",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`Beaconscan responded with ${response.status}`);
  }

  const html = await response.text();
  const epochMatch = html.match(
    /id=["']currentEpoch["'][\s\S]{0,250}?>([\d,]+)<\/a>/i,
  );
  const validatorMatch = html.match(
    /id=["']activeValidator["'][^>]*>([\d,]+)<\/span>/i,
  );
  if (!epochMatch || !validatorMatch) {
    throw new Error("Beaconscan page no longer contains the expected summary");
  }

  return validateSnapshot({
    activeValidators: parsePositiveInteger(
      validatorMatch[1],
      "active validator count",
    ),
    epoch: parsePositiveInteger(epochMatch[1], "epoch"),
    observedAt: new Date().toISOString(),
    source: "beaconscan.com",
  });
}

const apiKey =
  process.env.BEACONCHAIN_API_KEY ?? process.env.BEACONCHA_API_KEY;
const snapshot = apiKey
  ? await fetchBeaconchaSnapshot(apiKey)
  : await fetchBeaconscanSnapshot();

await writeFile(OUTPUT_URL, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
console.log(
  `Updated network snapshot: ${snapshot.activeValidators.toLocaleString("en-US")} active validators at epoch ${snapshot.epoch.toLocaleString("en-US")} (${snapshot.source}).`,
);
