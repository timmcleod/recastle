<script setup>
import { computed, ref } from "vue";
import { Pin, X } from "lucide-vue-next";
import FileIcon from "./FileIcon.vue";
import { isUnsaved } from "../lib/editing.js";
import { fileTabs, moveTab, pinTab, tabLabels, tabsToClose } from "../lib/fileTabs.js";
import { openMenu } from "../lib/overlays.js";
import { useTabRowDrag } from "../lib/tabRowDrag.js";
import { useTabRowScroll } from "../lib/tabRowScroll.js";

// The Files view's tabs, a file in each (see fileTabs.js), above its editor. Clicking
// one shows it; its ×, a middle-click or its menu closes it; dragging it moves it. A
// pinned tab has a pin in place of its ×, which unpins it. Each file's name takes its
// status's color, as in the tree beside it.
const props = defineProps({
  path: { type: String, required: true },
  // The changed files' statuses, by path (see useFileStatuses), or null until known.
  statuses: { type: Map, default: null },
});
// "show" with a file, and "close" with files, for the Files view to do, with the keys
// going where they should (see Workspace.vue).
const emit = defineEmits(["show", "close"]);

const tabs = computed(() => fileTabs(props.path));
const labels = computed(() => tabLabels(tabs.value.files));
const isPinned = (file) => tabs.value.pinned.includes(file);

function tabMenu(event, file) {
  const pinned = isPinned(file);
  const closing = (which) => tabsToClose(props.path, file, which, (f) => props.statuses.has(f));
  const item = (label, which) => ({ label, disabled: !closing(which).length, action: () => emit("close", closing(which)) });
  openMenu(event, [
    { label: "Close", action: () => emit("close", [file]) },
    item("Close Others", "others"),
    item("Close Tabs to the Left", "left"),
    item("Close Tabs to the Right", "right"),
    item("Close All", "all"),
    // Which are changed isn't known until the statuses are read.
    props.statuses ? item("Close Unmodified", "unmodified") : { label: "Close Unmodified", disabled: true },
    { separator: true },
    { label: pinned ? "Unpin Tab" : "Pin Tab", action: () => pinTab(props.path, file, !pinned) },
    { label: "Copy Path", action: () => navigator.clipboard.writeText(file) },
  ]);
}

// --- Dragging a tab to move it ------------------------------------------------------
// Along the row, as a terminal's tab is along its (see tabRowDrag.js), among the pinned
// tabs or the others, where it can go (see moveTab).

const row = ref(null);
const list = ref(null);

const { press, dragging, classOf } = useTabRowDrag({
  row,
  list,
  keys: () => tabs.value.files,
  among: (file) => tabs.value.files.filter((f) => isPinned(f) === isPinned(file)),
  move: (file, to) => moveTab(props.path, file, to),
});

function onPointerDown(event, file) {
  if (event.button !== 0 || event.target.closest(".pane-tab-close")) return;
  press(event, file);
}

// With more tabs than fit, the row scrolls sideways (see tabRowScroll.js).
const onWheel = useTabRowScroll(list, () => tabs.value.active);
</script>

<template>
  <nav v-if="tabs.files.length" ref="row" class="pane-tabs file-tabs" aria-label="Open files">
    <div ref="list" class="pane-tab-list tab-row" :class="{ sorting: dragging != null }" role="tablist" @wheel="onWheel">
      <div
        v-for="file in tabs.files"
        :key="file"
        class="pane-tab file-tab"
        :class="[{ active: file === tabs.active }, classOf(file)]"
        :data-key="file"
        role="tab"
        :aria-selected="file === tabs.active"
        :title="file"
        @pointerdown="onPointerDown($event, file)"
        @click="emit('show', file)"
        @auxclick.middle="emit('close', [file])"
        @contextmenu.prevent="tabMenu($event, file)"
      >
        <FileIcon :name="file" :size="14" />
        <span class="pane-tab-label status-text" :class="statuses?.get(file)">{{ labels.get(file) }}</span>
        <span v-if="isUnsaved(path, file)" class="unsaved-dot" title="Edits not saved" />
        <button v-if="isPinned(file)" class="pane-tab-close pin" title="Unpin" @click.stop="pinTab(path, file, false)">
          <Pin :size="12" />
        </button>
        <button v-else class="pane-tab-close" title="Close" @click.stop="emit('close', [file])"><X :size="12" /></button>
      </div>
    </div>
  </nav>
</template>

<style scoped>
/* The tab showing is of a piece with the editor below it. On the tab, so its copy
   that's dragged has it too (see .pane-tabs in styles.css). */
.file-tab {
  --pane-tab-active-bg: var(--content-bg);
}

/* A pinned tab's pin shows always, saying it's pinned. */
.pane-tab-close.pin {
  opacity: 1;
}

</style>
