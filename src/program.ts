import { Command, CommanderError } from "commander";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import doctorCmd from "./commands/doctor.js";
import initCmd from "./commands/init.js";
import buildCmd from "./commands/build.js";
import submitCmd from "./commands/submit.js";
import historyCmd from "./commands/history.js";
import { printJson } from "./core/output.js";

function readVersion(): string {
  try {
    const pkgPath = join(__dirname, "..", "package.json");
    return JSON.parse(readFileSync(pkgPath, "utf-8")).version;
  } catch {
    return "0.1.0"; // fallback to hardcoded version
  }
}

export function createProgram(argv: string[] = process.argv): Command {
  const jsonMode = argv.includes("--json");
  const program = new Command();
  // Usage errors (unknown option, missing argument) are thrown as CommanderError instead of
  // exiting, so handleCliError can print the --json envelope. Set before the subcommands are
  // created: they inherit both settings. Help and --version output are unchanged.
  program.exitOverride();
  program.configureOutput({
    // Commander prints help to stderr when no subcommand is given; --json gets an envelope instead
    writeErr: (str) => {
      if (!jsonMode) process.stderr.write(str);
    },
    outputError: (str, write) => {
      if (!jsonMode) write(str);
    },
  });
  const version = readVersion();

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
    .option("--android-keystore <path>", "Use an existing keystore instead of generating one")
    .option("--android-credentials <path>", "JSON file with keystorePassword, keyAlias, keyPassword (keep outside the repo)")
    .option("--android-last-version-code <n>", "Seed the versionCode counter (e.g. the EAS remote counter)")
    .option("--from-eas [path]", "Import the signing credentials `eas credentials` downloaded (default ./credentials.json)")
    .addHelpText("after", "\nExamples:\n  $ rn-shipyard init\n  $ rn-shipyard init --platform ios\n  $ rn-shipyard init --non-interactive --platform android\n  $ rn-shipyard init --from-eas")
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
    .option("--version-code <n>", "Android versionCode (must be greater than the last used one)")
    .option("--skip-checks", "Skip the requirements pre-flight (see `doctor`)", false)
    .addHelpText("after", "\nExamples:\n  $ rn-shipyard build --platform ios --profile production\n  $ rn-shipyard build --platform all --submit\n  $ rn-shipyard build --json --non-interactive")
    .action(async (_opts, cmd) => {
      const globalOpts = cmd.optsWithGlobals();
      await buildCmd(globalOpts);
    });

  program
    .command("submit")
    .description("Submit built artifacts to app stores")
    .option("-p, --platform <platform>", "Platform to submit: ios, android, or all", "all")
    .option("--profile <profile>", "Submit profile from eas.json", "production")
    .option("--dry-run", "Check everything and print the fastlane command without uploading", false)
    .option("--skip-checks", "Skip the requirements pre-flight (see `doctor`)", false)
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

  return program;
}

/** Prints a --json envelope or the plain message for whatever the CLI run threw, then exits. */
export function handleCliError(err: unknown, argv: string[] = process.argv): void {
  const jsonMode = argv.includes("--json");
  if (err instanceof CommanderError) {
    // --help / --version: Commander already printed them
    if (err.exitCode === 0) process.exit(0);
    if (jsonMode) {
      const noCommand = err.code === "commander.help" || err.message === "(outputHelp)";
      const sub = argv.slice(2).find((a) => !a.startsWith("-"));
      const known = ["doctor", "init", "build", "submit", "history"];
      printJson({
        success: false,
        error: {
          code: "INVALID_USAGE",
          message: noCommand ? "No command given" : err.message.replace(/^error: /, ""),
          fix: !noCommand && sub && known.includes(sub) ? `Run rn-shipyard ${sub} --help` : "Run rn-shipyard --help",
        },
      });
    }
    // human mode: Commander already wrote the message to stderr
    process.exit(1);
    return;
  }
  if (err && typeof err === "object" && "code" in err && "message" in err && "fix" in err) {
    const e = err as { code: string; message: string; fix: string };
    if (jsonMode) {
      printJson({ success: false, error: { code: e.code, message: e.message, fix: e.fix } });
    } else {
      console.error(e.message);
    }
  } else {
    console.error(err instanceof Error ? err.message : String(err));
  }
  process.exit(1);
}

export async function runCli(argv: string[] = process.argv): Promise<void> {
  try {
    await createProgram(argv).parseAsync(argv);
  } catch (err) {
    handleCliError(err, argv);
  }
}
