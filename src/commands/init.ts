import { readFile, writeFile, access } from "node:fs/promises";
import { dirname, join, relative, isAbsolute } from "node:path";
import chalk from "chalk";
import { parseEasConfig, parseAppConfig, profileEnvFrom, profileEnvWarnings, configFieldHint } from "../core/eas-parser.js";
import { writeConfig, type ShipyardConfig } from "../core/config.js";
import { generateAll } from "../fastlane/generator.js";
import { setupMatch } from "../platforms/ios/signing.js";
import { resolvePath, toPortablePath, ensureShipyardGitignore } from "../core/paths.js";
import { recordAndroidVersionCode } from "../core/version-code.js";
import { generateKeystore } from "../platforms/android/keystore.js";
import { createLogger } from "../utils/logger.js";
import { ShipyardError, exitCodeForError } from "../utils/errors.js";
import { nativeDirContaining, secretInNativeDirMessage } from "../utils/native-dirs.js";
import { printJson } from "../core/output.js";
import { createPrompter, type Prompter } from "../utils/prompt.js";
import { exec, registerStdinReleaser } from "../utils/shell.js";
import { isInteractive } from "../utils/interactive.js";
import { applyExpoEnvAliases } from "../utils/apple-env.js";
import { runPreflight } from "./preflight.js";
import { collectSecrets } from "../utils/secrets.js";

export interface InitOptions {
  platform: string;
  json: boolean;
  nonInteractive: boolean;
  /** Use an existing keystore (e.g. downloaded from Expo) instead of generating one */
  androidKeystore?: string;
  /** JSON file { keystorePassword, keyAlias, keyPassword } kept outside the repo */
  androidCredentials?: string;
  /** Seed the versionCode counter (e.g. EAS remote counter) so it is never reused */
  androidLastVersionCode?: string;
}

interface AndroidCredentialsFile {
  keystorePath?: string;
  keystorePassword?: string;
  keyAlias?: string;
  keyPassword?: string;
}

const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

/** Exit codes chosen at the failure site; process.exit is only called by initCmd. */
const exitCodes = new WeakMap<ShipyardError, number>();

function fail(err: ShipyardError, exitCode: number): never {
  exitCodes.set(err, exitCode);
  throw err;
}

const MIN_KEYSTORE_PASSWORD = 6;

export { isInteractive };

/**
 * A Match repo URL ends up in .shipyard/config.json and fastlane/Matchfile, which are
 * meant to be committed, so it must not carry credentials. SSH-style user names
 * (git@github.com:org/repo.git, ssh://git@host/repo) are fine.
 */
export function assertCleanMatchUrl(url: string, source: string): void {
  const m = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)@/i.exec(url.trim());
  if (!m) return;
  const scheme = m[1].toLowerCase();
  const userinfo = m[2];
  if (userinfo.includes(":") || ((scheme === "http" || scheme === "https") && userinfo !== "")) {
    throw new ShipyardError(
      "INVALID_MATCH_GIT_URL",
      `The Match git URL from ${source} contains credentials. It would be written to .shipyard/config.json and fastlane/Matchfile, which you commit`,
      "Use a URL without credentials (https://github.com/org/certs.git or git@github.com:org/certs.git) and provide access with MATCH_GIT_BASIC_AUTHORIZATION (base64 of user:token) or an SSH key"
    );
  }
}

function checkKeystorePassword(label: string, value: string): void {
  if (value.length < MIN_KEYSTORE_PASSWORD) {
    throw new ShipyardError(
      "INVALID_KEYSTORE_PASSWORD",
      `${label} must be at least ${MIN_KEYSTORE_PASSWORD} characters (keytool requirement)`,
      `Choose a ${label.toLowerCase()} of ${MIN_KEYSTORE_PASSWORD}+ characters`
    );
  }
}

function redactEnvSecrets(text: string): string {
  let out = text;
  for (const secret of collectSecrets(process.env as Record<string, string | undefined>)) {
    out = out.split(secret).join("***");
  }
  return out;
}

