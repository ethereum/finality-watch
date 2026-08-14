import { NextResponse } from "next/server";

type NetworkSummary = {
  activeValidators: number;
  epoch: number | null;
  observedAt: string;
  source: string;
  stale: boolean;
};

type BeaconchaEpochResponse = {
  status?: string;
  data?: {
    epoch?: number;
    validatorscount?: number;
    ts?: string;
  };
};

const FALLBACK: NetworkSummary = {
  activeValidators: 887_995,
  epoch: 463_868,
  observedAt: "2026-07-25T03:15:35.000Z",
  source: "Pectrified snapshot",
  stale: true,
};

const CACHE_TTL_MS = 5 * 60 * 1_000;
let cachedLiveSummary: NetworkSummary | null = null;
let cacheExpiresAt = 0;

async function fetchBeaconchaSummary(apiKey: string): Promise<NetworkSummary> {
  const endpoint = new URL("https://beaconcha.in/api/v1/epoch/latest");
  endpoint.searchParams.set("apikey", apiKey);

  const response = await fetch(endpoint, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(5_000),
  });

  if (!response.ok) {
    throw new Error(`Beaconcha.in responded with ${response.status}`);
  }

  const payload = (await response.json()) as BeaconchaEpochResponse;
  const activeValidators = Number(payload.data?.validatorscount);
  const epoch = Number(payload.data?.epoch);

  if (
    payload.status !== "OK" ||
    !Number.isFinite(activeValidators) ||
    activeValidators < 32_000 ||
    !Number.isFinite(epoch)
  ) {
    throw new Error("Beaconcha.in returned an unexpected payload");
  }

  return {
    activeValidators: Math.round(activeValidators),
    epoch: Math.round(epoch),
    observedAt: payload.data?.ts ?? new Date().toISOString(),
    source: "beaconcha.in",
    stale: false,
  };
}

export const dynamic = "force-dynamic";

export async function GET() {
  const now = Date.now();

  if (cachedLiveSummary && now < cacheExpiresAt) {
    return NextResponse.json(cachedLiveSummary, {
      headers: {
        "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=3600",
      },
    });
  }

  const apiKey =
    process.env.BEACONCHAIN_API_KEY ?? process.env.BEACONCHA_API_KEY;

  if (apiKey) {
    try {
      cachedLiveSummary = await fetchBeaconchaSummary(apiKey);
      cacheExpiresAt = now + CACHE_TTL_MS;

      return NextResponse.json(cachedLiveSummary, {
        headers: {
          "Cache-Control":
            "public, max-age=60, s-maxage=300, stale-while-revalidate=3600",
        },
      });
    } catch {
      if (cachedLiveSummary) {
        return NextResponse.json(
          { ...cachedLiveSummary, stale: true },
          {
            headers: {
              "Cache-Control": "public, max-age=30, s-maxage=60",
            },
          },
        );
      }
    }
  }

  return NextResponse.json(FALLBACK, {
    headers: {
      "Cache-Control": "public, max-age=30, s-maxage=60",
    },
  });
}
