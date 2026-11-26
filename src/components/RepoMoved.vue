<script setup>
import { computed } from "vue";
import { MoveRight } from "lucide-vue-next";

// In place of the Issues or Pull Requests view, for a repository that's moved on GitHub,
// where they can only be listed once its remote's pointed there.
const props = defineProps({
  // Where it was and is now, as { owner, repo }.
  from: { type: Object, required: true },
  to: { type: Object, required: true },
  // The remote to point there, or none, as for a fork's parent, which has no remote.
  remote: { type: String, default: null },
});
defineEmits(["change"]);

const name = (r) => `${r.owner}/${r.repo}`;
const what = computed(() =>
  props.remote
    ? `Point ${props.remote} at it to see its issues and pull requests here.`
    : "Choose another repository above.",
);
</script>

<template>
  <div class="repo-moved">
    <MoveRight :size="28" :stroke-width="1.25" />
    <p>
      {{ name(from) }} has moved to <strong>{{ name(to) }}</strong> on GitHub. {{ what }}
    </p>
    <button v-if="remote" class="secondary-button" @click="$emit('change')">Change {{ remote }}'s URL…</button>
  </div>
</template>

<style scoped>
.repo-moved {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 0 24px;
  color: var(--text-tertiary);
  text-align: center;
}

p {
  margin: 0;
  max-width: 360px;
  line-height: 1.45;
}

strong {
  color: var(--text-secondary);
  font-weight: 600;
}

button {
  padding: 4px 12px;
  font-size: var(--font-md);
}
</style>
