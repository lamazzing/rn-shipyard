import { describe, it, expect, vi } from "vitest";
import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../../src/utils/shell.js", () => ({ exec: vi.fn() }));

import { exec } from "../../src/utils/shell.js";
import { generateKeystore } from "../../src/platforms/android/keystore.js";
import { ShipyardError } from "../../src/utils/errors.js";

async function opts() {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "shipyard-ks-")));
  return { outputPath: join(dir, "k.keystore"), alias: "release", password: "abc", keyPassword: "abc" };
}

describe("generateKeystore failures", () => {
  it("throws a ShipyardError with code/message/fix when keytool fails", async () => {
    vi.mocked(exec).mockResolvedValue({ exitCode: 1, stdout: "", stderr: "keytool error: Keystore password is too short" });
    const err = await generateKeystore(await opts()).catch((e) => e);
    expect(err).toBeInstanceOf(ShipyardError);
    expect(err.code).toBe("KEYSTORE_GENERATION_FAILED");
    expect(err.message).toContain("too short");
    expect(err.fix).toBeTruthy();
  });

  it("maps a missing keytool binary to KEYTOOL_NOT_FOUND", async () => {
    vi.mocked(exec).mockRejectedValue(new Error("spawn keytool ENOENT"));
    const err = await generateKeystore(await opts()).catch((e) => e);
    expect(err).toBeInstanceOf(ShipyardError);
    expect(err.code).toBe("KEYTOOL_NOT_FOUND");
  });
});
