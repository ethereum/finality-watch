"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";

export type DcPipelineProps = {
  roundSlots: number;
  finalityRounds?: number;
  checkpointLagSlots?: number;
  stabilizationLagSlots?: number | null;
  tickMs?: number;
  paused?: boolean;
};

type BlockStage = "available" | "stabilized" | "finalized";

type PipelineBlock = {
  id: number;
  position: number;
  stage: BlockStage;
  checkpoint: boolean;
  cascading: boolean;
  cascadeDelayMs: number;
  recycled: boolean;
};

type PipelineState = {
  blocks: PipelineBlock[];
  tick: number;
};

type PipelineConfig = {
  blockCount: number;
  checkpointPosition: number;
  checkpointIntervalSlots: number;
  continuousFinality: boolean;
  firstPosition: number;
  headPosition: number;
  stabilizationLagSlots: number | null;
};

type PipelineStyle = CSSProperties & {
  "--dc-block-count"?: number;
  "--dc-block-scale"?: number;
  "--dc-cascade-delay"?: string;
  "--dc-vote-progress"?: string;
  "--dc-x"?: string;
};

type VoteTrackerProps = {
  complete: boolean;
  kind: "justification" | "finality";
  percent: number;
};

const VISUAL_TICK_MS = 700;
const MINIMUM_BLOCK_COUNT = 20;
const MAXIMUM_ROUND_SLOTS = 64;
const STABILIZATION_LAG = 3;
const VISIBLE_FINALIZED_PREFIX = 8;

function normalizeRoundSlots(roundSlots: number) {
  if (!Number.isFinite(roundSlots)) return 1;
  return Math.min(
    MAXIMUM_ROUND_SLOTS,
    Math.max(1, Math.round(roundSlots)),
  );
}

function createConfig(
  roundSlots: number,
  finalityRounds: number,
  checkpointLagSlots: number | undefined,
  stabilizationLagSlots: number | null | undefined,
): PipelineConfig {
  const normalizedRoundSlots = normalizeRoundSlots(roundSlots);
  const normalizedFinalityRounds = Math.max(1, Math.round(finalityRounds));
  const normalizedCheckpointLag = Math.max(
    1,
    Math.round(
      checkpointLagSlots ?? normalizedRoundSlots * normalizedFinalityRounds,
    ),
  );
  const normalizedStabilizationLag =
    stabilizationLagSlots === null
      ? null
      : Math.max(
          1,
          Math.round(stabilizationLagSlots ?? STABILIZATION_LAG),
        );
  const blockCount = Math.max(
    MINIMUM_BLOCK_COUNT,
    normalizedCheckpointLag +
      VISIBLE_FINALIZED_PREFIX +
      1,
  );
  const firstPosition = -1;
  const headPosition = blockCount - 2;

  return {
    blockCount,
    checkpointPosition:
      headPosition - normalizedCheckpointLag,
    checkpointIntervalSlots: normalizedRoundSlots,
    continuousFinality: normalizedFinalityRounds === 1,
    firstPosition,
    headPosition,
    stabilizationLagSlots: normalizedStabilizationLag,
  };
}

function positionToPercent(position: number, config: PipelineConfig) {
  const span = config.headPosition - config.firstPosition;
  return `${((position - config.firstPosition) / span) * 100}%`;
}

function stageForPosition(
  position: number,
  config: PipelineConfig,
): BlockStage {
  if (position <= config.checkpointPosition) return "finalized";
  if (
    config.stabilizationLagSlots !== null &&
    config.headPosition - position >= config.stabilizationLagSlots
  ) {
    return "stabilized";
  }
  return "available";
}

function trailingStageForPosition(
  position: number,
  config: PipelineConfig,
): Exclude<BlockStage, "finalized"> {
  return config.stabilizationLagSlots !== null &&
    config.headPosition - position >= config.stabilizationLagSlots
    ? "stabilized"
    : "available";
}

function VoteTracker({ complete, kind, percent }: VoteTrackerProps) {
  const voteStyle: PipelineStyle = {
    "--dc-vote-progress": `${percent}%`,
  };

  return (
    <div
      className={`dc-vote-tracker is-${kind} ${complete ? "is-complete" : ""}`}
      style={voteStyle}
    >
      <i aria-hidden="true" />
      <strong>
        {complete && kind === "finality" ? "final" : `${percent}%`}
      </strong>
      <small>{kind === "justification" ? "justification" : "finality votes"}</small>
    </div>
  );
}

