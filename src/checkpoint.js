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
   * Get completed chunk indices for a specific pass
   */
  getCompletedChunks(passNum) {
    if (!this.data?.passes?.[passNum]) return [];
    return this.data.passes[passNum].completedChunks || [];
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
   * Save merged/synthesized data
   */
  async saveMerged(key, data) {
    if (!this.data) this.data = { passes: {}, merged: {} };
    if (!this.data.merged) this.data.merged = {};
    this.data.merged[key] = data;
    await this.save(this.data);
  }
}
