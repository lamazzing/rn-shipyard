import chalk from "chalk";
import { printJson } from "../core/output.js";
import { ShipyardError } from "../utils/errors.js";
import { isInteractive } from "../utils/interactive.js";
import { applyExpoEnvAliases } from "../utils/apple-env.js";
import {
  ALL_PLATFORMS,
  describeReadiness,
  requirementsError,
  runRequirementChecks,
  type CheckGroup,
  type CheckResult,
  type Platform,
  type RequirementsResult,
} from "../requirements/index.js";

export { fastlaneUsesOwnRuby } from "../requirements/system.js";

export interface DoctorOptions {
  platform: string;
  json: boolean;
  nonInteractive: boolean;
}

const GROUP_ORDER: CheckGroup[] = ["System", "iOS", "Android", "Project", "Signing & submit"];

function parsePlatforms(value: string): Platform[] {
  if (value === "all") return ALL_PLATFORMS;
  if (value === "ios" || value === "android") return [value];
  throw new ShipyardError(
    "INVALID_FLAGS",
    `Unknown platform '${value}'`,
    "Use --platform ios, --platform android or --platform all"
  );
}

/** Exit code: 0 nothing failed (warnings are fine), 2 only project-config checks failed, 1 otherwise. */
export function exitCodeFor(result: RequirementsResult): number {
  if (result.ok) return 0;
  return result.configOnly ? 2 : 1;
}

const SYMBOL: Record<CheckResult["status"], () => string> = {
  pass: () => chalk.green("✓"),
  warn: () => chalk.yellow("!"),
  fail: () => chalk.red("✗"),
  skip: () => chalk.dim("-"),
};

/** Human report as lines. Groups where everything passes collapse to one line. */
export function renderReport(result: RequirementsResult): string[] {
  const lines: string[] = ["", chalk.bold("  rn-shipyard doctor")];
  for (const group of GROUP_ORDER) {
    const checks = result.checks.filter((c) => c.group === group);
    if (checks.length === 0) continue;
    lines.push("");
    const clean = checks.every((c) => c.status === "pass" || c.status === "skip");
    if (clean) {
      lines.push(`  ${SYMBOL.pass()} ${chalk.bold(group)} ${chalk.dim(`(${checks.length} checks passed)`)}`);
      continue;
    }
    lines.push(`  ${chalk.bold(group)}`);
    for (const c of checks) {
      lines.push(`    ${SYMBOL[c.status]()} ${c.title}  ${chalk.dim(c.detail)}`);
      if (c.status === "warn" || c.status === "fail") {
        if (c.fix) lines.push(`        ${chalk.cyan("Fix:")}  ${c.fix}`);
        if (c.docs) lines.push(`        ${chalk.dim("Docs: " + c.docs)}`);
      }
    }
  }

  const { ready, notReady } = describeReadiness(result.readiness);
  lines.push("");
  if (ready) lines.push(`  ${chalk.green("Ready:")}      ${ready}`);
  if (notReady) lines.push(`  ${chalk.red("Not ready:")}  ${notReady}`);
  lines.push("");
  lines.push(`  ${chalk.bold("Next step:")} ${result.nextStep}`);
  lines.push("");
  return lines;
}

export function toJson(result: RequirementsResult): Record<string, unknown> {
  const err = requirementsError(result);
  return {
    success: result.ok,
    checks: result.checks.map((c) => ({
      id: c.id,
      group: c.group,
      title: c.title,
      status: c.status,
      detail: c.detail,
      ...(c.fix ? { fix: c.fix } : {}),
      ...(c.docs ? { docs: c.docs } : {}),
      blocks: c.blocks,
    })),
    readiness: result.readiness,
    summary: result.summary,
    nextStep: result.nextStep,
    ...(err ? { error: { code: err.code, message: err.message, fix: err.fix } } : {}),
  };
}

export default async function doctorCmd(opts: DoctorOptions): Promise<void> {
  const platforms = parsePlatforms(opts.platform ?? "all");
  applyExpoEnvAliases(); // EXPO_* credential names count like their fastlane equivalents
  const result = await runRequirementChecks({
    projectDir: process.cwd(),
    platforms,
    nonInteractive: !isInteractive(opts),
  });

  if (opts.json) {
    printJson(toJson(result));
  } else {
    for (const line of renderReport(result)) console.log(line);
  }
  // exitCode, not exit(): lets the JSON document finish flushing
  process.exitCode = exitCodeFor(result);
}
