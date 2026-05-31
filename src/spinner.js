/**
 * Simple terminal spinner
 * Shows ⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏ or |/-\ while waiting
 */

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const FALLBACK = ['|', '/', '-', '\\'];

export class Spinner {
  constructor(text = '') {
    this.text = text;
    this.frame = 0;
    this.interval = null;
    // Use braille if terminal supports unicode, otherwise ascii
    this.frames = process.platform === 'win32' ? FALLBACK : FRAMES;
    this.startTime = null;
  }

  start(text) {
    if (text) this.text = text;
    this.startTime = Date.now();
    this.frame = 0;
    this.interval = setInterval(() => {
      const f = this.frames[this.frame % this.frames.length];
      const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(0);
      process.stdout.write(`\r          ${f} ${this.text} (${elapsed}s)`);
      this.frame++;
    }, 100);
  }

  update(text) {
    this.text = text;
  }

  stop(finalText) {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    const elapsed = this.startTime ? ((Date.now() - this.startTime) / 1000).toFixed(1) : '0';
    if (finalText) {
      process.stdout.write(`\r          ✓ ${finalText} (${elapsed}s)\n`);
    } else {
      process.stdout.write('\r' + ' '.repeat(80) + '\r');
    }
  }

  fail(text) {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    process.stdout.write(`\r          ✗ ${text}\n`);
  }

  warn(text) {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    process.stdout.write(`\r          ⚠ ${text}\n`);
  }
}
