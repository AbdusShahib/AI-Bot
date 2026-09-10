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
    command: "idle"
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
        if (req.body.command !== undefined && setField('command', req.body.command)) changed = true;

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

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
