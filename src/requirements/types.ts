import type { ShipyardConfig } from "../core/config.js";

export type Platform = "ios" | "android";
export type Action = "build-ios" | "build-android" | "submit-ios" | "submit-android";
export type CheckStatus = "pass" | "warn" | "fail" | "skip";
export type CheckGroup = "System" | "iOS" | "Android" | "Project" | "Signing & submit";

export const ALL_PLATFORMS: Platform[] = ["ios", "android"];
export const ALL_ACTIONS: Action[] = ["build-ios", "submit-ios", "build-android", "submit-android"];

export const ACTION_LABELS: Record<Action, string> = {
  "build-ios": "iOS build",
  "submit-ios": "iOS submit",
  "build-android": "Android build",
  "submit-android": "Android submit",
};

export const DOCS_BASE = "https://github.com/lamazzing/rn-shipyard#";

/** What a check function reports; the runner adds id, group, title and blocks. */
export interface Outcome {
  status: CheckStatus;
  /** One line: the version found, or what is wrong. Never a secret value. */
  detail: string;
  /** For warn/fail: the exact command or step that fixes it. */
  fix?: string;
  /** README anchor URL */
  docs?: string;
}

export interface CheckResult extends Outcome {
  id: string;
  group: CheckGroup;
  title: string;
  /** Actions that cannot work while this check fails */
  blocks: Action[];
  /** True for "project is not set up" failures (missing .shipyard/config.json, app config, ...) */
  configIssue: boolean;
  durationMs: number;
}

export type ConfigLoad =
  | { state: "ok"; config: ShipyardConfig }
  | { state: "missing" }
  | { state: "invalid"; message: string };

/** The few eas.json values doctor needs, read loosely (a missing field is fine). */
export interface EasHints {
  appleId?: string;
  serviceAccountKeyPath?: string;
}

export interface CheckContext {
  projectDir: string;
  env: NodeJS.ProcessEnv;
  nonInteractive: boolean;
  /** Memoized: .shipyard/config.json, with paths resolved */
  config(): Promise<ConfigLoad>;
  /** Memoized: submit hints from eas.json */
  eas(): Promise<EasHints>;
}

export interface CheckDef {
  id: string;
  group: CheckGroup;
  title: string;
  blocks: Action[];
  /** Failures of this check mean the project is not configured (exit code 2) */
  configIssue?: boolean;
  /** Return false to leave the check out entirely (e.g. a platform that is not configured) */
  applies?(ctx: CheckContext): Promise<boolean> | boolean;
  run(ctx: CheckContext): Promise<Outcome>;
}

export interface Readiness {
  ready: boolean;
  /** Number of failed checks that block this action */
  problems: number;
}

export interface RequirementsResult {
  /** True when no check failed (warnings are fine) */
  ok: boolean;
  checks: CheckResult[];
  readiness: Partial<Record<Action, Readiness>>;
  summary: Record<CheckStatus, number>;
  /** Every failure is a missing-project-config one (doctor exits 2) */
  configOnly: boolean;
  nextStep: string;
}

export interface RequirementsInput {
  projectDir: string;
  /** Default: both */
  platforms?: Platform[];
  /** Default: build and submit for the given platforms */
  actions?: Action[];
  env?: NodeJS.ProcessEnv;
  nonInteractive?: boolean;
  /** Check ids to leave out (e.g. `init` skips "shipyard-config" because it creates it) */
  exclude?: string[];
  /** Check groups to leave out entirely */
  excludeGroups?: CheckGroup[];
  /** Per-check timeout (default 20000) */
  timeoutMs?: number;
}
