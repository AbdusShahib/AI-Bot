const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// Bump this string every time you redeploy. /state and the startup log both
// print it, so you can always confirm what's actually live on Render instead
// of guessing.
const BUILD_VERSION = "armbot-server-2026-09-11-panel-e";

// JSON body parsing — used by /update-command and any other JSON routes.
// NOTE: this does NOT parse the /upload route, because the ESP32 posts
// Content-Type: image/jpeg, which express.json() silently ignores
// (req.body ends up undefined, and latestFrame was never actually set).
app.use(express.json({ limit: '10mb' }));

// Static assets (the arm diagram image for /panel). Put your arm image at
// <project root>/public/robot-arm.png — it'll be served at /public/robot-arm.png.
app.use('/public', express.static(path.join(__dirname, 'public')));

// Raw binary parser used ONLY on the JPEG upload endpoint.
const rawImageParser = express.raw({ type: 'image/jpeg', limit: '10mb' });

// Global Bot State containing all servos, motors, toggles, and sequence commands
let botState = {
    pan: 90,
    tilt: 90,
    action: "stop",
    flash: false,
    laser: false,
    speed: 90,
    neck: 90,
    shoulder: 90,
    elbow: 90,
    wrist: 90,
    rotation: 90,
    grip: 90,
    command: "idle"
};

let latestFrame = null;
let objectHeight = 0.0;

// 0. Health check / landing route — avoids a bare "Cannot GET /" and gives
// a quick way to confirm the service is up and which build is running.
app.get('/', (req, res) => {
    res.json({ status: "AI Armbot server running", build: BUILD_VERSION });
});

// 1. ESP32 Upload Endpoint (Receives JPEG frame + height, returns botState JSON)
app.post('/upload', rawImageParser, (req, res) => {
    if (Buffer.isBuffer(req.body) && req.body.length > 0) {
        latestFrame = req.body;
    }
    if (req.headers['x-object-height']) {
        objectHeight = parseFloat(req.headers['x-object-height']);
    }
    res.json(botState);
});

// 1b. Live state inspector — GET only. This reports current botState; it is
// NOT where the control panel sends updates (that's /update-command below).
// The panel polls this after every send just to confirm the server actually
// received it.
app.get('/state', (req, res) => {
    res.json({ ...botState, _serverBuild: BUILD_VERSION });
});

// 2. Image Stream Endpoint for WebViewer Background
app.get('/image', (req, res) => {
    if (!latestFrame) return res.status(404).send('No frame available');
    res.writeHead(200, {
        'Content-Type': 'image/jpeg',
        'Content-Length': latestFrame.length
    });
    res.end(latestFrame);
});

