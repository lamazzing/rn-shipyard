import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { type CheckDef, ALL_ACTIONS, DOCS_BASE } from "./types.js";
import { isFile } from "./helpers.js";

const DOCS = `${DOCS_BASE}quickstart`;

const APP_CONFIG_FILES = [
  "app.json",
  "app.config.js",
  "app.config.ts",
  "app.config.mjs",
  "app.config.cjs",
];

async function installCommand(projectDir: string): Promise<string> {
  if (await isFile(join(projectDir, "yarn.lock"))) return "yarn install";
  if (await isFile(join(projectDir, "pnpm-lock.yaml"))) return "pnpm install";
  if (await isFile(join(projectDir, "bun.lockb")) || (await isFile(join(projectDir, "bun.lock")))) return "bun install";
  return "npm install";
}

export const projectChecks: CheckDef[] = [
  {
    id: "expo-project",
    group: "Project",
    title: "Expo project (package.json depends on expo)",
    blocks: ALL_ACTIONS,
    configIssue: true,
    async run(ctx) {
      let raw: string;
      try {
        raw = await readFile(join(ctx.projectDir, "package.json"), "utf-8");
      } catch {
        return {
          status: "fail",
          detail: "no package.json here",
          fix: "cd into your Expo project's root folder (the one with package.json), then run this again",
          docs: DOCS,
        };
      }
      try {
        const pkg = JSON.parse(raw) as { dependencies?: object; devDependencies?: object };
        if ("expo" in (pkg.dependencies ?? {}) || "expo" in (pkg.devDependencies ?? {})) {
          return { status: "pass", detail: "expo found in package.json" };
        }
      } catch {
        return { status: "fail", detail: "package.json is not valid JSON", fix: "Fix package.json", docs: DOCS };
      }
      return {
        status: "fail",
        detail: "package.json does not list expo",
        fix: "Run this from an Expo project (npx create-expo-app creates one), or install expo: npx expo install expo",
        docs: DOCS,
      };
    },
  },
  {
    id: "node-modules",
    group: "Project",
    title: "Dependencies installed",
    blocks: ALL_ACTIONS,
    async applies(ctx) {
      return isFile(join(ctx.projectDir, "package.json"));
    },
    async run(ctx) {
      if (await isFile(join(ctx.projectDir, "node_modules", "expo", "package.json"))) {
        return { status: "pass", detail: "node_modules/expo present" };
      }
      return {
        status: "fail",
        detail: "node_modules/expo is missing",
        fix: await installCommand(ctx.projectDir),
        docs: DOCS,
      };
    },
  },
  {
    id: "app-config",
    group: "Project",
    title: "app.json or app.config.*",
    blocks: ALL_ACTIONS,
    configIssue: true,
    async run(ctx) {
      for (const name of APP_CONFIG_FILES) {
        if (await isFile(join(ctx.projectDir, name))) return { status: "pass", detail: name };
      }
      return {
        status: "fail",
        detail: "no app.json or app.config.{js,ts,mjs,cjs}",
        fix: "Run this from your Expo project's root folder; every Expo app has an app.json or app.config.js",
        docs: DOCS,
      };
    },
  },
  {
    id: "eas-json",
    group: "Project",
    title: "eas.json",
    blocks: ALL_ACTIONS,
    configIssue: true,
    async run(ctx) {
      const path = join(ctx.projectDir, "eas.json");
      let raw: string;
      try {
        raw = await readFile(path, "utf-8");
      } catch {
        return {
          status: "fail",
          detail: "not found",
          fix: "npx eas-cli build:configure   (creates eas.json; rn-shipyard only reads it)",
          docs: `${DOCS_BASE}migrating-from-eas`,
        };
      }
      try {
        JSON.parse(raw);
      } catch {
        return { status: "fail", detail: "not valid JSON", fix: "Fix the syntax error in eas.json", docs: DOCS };
      }
      return { status: "pass", detail: "found" };
    },
  },
  {
    id: "shipyard-config",
    group: "Project",
    title: "rn-shipyard set up (.shipyard/config.json)",
    blocks: ALL_ACTIONS,
    configIssue: true,
    async run(ctx) {
      const c = await ctx.config();
      if (c.state === "ok") {
        const platforms = Object.entries(c.config.platforms)
          .filter(([, v]) => v && v.enabled !== false)
          .map(([k]) => (k === "ios" ? "iOS" : "Android"));
        return { status: "pass", detail: platforms.length ? `configured for ${platforms.join(" and ")}` : "found" };
      }
      if (c.state === "missing") {
        return {
          status: "fail",
          detail: "not found: signing is not set up yet",
          fix: "rn-shipyard init",
          docs: `${DOCS_BASE}init`,
        };
      }
      return {
        status: "fail",
        detail: c.message,
        fix: "Delete .shipyard/config.json and run: rn-shipyard init",
        docs: `${DOCS_BASE}init`,
      };
    },
  },
];
