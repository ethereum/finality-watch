# finality.watch

[finality.watch](https://finality-watch.ethereum-fou-4225.chatgpt.site) is an
interactive explorer for Ethereum's fast-finality design space. It models how
validator consolidation, slot time, networking improvements, and finality
gadgets change full-set round time and expected time to finality.

> [!IMPORTANT]
> This is a work in progress built to make assumptions discussable and gather
> feedback. It is a simplified research model, not a consensus specification,
> implementation recommendation, or prediction of Ethereum's roadmap.

## What it explores

The controls make it possible to compare scenarios across:

- active validator counts and consolidation;
- slot duration and per-slot voting capacity;
- networking improvements; and
- different finality constructions.

The calculations are deterministic and intentionally kept in the repository so
that results can be inspected and challenged. The model lives in
`app/lib/model.ts`, proposal definitions live in `app/lib/proposals.ts`, and
tests cover the core calculations in `tests/model.test.mjs`.

## Data and limitations

The deployed site uses the checked-in snapshot at
`app/data/network-snapshot.json`. It does not contact a network-data provider
at runtime, so the snapshot's observation time—not the page-load time—defines
the freshness of displayed network data.

The explorer compresses protocol, networking, and validator behavior into a
small set of adjustable assumptions. It is useful for comparisons and
sensitivity checks, but it does not capture every implementation constraint,
adversarial condition, or economic consideration.

## Feedback

[GitHub Issues](https://github.com/yannvon/finality-watch/issues/new/choose) are
the primary feedback channel. Use the bug form for software or display
problems, the model-feedback form for assumptions, calculations, sources, and
missing scenarios, or the general-feedback form for anything that does not fit
those categories.

For broader protocol research discussion, use the related
[EthResearch thread](https://ethresear.ch/t/unblocking-faster-finality-with-decoupled-consensus/24527)
as a secondary channel. Please link any related EthResearch discussion from the
corresponding GitHub issue so the project record remains easy to follow.

See [CONTRIBUTING.md](CONTRIBUTING.md) before proposing a code or model change.

## Run locally

Requires Node.js `>=22.13.0` and npm.

```bash
npm ci
npm run dev
```

Open `http://localhost:3000`.

## Refresh the network snapshot

Run the updater locally when the checked-in network data needs to change:

```bash
npm run snapshot:network
```

Without a key, the updater reads Beaconscan's public validator summary. To use
Beaconcha.in instead, copy `.env.example` to `.env.local` and add a valid key:

```bash
BEACONCHAIN_API_KEY=your_key_here
```

The key is used only by the local updater and is never included in a build or
sent to the browser. Do not commit `.env.local`.

## Validate

Run the same checks used by continuous integration:

```bash
npm run lint
npm run typecheck
npm test
```

`npm test` includes a production build before running the test suite.

## Hosting

The checked-in `.openai/hosting.json` identifies the canonical Sites project.
Forks should configure their own hosting project rather than attempting to
publish to that identifier. No deployment credential or runtime secret is
stored in the repository.

## License

Licensed under the [MIT License](LICENSE).
