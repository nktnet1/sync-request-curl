import { Agent } from "node:http";
import { beforeEach, describe, expect, test, vi } from "vitest";

const { createConnectionPool, releaseConnectionPool } = vi.hoisted(() => ({
  createConnectionPool: vi.fn(),
  releaseConnectionPool: vi.fn(),
}));

vi.mock("#/native/index", () => ({
  default: {
    createConnectionPool,
    releaseConnectionPool,
  },
}));

import { getAgentPoolId, releaseAgentPool } from "#/request/agent";

beforeEach(() => {
  createConnectionPool.mockReset();
  releaseConnectionPool.mockReset();
});

describe("agent connection pools", () => {
  test("does not allocate a pool without a keep-alive agent", () => {
    expect(getAgentPoolId()).toBeUndefined();
    expect(getAgentPoolId(false)).toBeUndefined();
    expect(getAgentPoolId(true)).toBeUndefined();
    expect(getAgentPoolId(new Agent())).toBeUndefined();
    expect(
      getAgentPoolId(new Agent({ keepAlive: true, maxFreeSockets: -1 })),
    ).toBeUndefined();
    const nanFreeSockets = new Agent({ keepAlive: true });
    nanFreeSockets.maxFreeSockets = Number.NaN;
    expect(getAgentPoolId(nanFreeSockets)).toBeUndefined();
    expect(createConnectionPool).not.toHaveBeenCalled();
  });

  test("creates one pool per keep-alive agent and reuses its identifier", () => {
    createConnectionPool.mockReturnValue(17);
    const agent = new Agent({ keepAlive: true, maxTotalSockets: 3.8 });

    expect(getAgentPoolId(agent)).toBe(17);
    expect(getAgentPoolId(agent)).toBe(17);
    expect(createConnectionPool).toHaveBeenCalledOnce();
    expect(createConnectionPool).toHaveBeenCalledWith(3);
  });

  test("caps an unbounded connection pool to the native integer limit", () => {
    createConnectionPool.mockReturnValue(23);
    const agent = new Agent({ keepAlive: true });

    expect(getAgentPoolId(agent)).toBe(23);
    expect(createConnectionPool).toHaveBeenCalledWith(2_147_483_647);
  });

  test("does not allocate a pool when the total socket limit is invalid", () => {
    const agent = new Agent({ keepAlive: true });
    agent.maxTotalSockets = 0;

    expect(getAgentPoolId(agent)).toBeUndefined();
    expect(createConnectionPool).not.toHaveBeenCalled();
  });

  test("releases finalized pools through the native binding", () => {
    releaseAgentPool(31);

    expect(releaseConnectionPool).toHaveBeenCalledWith(31);
  });
});

test("destroy releases the native pool once and supports subsequent reuse", () => {
  createConnectionPool.mockReturnValueOnce(41).mockReturnValueOnce(42);
  const agent = new Agent({ keepAlive: true });
  const originalDestroy = vi.spyOn(agent, "destroy");
  expect(getAgentPoolId(agent)).toBe(41);
  agent.destroy();
  agent.destroy();
  expect(releaseConnectionPool.mock.calls).toEqual([[41]]);
  expect(originalDestroy).toHaveBeenCalledTimes(2);
  expect(getAgentPoolId(agent)).toBe(42);
  agent.destroy();
  expect(releaseConnectionPool.mock.calls).toEqual([[41], [42]]);
});
