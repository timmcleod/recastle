import { nextTick, watch } from "vue";

// A row of tabs with more than fit scrolls sideways, its scrollbar hidden, as the
// window's tabs and the Files view's do (TabStrip.vue, FileTabs.vue): the tab that
// comes to show, however it was chosen, is scrolled into it, and a mouse's wheel, as
// one without a trackpad has no other way, scrolls it too.

/**
 * Keeps the tab marked .active in `list`, the element they're in, in view as
 * `active()` changes. Returns onWheel, for the list's wheel events.
 */
export function useTabRowScroll(list, active) {
  watch(active, async () => {
    await nextTick();
    list.value?.querySelector(":scope > .active")?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  });

  function onWheel(event) {
    if (!event.deltaY || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
    event.preventDefault();
    list.value.scrollLeft += event.deltaY;
  }
  return onWheel;
}
