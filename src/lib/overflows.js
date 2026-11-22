import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

/**
 * Whether the element in the ref `element` is too narrow for what's in it, rechecked as
 * it's resized and as `content`, a getter for what it shows, changes. Its content
 * should be on one line, clipped (overflow: hidden), and what's done about it shouldn't
 * change its size, as visibility: hidden doesn't, or each check would undo the last.
 */
export function useOverflows(element, content) {
  const overflows = ref(false);
  const check = () => {
    const el = element.value;
    overflows.value = !!el && el.scrollWidth > el.clientWidth;
  };
  let observer;
  onMounted(() => {
    observer = new ResizeObserver(check);
    if (element.value) observer.observe(element.value);
    check();
  });
  onBeforeUnmount(() => observer?.disconnect());
  // Shown again, as the list empties and fills, it's another element to watch.
  watch(element, (now, before) => {
    if (before) observer?.unobserve(before);
    if (now) observer?.observe(now);
  });
  watch(content, () => nextTick(check));
  return overflows;
}