// 2b. Full-bleed auto-refreshing video page — used by Screen1's WebViewer2
// as a plain background feed (no controls, just the picture).
app.get('/stream', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
            <style>
                * { box-sizing: border-box; }
                body, html {
                    margin: 0; padding: 0; width: 100vw; height: 100vh;
                    background: #000; overflow: hidden;
                }
                #video-area {
                    width: 100%; height: 100%;
                    display: flex; justify-content: center; align-items: center;
                }
                img {
                    width: 100%; height: 100%; object-fit: cover;
                    transform: rotate(180deg); display: none;
                }
                #errorBox {
                    color: #ff4444; border: 2px solid #ff4444; padding: 20px;
                    border-radius: 8px; background: rgba(0,0,0,0.85); text-align: center;
                    font-family: sans-serif;
                }
            </style>
        </head>
        <body>
            <div id="video-area">
                <div id="errorBox">Connecting to Armbot...</div>
                <img id="feed" alt="Live Stream" />
            </div>
            <script>
                const img = document.getElementById('feed');
                const errBox = document.getElementById('errorBox');
                setInterval(() => {
                    const tempImg = new Image();
                    tempImg.onload = () => { img.src = tempImg.src; img.style.display = 'block'; errBox.style.display = 'none'; };
                    tempImg.onerror = () => { img.style.display = 'none'; errBox.style.display = 'block'; errBox.innerHTML = "<b>Connection Lost</b>"; };
                    tempImg.src = '/image?' + new Date().getTime();
                }, 200);
            </script>
        </body>
        </html>
    `);
});

// 3. Command Update Endpoint (Receives JSON payloads from App Inventor or HTML UI)
app.post('/update-command', (req, res) => {
    // Toggles
    if (req.body.flash === "toggle") botState.flash = !botState.flash;
    if (req.body.laser === "toggle") botState.laser = !botState.laser;
    if (typeof req.body.flash === "boolean") botState.flash = req.body.flash;
    if (typeof req.body.laser === "boolean") botState.laser = req.body.laser;

    // Direct Arm Sliders & Joysticks
    if (req.body.pan !== undefined) botState.pan = req.body.pan;
    if (req.body.tilt !== undefined) botState.tilt = req.body.tilt;
    if (req.body.speed !== undefined) botState.speed = req.body.speed;
    if (req.body.neck !== undefined) botState.neck = req.body.neck;
    if (req.body.shoulder !== undefined) botState.shoulder = req.body.shoulder;
    if (req.body.elbow !== undefined) botState.elbow = req.body.elbow;
    if (req.body.wrist !== undefined) botState.wrist = req.body.wrist;
    if (req.body.rotation !== undefined) botState.rotation = req.body.rotation;
    if (req.body.grip !== undefined) botState.grip = req.body.grip;

    // Drive Motors & Sequence Commands (save, run, pause, reset)
    if (req.body.action !== undefined) botState.action = req.body.action;
    if (req.body.command !== undefined) botState.command = req.body.command;

    res.json({ status: "success", state: botState });
});

// 4. Control Panel — a compact horizontal drive bar (Forward/Left/Right/
// Reverse, press-and-hold) above a card of joint sliders, with Neck/Speed
// broken out into their own footer box below. Colors/buttons follow the
// same dark theme as the rest of this app.
//
// NOTE ON DRIVE BAR / L298N: the buttons send distinct "forward"/"left"/
// "right"/"reverse" actions, but as of this build the ESP32 only has a
// single motor channel wired (MOTOR_FWD_PIN/MOTOR_REV_PIN) — there is no
// second channel for genuine differential steering yet, so Left/Right
// currently behave like Forward/Reverse on the hardware. Wiring real
// left/right turning needs a second motor channel; see chat for the
// suggested approach (moving both channels onto the ATmega8A slave, which
// has 5 free GPIO — A0-A3 + D11 — versus only 1-2 marginal free pins left
// on the ESP32 itself).
//
// NOTE ON FIELD MAPPING: the row labeled "Grip" below is bound to the real
// `tilt` field, not a separate gripper — there is no gripper servo wired up
// yet, and this was already confirmed to be tilt earlier. There is no Pan
// row here; pan stays controllable only from the /controller joystick.
app.get('/panel', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
            <style>
                * { box-sizing: border-box; }
                body, html {
                    margin: 0; padding: 0; width: 100vw; min-height: 100vh;
                    background: #131314; color: #e3e3e3; font-family: sans-serif;
                }
                .page { max-width: 820px; margin: 0 auto; padding: 18px 16px 30px; }
                h3 { margin: 0 0 4px 0; font-size: 15px; color: #fff; }
                .note {
                    font-size: 11px; color: #777; margin: 0 0 16px 0; font-style: italic;
                }

                .drive-bar {
                    background: #1e1f20; border: 1px solid #333; border-radius: 10px;
                    padding: 12px; display: flex; gap: 8px;
                }
                .drive-btn {
                    flex: 1; padding: 14px 6px; border: 1px solid #333; border-radius: 8px;
                    background: #131314; color: #8ab4f8; font-weight: bold; font-size: 13px;
                    display: flex; flex-direction: column; align-items: center; gap: 2px;
                    cursor: pointer; user-select: none; touch-action: none;
                }
                .drive-btn .arrow { font-size: 18px; line-height: 1; }
                .drive-btn:active, .drive-btn.pressed {
                    background: #0b57d0; color: #fff; border-color: #0b57d0;
                }

                .joint-card {
                    margin-top: 14px; background: #1e1f20; border: 1px solid #333; border-radius: 10px;
                    padding: 16px;
                }
                .joint-rows { display: flex; flex-direction: column; gap: 16px; }
                .joint-row { display: flex; flex-direction: column; gap: 5px; }
                .joint-label {
                    font-size: 12px; font-weight: bold; text-transform: uppercase; color: #8ab4f8;
                    display: flex; align-items: center; gap: 6px;
                }
                .joint-label .connector { width: 16px; height: 2px; background: #8ab4f8; display: inline-block; flex-shrink: 0; }
                .joint-label .sub { font-size: 10px; color: #666; text-transform: none; font-weight: normal; }
                .slider-row { display: flex; align-items: center; gap: 10px; }
                .slider-row span.value { width: 32px; text-align: right; font-family: monospace; font-size: 13px; flex-shrink: 0; }

                .footer-box {
                    margin-top: 14px; background: #1e1f20; border: 1px solid #333; border-radius: 10px;
                    padding: 16px; display: flex; flex-direction: column; gap: 16px;
                }

                input[type=range].dual {
                    -webkit-appearance: none; appearance: none; width: 100%; height: 6px;
                    border-radius: 3px; background: #2a2b2e; outline: none; cursor: pointer;
                }
                input[type=range].dual::-webkit-slider-thumb {
                    -webkit-appearance: none; width: 16px; height: 16px; border-radius: 50%;
                    background: #8ab4f8; border: 2px solid #131314; cursor: pointer;
                    box-shadow: 0 0 0 1px #8ab4f8;
                }
                input[type=range].dual::-moz-range-thumb {
                    width: 16px; height: 16px; border-radius: 50%;
                    background: #8ab4f8; border: 2px solid #131314; cursor: pointer;
                    box-shadow: 0 0 0 1px #8ab4f8;
                }

                .control-bar {
                    margin-top: 18px; background: #1e1f20; border: 1px solid #333; border-radius: 10px;
                    padding: 16px; display: flex; flex-direction: column; gap: 10px;
                }
                .btn-row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
                button {
                    padding: 10px; border: none; border-radius: 6px; font-weight: bold; cursor: pointer;
                }
                button:disabled { opacity: 0.5; cursor: not-allowed; }
                .btn-primary { background: #0b57d0; color: white; }
                .btn-save { background: #1a7a3c; color: white; }
                .btn-run { background: #8a5a00; color: white; }
                .btn-danger { background: #8c1d18; color: white; }
                #step-counter {
                    font-size: 12px; color: #8ab4f8; text-align: center;
                    background: #131314; border-radius: 6px; padding: 6px;
                }
                #status-line { font-size: 11px; color: #888; text-align: center; min-height: 14px; }
                .delay-row { display: flex; align-items: center; gap: 8px; font-size: 12px; }
                .delay-row input[type=number] {
                    width: 70px; background: #131314; color: #e3e3e3; border: 1px solid #333;
                    border-radius: 4px; padding: 4px;
                }
            </style>
        </head>
        <body>
            <div class="page">
                <h3>Armbot Control Panel</h3>
                <p class="note">"Grip" below drives the tilt joint — no dedicated gripper servo is wired up yet. Pan isn't on this page; use /controller for that. Left/Right send distinct commands but the L298N is currently only wired for straight forward/reverse — see note below the panel.</p>

                <div class="drive-bar">
                    <div class="drive-btn" data-action="forward"><span class="arrow">&#8593;</span>FWD</div>
                    <div class="drive-btn" data-action="left"><span class="arrow">&#8592;</span>LEFT</div>
                    <div class="drive-btn" data-action="right"><span class="arrow">&#8594;</span>RIGHT</div>
                    <div class="drive-btn" data-action="reverse"><span class="arrow">&#8595;</span>REV</div>
                </div>

                <div class="joint-card">
                    <div class="joint-rows">
                        <div class="joint-row">
                            <div class="joint-label"><span class="connector"></span>Grip<span class="sub">(tilt)</span></div>
                            <div class="slider-row"><input type="range" class="dual" id="tilt" min="0" max="180" value="90"><span class="value" id="val-tilt">90</span></div>
                        </div>
                        <div class="joint-row">
                            <div class="joint-label"><span class="connector"></span>Rotation</div>
                            <div class="slider-row"><input type="range" class="dual" id="rotation" min="0" max="180" value="90"><span class="value" id="val-rotation">90</span></div>
                        </div>
                        <div class="joint-row">
                            <div class="joint-label"><span class="connector"></span>Wrist</div>
                            <div class="slider-row"><input type="range" class="dual" id="wrist" min="0" max="180" value="90"><span class="value" id="val-wrist">90</span></div>
                        </div>
                        <div class="joint-row">
                            <div class="joint-label"><span class="connector"></span>Elbow</div>
                            <div class="slider-row"><input type="range" class="dual" id="elbow" min="0" max="180" value="90"><span class="value" id="val-elbow">90</span></div>
                        </div>
                        <div class="joint-row">
                            <div class="joint-label"><span class="connector"></span>Shoulder</div>
                            <div class="slider-row"><input type="range" class="dual" id="shoulder" min="0" max="180" value="90"><span class="value" id="val-shoulder">90</span></div>
                        </div>
                    </div>
                </div>

                <div class="footer-box">
                    <div class="joint-row">
                        <div class="joint-label"><span class="connector"></span>Neck</div>
                        <div class="slider-row"><input type="range" class="dual" id="neck" min="0" max="180" value="90"><span class="value" id="val-neck">90</span></div>
                    </div>
                    <div class="joint-row">
                        <div class="joint-label"><span class="connector"></span>Speed</div>
                        <div class="slider-row"><input type="range" class="dual" id="speed" min="0" max="180" value="90"><span class="value" id="val-speed">90</span></div>
                    </div>
                </div>

                <div class="control-bar">
                    <button class="btn-danger" onclick="resetDefaults()">RESET</button>

                    <div id="step-counter">Steps saved: <span id="step-count">0</span></div>

                    <div class="btn-row">
                        <button class="btn-save" onclick="saveStep()">SAVE STEP</button>
                        <button class="btn-danger" onclick="clearSteps()">CLEAR STEPS</button>
                    </div>

                    <div class="delay-row">
                        <label for="step-delay">Step delay (ms)</label>
                        <input type="number" id="step-delay" min="200" step="100" value="1000">
                    </div>

                    <button class="btn-run" id="run-btn" onclick="runSequence()">RUN SEQUENCE</button>

                    <div id="status-line"></div>
                </div>
            </div>

            <script>
                // Fields on this page — deliberately no "pan" (see note above).
                // The id "tilt" is used for the row labeled "Grip".
                const keys = ['tilt', 'rotation', 'wrist', 'elbow', 'shoulder', 'neck', 'speed'];
                const statusLine = document.getElementById('status-line');
                const runBtn = document.getElementById('run-btn');

                let steps = [];

                // Drive bar — press and hold to move, release/leave to stop.
                // Sends only {action: "..."} , nothing else, to keep the
                // payload minimal. Left/Right currently produce the same
                // hardware result as Forward/Reverse until the motor driver
                // gets a second channel (see server-side note near this route).
                document.querySelectorAll('.drive-btn').forEach(btn => {
                    const action = btn.dataset.action;
                    const start = (e) => {
                        e.preventDefault();
                        btn.classList.add('pressed');
                        sendPayload({ action })
                            .catch(err => setStatus('Drive error: ' + err.message));
                    };
                    const stop = () => {
                        if (!btn.classList.contains('pressed')) return;
                        btn.classList.remove('pressed');
                        sendPayload({ action: 'stop' })
                            .catch(err => setStatus('Drive error: ' + err.message));
                    };
                    btn.addEventListener('pointerdown', start);
                    btn.addEventListener('pointerup', stop);
                    btn.addEventListener('pointerleave', stop);
                    btn.addEventListener('pointercancel', stop);
                });

                function updateFill(slider) {
                    const min = +slider.min, max = +slider.max, val = +slider.value;
                    const pct = ((val - min) / (max - min)) * 100;
                    slider.style.background =
                        'linear-gradient(to right, #8ab4f8 0%, #8ab4f8 ' + pct + '%, #2a2b2e ' + pct + '%, #2a2b2e 100%)';
                }

                keys.forEach(k => {
                    const slider = document.getElementById(k);
                    const span = document.getElementById('val-' + k);
                    updateFill(slider);

                    // Live label + fill while dragging — no network traffic here.
                    slider.addEventListener('input', () => {
                        span.innerText = slider.value;
                        updateFill(slider);
                    });

                    // Only send to the robot once the slider is RELEASED.
                    // 'change' fires on mouseup/touchend/keyup-commit, not on
                    // every intermediate drag position — and only that one
                    // field is sent, keeping the payload minimal.
                    slider.addEventListener('change', () => {
                        const value = parseInt(slider.value, 10);
                        sendPayload({ [k]: value })
                            .then(state => setStatus(k + ' -> ' + value + ' (build ' + state._serverBuild + ')'))
                            .catch(err => setStatus('Error sending ' + k + ': ' + err.message));
                    });
                });

                function currentPayload() {
                    const payload = {};
                    keys.forEach(k => { payload[k] = parseInt(document.getElementById(k).value, 10); });
                    return payload;
                }

                function setStatus(msg) { statusLine.innerText = msg; }

                async function sendPayload(payload) {
                    await fetch('/update-command', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                    const stateRes = await fetch('/state');
                    return await stateRes.json();
                }

                function updateStepCount() {
                    document.getElementById('step-count').innerText = steps.length;
                }

                function saveStep() {
                    steps.push(currentPayload());
                    updateStepCount();
                    setStatus('Step ' + steps.length + ' saved');
                }

                function clearSteps() {
                    steps = [];
                    updateStepCount();
                    setStatus('Sequence cleared');
                }

                function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

                async function runSequence() {
                    if (steps.length === 0) { setStatus('No steps saved yet'); return; }
                    const delayMs = Math.max(200, parseInt(document.getElementById('step-delay').value, 10) || 1000);
                    runBtn.disabled = true;
                    try {
                        for (let i = 0; i < steps.length; i++) {
                            setStatus('Running step ' + (i + 1) + ' / ' + steps.length);
                            await sendPayload(steps[i]);
                            await sleep(delayMs);
                        }
                        setStatus('Sequence complete (' + steps.length + ' steps)');
                    } catch (err) {
                        setStatus('Error running sequence: ' + err.message);
                    } finally {
                        runBtn.disabled = false;
                    }
                }

                function resetDefaults() {
                    keys.forEach(k => {
                        const slider = document.getElementById(k);
                        slider.value = 90;
                        document.getElementById('val-' + k).innerText = '90';
                        updateFill(slider);
                    });
                    sendPayload({ ...currentPayload(), action: 'stop' })
                        .then(() => setStatus('Reset to defaults'))
                        .catch(err => setStatus('Error resetting: ' + err.message));
                }
            </script>
        </body>
        </html>
    `);
});

