import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createApp, h, nextTick } from "vue";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({ getCurrentWebviewWindow: () => ({ label: "main" }) }));
// settings.js sets the window's theme as it loads.
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ setTheme: async () => {} }) }));

const { default: FileTabs } = await import("./FileTabs.vue");
const { fileTabs, openTab, pinTab } = await import("../lib/fileTabs.js");
const { contextMenu } = await import("../lib/overlays.js");

let app;
let shown;
let closed;
let repo = 0;
let path;
beforeEach(() => {
  path = `/code/tabs${++repo}`;
});
afterEach(() => {
  app?.unmount();
  document.body.innerHTML = "";
  contextMenu.value = null;
});

async function mount(statuses = null) {
  shown = [];
  closed = [];
  const root = document.createElement("div");
  document.body.append(root);
  app = createApp({
    render: () => h(FileTabs, { path, statuses, onShow: (file) => shown.push(file), onClose: (files) => closed.push(files) }),
  });
  app.mount(root);
  await nextTick();
}

const tabs = () => [...document.querySelectorAll(".pane-tab")];
const tab = (name) => tabs().find((el) => el.textContent.trim() === name);
const names = () => tabs().map((el) => el.textContent.trim());
const menuItem = (label) => contextMenu.value.items.find((i) => i.label === label);

test("shows no row with no files open", async () => {
  await mount();
  expect(document.querySelector(".file-tabs")).toBeNull();
});

test("clicking a tab asks to show its file", async () => {
  ["a.js", "b.js"].forEach((file) => openTab(path, file));
  await mount();
  expect(tab("b.js").classList).toContain("active");
  tab("a.js").click();
  expect(shown).toEqual(["a.js"]);
});

test("a middle-click or a tab's × asks to close it", async () => {
  ["a.js", "b.js"].forEach((file) => openTab(path, file));
  await mount();
  tab("a.js").dispatchEvent(new MouseEvent("auxclick", { button: 1, bubbles: true }));
  tab("b.js").querySelector(".pane-tab-close").click();
  expect(closed).toEqual([["a.js"], ["b.js"]]);
  expect(shown).toEqual([]);
});

test("a pinned tab's pin unpins it, rather than closing it", async () => {
  ["a.js", "b.js"].forEach((file) => openTab(path, file));
  pinTab(path, "b.js", true);
  await mount();
  expect(names()).toEqual(["b.js", "a.js"]);
  tab("b.js").querySelector(".pin").click();
  await nextTick();
  expect(fileTabs(path).pinned).toEqual([]);
  expect(closed).toEqual([]);
});

test("a tab's menu asks to close the others, and can't close to the left of the first", async () => {
  ["a.js", "b.js", "c.js"].forEach((file) => openTab(path, file));
  await mount();
  tab("a.js").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
  expect(menuItem("Close Tabs to the Left").disabled).toBe(true);
  menuItem("Close Others").action();
  expect(closed).toEqual([["b.js", "c.js"]]);
});

test("a tab's menu closes the unmodified only once which are changed is known", async () => {
  ["a.js", "b.js"].forEach((file) => openTab(path, file));
  await mount();
  tab("a.js").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
  expect(menuItem("Close Unmodified").disabled).toBe(true);
  app.unmount();
  await mount(new Map([["a.js", "modified"]]));
  tab("a.js").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
  menuItem("Close Unmodified").action();
  expect(closed).toEqual([["b.js"]]);
});

test("a changed file's name takes its status's color", async () => {
  ["a.js", "b.js"].forEach((file) => openTab(path, file));
  await mount(new Map([["a.js", "modified"]]));
  expect(tab("a.js").querySelector(".pane-tab-label").classList).toContain("modified");
  expect(tab("b.js").querySelector(".pane-tab-label").classList).not.toContain("modified");
});