function createInitialState(config: PipelineConfig): PipelineState {
  return {
    blocks: Array.from({ length: config.blockCount }, (_, id) => {
      const position = config.firstPosition + id;

      return {
        id,
        position,
        stage: stageForPosition(position, config),
        checkpoint: position === config.checkpointPosition,
        cascading: false,
        cascadeDelayMs: 0,
        recycled: false,
      };
    }),
    tick: 0,
  };
}

function advancePipeline(
  current: PipelineState,
  config: PipelineConfig,
): PipelineState {
  if (current.blocks.length !== config.blockCount) {
    return createInitialState(config);
  }

  const nextTick = current.tick + 1;
  const checkpointLands =
    config.continuousFinality ||
    nextTick % config.checkpointIntervalSlots === 0;

  const blocks = current.blocks.map((block) => {
    let position = block.position - 1;
    const recycled = position < config.firstPosition;

    if (recycled) position = config.headPosition;

    if (recycled) {
      return {
        ...block,
        position,
        stage: "available" as const,
        checkpoint: false,
        cascading: false,
        cascadeDelayMs: 0,
        recycled: true,
      };
    }

    const reachesCheckpoint =
      checkpointLands && position <= config.checkpointPosition;
    const checkpoint = config.continuousFinality
      ? position === config.checkpointPosition
      : block.checkpoint ||
        (checkpointLands && position === config.checkpointPosition);
    const newlyFinalized =
      block.stage !== "finalized" && reachesCheckpoint;
    const stage: BlockStage =
      block.stage === "finalized" || reachesCheckpoint
        ? "finalized"
        : trailingStageForPosition(position, config);

    return {
      ...block,
      position,
      stage,
      checkpoint,
      cascading: config.continuousFinality
        ? newlyFinalized
        : reachesCheckpoint,
      cascadeDelayMs: reachesCheckpoint
        ? (config.checkpointPosition - position) * 40
        : 0,
      recycled: false,
    };
  });

  return { blocks, tick: nextTick };
}

