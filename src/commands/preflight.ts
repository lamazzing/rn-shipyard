import chalk from "chalk";
import { printJson } from "../core/output.js";
import { exitCodeForError } from "../utils/errors.js";
import type { Logger } from "../utils/logger.js";
import {
  requirementsError,
  runRequirementChecks,
  type Action,
  type CheckResult,
  type Platform,
  type RequirementsResult,
} from "../requirements/index.js";
import { toJson } from "./doctor.js";

export interface PreflightInput {
  projectDir: string;
  platforms: Platform[];
  /** Actions about to run, e.g. ["build-ios", "submit-ios"] */
  actions: Action[];
  json: boolean;
  nonInteractive: boolean;
  logger: Logger;
  /** Check ids to leave out */
  exclude?: string[];
  /** Check groups to leave out entirely (init skips "Signing & submit": it creates that setup) */
  excludeGroups?: CheckResult["group"][];
}

export type PreflightOutcome = { ok: true } | { ok: false; exitCode: number };

/**
 * The match repo probe is a network round trip, and the iOS build's phase-1 clone fails fast on
 * the same problem anyway, so the pre-flight leaves it out.
 */
const PREFLIGHT_EXCLUDE = ["match-repo", "ios-submit-auth", "eas-plaintext-credentials"];
// ("eas-plaintext-credentials" is a doctor-only reminder.)
// (and "ios-submit-auth": submit has its own, interactive-aware credentials gate and login step)

/** Compact failure report: one ✗ line per failed check with its fix. */
export function renderFailures(result: RequirementsResult): string[] {
  const lines: string[] = [];
  for (const c of result.checks.filter((x) => x.status === "fail")) {
    lines.push(`  ${chalk.red("✗")} ${c.title}  ${chalk.dim(c.detail)}`);
    if (c.fix) lines.push(`      ${chalk.cyan("Fix:")} ${c.fix}`);
  }
  return lines;
}

/**
 * Requirements pre-flight for build/submit/init: fails fast, before any prompt or long step,
 * when something the run needs is missing. Warnings never block; they are printed compactly.
 * On failure it prints the report (or the --json envelope with `checks`) and returns the exit
 * code for the caller to exit with. Never throws.
 */
export async function runPreflight(input: PreflightInput): Promise<PreflightOutcome> {
  const result = await runRequirementChecks({
    projectDir: input.projectDir,
    platforms: input.platforms,
    actions: input.actions,
    nonInteractive: input.nonInteractive,
    exclude: [...PREFLIGHT_EXCLUDE, ...(input.exclude ?? [])],
    excludeGroups: input.excludeGroups,
  });

  for (const c of result.checks.filter((x) => x.status === "warn")) {
    input.logger.warn(`${c.title}: ${c.detail}${c.fix ? ` (${c.fix})` : ""}`);
  }
  const err = requirementsError(result);
  if (!err) return { ok: true };

  if (input.json) {
    printJson(toJson(result));
  } else {
    console.log("");
    console.log(chalk.red("  Requirements not met:"));
    for (const line of renderFailures(result)) console.log(line);
    console.log("");
    console.log(`  Run ${chalk.bold("rn-shipyard doctor")} for the full report, or ${chalk.bold("--skip-checks")} to bypass this check.`);
    console.log("");
  }
  return { ok: false, exitCode: exitCodeForError(err) };
}
