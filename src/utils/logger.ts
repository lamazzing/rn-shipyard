import chalk from "chalk";

export interface Logger {
  info(message: string): void;
  success(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  log(message: string): void;
  /** Every warning issued so far (also in --json mode, where nothing is printed). */
  readonly warnings: string[];
}

export function createLogger(jsonMode: boolean): Logger {
  const warnings: string[] = [];
  if (jsonMode) {
    return {
      info() {},
      success() {},
      warn(message: string) {
        warnings.push(message);
      },
      error() {},
      log() {},
      warnings,
    };
  }

  return {
    warnings,
    info(message: string) {
      console.log(chalk.blue("ℹ"), message);
    },
    success(message: string) {
      console.log(chalk.green("✓"), message);
    },
    warn(message: string) {
      warnings.push(message);
      console.log(chalk.yellow("⚠"), message);
    },
    error(message: string) {
      console.error(chalk.red("✗"), message);
    },
    log(message: string) {
      console.log(message);
    },
  };
}
