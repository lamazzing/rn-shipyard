import { runCli } from "./program.js";
import chalk from "chalk";
import { installProcessGuards } from "./utils/signals.js";
import { applyNoColor } from "./utils/terminal.js";

applyNoColor(chalk);

// Dead stdout/stderr guards, SIGINT/SIGTERM/SIGHUP (stop child process groups, restore
// package.json, exit 130/143/129), crash handlers and a sync restore on exit.
// See src/utils/signals.ts.
installProcessGuards({ json: process.argv.includes("--json") });

void runCli(process.argv);
