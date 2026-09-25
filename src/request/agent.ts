import type { Agent } from "node:http";
import native from "#/native/index";

const agentPoolIds = new WeakMap<Agent, number>();
export const releaseAgentPool = (poolId: number): void => {
  native.releaseConnectionPool(poolId);
};

const poolFinalizer = new FinalizationRegistry<number>(releaseAgentPool);

const maximumNativePoolSize = 2_147_483_647;

const getMaximumConnections = (agent: Agent): number | undefined => {
  if (!agent.keepAlive || !(agent.maxFreeSockets > 0)) {
    return undefined;
  }

  if (!Number.isFinite(agent.maxTotalSockets)) {
    return maximumNativePoolSize;
  }

  if (!(agent.maxTotalSockets > 0)) {
    return undefined;
  }

  return Math.min(Math.floor(agent.maxTotalSockets), maximumNativePoolSize);
};

export const getAgentPoolId = (
  agent: Agent | false | undefined,
): number | undefined => {
  if (!agent) {
    return undefined;
  }

  const maximumConnections = getMaximumConnections(agent);
  if (maximumConnections === undefined) {
    return undefined;
  }

  const existingPoolId = agentPoolIds.get(agent);
  if (existingPoolId !== undefined) {
    return existingPoolId;
  }

  const poolId = native.createConnectionPool(maximumConnections);
  agentPoolIds.set(agent, poolId);
  poolFinalizer.register(agent, poolId);
  return poolId;
};
