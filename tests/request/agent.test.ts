import { Agent } from "node:http";
import { describe, expect, test } from "vitest";
import request from "#/index";
import { SERVER_URL } from "#tests/app/config";

const getConnectionId = (agent?: Agent | false): number =>
  request("GET", `${SERVER_URL}/connection/id`, { agent }).getJSON<{
    connectionId: number;
  }>().connectionId;

describe("agent", () => {
  test("does not reuse connections when agent is omitted or false", () => {
    const firstWithoutAgent = getConnectionId();
    const secondWithoutAgent = getConnectionId();
    const firstExplicitFalse = getConnectionId(false);
    const secondExplicitFalse = getConnectionId(false);

    expect(secondWithoutAgent).not.toBe(firstWithoutAgent);
    expect(secondExplicitFalse).not.toBe(firstExplicitFalse);
  });

  test("does not reuse connections for an agent without keepAlive", () => {
    const agent = new Agent();

    expect(getConnectionId(agent)).not.toBe(getConnectionId(agent));
  });

  test("reuses a connection across requests for the same keep-alive agent", () => {
    const agent = new Agent({ keepAlive: true });

    expect(getConnectionId(agent)).toBe(getConnectionId(agent));
  });

  test("preserves socket inactivity timeouts on pooled connections", () => {
    const agent = new Agent({ keepAlive: true });
    const response = request("GET", `${SERVER_URL}/socket-timeout/active`, {
      agent,
      socketTimeout: 200,
      timeout: 2_000,
    });

    expect(response.getBody("utf8")).toBe("012345");
  });

  test("keeps connection pools isolated between agent instances", () => {
    const firstAgent = new Agent({ keepAlive: true });
    const secondAgent = new Agent({ keepAlive: true });
    const firstConnection = getConnectionId(firstAgent);
    const secondConnection = getConnectionId(secondAgent);

    expect(secondConnection).not.toBe(firstConnection);
    expect(getConnectionId(firstAgent)).toBe(firstConnection);
    expect(getConnectionId(secondAgent)).toBe(secondConnection);
  });
});
