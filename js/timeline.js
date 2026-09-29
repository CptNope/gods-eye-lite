// Shared history timeline for time-aware weather imagery (radar, clouds, lightning).
// Live = follow the newest frame; otherwise an offset back in time in 10-minute steps.
const STEP_MIN = 10;
const SPAN_MIN = 180;

export class Timeline {
  constructor() {
    this.offset = 0; // minutes before now (0 = live)
    this.playing = false;
    this.subs = new Set();
    this.el = document.getElementById('timeline');
    this.slider = document.getElementById('tlSlider');
    this.label = document.getElementById('tlLabel');
    this.playBtn = document.getElementById('tlPlay');
    this.slider.min = -SPAN_MIN; this.slider.max = 0; this.slider.step = STEP_MIN; this.slider.value = 0;
    this.slider.addEventListener('input', () => { this.stop(); this.set(-Number(this.slider.value)); });
    this.playBtn.addEventListener('click', () => (this.playing ? this.stop() : this.play()));
    document.getElementById('tlLive').addEventListener('click', () => { this.stop(); this.set(0); });
    document.getElementById('tlBack').addEventListener('click', () => { this.stop(); this.set(Math.min(SPAN_MIN, this.offset + STEP_MIN)); });
    document.getElementById('tlFwd').addEventListener('click', () => { this.stop(); this.set(Math.max(0, this.offset - STEP_MIN)); });
    this.render();
  }

  // Time to request, rounded down to the step so tiles cache well. null = "latest".
  time() {
    if (this.offset === 0) return null;
    const t = Date.now() - this.offset * 60e3;
    return new Date(Math.floor(t / (STEP_MIN * 60e3)) * STEP_MIN * 60e3);
  }

  set(offset) {
    this.offset = offset;
    this.slider.value = -offset;
    this.render();
    for (const fn of this.subs) fn(this.time());
  }

  play() {
    this.playing = true;
    this.playBtn.textContent = '❚❚';
    if (this.offset === 0) this.set(SPAN_MIN);
    this.timer = setInterval(() => {
      if (this.offset <= 0) this.set(SPAN_MIN); // loop
      else this.set(this.offset - STEP_MIN);
    }, 1600);
  }

  stop() { this.playing = false; clearInterval(this.timer); this.playBtn.textContent = '▶'; }

  subscribe(fn) { this.subs.add(fn); this.updateVisibility(); return () => { this.subs.delete(fn); this.updateVisibility(); }; }

  updateVisibility() {
    this.el.hidden = this.subs.size === 0;
    document.body.classList.toggle('tl-on', this.subs.size > 0);
    if (this.subs.size === 0) { this.stop(); this.offset = 0; this.slider.value = 0; this.render(); }
  }

  render() {
    if (this.offset === 0) { this.label.textContent = 'LIVE'; this.label.className = 'live'; return; }
    const t = this.time();
    this.label.className = '';
    this.label.textContent = `−${this.offset} min · ${t.toISOString().slice(11, 16)}Z`;
  }
}
