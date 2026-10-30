import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findIosWorkspace } from "../../src/platforms/ios/workspace.js";

async function project(...workspaces: string[]) {
  const dir = await mkdtemp(join(tmpdir(), "shipyard-ws-"));
  await mkdir(join(dir, "ios", "Pods"), { recursive: true });
  for (const w of workspaces) await mkdir(join(dir, "ios", w), { recursive: true });
  return dir;
}

describe("findIosWorkspace", () => {
  it("finds the sanitised workspace Expo generated and derives the scheme", async () => {
    const dir = await project("BobsApp.xcworkspace");
    expect(await findIosWorkspace(dir)).toEqual({ workspace: "ios/BobsApp.xcworkspace", scheme: "BobsApp" });
  });
  it("keeps spaces in the name", async () => {
    const dir = await project("My App.xcworkspace");
    expect(await findIosWorkspace(dir)).toEqual({ workspace: "ios/My App.xcworkspace", scheme: "My App" });
  });
  it("errors when there is none", async () => {
    await expect(findIosWorkspace(await project())).rejects.toMatchObject({ code: "XCWORKSPACE_NOT_FOUND" });
  });
  it("errors when there are several", async () => {
    await expect(findIosWorkspace(await project("A.xcworkspace", "B.xcworkspace"))).rejects.toMatchObject({
      code: "XCWORKSPACE_AMBIGUOUS",
    });
  });
});
