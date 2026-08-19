# Contributing to finality.watch

Thanks for helping improve the explorer. Feedback on both the software and the
research model is welcome while the project is a work in progress.

## Start with an issue

Search the [existing issues](https://github.com/yannvon/finality-watch/issues)
before opening a new one.

- Use the bug form for broken behavior, incorrect rendering, accessibility
  problems, or development and build failures.
- Use the model-feedback form for questionable assumptions, calculations,
  sources, terminology, or missing scenarios.
- Use the general-feedback form for suggestions or reactions that do not fit
  either category.
- Use the related
  [EthResearch thread](https://ethresear.ch/t/unblocking-faster-finality-with-decoupled-consensus/24527)
  for broader protocol discussion, then link the discussion from a GitHub issue
  when it leads to a concrete change.

Opening an issue before a substantial pull request helps establish scope and
prevents parallel work on incompatible assumptions.

## Development setup

Install Node.js `>=22.13.0`, clone the repository, and install the locked
dependencies:

```bash
npm ci
npm run dev
```

Do not commit local environment files, build output, or hosting credentials.
The optional `BEACONCHAIN_API_KEY` belongs in `.env.local` and is used only by
the snapshot updater.

## Make a focused change

- Keep pull requests small enough to review as one coherent decision.
- Separate formatting or refactoring from changes to model behavior.
- Preserve accessible keyboard, touch, and responsive behavior for UI changes.
- Update documentation when behavior, assumptions, sources, or setup changes.

For model or snapshot changes, explain:

1. the assumption or data point being changed;
2. why the new treatment is more appropriate;
3. the source or derivation supporting it; and
4. which displayed scenarios and test expectations are affected.

Do not refresh `app/data/network-snapshot.json` incidentally. Snapshot updates
should be deliberate and should retain enough source and observation metadata
to make their provenance clear.

## Validate the change

Run all checks before opening a pull request:

```bash
npm run lint
npm run typecheck
npm test
```

`npm test` performs a production build and then runs the test suite. If a check
cannot be run locally, explain why in the pull request.

For visible changes, include before-and-after screenshots or a short recording.
For calculation changes, add or update focused tests and describe representative
input/output differences.

## Pull requests

Complete the pull request template, link the relevant issue, and call out any
remaining uncertainty. A pull request may be declined when it makes the model
more precise-looking without better evidence or hides an important assumption
from the interface or documentation.

By contributing, you agree that your contributions are licensed under the
project's [MIT License](LICENSE).
