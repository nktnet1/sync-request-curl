import type { Agent } from "node:http";
import native from "#/native/index";

const agentPoolIds = new WeakMap<Agent, number>();
export const releaseAgentPool = (poolId: number): void => {
  native.releaseConnectionPool(poolId);
};

const poolFinalizer = new FinalizationRegistry<number>(releaseAgentPool);

const wrappedAgents = new WeakSet<Agent>();

const wrapAgentDestroy = (agent: Agent): void => {
  if (wrappedAgents.has(agent)) return;
  const originalDestroy = agent.destroy;
  agent.destroy = function (this: Agent): void {
    const poolId = agentPoolIds.get(this);
    agentPoolIds.delete(this);
    poolFinalizer.unregister(this);
    try {
      if (poolId !== undefined) releaseAgentPool(poolId);
    } finally {
      originalDestroy.call(this);
    }
  };
  wrappedAgents.add(agent);
};

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

export const getAgentPoolId = (agent?: Agent | boolean): number | undefined => {
  // sync-request exposes `agent?: boolean`. Node only assigns special runtime
  // meaning to `false`, but accepting `true` is required for source/runtime
  // compatibility with that public surface. Treat it like the default form: it
  // does not opt into a dedicated persistent native pool.
  if (typeof agent === "boolean" || agent === undefined) {
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

  wrapAgentDestroy(agent);
  const poolId = native.createConnectionPool(maximumConnections);
  agentPoolIds.set(agent, poolId);
  poolFinalizer.register(agent, poolId, agent);
  return poolId;
};
