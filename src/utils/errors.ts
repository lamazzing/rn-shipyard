export class ShipyardError extends Error {
  code: string;
  fix: string;

  constructor(code: string, message: string, fix: string) {
    super(message);
    this.name = "ShipyardError";
    this.code = code;
    this.fix = fix;
  }

  toJSON() {
    return {
      success: false,
      error: {
        code: this.code,
        message: this.message,
        fix: this.fix,
      },
    };
  }
}

export function exitCodeForError(error: unknown): number {
  if (error instanceof ShipyardError) {
    if (error.code.startsWith("MISSING_CONFIG")) return 2;
  }
  return 1;
}
