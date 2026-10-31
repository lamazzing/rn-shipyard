import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { type CheckDef, ALL_ACTIONS } from "./types.js";
import { tryExec, isDir, isFile } from "./helpers.js";
import { hasSuccessfulBuild } from "./artifacts.js";

interface Leftover {
  /** Project-relative with "/" (trailing "/" = folder), "~/..." or absolute outside the project */
  display: string;
  isDir: boolean;
  inProject: boolean;
}

const SIGNING_FILE = /\.(jks|keystore|p12|pfx|p8|mobileprovision|cer)$/i;

function quote(s: string): string {
  return /^[A-Za-z0-9_\-./@:+=,]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}

/** `~/` stays unquoted so the shell expands it. */
function rmArg(display: string): string {
  return display.startsWith("~/") ? `~/${quote(display.slice(2))}` : quote(display);
}

async function gitState(projectDir: string, rel: string): Promise<"tracked" | "unignored" | "ignored" | "unknown"> {
  const run = (args: string[]) => tryExec("git", args, { cwd: projectDir, env: { GIT_LITERAL_PATHSPECS: "1" } });
  const tracked = await run(["ls-files", "--error-unmatch", "--", rel]);
  if (tracked?.exitCode === 0) return "tracked";
  const ignored = await run(["check-ignore", "-q", "--", rel]);
  if (ignored?.exitCode === 0) return "ignored";
  if (ignored?.exitCode === 1) return "unignored";
  return "unknown"; // not a repo, or git missing
}

async function findLeftovers(projectDir: string): Promise<Leftover[]> {
  // init.ts imports the requirements module (via the pre-flight): load it lazily
  const { readEasCredentials } = await import("../core/eas-credentials.js");
  try {
    const creds = await readEasCredentials(projectDir);
    const { easPlaintextEntries } = await import("../commands/init.js");
    return await easPlaintextEntries(projectDir, creds);
  } catch {
    // no (valid) credentials.json: look for loose signing files in credentials/
  }
  const out: Leftover[] = [];
  if (await isFile(join(projectDir, "credentials.json"))) {
    out.push({ display: "credentials.json", isDir: false, inProject: true }); // unreadable as EAS credentials, still plaintext
  }
  const dir = join(projectDir, "credentials");
  if (await isDir(dir)) {
    try {
      for (const e of await readdir(dir, { withFileTypes: true })) {
        if (e.isFile() && SIGNING_FILE.test(e.name)) out.push({ display: `credentials/${e.name}`, isDir: false, inProject: true });
      }
    } catch {
      // unreadable folder: nothing to list
    }
  }
  return out;
}

export const easLeftoverChecks: CheckDef[] = [
  {
    id: "eas-plaintext-credentials",
    group: "Project",
    title: "No plaintext EAS credentials left over",
    blocks: ALL_ACTIONS,
    async run(ctx) {
      const leftovers = await findLeftovers(ctx.projectDir);
      if (leftovers.length === 0) return { status: "pass", detail: "none found" };
      // Before the first successful build the files may still be the only copy of the keys
      if (!(await hasSuccessfulBuild(ctx.projectDir))) {
        return { status: "pass", detail: "present, kept until a build has worked" };
      }

      const states = new Map<string, string>();
      for (const e of leftovers) {
        states.set(e.display, e.inProject ? await gitState(ctx.projectDir, e.display) : "outside the project");
      }
      const label = (s: string): string =>
        s === "tracked" ? "TRACKED by git" : s === "unignored" ? "not git-ignored" : s === "ignored" ? "git-ignored" : s === "unknown" ? "no git info" : s;
      const detail =
        "a build has worked, but these still hold your signing keys/passwords in plaintext: " +
        leftovers.map((e) => `${e.display} (${label(states.get(e.display)!)})`).join(", ");
      const rm = `rm ${leftovers.some((e) => e.isDir) ? "-r " : ""}-- ${leftovers.map((e) => rmArg(e.display)).join(" ")}`;
      const tracked = leftovers.filter((e) => states.get(e.display) === "tracked");
      const untrack = tracked.length
        ? `git rm ${tracked.some((e) => e.isDir) ? "-r " : ""}--cached -- ${tracked.map((e) => quote(e.display)).join(" ")} && `
        : "";
      return {
        status: "warn",
        detail,
        fix: `Once your signing is safely in Match / ~/.config/rn-shipyard (rn-shipyard never deletes these): ${untrack}${rm}`,
      };
    },
  },
];
