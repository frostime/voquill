#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const tauriArgs = process.argv.slice(2);
const tauriCommand = tauriArgs[0];
const requestedTarget = readOptionValue(tauriArgs, "--target");

if (tauriCommand === "build" || tauriCommand === "dev") {
  const targets = resolveTargets(requestedTarget);
  const sidecarProfile =
    process.env.VOQUILL_SIDECAR_PROFILE ||
    (tauriCommand === "build" ? "release" : "debug");

  for (const target of targets) {
    const prepareEnv = {
      ...process.env,
      VOQUILL_SIDECAR_PROFILE: sidecarProfile,
    };

    if (target) {
      prepareEnv.CARGO_BUILD_TARGET = target;
    } else {
      delete prepareEnv.CARGO_BUILD_TARGET;
    }

    run("node", ["scripts/prepare-sidecars.mjs"], prepareEnv);
  }
}

run("tauri", tauriArgs, process.env);

function resolveTargets(requestedTarget) {
  if (!requestedTarget) {
    return [null];
  }

  return [requestedTarget];
}

function readOptionValue(args, optionName) {
  const exactIndex = args.indexOf(optionName);
  if (exactIndex >= 0) {
    return args[exactIndex + 1] || null;
  }

  const inlinePrefix = `${optionName}=`;
  const inlineArg = args.find((arg) => arg.startsWith(inlinePrefix));
  if (!inlineArg) {
    return null;
  }

  const value = inlineArg.slice(inlinePrefix.length).trim();
  return value.length > 0 ? value : null;
}

function run(command, args, env) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    stdio: "inherit",
    env,
    shell: true,
  });

  if (result.status !== 0) {
    const rendered = [command, ...args].join(" ");
    process.stderr.write(
      `[tauri-sidecar] Command failed (${result.status ?? "unknown"}): ${rendered}\n`,
    );
    process.exit(result.status ?? 1);
  }
}

function fail(message) {
  process.stderr.write(`[tauri-sidecar] ${message}\n`);
  process.exit(1);
}
