# finality.watch

An interactive explorer for Ethereum's fast-finality design space. It models
how validator consolidation, slot time, networking improvements, and finality
gadgets change full-set round time and expected time to finality.

## Run locally

Requires Node.js `>=22.13.0`.

```bash
npm ci
npm run dev
```

Open `http://localhost:3000`.

The deployed site uses the checked-in snapshot at
`app/data/network-snapshot.json`; it never contacts a network-data provider at
runtime. Refresh that snapshot locally when needed:

```bash
npm run snapshot:network
```

Without a key, the updater reads Beaconscan's public validator summary. To use
Beaconcha.in instead, copy `.env.example` to `.env.local` and add a valid key:

```bash
BEACONCHAIN_API_KEY=your_key_here
```

The key is used only by the local updater and is never included in a build or
sent to the browser.

## Validate

```bash
npm run build
npm test
```

The round and finality model lives in `app/lib/model.ts`; the network snapshot
is `app/data/network-snapshot.json`.
