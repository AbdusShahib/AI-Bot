const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// JSON body parsing — used by /update-command and any other JSON routes.
// NOTE: this does NOT parse the /upload route, because the ESP32 posts
// Content-Type: image/jpeg, which express.json() silently ignores
// (req.body ends up undefined, and latestFrame was never actually set).
app.use(express.json({ limit: '10mb' }));

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
    command: "idle"
};

let latestFrame = null;
let objectHeight = 0.0;

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

// 2. Image Stream Endpoint for WebViewer Background
app.get('/image', (req, res) => {
    if (!latestFrame) return res.status(404).send('No frame available');
    res.writeHead(200, {
        'Content-Type': 'image/jpeg',
        'Content-Length': latestFrame.length
    });
    res.end(latestFrame);
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

    // Drive Motors & Sequence Commands (save, run, pause, reset)
    if (req.body.action !== undefined) botState.action = req.body.action;
    if (req.body.command !== undefined) botState.command = req.body.command;

    res.json({ status: "success", state: botState });
});

// 4. Full-Screen Landscape PUBG-Style HTML Controller Interface
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

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