function MovingPipeline({
  roundSlots,
  finalityRounds,
  checkpointLagSlots,
  stabilizationLagSlots,
  tickMs,
  paused,
}: Required<
  Pick<DcPipelineProps, "roundSlots" | "finalityRounds" | "tickMs" | "paused">
> &
  Pick<DcPipelineProps, "checkpointLagSlots" | "stabilizationLagSlots">) {
  const config = useMemo(
    () =>
      createConfig(
        roundSlots,
        finalityRounds,
        checkpointLagSlots,
        stabilizationLagSlots,
      ),
    [
      checkpointLagSlots,
      finalityRounds,
      roundSlots,
      stabilizationLagSlots,
    ],
  );
  const [pipeline, setPipeline] = useState<PipelineState>(() =>
    createInitialState(config),
  );

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let timer: number | null = null;

    const stop = () => {
      if (timer === null) return;
      window.clearInterval(timer);
      timer = null;
    };

    const start = () => {
      if (timer !== null || document.hidden || reducedMotion.matches || paused) return;
      setPipeline((current) => ({
        ...current,
        tick: Math.floor(Date.now() / tickMs),
      }));
      timer = window.setInterval(() => {
        setPipeline((current) => advancePipeline(current, config));
      }, tickMs);
    };

    const syncPlayback = () => {
      if (document.hidden || paused) {
        stop();
        return;
      }

      if (reducedMotion.matches) {
        stop();
        setPipeline(createInitialState(config));
        return;
      }

      start();
    };

    document.addEventListener("visibilitychange", syncPlayback);
    reducedMotion.addEventListener("change", syncPlayback);
    syncPlayback();

    return () => {
      stop();
      document.removeEventListener("visibilitychange", syncPlayback);
      reducedMotion.removeEventListener("change", syncPlayback);
    };
  }, [config, paused, tickMs]);

  const pipelineStyle: PipelineStyle = {
    "--dc-block-count": config.blockCount,
    "--dc-block-scale": Math.min(1, 42 / config.blockCount),
  };
  const heartbeatStyle: PipelineStyle = {
    "--dc-x": positionToPercent(config.headPosition, config),
  };
  const normalizedFinalityRounds = Math.max(1, Math.round(finalityRounds));
  const finalityCycleSlots =
    config.checkpointIntervalSlots * normalizedFinalityRounds;
  const cycleComplete =
    pipeline.tick > 0 && pipeline.tick % finalityCycleSlots === 0;
  const slotsIntoCycle = cycleComplete
    ? finalityCycleSlots
    : pipeline.tick % finalityCycleSlots;
  const justificationPercent = Math.min(
    100,
    Math.round(
      (slotsIntoCycle / config.checkpointIntervalSlots) * 100,
    ),
  );
  const finalityStartSlot =
    config.checkpointIntervalSlots * (normalizedFinalityRounds - 1);
  const finalityPercent = Math.min(
    100,
    Math.max(
      0,
      Math.round(
        ((slotsIntoCycle - finalityStartSlot) /
          config.checkpointIntervalSlots) *
          100,
      ),
    ),
  );
  const justificationComplete =
    normalizedFinalityRounds > 1 &&
    slotsIntoCycle >= config.checkpointIntervalSlots;
  const finalityComplete = cycleComplete || finalityPercent === 100;

  return (
    <div
      className={`dc-pipeline ${normalizedFinalityRounds > 1 ? "has-two-rounds" : "has-one-round"}`}
      data-round-slots={roundSlots}
      data-tick={pipeline.tick}
      style={pipelineStyle}
      aria-hidden="true"
    >
      <div className="dc-pipeline-track">
        <span className="dc-pipeline-rail" />
        {pipeline.blocks.map((block) => {
          const blockStyle: PipelineStyle = {
            "--dc-cascade-delay": `${block.cascadeDelayMs}ms`,
            "--dc-x": positionToPercent(block.position, config),
          };
          const className = [
            "dc-pipeline-block",
            `is-${block.stage}`,
            block.checkpoint ? "is-checkpoint" : "",
            block.cascading ? "is-cascading" : "",
            block.recycled ? "is-recycled" : "",
          ]
            .filter(Boolean)
            .join(" ");

          return (
            <span
              className={className}
              data-position={block.position}
              data-stage={block.stage}
              key={block.id}
              style={blockStyle}
            >
              <span className="dc-pipeline-link" />
              <span className="dc-pipeline-block-face" />
              {block.checkpoint ? (
                <span className="dc-pipeline-checkpoint" />
              ) : null}
            </span>
          );
        })}
        <span
          className="dc-pipeline-heartbeat"
          key={`heartbeat-${pipeline.tick}`}
          style={heartbeatStyle}
        />
      </div>
      <div className="dc-vote-trackers">
        {normalizedFinalityRounds > 1 ? (
          <VoteTracker
            complete={justificationComplete}
            key={`justification-${justificationComplete ? "complete" : pipeline.tick}`}
            kind="justification"
            percent={justificationPercent}
          />
        ) : null}
        <VoteTracker
          complete={finalityComplete}
          key={`finality-${finalityComplete ? "complete" : pipeline.tick}`}
          kind="finality"
          percent={finalityPercent}
        />
      </div>
    </div>
  );
}

export function DcPipeline({
  roundSlots,
  finalityRounds = 1,
  checkpointLagSlots,
  stabilizationLagSlots = STABILIZATION_LAG,
  tickMs = VISUAL_TICK_MS,
  paused = false,
}: DcPipelineProps) {
  const normalizedRoundSlots = normalizeRoundSlots(roundSlots);
  const normalizedTickMs = Math.max(80, Math.round(tickMs));

  return (
    <MovingPipeline
      key={`dc-pipeline-${normalizedRoundSlots}-${finalityRounds}-${checkpointLagSlots ?? "auto"}-${stabilizationLagSlots ?? "none"}-${normalizedTickMs}`}
      roundSlots={normalizedRoundSlots}
      finalityRounds={finalityRounds}
      checkpointLagSlots={checkpointLagSlots}
      stabilizationLagSlots={stabilizationLagSlots}
      tickMs={normalizedTickMs}
      paused={paused}
    />
  );
}
