/* App wiring: engine picker, start/stop, main loop, menu. */
(() => {
  const $ = (id) => document.getElementById(id);
  const store = {
    get: (k, d) => { try { return JSON.parse(localStorage.getItem('nire.' + k)) ?? d; } catch { return d; } },
    set: (k, v) => { try { localStorage.setItem('nire.' + k, JSON.stringify(v)); } catch { /* private mode */ } },
  };

  const sound = new EngineSound();
  const tach = new Tach($('tach'));
  const gps = new GpsSpeed((msg) => { $('gpsStatus').textContent = msg; setStatus(msg); });
  const demo = new DemoSpeed();

  let profile = ENGINES.find((e) => e.id === store.get('engine', 'v8')) || ENGINES[0];
  let mode = store.get('mode', 'comfort');
  let useDemo = false;
  let running = false;
  let drivetrain = null;
  let gasHeld = false;
  let wakeLock = null;
  let lastFrame = 0;
  let lastText = '';

  // ---------- Engine picker ----------
  const grid = $('engineGrid');
  ENGINES.forEach((e) => {
    const b = document.createElement('button');
    b.className = 'engine';
    b.setAttribute('role', 'radio');
    b.dataset.id = e.id;
    b.innerHTML = `<span class="name"></span><span class="spec"></span>`;
    b.querySelector('.name').textContent = e.name;
    b.querySelector('.spec').textContent = e.spec;
    b.addEventListener('click', () => selectEngine(e.id));
    grid.appendChild(b);
  });
  // Arrow-key navigation inside the radiogroup
  grid.addEventListener('keydown', (ev) => {
    const items = [...grid.children];
    const i = items.indexOf(document.activeElement);
    if (i < 0) return;
    const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[ev.key];
    if (!d) return;
    ev.preventDefault();
    const next = items[(i + d + items.length) % items.length];
    next.focus(); selectEngine(next.dataset.id);
  });

  function selectEngine(id) {
    profile = ENGINES.find((e) => e.id === id);
    store.set('engine', id);
    [...grid.children].forEach((b) => {
      const on = b.dataset.id === id;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    tach.draw(0, profile, false);
  }
  selectEngine(profile.id);

  // ---------- Start / stop ----------
  $('startBtn').addEventListener('click', async () => {
    try {
      await sound.unlock(); // inside the user gesture
    } catch (err) {
      setStatus(location.protocol === 'file:' ? 'Open via a web server (http/https), not as a file' : `Audio error: ${err.message}`);
      return;
    }
    if (useDemo || store.get('gpsExplained', false) || !('geolocation' in navigator)) {
      ignite(!useDemo);
    } else {
      $('gpsDialog').showModal();
    }
  });
  $('gpsContinue').addEventListener('click', () => { store.set('gpsExplained', true); $('gpsDialog').close(); ignite(true); });
  $('gpsSkip').addEventListener('click', () => { $('gpsDialog').close(); ignite(false); });
  $('stopBtn').addEventListener('click', shutdown);

  function ignite(withGps) {
    drivetrain = new Drivetrain(profile);
    drivetrain.mode = mode;
    drivetrain.rpm = profile.idle * 1.8; // start-up flare
    sound.start(profile);
    if (withGps) gps.start();
    else setStatus(useDemo ? 'Demo drive' : 'No GPS – use “Hold to rev”');
    demo.reset();
    running = true;
    document.body.classList.replace('is-off', 'is-on');
    $('dock').hidden = false;
    requestWakeLock();
    lastFrame = performance.now();
    requestAnimationFrame(loop);
  }

  function shutdown() {
    running = false;
    sound.stop();
    gps.stop();
    releaseGas();
    document.body.classList.replace('is-on', 'is-off');
    $('dock').hidden = true;
    $('gasBtn').hidden = true;
    document.documentElement.style.setProperty('--rev', 0);
    $('speedOut').textContent = '0';
    $('gearOut').textContent = 'N';
    $('rpmOut').textContent = '0';
    setStatus('');
    tach.draw(0, profile, false);
    wakeLock?.release().catch(() => {});
    wakeLock = null;
    $('startBtn').focus();
  }

  // ---------- Main loop ----------
  function loop(now) {
    if (!running) return;
    const dt = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;

    const s = useDemo ? demo.sample(dt) : gps.sample(dt);
    const gas = gasHeld || !!s.gas;
    const { rpm, gear, load } = drivetrain.update(dt, s.v, s.a, gas);
    sound.update(rpm, load);
    tach.draw(rpm, profile, true);

    const stopped = s.v < STANDSTILL;
    $('gasBtn').hidden = !stopped || useDemo;
    if (!stopped && gasHeld) releaseGas();

    // Only touch the DOM when the text actually changes
    const text = `${Math.round(s.v * 3.6)}|${gear === 0 ? 'N' : gear}|${Math.round(rpm / 50) * 50}`;
    if (text !== lastText) {
      const [kmh, g, r] = text.split('|');
      $('speedOut').textContent = kmh;
      $('gearOut').textContent = g;
      $('rpmOut').textContent = r;
      lastText = text;
    }
    document.documentElement.style.setProperty('--rev', Math.min(1, rpm / profile.redline).toFixed(3));
    requestAnimationFrame(loop);
  }

  // ---------- Hold to rev ----------
  const gasBtn = $('gasBtn');
  const holdGas = (ev) => { ev.preventDefault(); gasHeld = true; gasBtn.classList.add('held'); };
  function releaseGas() { gasHeld = false; gasBtn.classList.remove('held'); }
  gasBtn.addEventListener('pointerdown', (ev) => { gasBtn.setPointerCapture(ev.pointerId); holdGas(ev); });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((t) => gasBtn.addEventListener(t, releaseGas));
  gasBtn.addEventListener('contextmenu', (ev) => ev.preventDefault());
  // Keyboard: hold Space / Enter
  gasBtn.addEventListener('keydown', (ev) => { if ((ev.key === ' ' || ev.key === 'Enter') && !ev.repeat) holdGas(ev); });
  gasBtn.addEventListener('keyup', (ev) => { if (ev.key === ' ' || ev.key === 'Enter') releaseGas(); });

  // ---------- Menu ----------
  $('menuBtn').addEventListener('click', () => $('menuDialog').showModal());
  document.querySelectorAll('input[name="mode"]').forEach((r) => {
    r.checked = r.value === mode;
    r.addEventListener('change', () => {
      mode = r.value;
      store.set('mode', mode);
      if (drivetrain) drivetrain.mode = mode;
    });
  });
  $('demoToggle').addEventListener('change', (ev) => {
    useDemo = ev.target.checked;
    if (running) { shutdown(); } // restart with the new speed source
  });
  const vol = $('volume');
  vol.value = store.get('volume', 0.8);
  sound.setVolume(Number(vol.value));
  vol.addEventListener('input', () => { sound.setVolume(Number(vol.value)); store.set('volume', Number(vol.value)); });
  $('beepBtn').addEventListener('click', async () => {
    try { await sound.unlock(); sound.beep(); } catch (err) { $('gpsStatus').textContent = `Audio error: ${err.message}`; }
  });

  // ---------- Helpers ----------
  function setStatus(msg) { $('statusOut').textContent = msg; }

  async function requestWakeLock() {
    try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* not supported / denied */ }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && running) requestWakeLock();
  });
})();
