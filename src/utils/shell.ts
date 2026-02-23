import { spawn } from "node:child_process";

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface ExecOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  timeout?: number;
  stream?: boolean;
}

export async function exec(
  cmd: string,
  args: string[],
  opts: ExecOptions = {}
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      stdio: opts.stream ? ["inherit", "pipe", "pipe"] : ["ignore", "pipe", "pipe"],
      timeout: opts.timeout,
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (data: Buffer) => {
      const text = data.toString();
      stdout += text;
      if (opts.stream) {
        process.stdout.write(text);
      }
    });

    child.stderr?.on("data", (data: Buffer) => {
      const text = data.toString();
      stderr += text;
      if (opts.stream) {
        process.stderr.write(text);
      }
    });

    child.on("error", (err) => {
      reject(err);
    });

    child.on("close", (code) => {
      resolve({
        exitCode: code ?? 1,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    });
  });
}

export async function commandExists(cmd: string): Promise<boolean> {
  try {
    const result = await exec("which", [cmd]);
    return result.exitCode === 0;
  } catch {
    return false;
  }
}
