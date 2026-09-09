const express = require('express');
const app = express();

// Add basic CORS so the local App Inventor HTML can fetch data from Render
app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, X-Object-Height");
    next();
});

// Configure Express to accept raw binary data and JSON
app.use(express.raw({ type: 'image/jpeg', limit: '10mb' }));
app.use(express.json()); 

// Global variables
let currentCommand = { pan: 90, tilt: 90, action: "stop" };
let latestImage = null;
let latestHeight = "0.00"; 
let lastUploadTime = 0; // Tracks the exact millisecond the last frame arrived

app.get('/', (req, res) => {
    res.send('🤖 AI Armbot Server is online!');
});

// 1. Endpoint for ESP32-CAM (Uploads image & height, gets commands)
app.post('/upload', (req, res) => {
    if (req.body && req.body.length > 0) {
        latestImage = req.body;
        lastUploadTime = Date.now(); // Reset the timeout clock
        
        // Extract the ultrasonic height data from the custom header
        if (req.headers['x-object-height']) {
            latestHeight = req.headers['x-object-height'];
        }
    }
    res.json(currentCommand);
});

// 2. Endpoint for App Inventor manual  controls
app.post('/update-command', (req, res) => {
    currentCommand = {
        pan: req.body.pan !== undefined ? req.body.pan : currentCommand.pan,
        tilt: req.body.tilt !== undefined ? req.body.tilt : currentCommand.tilt,
        action: req.body.action !== undefined ? req.body.action : currentCommand.action
    };
    res.json({ status: "success", command: currentCommand });
});

// 3. Endpoint for the AI Agent to fetch the sensor data on demand
app.get('/sensor-data', (req, res) => {
    // If we haven't received data in 3 seconds, the bot is offline
    const isOnline = (Date.now() - lastUploadTime) < 3000;
    
    res.json({
        online: isOnline,
        height: isOnline ? latestHeight : "Error: Sensor disconnected",
        lastUpdateMs: Date.now() - lastUploadTime
    });
});

// 4. Endpoint to serve the raw image data (returns 404 if timed out)
app.get('/image', (req, res) => {
    if (latestImage && (Date.now() - lastUploadTime < 3000)) {
        res.setHeader('Content-Type', 'image/jpeg');
        res.send(latestImage);
    } else {
        // Send a 404 error if the ESP32 crashed or lost Wi-Fi
        res.status(404).send('Camera feed unavailable.');
    }
});

