import { describe, expect, test } from "vitest";
import { nextTick, ref } from "vue";
import { mountComposable } from "../test/mount.js";
import { useOverflows } from "./overflows.js";

// A one-line label 80 wide, its text 10 a letter.
function label(text) {
  const el = document.createElement("span");
  Object.defineProperty(el, "clientWidth", { get: () => 80 });
  Object.defineProperty(el, "scrollWidth", { get: () => Math.max(80, text.value.length * 10) });
  return mountComposable(() => useOverflows(ref(el), () => text.value));
}

const settle = async () => {
  await nextTick();
  await nextTick();
};

describe("useOverflows", () => {
  test("tells, from the start and as what's shown changes, whether it fits", async () => {
    const text = ref("5 files");
    const { result: overflows, unmount } = label(text);
    expect(overflows.value).toBe(false);
    text.value = "500 changed files";
    await settle();
    expect(overflows.value).toBe(true);
    text.value = "1 file";
    await settle();
    expect(overflows.value).toBe(false);
    unmount();
  });

  test("a label too long to begin with is known from the start", () => {
    const { result: overflows, unmount } = label(ref("500 changed files"));
    expect(overflows.value).toBe(true);
    unmount();
  });
});
