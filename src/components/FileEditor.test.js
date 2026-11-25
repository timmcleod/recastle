import { afterEach, expect, test, vi } from "vitest";
import { createApp, h, nextTick } from "vue";
import { invoke } from "@tauri-apps/api/core";
import FileEditor from "./FileEditor.vue";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ readText: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
// settings.js sets the window's theme as it loads.
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ setTheme: async () => {} }) }));

let app;
afterEach(() => {
  app?.unmount();
  document.body.innerHTML = "";
});

async function mount(file) {
  // A file that isn't text, which opens without the editor.
  vi.mocked(invoke).mockResolvedValue({ kind: "binary", size: 2048 });
  const root = document.createElement("div");
  document.body.append(root);
  app = createApp({ render: () => h(FileEditor, { path: "/repo", file }) });
  app.mount(root);
}

// Waits for `text` to show, a turn at a time: opening loads the editor's code first.
async function until(text) {
  const giveUpAt = performance.now() + 2000;
  while (!document.body.textContent.includes(text) && performance.now() < giveUpAt) {
    await new Promise((resolve) => setTimeout(resolve));
    await nextTick();
  }
  expect(document.body.textContent).toContain(text);
}

test("a file that isn't text says so, with its size", async () => {
  await mount("assets/logo.bin");
  await until("This file isn't text Recastle can edit.");
  expect(document.body.textContent).toContain("2.0 KB");
});

test("with no file open, says how to open one", async () => {
  await mount(null);
  await until("Double-click a file to see and edit it.");
});