// 5. Smart Stream Endpoint with Error Handling UI
app.get('/stream', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
            <head>
                <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
                <style>
                    body { margin: 0; background-color: #000; display: flex; justify-content: center; align-items: center; height: 100vh; overflow: hidden; font-family: sans-serif; }
                    img { height: auto; width: auto; max-width: 100%; transform: rotate(0deg); display: none; }
                    #errorBox { 
                        display: block; 
                        text-align: center; 
                        color: #ff4444; 
                        padding: 20px; 
                        border: 2px solid #ff4444; 
                        border-radius: 8px; 
                        background: rgba(255,0,0,0.1); 
                        width: 80%;
                        max-width: 300px;
                    }
                </style>
            </head>
            <body>
                <div id="errorBox">Waiting for Armbot connection...</div>
                <img id="feed" alt="Live Feed" />
                
                <script>
                    const img = document.getElementById('feed');
                    const errBox = document.getElementById('errorBox');
                    
                    setInterval(() => {
                        const tempImg = new Image();
                        
                        // If the image loads successfully (200 OK)
                        tempImg.onload = () => {
                            img.src = tempImg.src;
                            img.style.display = 'block';
                            errBox.style.display = 'none';
                        };
                        
                        // If the server returns a 404 error (Timeout)
                        tempImg.onerror = () => {
                            img.style.display = 'none';
                            errBox.style.display = 'block';
                            errBox.innerHTML = "<b>Connection Lost</b><br><br>The Bot is offline, powered down, or lost Wi-Fi.";
                        };
                        
                        // Fetch the new frame
                        tempImg.src = '/image?' + new Date().getTime();
                    }, 250); // Refresh 4 times a second
                </script>
            </body>
        </html>
    `);
});

const PORT = process.env.PORT || 3000;

app.get('/controller', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <!-- Forces mobile scaling, prevents browser pinch-zoom and pull-to-refresh -->
            <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
            <style>
                * { box-sizing: border-box; }
                body, html {
                    margin: 0; padding: 0; width: 100%; height: 100%;
                    background: #000; color: white; font-family: sans-serif;
                    overflow: hidden; touch-action: none; position: relative;
                }
                
                /* 1. Full-Screen Video Background */
                #video-area {
                    position: absolute; top: 0; left: 0;
                    width: 100%; height: 100%; z-index: 1;
                    display: flex; justify-content: center; align-items: center;
                }
                img { 
                    width: 100%; height: 100%; 
                    object-fit: cover; /* Fills screen completely while preserving aspect ratio */
                    transform: rotate(180deg); display: none; 
                }
                #errorBox { 
                    color: #ff4444; border: 2px solid #ff4444; padding: 20px; 
                    border-radius: 8px; background: rgba(0,0,0,0.8); text-align: center;
                }

                /* 2. Floating Overlay Controls (70% Transparent / 30% Opacity) */
                .joystick-container {
                    position: absolute; bottom: 30px;
                    width: 130px; height: 130px; border-radius: 50%;
                    background: rgba(42, 42, 44, 0.3); 
                    border: 3px solid rgba(255, 255, 255, 0.3);
                    z-index: 10; display: flex; justify-content: center; align-items: center;
                    transition: opacity 0.2s ease;
                }
                
                #joy-left { left: 25px; }   /* Floating Left: Servos */
                #joy-right { right: 25px; } /* Floating Right: Motors */

                /* Thumbstick Knob */
                .stick {
                    width: 55px; height: 55px; border-radius: 50%;
                    background: rgba(138, 180, 248, 0.5);
                    border: 2px solid rgba(255, 255, 255, 0.6);
                    position: absolute; pointer-events: none;
                    box-shadow: 0 4px 10px rgba(0,0,0,0.4);
                }

                /* Active state: Brightens when touched */
                .joystick-container.active {
                    background: rgba(42, 42, 44, 0.7);
                    border-color: rgba(255, 255, 255, 0.8);
                }
                .joystick-container.active .stick {
                    background: rgba(138, 180, 248, 0.9);
                }
            </style>
        </head>
        <body>
            <!-- Background Stream -->
            <div id="video-area">
                <div id="errorBox">Connecting to Armbot...</div>
                <img id="feed" alt="Live Stream" />
            </div>
            
            <!-- Hovering Overlay Joysticks -->
            <div id="joy-left" class="joystick-container"><div id="stick-left" class="stick"></div></div>
            <div id="joy-right" class="joystick-container"><div id="stick-right" class="stick"></div></div>

            <script>
                // --- 1. Video Feed Loop ---
                const img = document.getElementById('feed');
                const errBox = document.getElementById('errorBox');
                setInterval(() => {
                    const tempImg = new Image();
                    tempImg.onload = () => { img.src = tempImg.src; img.style.display = 'block'; errBox.style.display = 'none'; };
                    tempImg.onerror = () => { img.style.display = 'none'; errBox.style.display = 'block'; errBox.innerHTML = "<b>Connection Lost</b><br>Armbot Offline"; };
                    tempImg.src = '/image?' + new Date().getTime();
                }, 200);

                // --- 2. State & HTTP Transmission ---
                let botState = { pan: 90, tilt: 90, action: "stop" };
                let lastSent = 0;

                function sendCommand() {
                    // Throttles to 10 HTTP updates/sec max to keep latency low
                    if (Date.now() - lastSent < 100) return;
                    lastSent = Date.now();

                    fetch('/update-command', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(botState)
                    }).catch(err => console.error("Update failed:", err));
                }

                // --- 3. Multi-Touch Joystick Engine ---
                class OverlayJoystick {
                    constructor(baseId, stickId, isServo) {
                        this.base = document.getElementById(baseId);
                        this.stick = document.getElementById(stickId);
                        this.isServo = isServo;
                        this.maxRadius = 50; 
                        this.active = false;
                        this.centerX = 0; this.centerY = 0;

                        const start = (e) => { 
                            this.active = true; 
                            this.base.classList.add('active'); 
                            this.updateCenter(); 
                            this.move(e); 
                        };
                        const end = () => { 
                            this.active = false; 
                            this.base.classList.remove('active'); 
                            this.reset(); 
                        };
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
                        if (!this.isServo) {
                            botState.action = "stop"; 
                            sendCommand();
                        }
                    }

                    processData(dx, dy) {
                        let nx = dx / this.maxRadius; 
                        let ny = dy / this.maxRadius;

                        if (this.isServo) {
                            botState.pan = Math.round(90 + (nx * 90));
                            botState.tilt = Math.round(90 + (ny * -90)); // Upper drag tilts camera up
                        } else {
                            if (ny < -0.35) botState.action = "forward";
                            else if (ny > 0.35) botState.action = "reverse";
                            else botState.action = "stop";
                        }
                        sendCommand();
                    }
                }

                // Initialize left and right overlay joysticks
                new OverlayJoystick('joy-left', 'stick-left', true);
                new OverlayJoystick('joy-right', 'stick-right', false);
            </script>
        </body>
        </html>
    `);
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
