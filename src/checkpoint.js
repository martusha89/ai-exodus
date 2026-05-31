/**
 * Checkpoint system — saves progress after each chunk/pass
 * Resumes from where it left off if the process crashes
 */

import { readFile, writeFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const CHECKPOINT_FILE = '.exodus-checkpoint.json';

export class Checkpoint {
  constructor(outputDir) {
    this.path = join(outputDir, CHECKPOINT_FILE);
    this.data = null;
  }

  /**
   * Load existing checkpoint, returns null if none exists
   */
  async load() {
    if (!existsSync(this.path)) return null;
    try {
      const raw = await readFile(this.path, 'utf-8');
      this.data = JSON.parse(raw);
      return this.data;
    } catch {
      return null;
    }
  }

  /**
   * Save current state
   */
  async save(state) {
    this.data = { ...state, savedAt: new Date().toISOString() };
    await writeFile(this.path, JSON.stringify(this.data, null, 2), 'utf-8');
  }

  /**
   * Remove checkpoint file (migration complete)
   */
  async clear() {
    if (existsSync(this.path)) {
      await unlink(this.path);
    }
  }

  /**
   * Get completed chunk indices for a specific pass.
   * Includes both successfully-processed and deliberately-skipped chunks —
   * resume should not retry either.
   */
  getCompletedChunks(passNum) {
    if (!this.data?.passes?.[passNum]) return [];
    const done = this.data.passes[passNum].completedChunks || [];
    const skipped = (this.data.passes[passNum].skippedChunks || []).map(s => s.index);
    return [...new Set([...done, ...skipped])];
  }

  /**
   * Get skipped-chunk records for a pass: [{ index, reason, message }]
   */
  getSkippedChunks(passNum) {
    if (!this.data?.passes?.[passNum]) return [];
    return this.data.passes[passNum].skippedChunks || [];
  }

  /**
   * Clear all skipped-chunk records — used when user wants to retry them
   * (e.g. after enabling 1M context at claude.ai/settings/usage).
   * Also un-marks the pass as complete if it was completed via skips.
   * Optionally restrict to specific reasons; omit to clear all.
   */
  async clearSkippedChunks(reasons = null) {
    if (!this.data?.passes) return 0;
    let cleared = 0;
    for (const pass of Object.values(this.data.passes)) {
      if (!pass.skippedChunks) continue;
      const before = pass.skippedChunks.length;
      pass.skippedChunks = reasons
        ? pass.skippedChunks.filter(s => !reasons.includes(s.reason))
        : [];
      cleared += before - pass.skippedChunks.length;
      // If pass was complete only because of skips, un-mark it
      if (pass.complete && cleared > 0) {
        const doneCount = pass.completedChunks?.length || 0;
        const skipCount = pass.skippedChunks.length;
        // We don't know totalChunks here, but if there are now-cleared skips,
        // the pass must be re-evaluated against current chunks.
        pass.complete = false;
      }
    }
    if (cleared > 0) await this.save(this.data);
    return cleared;
  }

  /**
   * Get the results array for a specific pass
   */
  getPassResults(passNum) {
    if (!this.data?.passes?.[passNum]) return null;
    return this.data.passes[passNum].results || null;
  }

  /**
   * Check if a pass is fully complete
   */
  isPassComplete(passNum) {
    return this.data?.passes?.[passNum]?.complete === true;
  }

  /**
   * Get merged/synthesized data for a pass
   */
  getMergedData(key) {
    return this.data?.merged?.[key] || null;
  }

  /**
   * Save chunk result for a pass
   */
  async saveChunkResult(passNum, chunkIndex, result, totalChunks) {
    if (!this.data) this.data = { passes: {}, merged: {} };
    if (!this.data.passes) this.data.passes = {};
    if (!this.data.passes[passNum]) {
      this.data.passes[passNum] = { completedChunks: [], results: [], complete: false };
    }

    const pass = this.data.passes[passNum];
    pass.completedChunks.push(chunkIndex);
    pass.results[chunkIndex] = result;

    if (pass.completedChunks.length >= totalChunks) {
      pass.complete = true;
    }

    await this.save(this.data);
  }

  /**
   * Record a chunk skip — non-retryable error, move on.
   * Counts toward pass completion so resume doesn't retry it.
   */
  async saveChunkSkipped(passNum, chunkIndex, reason, message, totalChunks) {
    if (!this.data) this.data = { passes: {}, merged: {} };
    if (!this.data.passes) this.data.passes = {};
    if (!this.data.passes[passNum]) {
      this.data.passes[passNum] = { completedChunks: [], results: [], skippedChunks: [], complete: false };
    }

    const pass = this.data.passes[passNum];
    if (!pass.skippedChunks) pass.skippedChunks = [];
    pass.skippedChunks.push({ index: chunkIndex, reason, message: (message || '').slice(0, 500) });

    const done = (pass.completedChunks?.length || 0) + pass.skippedChunks.length;
    if (done >= totalChunks) {
      pass.complete = true;
    }

    await this.save(this.data);
  }

  /**
   * Save merged/synthesized data
   */
  async saveMerged(key, data) {
    if (!this.data) this.data = { passes: {}, merged: {} };
    if (!this.data.merged) this.data.merged = {};
    this.data.merged[key] = data;
    await this.save(this.data);
  }
}
