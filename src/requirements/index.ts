import { readFile } from "node:fs/promises";
import { configExists, readConfig } from "../core/config.js";
import { ShipyardError } from "../utils/errors.js";
import {
  ACTION_LABELS,
  ALL_PLATFORMS,
  type Action,
  type CheckContext,
  type CheckDef,
  type CheckResult,
  type ConfigLoad,
  type EasHints,
  type Outcome,
  type Platform,
  type Readiness,
  type RequirementsInput,
  type RequirementsResult,
} from "./types.js";
import { systemChecks } from "./system.js";
import { iosChecks } from "./ios.js";
import { androidChecks } from "./android.js";
import { projectChecks } from "./project.js";
import { signingChecks } from "./signing.js";

export * from "./types.js";
export { displayGitUrl } from "./signing.js";

export const ALL_CHECKS: CheckDef[] = [
  ...systemChecks,
  ...iosChecks,
  ...androidChecks,
  ...projectChecks,
  ...signingChecks,
];

const DEFAULT_TIMEOUT_MS = 20_000;

export function actionsFor(platforms: Platform[]): Action[] {
  return platforms.flatMap((p): Action[] => [`build-${p}`, `submit-${p}`]);
}

async function loadConfig(projectDir: string): Promise<ConfigLoad> {
  if (!(await configExists(projectDir))) return { state: "missing" };
  try {
    return { state: "ok", config: await readConfig(projectDir) };
  } catch (err) {
    return { state: "invalid", message: err instanceof ShipyardError ? err.message : "cannot read .shipyard/config.json" };
  }
}

async function loadEasHints(projectDir: string): Promise<EasHints> {
  try {
    const eas = JSON.parse(await readFile(`${projectDir}/eas.json`, "utf-8")) as {
      submit?: Record<string, { ios?: { appleId?: unknown }; android?: { serviceAccountKeyPath?: unknown } }>;
    };
    const profiles = eas.submit ?? {};
    const first = profiles.production ?? Object.values(profiles)[0];
    const appleId = first?.ios?.appleId;
    const key = first?.android?.serviceAccountKeyPath;
    return {
      appleId: typeof appleId === "string" ? appleId : undefined,
      serviceAccountKeyPath: typeof key === "string" ? key : undefined,
    };
  } catch {
    return {};
  }
}

function memo<T>(fn: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | undefined;
  return () => (p ??= fn());
}

