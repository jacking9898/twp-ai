// SPDX-License-Identifier: MPL-2.0
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
function collectLicenses() {
  const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
  const sections = ["页渡 · Yedu — third-party dependency notices\nGenerated from package-lock.json by scripts/collect-licenses.cjs.\nThis inventory includes all production dependencies; tree shaking may omit some from the browser bundle.\nProject source: https://github.com/jacking9898/twp-ai\n"];
  for (const [location, entry] of Object.entries(lock.packages).filter(([p, e]) => p && !e.dev).sort(([a], [b]) => a.localeCompare(b))) {
    // Node-only optional canvas binaries are not bundled in this browser app.
    if (entry.optional && location.includes("@napi-rs/canvas")) continue;
    const dir = path.join(root, location);
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    if (pkg.version !== entry.version) throw new Error(`Dependency version mismatch: ${pkg.name}. Run npm ci.`);
    const files = fs.readdirSync(dir).filter(name => /^(license|licence|copying|notice)(\.|$)/i.test(name) && fs.statSync(path.join(dir, name)).isFile());
    let texts = files.sort().map(name => `${name}\n${fs.readFileSync(path.join(dir, name), "utf8")}`);
    if (!texts.length && pkg.name === "@ai-sdk/provider-utils" && entry.license === "Apache-2.0") texts = [fs.readFileSync(path.join(root, "licenses/ai-provider-utils.txt"), "utf8")];
    if (!texts.length) throw new Error(`Missing license text for ${pkg.name}; review before distributing.`);
    sections.push(`\n${"=".repeat(72)}\n${pkg.name}@${entry.version}\nDeclared license: ${entry.license || pkg.license}\n${texts.join("\n")}`);
    if (pkg.name === "@ai-sdk/provider-utils") sections.push("\nEmbedded zod3-to-json-schema (ISC):\n" + fs.readFileSync(path.join(dir, "src/to-json-schema/zod3-to-json-schema/LICENSE"), "utf8"));
  }
  for (const file of fs.readdirSync(path.join(root, "licenses")).sort()) sections.push(`\n${"=".repeat(72)}\n${file}\n${fs.readFileSync(path.join(root, "licenses", file), "utf8")}`);
  fs.writeFileSync(path.join(root, "THIRD_PARTY_LICENSES.txt"), sections.join("\n").replace(/[ \t]+(?=\r?$)/gm, ""));
}
if (require.main === module) { collectLicenses(); console.log("Third-party license inventory updated."); }
module.exports = {collectLicenses};
