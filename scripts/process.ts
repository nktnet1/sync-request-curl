import { spawnSync } from "node:child_process";

export interface RunOptions {
  capture?: boolean;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export const run = (
  command: string,
  args: string[],
  options: RunOptions = {},
): string => {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    stdio: options.capture ? "pipe" : "inherit",
    encoding: "utf8",
    env: options.env ?? process.env,
  });

  if (result.error) {
    const error = new Error(
      `Unable to run ${command}: ${result.error.message}`,
    );
    error.cause = result.error;
    throw error;
  }

  if (result.status !== 0) {
    const stderr = options.capture ? result.stderr?.trim() : undefined;
    const detail = stderr ? `: ${stderr}` : "";
    throw new Error(`${command} ${args.join(" ")} failed${detail}`);
  }

  return options.capture ? (result.stdout?.trim() ?? "") : "";
};

export const canRun = (
  command: string,
  args: string[] = ["--version"],
): boolean => {
  const result = spawnSync(command, args, {
    stdio: "ignore",
    env: process.env,
  });
  return !result.error && result.status === 0;
};

const unquote = (value: string): string => {
  const first = value.at(0);
  if ((first === '"' || first === "'") && value.at(-1) === first) {
    return value.slice(1, -1);
  }
  return value;
};

export const splitFlags = (value: string): string[] =>
  (value.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map(unquote);
