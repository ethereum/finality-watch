# finality.watch

An interactive explorer for Ethereum's fast-finality design space. It models
how validator consolidation, slot time, networking improvements, and finality
gadgets change full-set round time and expected time to finality.

## Run locally

Requires Node.js `>=22.13.0`.

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`.

The site works without an API key by showing a clearly dated Pectrified
snapshot. To refresh the active-validator count from Beaconcha.in, add a valid
key to `.env.local`:

```bash
BEACONCHAIN_API_KEY=your_key_here
```

The key is used only by the server route and is never sent to the browser.

## Validate

```bash
npm run build
npm test
```

The round and finality model lives in `app/lib/model.ts`; the network summary
route is `app/api/network-summary/route.ts`.
