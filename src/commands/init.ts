import { readFile, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import chalk from "chalk";
import { parseEasConfig, parseAppConfig } from "../core/eas-parser.js";
import { writeConfig, type ShipyardConfig } from "../core/config.js";
import { generateAll } from "../fastlane/generator.js";
import { setupMatch } from "../platforms/ios/signing.js";
import { generateKeystore } from "../platforms/android/keystore.js";
import { createLogger } from "../utils/logger.js";
import { ShipyardError } from "../utils/errors.js";
import { printJson } from "../core/output.js";

export interface InitOptions {
  platform: string;
  json: boolean;
  nonInteractive: boolean;
}

async function prompt(question: string, defaultValue?: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const suffix = defaultValue ? ` [${defaultValue}]` : "";

  return new Promise((resolve) => {
    rl.question(`  ${question}${suffix}: `, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultValue || "");
    });
  });
}

export default async function initCmd(opts: InitOptions): Promise<void> {
  const logger = createLogger(opts.json);
  const projectDir = process.cwd();
  const doIos = opts.platform === "all" || opts.platform === "ios";
  const doAndroid = opts.platform === "all" || opts.platform === "android";

  logger.info("Initializing rn-shipyard...");

  // Parse existing configs
  let easConfig;
  try {
    easConfig = await parseEasConfig(projectDir);
    logger.success("Found eas.json");
  } catch {
    logger.warn("No eas.json found — using defaults");
    easConfig = null;
  }

  let appConfig;
  try {
    appConfig = await parseAppConfig(projectDir);
    logger.success(`Found app config: ${appConfig.name} v${appConfig.version}`);
  } catch (err) {
    if (err instanceof ShipyardError) {
      if (opts.json) {
        printJson(err.toJSON());
        process.exit(2);
      }
      logger.error(err.message);
      logger.info(`Fix: ${err.fix}`);
      process.exit(2);
    }
    throw err;
  }

  const config: ShipyardConfig = {
    version: "1.0.0",
    createdAt: new Date().toISOString(),
    platforms: {},
    outputDir: "./output",
  };

  // --- iOS Setup ---
  if (doIos) {
    logger.info("Setting up iOS...");

    const easIos = easConfig?.submit?.production?.ios;
    const defaultTeamId = easIos?.appleTeamId ?? process.env.APPLE_TEAM_ID ?? "";
    const defaultMatchUrl = process.env.MATCH_GIT_URL ?? "";
    const defaultBundleId = appConfig.ios?.bundleIdentifier ?? "";

    let teamId: string;
    let matchGitUrl: string;
    let bundleId: string;

    if (opts.nonInteractive) {
      teamId = defaultTeamId;
      matchGitUrl = defaultMatchUrl;
      bundleId = defaultBundleId;

      if (!teamId || !matchGitUrl || !bundleId) {
        const missing = [];
        if (!teamId) missing.push("APPLE_TEAM_ID");
        if (!matchGitUrl) missing.push("MATCH_GIT_URL");
        if (!bundleId) missing.push("ios.bundleIdentifier in app.json");
        const err = new ShipyardError(
          "MISSING_CONFIG_IOS",
          `Missing required iOS config: ${missing.join(", ")}`,
          "Set the missing environment variables or add values to eas.json/app.json"
        );
        if (opts.json) {
          printJson(err.toJSON());
          process.exit(2);
        }
        logger.error(err.message);
        process.exit(2);
      }
    } else {
      bundleId = await prompt("iOS Bundle Identifier", defaultBundleId);
      teamId = await prompt("Apple Team ID", defaultTeamId);
      matchGitUrl = await prompt("Match Git URL (for certificates)", defaultMatchUrl);
    }

    config.platforms.ios = {
      enabled: true,
      signingMethod: "match",
      matchGitUrl,
      matchType: "appstore",
      teamId,
      bundleId,
    };

    // Run Match setup
    const matchPassword = process.env.MATCH_PASSWORD;
    if (matchPassword) {
      logger.info("Running Fastlane Match to set up code signing...");
      const matchResult = await setupMatch({
        gitUrl: matchGitUrl,
        teamId,
        bundleId,
        password: matchPassword,
        projectDir,
        stream: !opts.json,
      });
      if (matchResult.success) {
        logger.success("iOS code signing configured");
      } else {
        logger.warn(`Match setup failed: ${matchResult.error}`);
        logger.info("You can run 'fastlane match appstore' manually later");
      }
    } else {
      logger.warn(
        "MATCH_PASSWORD not set — skipping Match setup. Set it and run 'fastlane match appstore' manually"
      );
    }
  }

  // --- Android Setup ---
  if (doAndroid) {
    logger.info("Setting up Android...");

    const defaultPackage = appConfig.android?.package ?? "";
    const defaultKeystorePath = join(".shipyard", "android", "release.keystore");
    const easAndroid = easConfig?.submit?.production?.android;
    const defaultServiceAccount = easAndroid?.serviceAccountKeyPath ?? "";

    let keystorePassword: string;
    let keyPassword: string;

    if (opts.nonInteractive) {
      keystorePassword = process.env.ANDROID_KEYSTORE_PASSWORD ?? "";
      keyPassword = process.env.ANDROID_KEY_PASSWORD ?? keystorePassword;

      if (!keystorePassword) {
        const err = new ShipyardError(
          "MISSING_CONFIG_ANDROID",
          "Missing ANDROID_KEYSTORE_PASSWORD environment variable",
          "Set ANDROID_KEYSTORE_PASSWORD env var for non-interactive mode"
        );
        if (opts.json) {
          printJson(err.toJSON());
          process.exit(2);
        }
        logger.error(err.message);
        process.exit(2);
      }
    } else {
      keystorePassword = await prompt(
        "Keystore password",
        process.env.ANDROID_KEYSTORE_PASSWORD
      );
      keyPassword = await prompt("Key password (Enter for same as keystore)", "") || keystorePassword;
    }

    // Generate keystore
    const keystorePath = join(projectDir, defaultKeystorePath);
    const keystoreResult = await generateKeystore({
      outputPath: keystorePath,
      alias: "release",
      password: keystorePassword,
      keyPassword,
    });

    if (keystoreResult.created) {
      logger.success(`Generated release keystore at ${defaultKeystorePath}`);
    } else {
      logger.info("Keystore already exists, skipping generation");
    }

    config.platforms.android = {
      enabled: true,
      keystorePath: defaultKeystorePath,
      keystoreAlias: "release",
      serviceAccountKeyPath: defaultServiceAccount || undefined,
    };

    if (defaultServiceAccount) {
      logger.success(`Google Play service account: ${defaultServiceAccount}`);
    } else {
      logger.info(
        "No Google Play service account configured — Android submit will be skipped"
      );
    }
  }

  // --- Write config ---
  await writeConfig(projectDir, config);
  logger.success("Created .shipyard/config.json");

  // --- Generate Fastlane files ---
  const appleId = easConfig?.submit?.production?.ios?.appleId as string | undefined;
  const packageName = appConfig.android?.package;
  await generateAll(projectDir, config, appConfig.name, appleId, packageName);
  logger.success("Generated fastlane/ files");

  // --- Update .gitignore ---
  await updateGitignore(projectDir);
  logger.success("Updated .gitignore");

  // --- Output summary ---
  if (opts.json) {
    printJson({
      success: true,
      config,
      files: [
        ".shipyard/config.json",
        "fastlane/Fastfile",
        "fastlane/Appfile",
        ...(config.platforms.ios ? ["fastlane/Matchfile"] : []),
      ],
    });
  } else {
    console.log("");
    console.log(chalk.bold("  Setup complete!"));
    console.log("");
    if (config.platforms.ios) {
      console.log(`  ${chalk.green("✓")} iOS: Match signing configured`);
    }
    if (config.platforms.android) {
      console.log(`  ${chalk.green("✓")} Android: Keystore ready`);
    }
    console.log("");
    console.log(chalk.dim("  Next: rn-shipyard build --platform all"));
  }
}

async function updateGitignore(projectDir: string): Promise<void> {
  const gitignorePath = join(projectDir, ".gitignore");
  let content = "";

  try {
    content = await readFile(gitignorePath, "utf-8");
  } catch {
    // No .gitignore yet
  }

  const entries = [
    "# rn-shipyard",
    ".shipyard/android/*.keystore",
    ".shipyard/android/*.jks",
    "output/",
    "*.ipa",
    "*.aab",
    "*.apk",
  ];

  const linesToAdd = entries.filter((e) => !content.includes(e));
  if (linesToAdd.length > 0) {
    const suffix = content.endsWith("\n") ? "" : "\n";
    await writeFile(gitignorePath, content + suffix + linesToAdd.join("\n") + "\n");
  }
}