async function runOne(def: CheckDef, ctx: CheckContext, timeoutMs: number): Promise<CheckResult> {
  const started = Date.now();
  let timer: NodeJS.Timeout | undefined;
  let outcome: Outcome;
  try {
    outcome = await Promise.race([
      def.run(ctx),
      new Promise<Outcome>((resolve) => {
        timer = setTimeout(
          () =>
            resolve({
              status: "fail",
              detail: `did not answer within ${Math.round(timeoutMs / 1000)}s`,
              fix: "Run the underlying tool by hand to see why it hangs, then run doctor again",
            }),
          timeoutMs
        );
      }),
    ]);
  } catch (err) {
    outcome = {
      status: "fail",
      detail: `check crashed: ${err instanceof Error ? err.message : String(err)}`,
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
  return {
    id: def.id,
    group: def.group,
    title: def.title,
    blocks: def.blocks,
    configIssue: def.configIssue === true,
    ...outcome,
    durationMs: Date.now() - started,
  };
}

export function computeReadiness(checks: CheckResult[], actions: Action[]): Partial<Record<Action, Readiness>> {
  const out: Partial<Record<Action, Readiness>> = {};
  for (const action of actions) {
    const problems = checks.filter((c) => c.status === "fail" && c.blocks.includes(action)).length;
    out[action] = { ready: problems === 0, problems };
  }
  return out;
}

function listLabels(actions: Action[]): string {
  return actions.map((a) => ACTION_LABELS[a]).join(", ");
}

export function describeReadiness(readiness: Partial<Record<Action, Readiness>>): { ready: string; notReady: string } {
  const entries = Object.entries(readiness) as [Action, Readiness][];
  const ready = entries.filter(([, r]) => r.ready).map(([a]) => a);
  const notReady = entries
    .filter(([, r]) => !r.ready)
    .map(([a, r]) => `${ACTION_LABELS[a]} (${r.problems} problem${r.problems === 1 ? "" : "s"})`);
  return { ready: listLabels(ready), notReady: notReady.join(", ") };
}

function buildNextStep(checks: CheckResult[], readiness: Partial<Record<Action, Readiness>>): string {
  const failed = checks.filter((c) => c.status === "fail");
  const warned = checks.filter((c) => c.status === "warn");
  if (failed.length > 0) {
    if (failed.length === 1 && failed[0].id === "shipyard-config") {
      return "Run `rn-shipyard init` to set up signing, then run `rn-shipyard doctor` again.";
    }
    const n = failed.length;
    return `Fix the ${n === 1 ? "item" : `${n} items`} marked ✗ above, then run \`rn-shipyard doctor\` again.`;
  }
  const buildable = ALL_PLATFORMS.filter((p) => readiness[`build-${p}`]?.ready);
  const cmd =
    buildable.length === 0
      ? "`rn-shipyard submit`"
      : buildable.length === ALL_PLATFORMS.length
        ? "`rn-shipyard build`"
        : `\`rn-shipyard build --platform ${buildable[0]}\``;
  const prefix = warned.length > 0 ? `Nothing blocks you (${warned.length} warning${warned.length === 1 ? "" : "s"} above). ` : "All set. ";
  return `${prefix}Run ${cmd}.`;
}

/**
 * Runs every requirement check relevant to the given platforms and actions, concurrently,
 * each with a timeout. Never throws. Reusable by build/submit/init to fail fast.
 */
export async function runRequirementChecks(input: RequirementsInput): Promise<RequirementsResult> {
  const platforms = input.platforms ?? ALL_PLATFORMS;
  const actions = input.actions ?? actionsFor(platforms);
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const env = input.env ?? process.env;
  const ctx: CheckContext = {
    projectDir: input.projectDir,
    env,
    nonInteractive: input.nonInteractive === true,
    config: memo(() => loadConfig(input.projectDir)),
    eas: memo(() => loadEasHints(input.projectDir)),
  };

  const relevant = ALL_CHECKS.filter(
    (d) => d.blocks.some((a) => actions.includes(a)) && !input.exclude?.includes(d.id) &&
      !input.excludeGroups?.includes(d.group)
  );
  const settled = await Promise.all(
    relevant.map(async (def) => {
      let applies = true;
      try {
        applies = def.applies ? await def.applies(ctx) : true;
      } catch {
        applies = true;
      }
      return applies ? runOne(def, ctx, timeoutMs) : undefined;
    })
  );
  const checks = settled.filter((c): c is CheckResult => c !== undefined);

  const summary = { pass: 0, warn: 0, fail: 0, skip: 0 };
  for (const c of checks) summary[c.status]++;
  const readiness = computeReadiness(checks, actions);
  const failed = checks.filter((c) => c.status === "fail");
  return {
    ok: failed.length === 0,
    checks,
    readiness,
    summary,
    configOnly: failed.length > 0 && failed.every((c) => c.configIssue),
    nextStep: buildNextStep(checks, readiness),
  };
}

/**
 * The error build/submit/init can throw when requirements fail: code REQUIREMENTS_NOT_MET (MISSING_CONFIG_PROJECT, exit 2, when only project setup is missing),
 * message lists each failed check, fix lists each fix command. Returns undefined when nothing failed.
 */
export function requirementsError(result: RequirementsResult): ShipyardError | undefined {
  const failed = result.checks.filter((c) => c.status === "fail");
  if (failed.length === 0) return undefined;
  const message = `Requirements not met: ${failed.map((c) => `${c.title} (${c.detail})`).join("; ")}`;
  const fix = failed.map((c) => (c.fix ? `${c.title}: ${c.fix}` : c.title)).join("\n") + "\nThen run: rn-shipyard doctor";
  // MISSING_CONFIG_* maps to exit code 2 (exitCodeForError)
  return new ShipyardError(result.configOnly ? "MISSING_CONFIG_PROJECT" : "REQUIREMENTS_NOT_MET", message, fix);
}
