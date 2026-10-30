import { readFile, writeFile, access, readdir, stat } from "node:fs/promises";
import { dirname, join, relative, isAbsolute, sep } from "node:path";
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
import { safeUrl } from "../platforms/ios/match-repo.js";
import { createPrompter, type Prompter } from "../utils/prompt.js";
import { exec, registerStdinReleaser } from "../utils/shell.js";
import { isInteractive } from "../utils/interactive.js";
import { applyExpoEnvAliases } from "../utils/apple-env.js";
import { runPreflight } from "./preflight.js";
import { collectSecrets } from "../utils/secrets.js";
import { readEasCredentials, type EasCredentials } from "../core/eas-credentials.js";
import { importAndroidKeystore, type AndroidEasImport } from "../platforms/android/eas-import.js";
import { importIosCredentials, type IosEasImport, type IosEasImportOptions } from "../platforms/ios/eas-import.js";

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
  /** Import the signing credentials `eas credentials` downloaded: true = ./credentials.json, or a path */
  fromEas?: string | boolean;
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
  let doIos = opts.platform === "all" || opts.platform === "ios";
  let doAndroid = opts.platform === "all" || opts.platform === "android";

  // --- --from-eas: read credentials.json first, so a missing file fails before any side effect ---
  let easCreds: EasCredentials | undefined;
  if (opts.fromEas !== undefined && opts.fromEas !== false) {
    const conflicting = [
      opts.androidKeystore !== undefined && "--android-keystore",
      opts.androidCredentials !== undefined && "--android-credentials",
    ].filter((f): f is string => !!f);
    if (conflicting.length > 0) {
      return fail(
        new ShipyardError(
          "INVALID_FLAGS",
          `--from-eas already provides the keystore and its credentials; ${conflicting.join(", ")} would conflict`,
          "Use either --from-eas or the --android-* flags"
        ),
        1
      );
    }
    try {
      easCreds = await readEasCredentials(projectDir, typeof opts.fromEas === "string" ? opts.fromEas : undefined);
    } catch (err) {
      if (err instanceof ShipyardError) return fail(err, err.code === "EAS_CREDENTIALS_NOT_FOUND" ? 2 : 1);
      throw err;
    }
    // A platform the file has no section for is skipped: running the normal setup would generate a NEW key
    for (const [name, present, wanted] of [
      ["android", easCreds.android !== undefined, doAndroid],
      ["ios", easCreds.ios !== undefined, doIos],
    ] as const) {
      if (!wanted || present) continue;
      if (opts.platform === name) {
        return fail(
          new ShipyardError(
            "EAS_CREDENTIALS_INVALID",
            `${easCreds.file} has no ${name} section`,
            `Run \`npx eas-cli credentials\`, choose ${name === "ios" ? "iOS" : "Android"}, then credentials.json -> "Download credentials from EAS to credentials.json", and re-run`
          ),
          1
        );
      }
      logger.warn(`${easCreds.file} has no ${name} section: ${name} was not set up. Download its credentials with \`npx eas-cli credentials\` and run init --platform ${name} --from-eas`);
      if (name === "android") doAndroid = false;
      else doIos = false;
    }
  }

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

  // --- --from-eas, Android: verify and copy the EAS keystore, then take the same path as
  // --android-keystore + --android-credentials (config gets ~/-portable paths) ---
  let androidImport: AndroidEasImport | undefined;
  if (easCreds?.android && doAndroid) {
    androidImport = await importAndroidKeystore({
      creds: easCreds.android,
      slug: appConfig.slug,
      confirmReplace: interactive
        ? async (existing) => {
            const answer = await getPrompter().ask(
              `A different keystore already exists at ${toPortablePath(projectDir, existing)}. Replace it? The old file is kept as a .bak copy (y/N)`,
              "n"
            );
            return /^y(es)?$/i.test(answer.trim());
          }
        : undefined,
    });
    opts = { ...opts, androidKeystore: androidImport.keystorePath, androidCredentials: androidImport.credentialsPath };
    logger.success(
      androidImport.unchanged
        ? `EAS keystore already in ${toPortablePath(projectDir, androidImport.dir)}/`
        : `Copied the EAS keystore to ${toPortablePath(projectDir, androidImport.keystorePath)} (mode 600)`
    );
    if (androidImport.backupPath) {
      logger.warn(
        `The previous keystore was kept as ${toPortablePath(projectDir, androidImport.backupPath)}${
          androidImport.credentialsBackupPath ? ` and its passwords as ${toPortablePath(projectDir, androidImport.credentialsBackupPath)}` : ""
        }`
      );
    }
    logger.success(`Upload key certificate SHA-256 (alias ${androidImport.keyAlias}): ${androidImport.sha256}`);
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
  let iosImportPlan: Omit<IosEasImportOptions, "projectDir" | "interactive" | "stream"> | undefined;
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
    if (easCreds?.ios) {
      // --from-eas: the import into the Match repo runs after the Fastfile (which has its lane) is written
      let password = matchPassword ?? "";
      if (!password && interactive) {
        const p = getPrompter();
        for (let attempt = 0; attempt < 3 && !password; attempt++) {
          const first = await p.askSecret("Match password (encrypts the certificates in the Match repo)");
          if (!first) continue;
          if ((await p.askSecret("Repeat Match password")) === first) password = first;
          else logger.warn("Passwords do not match");
        }
      }
      if (!password) {
        return fail(
          new ShipyardError(
            "MISSING_CONFIG_IOS",
            "MATCH_PASSWORD is not set",
            "Set MATCH_PASSWORD (the passphrase that encrypts your Match repo; choose one if the repo is new) or run without --non-interactive to be asked"
          ),
          2
        );
      }
      iosImportPlan = { targets: easCreds.ios, gitUrl: matchGitUrl, teamId, bundleId, matchPassword: password };
    } else if (matchPassword) {
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

  // --- --from-eas: the plaintext EAS files left behind (reported, never deleted by us) ---
  const easEntries = easCreds ? await easPlaintextEntries(projectDir, easCreds) : [];
  const easFiles = easEntries.map((e) => e.display);
  if (easCreds) {
    for (const e of easEntries.filter((x) => x.inProject)) {
      if (await isGitTracked(projectDir, e.display)) {
        logger.warn(`${e.display} holds your signing passwords/keys and is tracked by git. Untrack it: git rm ${e.isDir ? "-r " : ""}--cached -- ${shellQuote(e.display)}`);
      } else if (await isGitUnignored(projectDir, e.display)) {
        logger.warn(`${e.display} holds your signing passwords/keys and was not git-ignored. rn-shipyard adds it to .gitignore`);
      }
    }
    for (const e of easEntries.filter((x) => !x.inProject)) {
      logger.warn(`${e.display} (outside the project) holds your signing passwords/keys: delete it once a build works`);
    }
  }

  // --- Generate Fastlane files (the iOS import below needs the shipyard_match_import lane) ---
  const appleId = easConfig?.submit?.production?.ios?.appleId as string | undefined;
  const packageName = appConfig.android?.package;
  await generateAll(projectDir, config, appConfig.name, appleId, packageName);
  logger.success("Generated fastlane/ files");

  // --- --from-eas, iOS: import into the Match repo (pushes to it; may prompt on the terminal).
  // Before .shipyard/config.json is written, so a failed or interrupted import leaves no config behind. ---
  let iosImport: IosEasImport | undefined;
  if (iosImportPlan) {
    logger.info("Importing the EAS distribution certificate and provisioning profile(s) into the Match repository...");
    iosImport = await importIosCredentials({ ...iosImportPlan, projectDir, interactive, stream: !opts.json });
    for (const w of iosImport.warnings) logger.warn(w);
    for (const t of iosImport.targets) {
      logger.success(
        `Imported ${t.target}${t.bundleId ? ` (${t.bundleId})` : ""}: certificate SHA-256 ${t.certificateSha256}, expires ${t.certificateExpires}`
      );
    }
  }

  // --- Write config ---
  await writeConfig(projectDir, config);
  logger.success("Created .shipyard/config.json");

  // --- Update .gitignore ---
  await updateGitignore(projectDir, easEntries.filter((e) => e.inProject).map((e) => gitignoreLiteral(e.display)));
  logger.success("Updated .gitignore");
  if (await ensureShipyardGitignore(projectDir)) {
    logger.success("Wrote .shipyard/.gitignore");
  }

  // --- Next steps after an import ---
  const nextSteps: string[] = [];
  if (easCreds) {
    if (androidImport) {
      nextSteps.push(
        `Compare the Android upload key SHA-256 (${androidImport.sha256}) with Google Play Console > your app > Test and release > App integrity > App signing > Upload key certificate. They must be identical`
      );
      if (opts.androidLastVersionCode === undefined) {
        nextSteps.push(
          "If EAS managed your versionCode, seed the counter so it is never reused: rn-shipyard init --platform android --from-eas --android-last-version-code <highest versionCode EAS used>"
        );
      }
    }
    const built = [config.platforms.ios ? "ios" : undefined, config.platforms.android ? "android" : undefined].filter(Boolean);
    if (built.length > 0) nextSteps.push(`Build once to confirm the imported credentials work: rn-shipyard build --platform ${built.length === 2 ? "all" : built[0]}`);
    if (easEntries.length > 0) {
      const rm = easEntries.some((e) => e.isDir) ? "rm -r --" : "rm --";
      nextSteps.push(
        `After that build works, delete the plaintext EAS files (they contain your signing passwords): ${rm} ${easEntries.map((e) => rmArg(e.display)).join(" ")}  (rn-shipyard never deletes them for you)`
      );
    }
  }

  // --- Output summary ---
  if (opts.json) {
    printJson({
      success: true,
      config: portableForOutput(projectDir, config),
      ...(easCreds
        ? {
            imported: {
              source: toPortablePath(projectDir, easCreds.file),
              ...(androidImport
                ? {
                    android: {
                      keystore: toPortablePath(projectDir, androidImport.keystorePath),
                      credentials: toPortablePath(projectDir, androidImport.credentialsPath),
                      keyAlias: androidImport.keyAlias,
                      sha256: androidImport.sha256,
                      ...(androidImport.backupPath ? { previousKeystore: toPortablePath(projectDir, androidImport.backupPath) } : {}),
                      ...(androidImport.credentialsBackupPath ? { previousCredentials: toPortablePath(projectDir, androidImport.credentialsBackupPath) } : {}),
                    },
                  }
                : {}),
              ...(iosImport
                ? {
                    ios: {
                      matchGitUrl: safeUrl(config.platforms.ios?.matchGitUrl ?? ""),
                      targets: iosImport.targets.map((t) => ({
                        target: t.target,
                        bundleId: t.bundleId,
                        certificateSha256: t.certificateSha256,
                        certificateExpires: t.certificateExpires,
                      })),
                    },
                  }
                : {}),
            },
            plaintextFiles: easFiles,
            nextSteps,
          }
        : {}),
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
    if (easCreds) {
      console.log(chalk.bold("  Next steps"));
      nextSteps.forEach((step, i) => console.log(`  ${i + 1}. ${step}`));
    } else {
      console.log(chalk.dim(`  Next: rn-shipyard build --platform ${opts.platform}`));
    }
  }
}

/** POSIX single-quote quoting, for commands we print for the user to copy. */
function shellQuote(s: string): string {
  return /^[A-Za-z0-9_\-./@:+=,]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}

export interface EasPlaintextEntry {
  /** What the user sees: project-relative with "/" (trailing "/" = folder), "~/..." or absolute when outside the project */
  display: string;
  isDir: boolean;
  /** Inside the project: worth a .gitignore entry and a git check */
  inProject: boolean;
}

/** Every file under `dir` (recursive, symlinks and special files count as files), or undefined if unreadable. */
async function filesUnder(dir: string): Promise<string[] | undefined> {
  try {
    const out: string[] = [];
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        const sub = await filesUnder(full);
        if (!sub) return undefined;
        out.push(...sub);
      } else out.push(full);
    }
    return out;
  } catch {
    return undefined;
  }
}

/**
 * The plaintext files `eas credentials` left behind, for the .gitignore entries, the git warnings and
 * the delete command. INDIVIDUAL files only, with one exception: eas-cli's default `credentials/`
 * folder (named exactly that, directly next to credentials.json) is listed as a folder when it is
 * not inside a native dir and holds nothing but the referenced files. Never android/, ios/ or a
 * folder in them: a user's native project must not end up in a delete command.
 */
export async function easPlaintextEntries(projectDir: string, creds: EasCredentials): Promise<EasPlaintextEntry[]> {
  const referenced = [
    creds.file,
    creds.android?.keystorePath,
    ...(creds.ios ?? []).flatMap((t) => [t.certificatePath, t.provisioningProfilePath]),
  ].filter((p): p is string => !!p);

  let collapsed: string | undefined;
  const candidate = join(creds.dir, "credentials");
  if (!(await nativeDirContaining(projectDir, candidate))) {
    try {
      if ((await stat(candidate)).isDirectory()) {
        const inside = await filesUnder(candidate);
        const refSet = new Set(referenced);
        if (inside && inside.length > 0 && inside.every((f) => refSet.has(f))) collapsed = candidate;
      }
    } catch {
      // not a folder: list files
    }
  }

  const out: EasPlaintextEntry[] = [];
  const seen = new Set<string>();
  const push = (e: EasPlaintextEntry) => {
    if (!seen.has(e.display)) {
      seen.add(e.display);
      out.push(e);
    }
  };
  for (const abs of referenced) {
    const target = collapsed && relative(collapsed, abs) !== "" && !relative(collapsed, abs).startsWith("..") && !isAbsolute(relative(collapsed, abs)) ? collapsed : abs;
    const isDir = target === collapsed;
    const rel = relative(projectDir, target);
    if (rel !== "" && !rel.startsWith("..") && !isAbsolute(rel)) {
      push({ display: rel.split(sep).join("/") + (isDir ? "/" : ""), isDir, inProject: true });
    } else {
      push({ display: toPortablePath(projectDir, target), isDir: false, inProject: false });
    }
  }
  return out;
}

/** A path as a literal .gitignore line: glob characters and a leading ! or # escaped. */
export function gitignoreLiteral(entry: string): string {
  const escaped = entry.replace(/[*?[\]\\]/g, "\\$&");
  return /^[!#]/.test(escaped) ? `\\${escaped}` : escaped;
}

/** Argument for a printed `rm` command: `~/` stays unquoted so the shell expands it. */
function rmArg(display: string): string {
  return display.startsWith("~/") ? `~/${shellQuote(display.slice(2))}` : shellQuote(display);
}

/** True when git tracks the path (a file, or anything under a folder). */
async function isGitTracked(projectDir: string, relPath: string): Promise<boolean> {
  try {
    const result = await exec("git", ["ls-files", "--error-unmatch", "--", relPath], { cwd: projectDir, env: { GIT_LITERAL_PATHSPECS: "1" } });
    return result?.exitCode === 0;
  } catch {
    return false;
  }
}

/** True only when git is available, this is a repo, and the path is definitely not ignored. */
async function isGitUnignored(projectDir: string, relPath: string): Promise<boolean> {
  try {
    const result = await exec("git", ["check-ignore", "-q", "--", relPath], { cwd: projectDir, env: { GIT_LITERAL_PATHSPECS: "1" } });
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

async function updateGitignore(projectDir: string, extraEntries: string[] = []): Promise<void> {
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
    ...extraEntries,
  ];

  const present = new Set(content.split(/\r?\n/).map((l) => l.trim()));
  const linesToAdd = [...new Set(entries)].filter((e) => !present.has(e));
  if (linesToAdd.length > 0) {
    const suffix = content.endsWith("\n") ? "" : "\n";
    await writeFile(gitignorePath, content + suffix + linesToAdd.join("\n") + "\n");
  }
}
