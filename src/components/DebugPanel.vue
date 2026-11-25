<template>
  <Modal
    :show="player.debugMode"
    :close="close"
    title="Debug"
    :show-footer="false"
    :click-outside-hide="true"
    width="40rem"
  >
    <div class="debug-panel">
      <p class="note">
        Playback is paused while debug mode is on. Press Alt+Shift+D or Esc to
        exit.
      </p>

      <section>
        <h3>Track</h3>
        <dl v-if="track.name">
          <dt>Name</dt>
          <dd>{{ track.name }}</dd>
          <dt>ID</dt>
          <dd>{{ track.id }}</dd>
          <dt>Artists</dt>
          <dd>{{ artists }}</dd>
          <dt>Album</dt>
          <dd>{{ album }}</dd>
          <dt>Duration</dt>
          <dd>{{ duration }}</dd>
        </dl>
        <p v-else class="note">No track loaded.</p>
      </section>

      <section>
        <h3>Source</h3>
        <template v-if="source">
          <span class="tag">{{ source.from }}</span>
          <p v-if="source.from === 'cache'" class="note">
            {{ source.url }} (local blob, only playable inside this app)
          </p>
          <a
            v-else
            class="url"
            :href="source.url"
            target="_blank"
            rel="noopener noreferrer"
            >{{ source.url }}</a
          >
        </template>
        <p v-else class="note">No source loaded for this track yet.</p>
      </section>

      <section v-if="ytmurl">
        <h3>ytmurl</h3>
        <dl>
          <dt>Query</dt>
          <dd>{{ ytmurl.q }}</dd>
          <dt>Duration</dt>
          <dd>{{ ytmurl.dmin }}–{{ ytmurl.dmax }}s</dd>
        </dl>
        <a :href="ytmSearchUrl" target="_blank" rel="noopener noreferrer"
          >Search on YouTube Music</a
        >
        <p v-if="!settings.enableUnblockNeteaseMusic" class="note">
          The YouTube Music fallback is disabled in settings.
        </p>
      </section>

      <details v-if="track.name">
        <summary>Raw track JSON</summary>
        <pre>{{ rawTrack }}</pre>
      </details>
    </div>
  </Modal>
</template>

<script>
import { mapState } from 'vuex';
import Modal from '@/components/Modal.vue';
import { formatTrackTime } from '@/utils/common';

export default {
  name: 'DebugPanel',
  components: { Modal },
  computed: {
    ...mapState(['player', 'settings']),
    track() {
      return this.player.currentTrack || {};
    },
    artists() {
      return (this.track.ar || [])
        .map(a => (a.id ? `${a.name} (${a.id})` : a.name))
        .join(', ');
    },
    album() {
      const al = this.track.al;
      if (!al) return '';
      return al.id ? `${al.name} (${al.id})` : al.name;
    },
    duration() {
      const ms = this.track.dt;
      return ms ? `${formatTrackTime(ms / 1000)} (${ms} ms)` : '';
    },
    source() {
      // Ignore the previous track's source while the current one is loading
      const source = this.player.currentTrackSource;
      return source && source.trackId === this.track.id ? source : null;
    },
    ytmurl() {
      return this.track.name ? this.player.getYtmurlParams(this.track) : null;
    },
    ytmSearchUrl() {
      return (
        'https://music.youtube.com/search?q=' +
        encodeURIComponent(this.ytmurl.q)
      );
    },
    rawTrack() {
      return JSON.stringify(this.track, null, 2);
    },
  },
  methods: {
    close() {
      if (this.player.debugMode) this.player.toggleDebugMode();
    },
  },
};
</script>

<style lang="scss" scoped>
.debug-panel {
  color: var(--color-text);
  margin-bottom: 8px;
}

section {
  margin-bottom: 20px;
}

h3 {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  opacity: 0.58;
  margin: 0 0 8px;
}

dl {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 4px 16px;
  margin: 0 0 8px;
}

dt {
  opacity: 0.58;
}

dd {
  margin: 0;
  word-break: break-word;
}

a {
  color: var(--color-primary);
  &:hover {
    text-decoration: underline;
  }
}

.url,
.note {
  word-break: break-all;
}

.note {
  opacity: 0.58;
  margin: 0 0 8px;
}

.tag {
  display: inline-block;
  font-size: 12px;
  font-weight: 600;
  padding: 2px 8px;
  margin-bottom: 6px;
  border-radius: 6px;
  background: var(--color-secondary-bg-for-transparent);
}

summary {
  cursor: pointer;
  opacity: 0.58;
}

pre {
  font-size: 12px;
  max-height: 16rem;
  overflow: auto;
  padding: 8px 12px;
  border-radius: 8px;
  background: var(--color-secondary-bg-for-transparent);
}
</style>
