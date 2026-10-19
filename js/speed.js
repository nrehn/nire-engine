/* Speed sources: real GPS and a simulated demo drive. Both expose sample(dt) -> { v, a } in m/s and m/s². */

class GpsSpeed {
  constructor(onStatus) {
    this.onStatus = onStatus;
    this.watchId = null;
    this.fix = null;   // { v, t }
    this.last = null;  // previous position for fallback speed calc
    this.accel = 0;
    this.v = 0;        // smoothed output speed
  }

  start() {
    if (!('geolocation' in navigator)) {
      this.onStatus('GPS not available in this browser');
      return;
    }
    this.onStatus('Waiting for GPS…');
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => this.onPosition(pos),
      (err) => this.onStatus(err.code === err.PERMISSION_DENIED ? 'Location permission denied – use “Hold to rev” or Demo drive' : 'GPS signal lost'),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
    );
  }

  stop() {
    if (this.watchId !== null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
    this.fix = this.last = null;
    this.v = this.accel = 0;
  }

  onPosition(pos) {
    const t = pos.timestamp / 1000;
    const { latitude, longitude, speed, accuracy } = pos.coords;
    let v = speed;
    if (v == null || Number.isNaN(v)) {
      // Some browsers don't report speed: derive it from consecutive fixes
      v = this.last && t > this.last.t ? haversine(this.last.lat, this.last.lon, latitude, longitude) / (t - this.last.t) : 0;
    }
    if (this.fix && t > this.fix.t) {
      const raw = (v - this.fix.v) / (t - this.fix.t);
      this.accel += (clamp(raw, -9, 9) - this.accel) * 0.6;
    }
    this.fix = { v, t, at: performance.now() };
    this.last = { lat: latitude, lon: longitude, t };
    this.onStatus(`GPS ok · ±${Math.round(accuracy)} m`);
  }

  sample(dt) {
    let target = 0, a = 0;
    if (this.fix) {
      const age = (performance.now() - this.fix.at) / 1000;
      // GPS updates ~1 Hz; extrapolate briefly so revs move smoothly between fixes
      target = age < 3 ? Math.max(0, this.fix.v + this.accel * Math.min(age, 1.2)) : this.fix.v;
      a = age < 3 ? this.accel : 0;
    }
    this.v += (target - this.v) * Math.min(1, dt * 4);
    return { v: this.v, a };
  }
}

class DemoSpeed {
  constructor() {
    // [duration s, acceleration m/s², rev blip while stopped]
    this.script = [
      [3, 0], [0.5, 0, true], [1, 0], [0.6, 0, true], [1.5, 0],
      [7, 3.4], [5, 1.4], [6, 0], [5, -3.2], [3, 0],
      [6, 1.6], [8, 0.4], [4, -1.0], [6, 2.2], [5, 0], [9, -2.5], [3, 0],
    ];
    this.reset();
  }

  reset() { this.i = 0; this.t = 0; this.v = 0; }

  sample(dt) {
    const [dur, accel, blip] = this.script[this.i];
    let a = accel;
    this.v = clamp(this.v + a * dt, 0, 60);
    if (this.v === 0 && a < 0) a = 0;
    this.t += dt;
    if (this.t >= dur) { this.t = 0; this.i = (this.i + 1) % this.script.length; }
    return { v: this.v, a, gas: !!blip };
  }
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

window.GpsSpeed = GpsSpeed;
window.DemoSpeed = DemoSpeed;
