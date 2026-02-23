import { Command } from "commander";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const program = new Command();

// Read version from package.json
let version = "0.1.0";
try {
  const pkgPath = join(__dirname, "..", "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  version = pkg.version;
} catch {
  // fallback to hardcoded version
}

program
  .name("rn-shipyard")
  .description(
    "Build and submit Expo apps locally using Fastlane — a local replacement for EAS"
  )
  .version(version)
  .option("--json", "Output results as JSON", false)
  .option("--non-interactive", "Never prompt, fail with clear errors instead", false);

program
  .command("doctor")
  .description("Check environment readiness for local builds")
  .option("-p, --platform <platform>", "Platform to check: ios, android, or all", "all")
  .action(async (_opts, cmd) => {
    const globalOpts = cmd.optsWithGlobals();
    const { default: doctorCmd } = await import("./commands/doctor.js");
    await doctorCmd(globalOpts);
  });

program
  .command("init")
  .description("Set up project for local builds (signing, keystore, Fastlane)")
  .option("-p, --platform <platform>", "Platform to set up: ios, android, or all", "all")
  .action(async (_opts, cmd) => {
    const globalOpts = cmd.optsWithGlobals();
    const { default: initCmd } = await import("./commands/init.js");
    await initCmd(globalOpts);
  });

program
  .command("build")
  .description("Build the app locally using Fastlane")
  .option("-p, --platform <platform>", "Platform to build: ios, android, or all", "all")
  .option("--profile <profile>", "Build profile from eas.json", "production")
  .option("--submit", "Submit after successful build", false)
  .option("--skip-version-check", "Skip version bump warning", false)
  .action(async (_opts, cmd) => {
    const globalOpts = cmd.optsWithGlobals();
    const { default: buildCmd } = await import("./commands/build.js");
    await buildCmd(globalOpts);
  });

program
  .command("submit")
  .description("Submit built artifacts to app stores")
  .option("-p, --platform <platform>", "Platform to submit: ios, android, or all", "all")
  .action(async (_opts, cmd) => {
    const globalOpts = cmd.optsWithGlobals();
    const { default: submitCmd } = await import("./commands/submit.js");
    await submitCmd(globalOpts);
  });

program
  .command("history")
  .description("Show deployment history")
  .option("-p, --platform <platform>", "Filter by platform: ios or android")
  .option("-l, --limit <limit>", "Number of entries to show", "10")
  .action(async (_opts, cmd) => {
    const globalOpts = cmd.optsWithGlobals();
    const { default: historyCmd } = await import("./commands/history.js");
    await historyCmd(globalOpts);
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err.message);
  process.exit(1);
});