// 5. Full-Screen Landscape PUBG-Style HTML Controller Interface — the
// overlay joystick. Separate link/WebViewer from the slider panel at
// /panel above. Left stick drives pan/tilt live, right stick drives the
// motors (forward/reverse/stop).
app.get('/controller', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
            <style>
                * { box-sizing: border-box; }
                body, html {
                    margin: 0; padding: 0; width: 100vw; height: 100vh;
                    background: #000; color: white; font-family: sans-serif;
                    overflow: hidden; touch-action: none; position: relative;
                }
                #video-area {
                    position: absolute; top: 0; left: 0;
                    width: 100%; height: 100%; z-index: 1;
                    display: flex; justify-content: center; align-items: center;
                }
                img { 
                    width: 100%; height: 100%; object-fit: cover; 
                    transform: rotate(180deg); display: none; 
                }
                #errorBox { 
                    color: #ff4444; border: 2px solid #ff4444; padding: 20px; 
                    border-radius: 8px; background: rgba(0,0,0,0.85); text-align: center;
                }
                .joystick-container {
                    position: absolute; bottom: 25px;
                    width: 140px; height: 140px; border-radius: 50%;
                    background: rgba(42, 42, 44, 0.3); 
                    border: 3px solid rgba(255, 255, 255, 0.3);
                    z-index: 10; display: flex; justify-content: center; align-items: center;
                    transition: opacity 0.2s ease, background 0.2s ease;
                }
                #joy-left { left: 40px; }
                #joy-right { right: 40px; }
                .stick {
                    width: 60px; height: 60px; border-radius: 50%;
                    background: rgba(138, 180, 248, 0.4);
                    border: 2px solid rgba(255, 255, 255, 0.6);
                    position: absolute; pointer-events: none;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.5);
                }
                .joystick-container.active {
                    background: rgba(42, 42, 44, 0.75);
                    border-color: rgba(255, 255, 255, 0.9);
                }
                .joystick-container.active .stick {
                    background: rgba(138, 180, 248, 0.85);
                }
                .hud-label {
                    position: absolute; top: 15px; left: 20px; z-index: 10;
                    font-size: 12px; font-weight: bold; letter-spacing: 1px;
                    color: rgba(255,255,255,0.5); background: rgba(0,0,0,0.4);
                    padding: 5px 10px; border-radius: 4px; pointer-events: none;
                }
            </style>
        </head>
        <body>
            <div class="hud-label">AI ARMBOT HUD</div>
            <div id="video-area">
                <div id="errorBox">Connecting to Armbot...</div>
                <img id="feed" alt="Live Stream" />
            </div>
            <div id="joy-left" class="joystick-container"><div id="stick-left" class="stick"></div></div>
            <div id="joy-right" class="joystick-container"><div id="stick-right" class="stick"></div></div>
            <script>
                const img = document.getElementById('feed');
                const errBox = document.getElementById('errorBox');
                setInterval(() => {
                    const tempImg = new Image();
                    tempImg.onload = () => { img.src = tempImg.src; img.style.display = 'block'; errBox.style.display = 'none'; };
                    tempImg.onerror = () => { img.style.display = 'none'; errBox.style.display = 'block'; errBox.innerHTML = "<b>Connection Lost</b>"; };
                    tempImg.src = '/image?' + new Date().getTime();
                }, 200);

                let botState = { pan: 90, tilt: 90, action: "stop" };
                let lastSent = 0;
                function sendCommand() {
                    if (Date.now() - lastSent < 100) return;
                    lastSent = Date.now();
                    fetch('/update-command', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(botState)
                    }).catch(err => console.error("Update failed:", err));
                }

                class OverlayJoystick {
                    constructor(baseId, stickId, isServo) {
                        this.base = document.getElementById(baseId);
                        this.stick = document.getElementById(stickId);
                        this.isServo = isServo;
                        this.maxRadius = 55; 
                        this.active = false;
                        this.centerX = 0; this.centerY = 0;

                        const start = (e) => { this.active = true; this.base.classList.add('active'); this.updateCenter(); this.move(e); };
                        const end = () => { this.active = false; this.base.classList.remove('active'); this.reset(); };
                        const move = (e) => { if (this.active) this.move(e); };

                        this.base.addEventListener('mousedown', start);
                        this.base.addEventListener('touchstart', start, {passive: false});
                        window.addEventListener('mouseup', end);
                        window.addEventListener('touchend', end);
                        window.addEventListener('mousemove', move);
                        window.addEventListener('touchmove', move, {passive: false});
                    }
                    updateCenter() {
                        const rect = this.base.getBoundingClientRect();
                        this.centerX = rect.left + (rect.width / 2);
                        this.centerY = rect.top + (rect.height / 2);
                    }
                    move(e) {
                        if (e.preventDefault) e.preventDefault();
                        let clientX = e.touches ? e.touches[0].clientX : e.clientX;
                        let clientY = e.touches ? e.touches[0].clientY : e.clientY;
                        let dx = clientX - this.centerX;
                        let dy = clientY - this.centerY;
                        let distance = Math.sqrt(dx*dx + dy*dy);
                        if (distance > this.maxRadius) {
                            dx = (dx / distance) * this.maxRadius;
                            dy = (dy / distance) * this.maxRadius;
                        }
                        this.stick.style.transform = \`translate(\${dx}px, \${dy}px)\`;
                        this.processData(dx, dy);
                    }
                    reset() {
                        this.stick.style.transform = \`translate(0px, 0px)\`;
                        if (!this.isServo) { botState.action = "stop"; sendCommand(); }
                    }
                    processData(dx, dy) {
                        let nx = dx / this.maxRadius; 
                        let ny = dy / this.maxRadius;
                        if (this.isServo) {
                            botState.pan = Math.round(90 + (nx * 90));
                            botState.tilt = Math.round(90 + (ny * -90));
                        } else {
                            if (ny < -0.35) botState.action = "forward";
                            else if (ny > 0.35) botState.action = "reverse";
                            else botState.action = "stop";
                        }
                        sendCommand();
                    }
                }
                new OverlayJoystick('joy-left', 'stick-left', true);
                new OverlayJoystick('joy-right', 'stick-right', false);
            </script>
        </body>
        </html>
    `);
});

app.listen(PORT, () => console.log(`Server running on port ${PORT} — build ${BUILD_VERSION}`));
