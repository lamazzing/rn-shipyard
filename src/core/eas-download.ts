import { exec } from "../utils/shell.js";

export type EasPlatform = "ios" | "android";

/**
 * eas-cli 18.1.0 has no non-interactive way to download signing credentials: `eas credentials`
 * takes only --platform (commands/credentials/index.js) and hard-codes nonInteractive: false in
 * ManageIos/ManageAndroid. The only supported path is its menu, so we print every answer up front.
 *
 * Questions, in the order eas-cli asks them (credentials/manager/*.js, credentials/context.js):
 *  - Expo login, if `eas login` was not done
 *  - "Which build profile do you want to configure?" (only when eas.json has several)
 *  - iOS only: "Do you want to log in to your Apple account?" (context.js
 *    bestEffortAppStoreAuthenticateAsync). Download reads only Expo's servers (credentialsJson/
 *    update.js getTargetBuildCredentialsAsync uses ctx.graphqlClient), so the answer is No.
 *    It is skipped when EXPO_ASC_API_KEY_PATH / EXPO_ASC_KEY_ID / EXPO_ASC_ISSUER_ID are set.
 *  - "What do you want to do?" -> credentials.json -> Download credentials from EAS to credentials.json
 *  - "Press any key to continue", then Go back -> Exit
 */
export function easDownloadGuide(platforms: EasPlatform[]): string[] {
  const lines: string[] = [
    "eas-cli will open its menu. Answer like this:",
    "  - Expo login: if it asks for your email/username and password, sign in (or run `npx eas-cli login` first).",
    '  - "Which build profile do you want to configure?" (only if eas.json has several): choose production.',
  ];
  if (platforms.includes("ios")) {
    lines.push(
      '  - iOS: "Do you want to log in to your Apple account?": answer n (No). The download only reads Expo\'s servers; no Apple login is needed.'
    );
  }
  lines.push(
    '  - "What do you want to do?": choose "credentials.json: Upload/Download credentials between EAS servers and your local json".',
    '  - Then choose "Download credentials from EAS to credentials.json".',
    '  - Press any key when it says it is done, choose "Go back", then "Exit". Do not press Ctrl-C.'
  );
  return lines;
}

/** One line for an error's `fix`: the same menu path, without the interactive details. */
export function easDownloadMenuPath(): string {
  return 'Run `npx eas-cli credentials -p <ios|android>` in the project folder and choose: (iOS: answer n to "Do you want to log in to your Apple account?") -> "credentials.json: Upload/Download credentials between EAS servers and your local json" -> "Download credentials from EAS to credentials.json" -> Go back -> Exit';
}

/**
 * Runs `npx eas-cli credentials -p <platform>` on the user's terminal, one platform after the
 * other. Interactive only (exec rejects foreground without a TTY). Returns the platforms whose
 * run ended with exit code 0.
 */
export async function runEasCredentialsDownload(projectDir: string, platforms: EasPlatform[]): Promise<EasPlatform[]> {
  const done: EasPlatform[] = [];
  for (const platform of platforms) {
    const r = await exec("npx", ["eas-cli", "credentials", "-p", platform], { cwd: projectDir, foreground: true });
    if (r?.exitCode === 0) done.push(platform);
  }
  return done;
}
