import type { Agent } from "node:http";
import native from "#/native/index";

const agentPoolIds = new WeakMap<Agent, number>();
export const releaseAgentPool = (poolId: number): void => {
  native.releaseConnectionPool(poolId);
};

const poolFinalizer = new FinalizationRegistry<number>(releaseAgentPool);

const maximumNativePoolSize = 2_147_483_647;

/**
 * then-request forwards Agent instances directly to Node, whose runtime Agent
 * stores the effective keep-alive flag on the instance. Current Node typings do
 * not expose that field, so read it reflectively at this compatibility boundary.
 */
const hasKeepAlive = (agent: Agent): boolean =>
  Reflect.get(agent, "keepAlive") === true;

const getMaximumConnections = (agent: Agent): number | undefined => {
  if (
    !hasKeepAlive(agent) ||
    agent.maxFreeSockets <= 0 ||
    Number.isNaN(agent.maxFreeSockets)
  ) {
    return undefined;
  }

  if (!Number.isFinite(agent.maxTotalSockets)) {
    return maximumNativePoolSize;
  }

  if (agent.maxTotalSockets <= 0) {
    return undefined;
  }

  return Math.min(Math.floor(agent.maxTotalSockets), maximumNativePoolSize);
};

export const getAgentPoolId = (agent?: Agent | false): number | undefined => {
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