export default async function initCmd(opts: InitOptions): Promise<void> {
  const prompter: { current?: Prompter } = {};
  try {
    await runInit(opts, prompter);
  } catch (err) {
    prompter.current?.close();
    const shipyardErr =
      err instanceof ShipyardError
        ? err
        : new ShipyardError(
            "INIT_FAILED",
            redactEnvSecrets(err instanceof Error ? err.message : String(err)),
            "Re-run with the same flags; if it persists, open an issue with the message above"
          );
    const exitCode =
      exitCodes.get(shipyardErr) ?? (shipyardErr.code === "INTERRUPTED" ? 130 : exitCodeForError(shipyardErr));
    if (opts.json) printJson(shipyardErr.toJSON());
    else {
      const logger = createLogger(false);
      logger.error(shipyardErr.message);
      logger.info(`Fix: ${shipyardErr.fix}`);
    }
    process.exit(exitCode);
    return;
  }
  prompter.current?.close();
}

async function runInit(opts: InitOptions, prompterRef: { current?: Prompter }): Promise<void> {
  const logger = createLogger(opts.json);
  const interactive = isInteractive(opts);
  // EAS-style EXPO_* credential names -> the fastlane names every child reads
  applyExpoEnvAliases();
  // Lazily (re)opened. Any foreground child (fastlane match) first releases it through
  // exec()'s stdin-release hook: the prompter is closed (raw mode off, stdin paused) and
  // dropped here, and the next question simply opens a fresh one.
  const getPrompter = (): Prompter => {
    if (!prompterRef.current) {
      const p = createPrompter();
      const unregister = registerStdinReleaser(() => {
        unregister();
        p.close();
        if (prompterRef.current === p) prompterRef.current = undefined;
      });
      prompterRef.current = p;
    }
    return prompterRef.current;
  };
  const projectDir = process.cwd();
  const doIos = opts.platform === "all" || opts.platform === "ios";
  const doAndroid = opts.platform === "all" || opts.platform === "android";

  // Requirements pre-flight (the same checks as `doctor`) for the selected platforms. init creates
  // .shipyard/config.json and the signing setup, so those checks are left out.
  const platforms = [...(doIos ? (["ios"] as const) : []), ...(doAndroid ? (["android"] as const) : [])];
  if (platforms.length > 0) {
    const preflight = await runPreflight({
      projectDir,
      platforms,
      actions: platforms.map((p) => `build-${p}` as const),
      json: opts.json,
      nonInteractive: !interactive,
      logger,
      // init has its own "No eas.json found" path, and creates the shipyard config
      exclude: ["shipyard-config", "eas-json"],
      excludeGroups: ["Signing & submit"],
    });
    if (!preflight.ok) {
      process.exit(preflight.exitCode);
      return;
    }
  }

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
    // same default profile as `build`/`submit`; its env is applied while a dynamic config is evaluated
    const profile = profileEnvFrom(easConfig, "production");
    for (const w of profileEnvWarnings(profile, "production")) logger.warn(w);
    appConfig = await parseAppConfig(projectDir, profile.env);
    if (appConfig.versionDefaulted) logger.warn(`version not set in ${appConfig.source}; Expo uses 1.0.0`);
    logger.success(`Found app config (${appConfig.source}): ${appConfig.name} v${appConfig.version}`);
  } catch (err) {
    if (err instanceof ShipyardError) return fail(err, err.code.startsWith("MISSING_CONFIG") ? 2 : 1);
    throw err;
  }

  const fatal = fail;

  // --- Validate flag combinations up front: nothing is silently ignored ---
  const androidFlags = [
    opts.androidKeystore !== undefined && "--android-keystore",
    opts.androidCredentials !== undefined && "--android-credentials",
    opts.androidLastVersionCode !== undefined && "--android-last-version-code",
  ].filter((f): f is string => !!f);
  if (androidFlags.length > 0 && !doAndroid) {
    fatal(
      new ShipyardError(
        "INVALID_FLAGS",
        `${androidFlags.join(", ")} only apply to Android but --platform is ${opts.platform}`,
        "Use --platform android (or all), or drop the Android flags"
      ),
      1
    );
  }

  let lastVersionCode: number | undefined;
  if (opts.androidLastVersionCode !== undefined) {
    lastVersionCode = Number(opts.androidLastVersionCode);
    if (!Number.isInteger(lastVersionCode) || lastVersionCode < 0) {
      fatal(
        new ShipyardError(
          "INVALID_FLAGS",
          "--android-last-version-code must be a non-negative integer",
          "Pass the highest versionCode already used, e.g. --android-last-version-code 42"
        ),
        1
      );
    }
  }

  // Existing Android credentials file: read once, validate before any side effect
  let existingKeystore = opts.androidKeystore
    ? resolvePath(projectDir, opts.androidKeystore)
    : undefined;
  let credentialsPath: string | undefined;
  let credentialsAlias: string | undefined;
  if (opts.androidCredentials) {
    credentialsPath = resolvePath(projectDir, opts.androidCredentials);
    let creds: AndroidCredentialsFile;
    try {
      creds = JSON.parse(await readFile(credentialsPath, "utf-8")) as AndroidCredentialsFile;
      if (creds === null || typeof creds !== "object") throw new Error("not an object");
    } catch {
      return fatal(
        new ShipyardError(
          "CREDENTIALS_NOT_READABLE",
          `Cannot read credentials file at ${credentialsPath}`,
          "Check --android-credentials (JSON with keystorePassword, keyAlias, keyPassword)"
        ),
        2
      );
    }

    if (!existingKeystore) {
      if (nonEmpty(creds.keystorePath)) {
        // The credentials file names its keystore: relative paths are relative to that file
        existingKeystore = resolvePath(dirname(credentialsPath), creds.keystorePath);
      } else {
        fatal(
          new ShipyardError(
            "INVALID_FLAGS",
            "--android-credentials was given without --android-keystore, so the credentials would be ignored",
            "Pass --android-keystore <path to .jks/.keystore> too, or add a keystorePath field to the credentials file"
          ),
          1
        );
      }
    }

    const missing: string[] = [];
    if (!nonEmpty(creds.keystorePassword) && !nonEmpty(process.env.ANDROID_KEYSTORE_PASSWORD)) {
      missing.push("keystorePassword (or set ANDROID_KEYSTORE_PASSWORD)");
    }
    if (!nonEmpty(creds.keyAlias)) missing.push("keyAlias");
    if (missing.length > 0) {
      fatal(
        new ShipyardError(
          "MISSING_CONFIG_ANDROID",
          `Android credentials file ${credentialsPath} is missing: ${missing.join(", ")}`,
          'Add the missing fields: { "keystorePassword": "...", "keyAlias": "...", "keyPassword": "..." }'
        ),
        2
      );
    }
    if (nonEmpty(creds.keyAlias)) credentialsAlias = creds.keyAlias;
    if (!nonEmpty(creds.keyPassword)) {
      logger.warn("Credentials file has no keyPassword — the keystore password will be used for the key");
    }
  }

  // A keystore or credentials file inside ios/ or android/ would be deleted by `expo prebuild --clean`
  if (doAndroid) {
    for (const [label, path] of [
      ["Keystore", existingKeystore],
      ["Credentials file", credentialsPath],
    ] as const) {
      if (!path) continue;
      const dir = await nativeDirContaining(projectDir, path);
      if (dir) {
        const { message, fix } = secretInNativeDirMessage(label, path, dir);
        return fatal(new ShipyardError("SECRET_IN_NATIVE_DIR", message, fix), 1);
      }
    }
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
    if (!defaultBundleId && interactive) {
      logger.warn(configFieldHint(appConfig.source, "ios.bundleIdentifier", "com.example.app"));
    }

    let teamId: string;
    let matchGitUrl: string;
    let bundleId: string;

    if (defaultMatchUrl) assertCleanMatchUrl(defaultMatchUrl, "MATCH_GIT_URL");

    if (!interactive) {
      teamId = defaultTeamId;
      matchGitUrl = defaultMatchUrl;
      bundleId = defaultBundleId;

      if (!teamId || !matchGitUrl || !bundleId) {
        const missing = [];
        if (!teamId) missing.push("APPLE_TEAM_ID");
        if (!matchGitUrl) missing.push("MATCH_GIT_URL");
        if (!bundleId) missing.push(`ios.bundleIdentifier in ${appConfig.source}`);
        return fail(
          new ShipyardError(
            "MISSING_CONFIG_IOS",
            `Missing required iOS config: ${missing.join(", ")}`,
            `Set the missing environment variables or add the values to eas.json/${appConfig.source}.${
              bundleId ? "" : ` ${configFieldHint(appConfig.source, "ios.bundleIdentifier", "com.example.app")}`
            }`
          ),
          2
        );
      }
    } else {
      const p = getPrompter();
      bundleId = await p.ask("iOS Bundle Identifier", defaultBundleId);
      teamId = await p.ask("Apple Team ID", defaultTeamId);
      matchGitUrl = await p.ask("Match Git URL (no credentials in the URL)", defaultMatchUrl);
    }
    assertCleanMatchUrl(matchGitUrl, interactive ? "the prompt" : "MATCH_GIT_URL");

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
        interactive,
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
    if (!defaultPackage) {
      logger.warn(configFieldHint(appConfig.source, "android.package", "com.example.app"));
    }
    const defaultKeystorePath = join(".shipyard", "android", "release.keystore");
    const easAndroid = easConfig?.submit?.production?.android;
    const defaultServiceAccount = easAndroid?.serviceAccountKeyPath ?? "";

    let keystorePath = defaultKeystorePath;
    let keystoreAlias = "release";

    if (existingKeystore) {
      // Existing keystore (e.g. the upload key Expo holds): never generate a new one
      keystorePath = existingKeystore;
      try {
        await access(keystorePath);
      } catch {
        fatal(
          new ShipyardError(
            "KEYSTORE_NOT_FOUND",
            `Keystore not found at ${keystorePath}`,
            "Check the --android-keystore path"
          ),
          2
        );
      }
      if (credentialsAlias) keystoreAlias = credentialsAlias;
      else {
        logger.warn(
          `No --android-credentials: assuming key alias "${keystoreAlias}". Set ANDROID_KEYSTORE_PASSWORD and pass a credentials file with keyAlias if it differs`
        );
      }
      logger.success(`Using existing keystore ${keystorePath}`);
    } else {
      let keystorePassword: string;
      let keyPassword: string;

      if (!interactive) {
        keystorePassword = process.env.ANDROID_KEYSTORE_PASSWORD ?? "";
        keyPassword = process.env.ANDROID_KEY_PASSWORD ?? keystorePassword;

        if (!keystorePassword) {
          return fail(
            new ShipyardError(
              "MISSING_CONFIG_ANDROID",
              "Missing ANDROID_KEYSTORE_PASSWORD environment variable",
              "Set ANDROID_KEYSTORE_PASSWORD env var for non-interactive mode, or pass --android-keystore"
            ),
            2
          );
        }
      } else {
        const p = getPrompter();
        const envStore = process.env.ANDROID_KEYSTORE_PASSWORD;
        keystorePassword = "";
        for (let attempt = 0; attempt < 3 && !keystorePassword; attempt++) {
          const first = await p.askSecret("Keystore password", envStore);
          if (first.length < MIN_KEYSTORE_PASSWORD) {
            logger.warn(`Keystore password must be at least ${MIN_KEYSTORE_PASSWORD} characters`);
            continue;
          }
          if (first !== envStore) {
            const again = await p.askSecret("Repeat keystore password");
            if (again !== first) {
              logger.warn("Passwords do not match");
              continue;
            }
          }
          keystorePassword = first;
        }
        if (!keystorePassword) {
          return fail(
            new ShipyardError(
              "INVALID_KEYSTORE_PASSWORD",
              "No valid keystore password entered",
              `Use a password of ${MIN_KEYSTORE_PASSWORD}+ characters, entered identically twice`
            ),
            1
          );
        }
        keyPassword =
          (await p.askSecret("Key password (Enter for same as keystore)", process.env.ANDROID_KEY_PASSWORD)) ||
          keystorePassword;
      }

      checkKeystorePassword("Keystore password", keystorePassword);
      checkKeystorePassword("Key password", keyPassword);

      const keystoreResult = await generateKeystore({
        outputPath: join(projectDir, defaultKeystorePath),
        alias: "release",
        password: keystorePassword,
        keyPassword,
      });

      if (keystoreResult.created) {
        logger.success(`Generated release keystore at ${defaultKeystorePath}`);
      } else {
        logger.info("Keystore already exists, skipping generation");
      }
    }

    if (lastVersionCode !== undefined) {
      await recordAndroidVersionCode(projectDir, lastVersionCode);
      logger.success(
        `Android versionCode counter set to ${lastVersionCode} (next build uses at least ${lastVersionCode + 1})`
      );
    }

    config.platforms.android = {
      enabled: true,
      keystorePath,
      keystoreAlias,
      credentialsPath,
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

  // --- Credentials file inside the repo and not ignored: it would get committed ---
  if (credentialsPath) {
    const rel = relative(projectDir, credentialsPath);
    const insideProject = rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
    if (insideProject && (await isGitUnignored(projectDir, rel))) {
      const msg = `${rel} holds your keystore passwords, is inside the project and is not git-ignored. Add it to .gitignore or move it outside the repository`;
      logger.warn(msg);
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
  if (await ensureShipyardGitignore(projectDir)) {
    logger.success("Wrote .shipyard/.gitignore");
  }

  // --- Output summary ---
  if (opts.json) {
    printJson({
      success: true,
      config: portableForOutput(projectDir, config),
      ...(logger.warnings.length > 0 ? { warnings: logger.warnings } : {}),
      files: [
        ".shipyard/config.json",
        ".shipyard/.gitignore",
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
    console.log(chalk.dim(`  Next: rn-shipyard build --platform ${opts.platform}`));
  }
}

/** True only when git is available, this is a repo, and the path is definitely not ignored. */
async function isGitUnignored(projectDir: string, relPath: string): Promise<boolean> {
  try {
    const result = await exec("git", ["check-ignore", "-q", "--", relPath], { cwd: projectDir });
    return result?.exitCode === 1; // 0 = ignored, 128 = not a repo / error: stay silent
  } catch {
    return false;
  }
}

/** Same portable path form writeConfig stores, so --json output matches config.json. */
function portableForOutput(projectDir: string, config: ShipyardConfig): ShipyardConfig {
  const android = config.platforms.android;
  if (!android) return config;
  const port = (p?: string) => (p ? toPortablePath(projectDir, p) : p);
  return {
    ...config,
    platforms: {
      ...config.platforms,
      android: {
        ...android,
        keystorePath: toPortablePath(projectDir, android.keystorePath),
        credentialsPath: port(android.credentialsPath),
        serviceAccountKeyPath: port(android.serviceAccountKeyPath),
      },
    },
  };
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
    "*.jks",
    "*.keystore",
    "credentials.json",
    "fastlane/report.xml",
    "fastlane/README.md",
  ];

  const present = new Set(content.split(/\r?\n/).map((l) => l.trim()));
  const linesToAdd = entries.filter((e) => !present.has(e));
  if (linesToAdd.length > 0) {
    const suffix = content.endsWith("\n") ? "" : "\n";
    await writeFile(gitignorePath, content + suffix + linesToAdd.join("\n") + "\n");
  }
}
