import chalk from "chalk";
import Table from "cli-table3";
import { queryHistory, type HistoryEntry } from "../core/history.js";
import { createLogger } from "../utils/logger.js";
import { printJson, tableStyle } from "../core/output.js";

export interface HistoryOptions {
  platform?: string;
  limit: string;
  json: boolean;
  nonInteractive: boolean;
}

export default async function historyCmd(opts: HistoryOptions): Promise<void> {
  const logger = createLogger(opts.json);
  const projectDir = process.cwd();
  const limit = parseInt(opts.limit, 10) || 10;

  const entries = await queryHistory(projectDir, {
    platform: opts.platform as "ios" | "android" | undefined,
    limit,
  });

  if (entries.length === 0) {
    if (opts.json) {
      printJson({ success: true, entries: [] });
    } else {
      logger.info("No builds yet. Run 'rn-shipyard build' to get started.");
    }
    return;
  }

  if (opts.json) {
    printJson({ success: true, entries });
    return;
  }

  // Render as table — one row per platform per entry
  const table = new Table({
    head: ["Date", "Command", "Profile", "Platform", "Version", "Build#", "Status", "Duration"],
    style: tableStyle(),
  });

  for (const entry of entries) {
    for (const [platform, result] of Object.entries(entry.platforms)) {
      if (!result) continue;
      if (opts.platform && platform !== opts.platform) continue;

      const date = new Date(entry.timestamp).toLocaleString();
      const buildNum = result.buildNumber ?? result.versionCode?.toString() ?? "-";
      const statusText = colorStatus(result.status);
      const duration = result.durationSeconds > 0 ? `${result.durationSeconds}s` : "-";

      table.push([
        date,
        entry.command,
        entry.profile,
        platform,
        result.version,
        buildNum,
        statusText,
        duration,
      ]);
    }
  }

  console.log(table.toString());
}

function colorStatus(status: string): string {
  switch (status) {
    case "success":
      return chalk.green(status);
    case "error":
      return chalk.red(status);
    case "skipped":
      return chalk.yellow(status);
    default:
      return status;
  }
}
