const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
const rawImageParser = express.raw({ type: 'image/jpeg', limit: '10mb' });

let latestFrame = null;
let stateVersion = 1;

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
    command: "idle",
    savedSteps: []
};

function setField(key, value) {
    let newVal = value;
    if (['pan', 'tilt', 'speed', 'neck', 'shoulder', 'elbow', 'wrist', 'rotation'].includes(key)) {
        newVal = Number(value);
    } else if (key === 'flash' || key === 'laser') {
        newVal = Boolean(value);
    }
    if (botState[key] !== newVal) {
        botState[key] = newVal;
        return true;
    }
    return false;
}

app.post('/upload', rawImageParser, (req, res) => {
    if (req.body && req.body.length > 0) {
        latestFrame = req.body;
        res.json({ status: "ok" });
    } else {
        res.status(400).send('No image data');
    }
});

app.get('/image', (req, res) => {
    if (!latestFrame) return res.status(404).send('No frame available');
    res.writeHead(200, {
        'Content-Type': 'image/jpeg',
        'Content-Length': latestFrame.length
    });
    res.end(latestFrame);
});

app.get('/state', (req, res) => {
    const clientVersion = parseInt(req.query.v, 10);
    if (!Number.isNaN(clientVersion) && clientVersion === stateVersion) {
        return res.json({ v: stateVersion });
    }
    res.json({ ...botState, v: stateVersion });
});

