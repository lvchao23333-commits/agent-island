/**
 * Tracks conversation state across polls and detects running -> finished transitions.
 */
class StateTracker {
  constructor(options = {}) {
    this.recentTtlMs = options.recentTtlMs ?? 60 * 1000;
    this.prevById = new Map();
    this.recentFinished = [];
    this.dismissedIds = new Set();
    this.initialized = false;
  }

  dismiss(id) {
    if (id) {
      this.dismissedIds.add(id);
    }
  }

  update(items, now = Date.now()) {
    const currentById = new Map();
    const newlyFinished = [];

    for (const item of items) {
      currentById.set(item.id, item);
      // On first poll, ignore pre-existing non-running conversations
      if (!this.initialized && item.status !== 'running') {
        this.dismissedIds.add(item.id);
      }
      // Automatically un-dismiss if the conversation starts running again
      if (item.status === 'running' && this.dismissedIds.has(item.id)) {
        this.dismissedIds.delete(item.id);
      }
      if (this.initialized) {
        const prev = this.prevById.get(item.id);
        if (prev && prev.status === 'running' && item.status !== 'running') {
          const event = {
            id: item.id,
            rawId: item.rawId,
            source: item.source,
            title: item.title,
            detailStatus: item.detailStatus,
            finishedAt: now,
          };
          newlyFinished.push(event);
          this.recentFinished.unshift(event);
        }
      }
    }

    // Prune expired recentFinished entries
    this.recentFinished = this.recentFinished.filter(
      (e) => now - e.finishedAt <= this.recentTtlMs
    );

    this.prevById = currentById;
    this.initialized = true;

    const visibleItems = items.filter((i) => !this.dismissedIds.has(i.id));

    const running = visibleItems
      .filter((i) => i.status === 'running')
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    const waiting = visibleItems
      .filter((i) => i.status === 'waiting')
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    return {
      running,
      waiting,
      recentFinished: [...this.recentFinished],
      newlyFinished,
      updatedAt: now,
    };
  }
}

module.exports = { StateTracker };
