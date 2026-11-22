<script setup>
// A changed file's path, as a list shows it: the name stays whole, and a folder too long
// to fit is cut from its start ("…/resources/js/"), the end being what tells files apart.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { splitPath } from "../lib/filePath.js";

const props = defineProps({
  path: { type: String, required: true },
  // The path it was renamed from.
  oldPath: { type: String, default: null },
  // Off where the folder's already shown, as in a tree.
  withFolder: { type: Boolean, default: true },
});

const parts = computed(() => splitPath(props.path));

// CSS only puts an ellipsis at a line's end, and right-to-left text, the usual way round
// that, squeezes the name and misplaces the ellipsis in WebKit. So each part's start is
// clipped by aligning it to its end, and the "…" shown only where it doesn't fit.
const root = ref(null);
const cut = ref(new Set());
function measure() {
  const next = new Set();
  for (const part of root.value?.querySelectorAll(".start-cut") ?? []) {
    if (part.querySelector(".text").offsetWidth > part.clientWidth) next.add(part.dataset.part);
  }
  if ([...next].join() !== [...cut.value].join()) cut.value = next;
}
let observer;
onMounted(() => {
  observer = new ResizeObserver(measure);
  observer.observe(root.value);
  measure();
});
onBeforeUnmount(() => observer?.disconnect());
watch([() => props.path, () => props.oldPath, () => props.withFolder], () => nextTick(measure));
</script>

<template>
  <span ref="root" class="file-path" :title="oldPath ? `${oldPath} → ${path}` : path">
    <span v-if="oldPath" class="dim start-cut old" data-part="old" :class="{ cut: cut.has('old') }">
      <span class="clip"><span class="text">{{ oldPath }} →</span></span>
    </span>
    <span v-if="withFolder && parts.dir" class="dim start-cut" data-part="dir" :class="{ cut: cut.has('dir') }">
      <span class="clip"><span class="text">{{ parts.dir }}</span></span>
    </span>
    <span class="name">{{ parts.name }}</span>
  </span>
</template>

<style scoped>
.file-path {
  flex: 1;
  min-width: 0;
  display: flex;
  overflow: hidden;
  white-space: nowrap;
}

/* The folders give up their room; the name only once it's alone and still too long. */
.start-cut {
  display: flex;
  min-width: 0;
}

.start-cut.cut::before {
  content: "…";
  flex-shrink: 0;
}

/* Aligned to its end, what doesn't fit spills off the start, where it's hidden. */
.clip {
  display: flex;
  justify-content: flex-end;
  min-width: 0;
  overflow: hidden;
}

.text {
  flex-shrink: 0;
  white-space: pre;
}

.name {
  flex-shrink: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}

.old {
  margin-right: 0.3em;
}
</style>
