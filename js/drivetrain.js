/* Turns vehicle speed + acceleration into engine rpm, gear and load. */
const TIRE_CIRCUMFERENCE = 2.05; // metres
const STANDSTILL = 0.8;          // m/s, below this we are "stopped" (neutral)

class Drivetrain {
  constructor(profile) {
    this.p = profile;
    this.mode = 'comfort';
    this.gear = 0;
    this.rpm = profile.idle;
    this.load = 0;
    this.shiftTimer = 0;
    this.limiterPhase = 0;
  }

  rpmInGear(gear, v) {
    return (v / TIRE_CIRCUMFERENCE) * 60 * this.p.gears[gear - 1] * this.p.final;
  }

  /**
   * dt: seconds, v: speed m/s, a: acceleration m/s², gas: rev button held (only used when stopped)
   */
  update(dt, v, a, gas) {
    const p = this.p;
    let targetLoad;
    this.shiftTimer = Math.max(0, this.shiftTimer - dt);

    if (v < STANDSTILL) {
      this.gear = 0;
      if (gas) {
        this.rpm += p.redline * 1.4 * dt * (1 - (this.rpm / p.limiter) * 0.5);
        // Bounce off the limiter
        if (this.rpm >= p.limiter) this.rpm = p.limiter - p.redline * 0.05;
        targetLoad = 1;
      } else {
        this.rpm += (p.idle - this.rpm) * Math.min(1, dt * 2.2);
        targetLoad = 0.03;
      }
    } else {
      if (this.gear === 0) this.gear = 1;
      const sport = this.mode === 'sport';
      const throttle = clamp((a + 0.15) / (sport ? 2.5 : 3.2), 0, 1);
      const up = p.redline * (sport ? 0.62 + 0.3 * throttle : 0.38 + 0.37 * throttle);
      const down = p.redline * (sport ? 0.34 : 0.2) + p.idle * 0.3;
      const top = p.gears.length;

      if (this.shiftTimer === 0) {
        if (this.gear < top && this.rpmInGear(this.gear, v) > up) {
          this.gear++;
          this.shiftTimer = 0.35;
        } else if (this.gear > 1 && this.rpmInGear(this.gear, v) < down && this.rpmInGear(this.gear - 1, v) < up * 0.9) {
          this.gear--;
          this.shiftTimer = 0.35;
        }
      }

      let target = this.rpmInGear(this.gear, v);
      // Clutch slip pulling away in first gear
      if (this.gear === 1) target = Math.max(target, p.idle * 1.15 + throttle * p.redline * 0.18);
      target = clamp(target, p.idle, p.limiter);

      const follow = this.shiftTimer > 0 ? 9 : 6;
      this.rpm += (target - this.rpm) * Math.min(1, dt * follow);

      // Lifting off / braking = overrun, almost no load
      targetLoad = a < -0.3 ? 0 : throttle;
      if (this.shiftTimer > 0.15) targetLoad *= 0.2; // torque cut during the shift
    }

    this.load += (targetLoad - this.load) * Math.min(1, dt * 8);
    return { rpm: this.rpm, gear: this.gear, load: this.load };
  }
}

function clamp(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }

window.clamp = clamp;
window.Drivetrain = Drivetrain;
window.STANDSTILL = STANDSTILL;
