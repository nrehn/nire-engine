/* Canvas tachometer: 240° sweep, redline zone, shift lights. */
class Tach {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const r = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.size = Math.min(this.canvas.width, this.canvas.height);
  }

  draw(rpm, profile, on) {
    const c = this.ctx, s = this.size, cx = this.canvas.width / 2, cy = this.canvas.height / 2;
    const R = s * 0.46;
    const max = Math.ceil(profile.limiter / 1000) * 1000 + 1000;
    const start = Math.PI * (150 / 180), sweep = Math.PI * (240 / 180);
    const ang = (r) => start + sweep * Math.min(1, r / max);

    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    c.lineCap = 'round';

    // Track
    c.lineWidth = s * 0.035;
    c.strokeStyle = '#1d2128';
    c.beginPath(); c.arc(cx, cy, R, start, start + sweep); c.stroke();

    // Redline zone
    c.strokeStyle = '#5a1515';
    c.beginPath(); c.arc(cx, cy, R, ang(profile.redline), start + sweep); c.stroke();

    // Active arc
    if (rpm > 0) {
      const grad = c.createLinearGradient(cx - R, cy, cx + R, cy);
      grad.addColorStop(0, '#ff7a1a'); grad.addColorStop(0.7, '#ffb347'); grad.addColorStop(1, '#ff3b3b');
      c.strokeStyle = rpm >= profile.redline ? '#ff3b3b' : grad;
      c.beginPath(); c.arc(cx, cy, R, start, ang(rpm)); c.stroke();
    }

    // Ticks + labels (every 1000 rpm, minor every 500; thinned out for high-revving engines)
    const step = max > 12000 ? 2000 : 1000;
    c.fillStyle = '#9aa3ad';
    c.font = `600 ${Math.round(s * 0.042)}px system-ui, sans-serif`;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    for (let r = 0; r <= max; r += step / 2) {
      const a = ang(r), major = r % step === 0;
      const r1 = R - s * (major ? 0.07 : 0.045), r2 = R - s * 0.03;
      c.strokeStyle = r >= profile.redline ? '#ff3b3b' : major ? '#cfd5dc' : '#4a525c';
      c.lineWidth = s * (major ? 0.008 : 0.005);
      c.beginPath();
      c.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      c.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
      c.stroke();
      if (major) {
        const rl = R - s * 0.12;
        c.fillText(String(r / 1000), cx + Math.cos(a) * rl, cy + Math.sin(a) * rl);
      }
    }
    c.fillStyle = '#5b636d';
    c.font = `600 ${Math.round(s * 0.028)}px system-ui, sans-serif`;
    c.fillText('× 1000 rpm', cx, cy + R * 0.72);

    // Needle
    if (on) {
      const a = ang(rpm);
      c.strokeStyle = '#ffffff';
      c.lineWidth = s * 0.012;
      c.beginPath();
      c.moveTo(cx + Math.cos(a) * (R - s * 0.2), cy + Math.sin(a) * (R - s * 0.2));
      c.lineTo(cx + Math.cos(a) * (R + s * 0.01), cy + Math.sin(a) * (R + s * 0.01));
      c.stroke();
    }

    // Shift lights: 5 dots that fill from 75% of redline
    const lights = 5, from = profile.redline * 0.75;
    for (let i = 0; i < lights; i++) {
      const lit = on && rpm >= from + ((profile.redline - from) * i) / lights;
      const x = cx + (i - (lights - 1) / 2) * s * 0.055, y = cy - R * 0.62;
      c.fillStyle = lit ? (i < 2 ? '#3ddc84' : i < 4 ? '#ffb347' : '#ff3b3b') : '#20242b';
      if (lit && rpm >= profile.redline) c.fillStyle = '#ff3b3b';
      c.beginPath(); c.arc(x, y, s * 0.014, 0, Math.PI * 2); c.fill();
    }
  }
}
window.Tach = Tach;
