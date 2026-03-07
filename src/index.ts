import { Command } from "commander";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import doctorCmd from "./commands/doctor.js";
import initCmd from "./commands/init.js";
import buildCmd from "./commands/build.js";
import submitCmd from "./commands/submit.js";
import historyCmd from "./commands/history.js";

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

// Handle SIGINT gracefully
process.on("SIGINT", () => {
  console.log("\nInterrupted. Cleaning up...");
  process.exit(130);
});

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
  .addHelpText("after", "\nExamples:\n  $ rn-shipyard doctor\n  $ rn-shipyard doctor --platform ios\n  $ rn-shipyard doctor --json")
  .action(async (_opts, cmd) => {
    const globalOpts = cmd.optsWithGlobals();
    await doctorCmd(globalOpts);
  });

program
  .command("init")
  .description("Set up project for local builds (signing, keystore, Fastlane)")
  .option("-p, --platform <platform>", "Platform to set up: ios, android, or all", "all")
  .addHelpText("after", "\nExamples:\n  $ rn-shipyard init\n  $ rn-shipyard init --platform ios\n  $ rn-shipyard init --non-interactive --platform android")
  .action(async (_opts, cmd) => {
    const globalOpts = cmd.optsWithGlobals();
    await initCmd(globalOpts);
  });

program
  .command("build")
  .description("Build the app locally using Fastlane")
  .option("-p, --platform <platform>", "Platform to build: ios, android, or all", "all")
  .option("--profile <profile>", "Build profile from eas.json", "production")
  .option("--submit", "Submit after successful build", false)
  .option("--skip-version-check", "Skip version bump warning", false)
  .addHelpText("after", "\nExamples:\n  $ rn-shipyard build --platform ios --profile production\n  $ rn-shipyard build --platform all --submit\n  $ rn-shipyard build --json --non-interactive")
  .action(async (_opts, cmd) => {
    const globalOpts = cmd.optsWithGlobals();
    await buildCmd(globalOpts);
  });

program
  .command("submit")
  .description("Submit built artifacts to app stores")
  .option("-p, --platform <platform>", "Platform to submit: ios, android, or all", "all")
  .addHelpText("after", "\nExamples:\n  $ rn-shipyard submit\n  $ rn-shipyard submit --platform ios\n  $ rn-shipyard submit --json --non-interactive")
  .action(async (_opts, cmd) => {
    const globalOpts = cmd.optsWithGlobals();
    await submitCmd(globalOpts);
  });

program
  .command("history")
  .description("Show deployment history")
  .option("-p, --platform <platform>", "Filter by platform: ios or android")
  .option("-l, --limit <limit>", "Number of entries to show", "10")
  .addHelpText("after", "\nExamples:\n  $ rn-shipyard history\n  $ rn-shipyard history --platform ios --limit 5\n  $ rn-shipyard history --json")
  .action(async (_opts, cmd) => {
    const globalOpts = cmd.optsWithGlobals();
    await historyCmd(globalOpts);
  });

program.parseAsync(process.argv).catch((err) => {
  if (err && typeof err === "object" && "code" in err && "message" in err && "fix" in err) {
    const jsonMode = process.argv.includes("--json");
    if (jsonMode) {
      console.log(JSON.stringify({
        success: false,
        error: { code: err.code, message: err.message, fix: err.fix },
      }, null, 2));
    } else {
      console.error(err.message);
    }
  } else {
    console.error(err instanceof Error ? err.message : String(err));
  }
  process.exit(1);
});
