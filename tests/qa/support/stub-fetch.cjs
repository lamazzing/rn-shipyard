// Preloaded into the CLI under test (NODE_OPTIONS=--require <this file>) by the credential-flow QA test.
// `init` checks an App Store Connect API key with a real HTTPS call to api.appstoreconnect.apple.com;
// QA has no Apple account, so that one host answers "key works, app exists". Every other URL is untouched.
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith("https://api.appstoreconnect.apple.com/")) {
    return new Response(JSON.stringify({ data: [{ id: "1000000000", type: "apps" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  return realFetch(url, init);
};
