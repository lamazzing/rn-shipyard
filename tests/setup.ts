import { vi } from "vitest";
import { setJsonSinkForTests } from "../src/utils/terminal.js";

// Command tests capture --json output through a console.log spy. Production writes it with a
// synchronous fd write (src/utils/terminal.ts); route it through console.log here. The helper
// itself is tested for real in tests/utils/terminal.test.ts.
setJsonSinkForTests((text) => console.log(text.replace(/\n$/, "")));

// CI=true (GitHub Actions) makes rn-shipyard non-interactive. Tests that fake a terminal must not
// depend on the host: start every file without it; tests of the CI rule set it themselves.
delete process.env.CI;

// The requirements pre-flight inspects the real machine (Xcode, Ruby, ...). Command tests run
// without it; tests/commands/preflight.test.ts exercises the real module via vi.importActual.
vi.mock("../src/commands/preflight.js", async () => {
  const actual = await vi.importActual<typeof import("../src/commands/preflight.js")>("../src/commands/preflight.js");
  return { ...actual, runPreflight: vi.fn(async () => ({ ok: true })) };
});
