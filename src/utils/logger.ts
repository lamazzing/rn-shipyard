import chalk from "chalk";

export interface Logger {
  info(message: string): void;
  success(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  log(message: string): void;
}

export function createLogger(jsonMode: boolean): Logger {
  if (jsonMode) {
    return {
      info() {},
      success() {},
      warn() {},
      error() {},
      log() {},
    };
  }

  return {
    info(message: string) {
      console.log(chalk.blue("ℹ"), message);
    },
    success(message: string) {
      console.log(chalk.green("✓"), message);
    },
    warn(message: string) {
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
