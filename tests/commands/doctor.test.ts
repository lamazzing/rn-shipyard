import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/utils/shell.js", () => ({
  exec: vi.fn(),
}));

import { exec } from "../../src/utils/shell.js";

const mockedExec = vi.mocked(exec);

// We test the individual check functions by importing them after mocking shell
import { checkXcode, checkCocoaPods } from "../../src/platforms/ios/doctor.js";
import {
  checkAndroidSdk,
  checkJdk,
  checkKeytool,
} from "../../src/platforms/android/doctor.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("iOS checks", () => {
  it("checkXcode passes with valid version", async () => {
    mockedExec.mockResolvedValueOnce({
      exitCode: 0,
      stdout: "Xcode 15.4\nBuild version 15F31d",
      stderr: "",
    });

    const result = await checkXcode();
    expect(result.passed).toBe(true);
    expect(result.version).toBe("15.4");
  });

  it("checkXcode fails when not installed", async () => {
    mockedExec.mockRejectedValueOnce(new Error("not found"));

    const result = await checkXcode();
    expect(result.passed).toBe(false);
    expect(result.fix).toBeTruthy();
  });

  it("checkCocoaPods passes", async () => {
    mockedExec.mockResolvedValueOnce({
      exitCode: 0,
      stdout: "1.15.2",
      stderr: "",
    });

    const result = await checkCocoaPods();
    expect(result.passed).toBe(true);
    expect(result.version).toBe("1.15.2");
  });
});

describe("Android checks", () => {
  it("checkAndroidSdk passes when ANDROID_HOME is set", async () => {
    const original = process.env.ANDROID_HOME;
    process.env.ANDROID_HOME = "/usr/local/android-sdk";

    const result = await checkAndroidSdk();
    expect(result.passed).toBe(true);

    process.env.ANDROID_HOME = original;
  });

  it("checkAndroidSdk fails when ANDROID_HOME not set", async () => {
    const original = process.env.ANDROID_HOME;
    delete process.env.ANDROID_HOME;
    delete process.env.ANDROID_SDK_ROOT;

    const result = await checkAndroidSdk();
    expect(result.passed).toBe(false);
    expect(result.fix).toBeTruthy();

    process.env.ANDROID_HOME = original;
  });

  it("checkJdk passes with valid version", async () => {
    mockedExec.mockResolvedValueOnce({
      exitCode: 0,
      stdout: "",
      stderr: 'openjdk version "17.0.8" 2023-07-18',
    });

    const result = await checkJdk();
    expect(result.passed).toBe(true);
    expect(result.version).toBe("17.0.8");
  });

  it("checkJdk fails with old version", async () => {
    mockedExec.mockResolvedValueOnce({
      exitCode: 0,
      stdout: "",
      stderr: 'java version "1.8.0_301"',
    });

    const result = await checkJdk();
    expect(result.passed).toBe(false);
  });

  it("checkKeytool passes when available", async () => {
    mockedExec.mockResolvedValueOnce({
      exitCode: 0,
      stdout: "keytool usage...",
      stderr: "",
    });

    const result = await checkKeytool();
    expect(result.passed).toBe(true);
  });
});
