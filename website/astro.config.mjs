// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

// Deploy target is configurable so the same build works on GitHub Pages
// (https://lamazzing.github.io/rn-shipyard/) and, later, on a custom domain
// (SITE_URL=https://example.com BASE_PATH=/).
const site = (process.env.SITE_URL || "https://lamazzing.github.io").replace(/\/+$/, "");
const rawBase = process.env.BASE_PATH ?? "/rn-shipyard/";
const base = rawBase === "/" || rawBase === "" ? "/" : "/" + rawBase.replace(/^\/+|\/+$/g, "");
const prefix = base === "/" ? "" : base;
const ogImage = `${site}${prefix}/og.png`;

/**
 * Markdown links that start with "/" are written without the base path in the content.
 * This remark plugin prepends the configured base so pages work under any BASE_PATH.
 */
function remarkBaseLinks() {
  /** @param {any} node */
  const walk = (node) => {
    if (node.type === "link" && typeof node.url === "string" && /^\/(?!\/)/.test(node.url) && prefix) {
      if (!node.url.startsWith(prefix + "/")) node.url = prefix + node.url;
    }
    if (Array.isArray(node.children)) node.children.forEach(walk);
  };
  return (/** @type {any} */ tree) => walk(tree);
}

export default defineConfig({
  site,
  base,
  trailingSlash: "always",
  markdown: { remarkPlugins: [remarkBaseLinks] },
  integrations: [
    starlight({
      title: "rn-shipyard",
      description:
        "Build and submit Expo and React Native apps from your own Mac with Fastlane. A local alternative to EAS Build and EAS Submit.",
      logo: { src: "./src/assets/logo.svg", alt: "rn-shipyard" },
      favicon: "/favicon.svg",
      social: [{ icon: "github", label: "GitHub", href: "https://github.com/lamazzing/rn-shipyard" }],
      editLink: { baseUrl: "https://github.com/lamazzing/rn-shipyard/edit/main/website/" },
      lastUpdated: false,
      components: { Footer: "./src/components/Footer.astro" },
      customCss: ["./src/styles/theme.css"],
      head: [
        { tag: "meta", attrs: { property: "og:image", content: ogImage } },
        { tag: "meta", attrs: { property: "og:image:width", content: "1200" } },
        { tag: "meta", attrs: { property: "og:image:height", content: "630" } },
        { tag: "meta", attrs: { property: "og:site_name", content: "rn-shipyard" } },
        { tag: "meta", attrs: { name: "twitter:card", content: "summary_large_image" } },
        { tag: "meta", attrs: { name: "twitter:image", content: ogImage } },
        { tag: "meta", attrs: { name: "theme-color", content: "#0b1b33" } },
      ],
      sidebar: [
        {
          label: "Getting started",
          items: [
            { slug: "getting-started/requirements" },
            { slug: "getting-started/install" },
            { slug: "getting-started/first-build" },
            { slug: "getting-started/first-submission" },
          ],
        },
        {
          label: "Guides",
          items: [
            { slug: "guides/migrating-from-eas" },
            { slug: "guides/ios-signing" },
            { slug: "guides/android-credentials" },
            { slug: "guides/submit-app-store" },
            { slug: "guides/submit-google-play" },
            { slug: "guides/dynamic-config" },
            { slug: "guides/ci-scripting" },
            { slug: "guides/version-numbers" },
          ],
        },
        {
          label: "Reference",
          items: [
            { slug: "reference/commands" },
            { slug: "reference/environment-variables" },
            { slug: "reference/json-and-exit-codes" },
            { slug: "reference/error-codes" },
            { slug: "reference/files" },
          ],
        },
        { slug: "security" },
        { slug: "troubleshooting" },
        { slug: "faq" },
        { slug: "roadmap" },
        { slug: "contributing" },
      ],
    }),
  ],
});
