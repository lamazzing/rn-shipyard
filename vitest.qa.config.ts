import { defineConfig } from "vitest/config";

// The QA suite (`npm run test:qa`): runs the BUILT cli against throwaway Expo projects with real
// git / fastlane / Gradle / CocoaPods. Slow and needs the network, so it is not part of `npm test`
// (vitest.config.ts excludes tests/qa). See CONTRIBUTING.md, "QA suite".
export default defineConfig({
  test: {
    include: ["tests/qa/**/*.test.ts"],
    globalSetup: ["./tests/qa/support/global-setup.ts"],
    testTimeout: 180_000,
    hookTimeout: 900_000,
    // one scenario file at a time: they share the fixture, Gradle and the CocoaPods cache
    fileParallelism: false,
    reporters: ["verbose"],
  },
});