app.post('/update-command', (req, res) => {
    try {
        let changed = false;

        if (req.body.flash === "toggle") { botState.flash = !botState.flash; changed = true; }
        if (req.body.laser === "toggle") { botState.laser = !botState.laser; changed = true; }
        if (typeof req.body.flash === "boolean" && setField('flash', req.body.flash)) changed = true;
        if (typeof req.body.laser === "boolean" && setField('laser', req.body.laser)) changed = true;

        ['pan', 'tilt', 'speed', 'neck', 'shoulder', 'elbow', 'wrist', 'rotation'].forEach((key) => {
            if (req.body[key] !== undefined && setField(key, req.body[key])) changed = true;
        });

        if (req.body.action !== undefined && setField('action', req.body.action)) changed = true;
        
        // Handle step saving command
        if (req.body.command === "save") {
            const stepSnapshot = {
                pan: botState.pan,
                tilt: botState.tilt,
                neck: botState.neck,
                shoulder: botState.shoulder,
                elbow: botState.elbow,
                wrist: botState.wrist,
                rotation: botState.rotation,
                speed: botState.speed
            };
            botState.savedSteps.push(stepSnapshot);
            botState.command = "save";
            changed = true;
        } else if (req.body.command === "run") {
            botState.command = "run";
            changed = true;
        } else if (req.body.command === "reset") {
            botState.savedSteps = [];
            botState.command = "reset";
            changed = true;
        } else if (req.body.command !== undefined) {
            if (setField('command', req.body.command)) changed = true;
        }

        if (changed) stateVersion++;

        res.json({ status: "success", state: botState, v: stateVersion });
    } catch (err) {
        console.error("Server error on update-command:", err);
        res.status(500).json({ error: err.message });
    }
});

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
                    background: #131314; color: #e3e3e3; font-family: sans-serif;
                    overflow: hidden; display: flex; flex-direction: row;
                }
                #video-area {
                    flex: 1; height: 100%; background: #000;
                    display: flex; justify-content: center; align-items: center; position: relative;
                }
                img {
                    width: 100%; height: 100%; object-fit: cover;
                    transform: rotate(180deg); display: none;
                }
                #errorBox {
                    color: #ff4444; border: 2px solid #ff4444; padding: 20px;
                    border-radius: 8px; background: rgba(0,0,0,0.85); text-align: center;
                }
                #control-panel {
                    width: 320px; height: 100%; background: #1e1f20;
                    border-left: 1px solid #333; padding: 15px;
                    display: flex; flex-direction: column; gap: 12px; overflow-y: auto;
                }
                .slider-group {
                    display: flex; flex-direction: column; gap: 4px;
                }
                .slider-group label {
                    font-size: 11px; font-weight: bold; text-transform: uppercase; color: #8ab4f8;
                }
                .slider-row {
                    display: flex; align-items: center; gap: 10px;
                }
                .slider-row input[type=range] {
                    flex: 1; accent-color: #8ab4f8; cursor: pointer;
                }
                .slider-row span {
                    width: 35px; text-align: right; font-size: 13px; font-family: monospace;
                }
                .btn-row {
                    display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: auto;
                }
                button {
                    padding: 10px; border: none; border-radius: 6px; font-weight: bold; cursor: pointer;
                }
                .btn-primary { background: #0b57d0; color: white; }
                .btn-danger { background: #8c1d18; color: white; }
                .btn-success { background: #137333; color: white; }
                .counter-box {
                    font-size: 12px; background: #2c2d2e; padding: 8px; border-radius: 6px; text-align: center; color: #8ab4f8; font-weight: bold;
                }
            </style>
        </head>
        <body>
            <div id="video-area">
                <div id="errorBox">Connecting to Armbot Stream...</div>
                <img id="feed" alt="Live Stream" />
            </div>

            <div id="control-panel">
                <h3 style="margin: 0 0 5px 0; font-size: 14px; color: #fff;">Armbot Control Panel</h3>
                
                <div class="counter-box">Saved Steps: <span id="step-counter">0</span></div>

                <div class="slider-group">
                    <label>Pan (Servo 5)</label>
                    <div class="slider-row"><input type="range" id="pan" min="0" max="180" value="90"><span id="val-pan">90</span></div>
                </div>
                <div class="slider-group">
                    <label>Tilt (Servo 6)</label>
                    <div class="slider-row"><input type="range" id="tilt" min="0" max="180" value="90"><span id="val-tilt">90</span></div>
                </div>
                <div class="slider-group">
                    <label>Neck (Servo 1)</label>
                    <div class="slider-row"><input type="range" id="neck" min="0" max="180" value="90"><span id="val-neck">90</span></div>
                </div>
                <div class="slider-group">
                    <label>Shoulder (Servo 2)</label>
                    <div class="slider-row"><input type="range" id="shoulder" min="0" max="180" value="90"><span id="val-shoulder">90</span></div>
                </div>
                <div class="slider-group">
                    <label>Elbow (Servo 3)</label>
                    <div class="slider-row"><input type="range" id="elbow" min="0" max="180" value="90"><span id="val-elbow">90</span></div>
                </div>
                <div class="slider-group">
                    <label>Wrist (Servo 4)</label>
                    <div class="slider-row"><input type="range" id="wrist" min="0" max="180" value="90"><span id="val-wrist">90</span></div>
                </div>
                <div class="slider-group">
                    <label>Rotation</label>
                    <div class="slider-row"><input type="range" id="rotation" min="0" max="180" value="90"><span id="val-rotation">90</span></div>
                </div>
                <div class="slider-group">
                    <label>Speed</label>
                    <div class="slider-row"><input type="range" id="speed" min="0" max="180" value="90"><span id="val-speed">90</span></div>
                </div>

                <div class="btn-row" style="margin-top: 5px;">
                    <button class="btn-success" onclick="saveStep()">SAVE STEP</button>
                    <button class="btn-primary" onclick="runSequence()">RUN</button>
                </div>
                <div class="btn-row">
                    <button class="btn-primary" onclick="sendUpdate()">APPLY</button>
                    <button class="btn-danger" onclick="resetDefaults()">RESET</button>
                </div>
            </div>

            <script>
                const img = document.getElementById('feed');
                const errBox = document.getElementById('errorBox');
                
                // Stream polling loop
                setInterval(() => {
                    const tempImg = new Image();
                    tempImg.onload = () => { img.src = tempImg.src; img.style.display = 'block'; errBox.style.display = 'none'; };
                    tempImg.onerror = () => { img.style.display = 'none'; errBox.style.display = 'block'; };
                    tempImg.src = '/image?' + new Date().getTime();
                }, 200);

                // Fetch current state periodically to sync sliders and step counter
                setInterval(() => {
                    fetch('https://ai-bot-m5b2.onrender.com/state')
                        .then(res => res.json())
                        .then(data => {
                            if (data.savedSteps) {
                                document.getElementById('step-counter').innerText = data.savedSteps.length;
                            }
                        }).catch(err => console.error("Sync error:", err));
                }, 1000);

                const keys = ['pan', 'tilt', 'neck', 'shoulder', 'elbow', 'wrist', 'rotation', 'speed'];
                keys.forEach(k => {
                    const slider = document.getElementById(k);
                    const span = document.getElementById('val-' + k);
                    slider.addEventListener('input', () => { span.innerText = slider.value; });
                });

                function sendUpdate() {
                    const payload = {};
                    keys.forEach(k => { payload[k] = parseInt(document.getElementById(k).value, 10); });
                    
                    fetch('/update-command', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    }).then(res => res.json()).catch(err => console.error("Error updating state:", err));
                }

                function saveStep() {
                    const payload = { command: "save" };
                    keys.forEach(k => { payload[k] = parseInt(document.getElementById(k).value, 10); });

                    fetch('/update-command', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    }).then(res => res.json())
                      .then(data => {
                          if(data.state && data.state.savedSteps) {
                              document.getElementById('step-counter').innerText = data.state.savedSteps.length;
                          }
                      })
                      .catch(err => console.error("Error saving step:", err));
                }

                function runSequence() {
                    fetch('/update-command', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ command: "run" })
                    }).then(res => res.json()).catch(err => console.error("Error running sequence:", err));
                }

                function resetDefaults() {
                    keys.forEach(k => {
                        document.getElementById(k).value = 90;
                        document.getElementById('val-' + k).innerText = "90";
                    });
                    fetch('/update-command', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ command: "reset", pan: 90, tilt: 90, neck: 90, shoulder: 90, elbow: 90, wrist: 90, rotation: 90, speed: 90 })
                    }).then(res => res.json())
                      .then(data => {
                          document.getElementById('step-counter').innerText = "0";
                      })
                      .catch(err => console.error("Error resetting:", err));
                }
            </script>
        </body>
        </html>
    `);
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
