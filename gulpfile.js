const fs = require("node:fs");
const path = require("node:path");
const {execFileSync} = require("node:child_process");
const {pipeline} = require("node:stream/promises");
const gulp = require("gulp");
const zip = require("gulp-zip");
const babel = require("gulp-babel");
const sourcemaps = require("gulp-sourcemaps");
const webpack = require("webpack");
const {collectLicenses} = require("./scripts/collect-licenses.cjs");
const root = __dirname;
const build = path.join(root, "build");
const version = JSON.parse(fs.readFileSync(path.join(root, "src/manifest.json"), "utf8")).version;
// Keep unpacked paths stable for existing development installations; archive names use the new brand.
const chromium = `TWP_AI_${version}_Chromium_MV3`;
const firefox = `TWP_AI_${version}_Firefox`;
const legal = ["LICENSE", "PRIVACY.md", "THIRD_PARTY_NOTICES.md", "THIRD_PARTY_LICENSES.txt"];

gulp.task("clean", cb => {
  const resolved = path.resolve(build);
  if (resolved !== path.join(path.resolve(root), "build") || path.dirname(resolved) !== path.resolve(root)) throw new Error("Invalid build output path");
  if (fs.existsSync(resolved) && fs.lstatSync(resolved).isSymbolicLink()) throw new Error("Refusing to clean a linked build directory");
  fs.rmSync(resolved, {recursive: true, force: true});
  cb();
});
gulp.task("ai-bundle", () => new Promise((resolve, reject) => {
  const compiler = webpack(require("./webpack.ai.cjs"));
  compiler.run((error, stats) => compiler.close(closeError => {
    if (error || closeError || stats?.hasErrors()) reject(error || closeError || new Error(stats.toString({all: false, errors: true})));
    else resolve();
  }));
}));
gulp.task("licenses", cb => { collectLicenses(); cb(); });
gulp.task("firefox-copy", () => gulp.src(["src/**/*", "!src/icons/icon-*.png", "!src/icons/bilingual.png"], {cwd: root, encoding: false}).pipe(gulp.dest(path.join(build, firefox))));
gulp.task("pdf-copy", cb => {
  const dependency = path.join(root, "node_modules/pdfjs-dist");
  const destination = path.join(build, firefox, "lib/pdfjs");
  fs.mkdirSync(destination, {recursive: true});
  for (const file of ["pdf.mjs", "pdf.worker.mjs"]) fs.copyFileSync(path.join(dependency, "legacy/build", file), path.join(destination, file));
  fs.copyFileSync(path.join(dependency, "LICENSE"), path.join(destination, "LICENSE"));
  for (const dir of ["cmaps", "standard_fonts", "wasm", "iccs"]) fs.cpSync(path.join(dependency, dir), path.join(destination, dir), {recursive: true});
  cb();
});
// Rebuild the inherited polyfill from the locked dependencies, so bundled code
// and the generated license inventory describe the same versions.
gulp.task("polyfill-bundle", () => new Promise((resolve, reject) => {
  const compiler = webpack({mode: "production", entry: path.join(root, "polyfill.js"), target: "web", devtool: "source-map", output: {path: path.join(build, firefox, "lib"), filename: "polyfill.js"}, performance: {hints: false}});
  compiler.run((error, stats) => compiler.close(closeError => {
    if (error || closeError || stats?.hasErrors()) reject(error || closeError || new Error(stats.toString({all: false, errors: true})));
    else resolve();
  }));
}));
gulp.task("legal-copy", () => gulp.src(legal, {cwd: root, encoding: false}).pipe(gulp.dest(path.join(build, firefox))));
gulp.task("firefox-manifest", cb => {
  const dir = path.join(build, firefox);
  fs.renameSync(path.join(dir, "manifest.json"), path.join(dir, "chrome-manifest.json"));
  fs.renameSync(path.join(dir, "firefox-manifest.json"), path.join(dir, "manifest.json"));
  cb();
});
gulp.task("babel", () => Promise.all(["background", "lib", "contentScript", "options", "popup"].map(dir => pipeline(
  gulp.src(`${dir}/*.js`, {cwd: path.join(build, firefox), encoding: false}),
  sourcemaps.init(),
  babel({presets: [["@babel/preset-env", {targets: {firefox: "109", chrome: "116"}}]]}),
  sourcemaps.write(`../maps/${version}`),
  gulp.dest(path.join(build, firefox, dir))
))));
gulp.task("source-notice", cb => {
  let revision = "source archive", dirty = false;
  try {
    revision = execFileSync("git", ["rev-parse", "HEAD"], {cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]}).trim();
    dirty = Boolean(execFileSync("git", ["status", "--porcelain"], {cwd: root, encoding: "utf8"}).trim());
  } catch { /* Release source archives need not contain .git. */ }
  fs.writeFileSync(path.join(build, firefox, "SOURCE.txt"), `页渡 · Yedu ${version}\nSource: https://github.com/jacking9898/twp-ai\nLicense: MPL-2.0; third-party exceptions are listed in THIRD_PARTY_NOTICES.md.\nBuild base: ${revision}${dirty ? " (with local changes)" : ""}\nCorresponding editable source is included as Yedu_${version}_Source.zip alongside the extension release.\nBuild instructions: build-instructions.md in that archive.\n`);
  cb();
});
gulp.task("chrome-copy", () => gulp.src("**/*", {cwd: path.join(build, firefox), encoding: false}).pipe(gulp.dest(path.join(build, chromium))));
gulp.task("chrome-manifest", cb => {
  const dir = path.join(build, chromium);
  fs.renameSync(path.join(dir, "manifest.json"), path.join(dir, "firefox-manifest.json"));
  fs.renameSync(path.join(dir, "chrome-manifest.json"), path.join(dir, "manifest.json"));
  cb();
});
gulp.task("zip", () => Promise.all([chromium, firefox].map(dir => pipeline(
  gulp.src("**/*", {cwd: path.join(build, dir), encoding: false}), zip(`${dir.replace("TWP_AI_", "Yedu_")}.zip`), gulp.dest(build)
))));
gulp.task("source-zip", () => gulp.src([
  "src/**/*", "extension/**/*", "scripts/**/*", "tests/**/*", "docs/**/*", "licenses/**/*", "assets/branding/**/*", ".github/**/*",
  ".gitignore", "LICENSE", "PRIVACY", "*.md", "THIRD_PARTY_LICENSES.txt", "package.json", "package-lock.json", "gulpfile.js", "polyfill.js", "webpack.ai.cjs", "playwright.config.js", "jsconfig.json",
  "!src/background/aiService.bundle.js", "!src/background/aiService.bundle.js.LICENSE.txt",
], {cwd: root, base: root, dot: true, encoding: false}).pipe(zip(`Yedu_${version}_Source.zip`)).pipe(gulp.dest(build)));
gulp.task("checksums", cb => {
  const {createHash} = require("node:crypto");
  const names = fs.readdirSync(build).filter(name => name.endsWith(".zip")).sort();
  fs.writeFileSync(path.join(build, "SHA256SUMS.txt"), names.map(name => `${createHash("sha256").update(fs.readFileSync(path.join(build, name))).digest("hex")}  ${name}`).join("\n") + "\n");
  cb();
});
gulp.task("chrome-sign", cb => {
  if (!process.argv.includes("--sign")) return cb();
  return require("node-file-dialog")({type: "open-file"}).then(files => require("crx3")([path.join(build, chromium, "manifest.json")], {keyPath: files[0], crxPath: path.join(build, `${chromium.replace("TWP_AI_", "Yedu_")}.crx`)}));
});
gulp.task("default", gulp.series("licenses", "ai-bundle", "clean", "firefox-copy", "pdf-copy", "polyfill-bundle", "legal-copy", "firefox-manifest", "babel", "source-notice", "chrome-copy", "chrome-manifest", "zip", "source-zip", "checksums", "chrome-sign"));
