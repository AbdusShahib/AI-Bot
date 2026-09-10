const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true })); // Added to catch form-style posts
const rawImageParser = express.raw({ type: 'image/jpeg', limit: '10mb' });

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
    command: "idle"
};

// ... keep your latestFrame and /upload, /image, /stream routes here ...

app.post('/update-command', (req, res) => {
    console.log("Received update-command payload:", req.body); // Check your Render logs!

    if (req.body.flash === "toggle") botState.flash = !botState.flash;
    if (req.body.laser === "toggle") botState.laser = !botState.laser;
    if (typeof req.body.flash === "boolean") botState.flash = req.body.flash;
    if (typeof req.body.laser === "boolean") botState.laser = req.body.laser;

    if (req.body.pan !== undefined) botState.pan = Number(req.body.pan);
    if (req.body.tilt !== undefined) botState.tilt = Number(req.body.tilt);
    if (req.body.speed !== undefined) botState.speed = Number(req.body.speed);
    if (req.body.neck !== undefined) botState.neck = Number(req.body.neck);
    if (req.body.shoulder !== undefined) botState.shoulder = Number(req.body.shoulder);
    if (req.body.elbow !== undefined) botState.elbow = Number(req.body.elbow);
    if (req.body.wrist !== undefined) botState.wrist = Number(req.body.wrist);
    if (req.body.rotation !== undefined) botState.rotation = Number(req.body.rotation);

    if (req.body.action !== undefined) botState.action = req.body.action;
    if (req.body.command !== undefined) botState.command = req.body.command;

    res.json({ status: "success", state: botState });
});

app.get('/image', (req, res) => {
    if (!latestFrame) return res.status(404).send('No frame available');
    res.writeHead(200, {
        'Content-Type': 'image/jpeg',
        'Content-Length': latestFrame.length
    });
    res.end(latestFrame);
});

// Version-gated minimal-payload state endpoint. The ESP32 sends the version
// it last saw as ?v=N; if that's still current, respond with just {"v":N}
// (no serialization/parsing overhead for a no-op poll). Otherwise send the
// full state plus the new version.
app.get('/state', (req, res) => {
    const clientVersion = parseInt(req.query.v, 10);
    if (!Number.isNaN(clientVersion) && clientVersion === stateVersion) {
        return res.json({ v: stateVersion });
    }
    res.json({ ...botState, v: stateVersion });
});

app.get('/stream', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
            <style>
                * { box-sizing: border-box; }
                body, html { margin: 0; padding: 0; width: 100vw; height: 100vh; background: #000; overflow: hidden; }
                #video-area { width: 100%; height: 100%; display: flex; justify-content: center; align-items: center; }
                img { width: 100%; height: 100%; object-fit: cover; transform: rotate(180deg); display: none; }
                #errorBox { color: #ff4444; border: 2px solid #ff4444; padding: 20px; border-radius: 8px; background: rgba(0,0,0,0.85); text-align: center; font-family: sans-serif; }
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

// Every write goes through setField so stateVersion only moves on a real
// change — repeated identical POSTs (e.g. a slider re-sending the same
// value) don't force an extra full /state payload on the next ESP32 poll.
app.post('/update-command', (req, res) => {
    let changed = false;

    if (req.body.flash === "toggle") { botState.flash = !botState.flash; changed = true; }
    if (req.body.laser === "toggle") { botState.laser = !botState.laser; changed = true; }
    if (typeof req.body.flash === "boolean" && setField('flash', req.body.flash)) changed = true;
    if (typeof req.body.laser === "boolean" && setField('laser', req.body.laser)) changed = true;

    ['pan', 'tilt', 'speed', 'neck', 'shoulder', 'elbow', 'wrist', 'rotation'].forEach((key) => {
        if (req.body[key] !== undefined && setField(key, req.body[key])) changed = true;
    });

    if (req.body.action !== undefined && setField('action', req.body.action)) changed = true;
    if (req.body.command !== undefined && setField('command', req.body.command)) changed = true;

    if (changed) stateVersion++;

    res.json({ status: "success", state: botState, v: stateVersion });
});

// Screen 3 controller: video overlay only. The joystick is purely visual —
// it does not call /update-command or send anything to the robot. Real
// control now happens through the native App Inventor sliders/joysticks on
// Screen 2, which talk to /update-command directly.
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
                    position: absolute; bottom: 25px; right: 40px;
                    width: 140px; height: 140px; border-radius: 50%;
                    background: rgba(42, 42, 44, 0.3); 
                    border: 3px solid rgba(255, 255, 255, 0.3);
                    z-index: 10; display: flex; justify-content: center; align-items: center;
                    pointer-events: auto;
                }
                .stick {
                    width: 60px; height: 60px; border-radius: 50%;
                    background: rgba(138, 180, 248, 0.4);
                    border: 2px solid rgba(255, 255, 255, 0.6);
                    position: absolute; pointer-events: none;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.5);
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
            <div class="hud-label">AI ARMBOT HUD (VISUAL OVERLAY)</div>
            <div id="video-area">
                <div id="errorBox">Connecting to Armbot...</div>
                <img id="feed" alt="Live Stream" />
            </div>
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

                // Purely visual joystick — no fetch(), no backend calls.
                class VisualJoystick {
                    constructor(baseId, stickId) {
                        this.base = document.getElementById(baseId);
                        this.stick = document.getElementById(stickId);
                        this.maxRadius = 55; 
                        this.active = false;
                        this.centerX = 0; this.centerY = 0;

                        const start = (e) => { this.active = true; this.updateCenter(); this.move(e); };
                        const end = () => { this.active = false; this.reset(); };
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
                    }
                    reset() {
                        this.stick.style.transform = \`translate(0px, 0px)\`;
                    }
                }
                new VisualJoystick('joy-right', 'stick-right');
            </script>
        </body>
        </html>
    `);
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
