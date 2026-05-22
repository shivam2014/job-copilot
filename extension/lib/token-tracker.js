// Token Usage Tracker — records LLM token consumption per model

const TokenTracker = {
  STORAGE_KEY: 'token_history',

  async getHistory() {
    const result = await chrome.storage.local.get(this.STORAGE_KEY);
    return result[this.STORAGE_KEY] || [];
  },

  async record(model, usage) {
    if (!usage || !model) return;
    const entry = {
      model: model,
      promptTokens: usage.prompt_tokens || 0,
      completionTokens: usage.completion_tokens || 0,
      totalTokens: usage.total_tokens || 0,
      timestamp: Date.now(),
      date: new Date().toISOString().split('T')[0],
    };

    const history = await this.getHistory();
    history.push(entry);

    // Keep last 1000 entries
    if (history.length > 1000) {
      history.splice(0, history.length - 1000);
    }

    await chrome.storage.local.set({ [this.STORAGE_KEY]: history });
    return entry;
  },

  async getSummary() {
    const history = await this.getHistory();
    if (history.length === 0) return null;

    const total = history.reduce((s, e) => ({
      promptTokens: s.promptTokens + e.promptTokens,
      completionTokens: s.completionTokens + e.completionTokens,
      totalTokens: s.totalTokens + e.totalTokens,
      calls: s.calls + 1,
    }), { promptTokens: 0, completionTokens: 0, totalTokens: 0, calls: 0 });

    // Per-model breakdown
    const byModel = {};
    for (const entry of history) {
      if (!byModel[entry.model]) {
        byModel[entry.model] = { calls: 0, totalTokens: 0 };
      }
      byModel[entry.model].calls++;
      byModel[entry.model].totalTokens += entry.totalTokens;
    }

    // Last 7 days
    const weekAgo = Date.now() - 7 * 86400000;
    const lastWeek = history.filter(e => e.timestamp >= weekAgo);
    const weekTotal = lastWeek.reduce((s, e) => s + e.totalTokens, 0);

    return {
      total,
      byModel,
      weekTotal,
      lastEntry: history[history.length - 1],
    };
  },

  async reset() {
    await chrome.storage.local.remove(this.STORAGE_KEY);
  },

  // Format token count for display
  formatTokens(n) {
    if (!n) return '0';
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return n.toString();
  },
};
