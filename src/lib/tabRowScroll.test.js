import { expect, test, vi } from "vitest";
import { nextTick, ref } from "vue";
import { mountComposable } from "../test/mount.js";
import { useTabRowScroll } from "./tabRowScroll.js";

function row() {
  const list = document.createElement("div");
  for (const key of ["a", "b"]) {
    const tab = document.createElement("div");
    tab.dataset.key = key;
    tab.scrollIntoView = vi.fn();
    list.append(tab);
  }
  return list;
}

test("the tab that comes to show is scrolled into the row", async () => {
  const list = row();
  const active = ref("a");
  const { unmount } = mountComposable(() => useTabRowScroll(ref(list), () => active.value));
  const b = list.querySelector('[data-key="b"]');
  b.classList.add("active");
  active.value = "b";
  await nextTick();
  await nextTick();
  expect(b.scrollIntoView).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });
  unmount();
});

test("a mouse's wheel scrolls the row sideways, and a trackpad's sideways scroll is left alone", () => {
  const list = row();
  const { result: onWheel, unmount } = mountComposable(() => useTabRowScroll(ref(list), () => null));
  const wheel = (deltaX, deltaY) => ({ deltaX, deltaY, preventDefault: vi.fn() });
  const down = wheel(0, 40);
  onWheel(down);
  expect(list.scrollLeft).toBe(40);
  expect(down.preventDefault).toHaveBeenCalled();
  const sideways = wheel(30, 5);
  onWheel(sideways);
  expect(list.scrollLeft).toBe(40);
  expect(sideways.preventDefault).not.toHaveBeenCalled();
  unmount();
});
