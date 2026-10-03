const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
function setup(sidePanel) {
  let handler;
  const created = [];
  vm.runInNewContext(fs.readFileSync("src/background/sidePanel.js", "utf8"), { chrome: {
    runtime: { id: "test", getURL: path => `chrome-extension://test/${path}`, onMessage: { addListener: fn => handler = fn } },
    sidePanel, tabs: { create: options => { created.push(options); return Promise.resolve(); } },
  } });
  return { handler, created };
}
const sender = { id: "test", tab: { id: 3, windowId: 2 }, frameId: 0 };
test("native open runs synchronously in the content script user gesture", async () => {
  const calls = [];
  const { handler } = setup({ open: options => { calls.push(options); return Promise.resolve(); } });
  let response;
  assert.equal(handler({ action: "openTranslationSidebar" }, sender, value => response = value), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].windowId, 2);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(response.ok, true);
});
test("failed native open reports an actionable error and no extra tab", async () => {
  const { handler, created } = setup({ open: () => Promise.reject(new Error("gesture lost")) });
  const response = await new Promise(resolve => handler({ action: "openTranslationSidebar" }, sender, resolve));
  assert.equal(response.ok, false);
  assert.match(response.error, /重新点击/);
  assert.equal(created.length, 0);
});
test("browsers without Side Panel API get the same workspace in a tab", async () => {
  const { handler, created } = setup(undefined);
  const response = await new Promise(resolve => handler({ action: "openTranslationSidebar" }, sender, resolve));
  assert.equal(response.ok, true);
  assert.equal(created[0].url, "chrome-extension://test/options/sidepanel.html");
});
test("only this extension's top frame can request a sidebar", () => {
  const { handler, created } = setup(undefined);
  for (const invalid of [{ ...sender, id: "other" }, { ...sender, frameId: 4 }, { id: "test" }]) {
    let response;
    handler({ action: "openTranslationSidebar" }, invalid, value => response = value);
    assert.equal(response.ok, false);
  }
  assert.equal(created.length, 0);
});
test("workspace shortcuts open the requested tool in a separate tab", async () => {
  const { handler, created } = setup({ open: () => { throw new Error("must not open sidebar"); } });
  for (const view of ["text", "document"]) {
    const response = await new Promise(resolve => handler({ action: "openTranslationWorkspace", view }, sender, resolve));
    assert.equal(response.ok, true);
    assert.equal(created.at(-1).url, `chrome-extension://test/options/sidepanel.html?workspace=1&view=${view}`);
  }
  await new Promise(resolve => handler({ action: "openTranslationWorkspace", view: "https://example.invalid" }, sender, resolve));
  assert.equal(created.at(-1).url, "chrome-extension://test/options/sidepanel.html?workspace=1&view=text");
});
