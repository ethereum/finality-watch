# finality.watch

[finality.watch](https://finality.watch) is an
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

## Expert view

The **Expert** toggle (or `?view=expert&protocol=…`) replaces the single DC
switch with four consensus protocols and models decoupled consensus slot by
slot. The model lives in `app/lib/protocols.ts`: each expectation averages
every block a transaction can land in over one period of the protocol's
schedule. It is tested in `tests/protocols.test.mjs` against an independent
vote-by-vote simulation.

Conventions, in slots, with every validator honest and online:

- One finality-gadget cohort votes per slot, so a full-set round of `R` slots
  (from the capacity model above) has `R` cohorts. Quorums count whole cohorts:
  `J = ⌈2R/3⌉` to justify and `Q = ⌈5R/6⌉` for one-round finality.
- A block is fast-confirmed one slot after its proposal, and the finality
  gadget votes only confirmed blocks. Stabilization is shown one slot later and
  does not gate finality.
- Justification and height progress are on-chain: they take effect when the
  next block includes the quorum's votes. Finality is observed locally as soon
  as the last needed votes are cast.
- As in DC's attestation rules, a finality pair must name a height below its
  vote's height pair, and a target is never re-sent. A cohort whose confirmed
  view still shows a closed height therefore carries no finality pair.
- The coupled reference counts the round wait in whole slots: a block at a
  round start is voted in that round.

| Protocol | Rule | Two-round expectation (slots) |
|---|---|---|
| Coupled | Standard model above | `5R/2` |
| DC today | Round-locked: every cohort of a round votes the height its opening view shows; one height per round, in rounds long enough for the quorum to be on-chain and confirmed before the next round opens | `5P/2 − 1`, `P = max(R, J + 1)` slots per round |
| DC + height progress | A height closes at its quorum; cohorts switch once the new entry is confirmed, and the next height's votes finalize | `5H/2 − 1`, `H = J + 1` |
| DC + Rolling FFG | Every slot is a checkpoint; justify with `J` votes, then finalize with `J` lock votes | `2J + ½` |

With one-round finality, the coupled reference gives `3R/2`, and height-based
designs close a height at `Q`: DC today
gives `3P/2 − 1` with `P = max(R, Q + 1)`, and height progress gives `3H/2 − 1`
with `H = Q + 1`. One-round Rolling FFG is open research and is not modeled. For long
rounds the expectations approach 5/2, 5/3 and 4/3 rounds (3/2 and 5/4 with one
round). A DC-today round has `R` slots of votes. When its quorum needs every
one of them, the round runs one more slot, in which the block carrying the
quorum is confirmed, so the next round can vote it. Rounds therefore last at
least two slots, and finality never gets slower with fewer validators.

The timeline also shows the votes that arrive after finality is already seen:
DC today's cohorts all vote from the round's opening view, so the rest of the
round repeats the finality vote, and Rolling FFG collects a full round of lock
votes. They change no expected value.

## Feedback

[GitHub Issues](https://github.com/ethereum/finality-watch/issues/new/choose) are
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

Production is hosted on Netlify at [finality.watch](https://finality.watch).
The checked-in `netlify.toml` runs the repository's standard `npm run build`
command and deploys the native Next.js output. Netlify is the only deployment
target.

## License

Licensed under the [MIT License](LICENSE).
