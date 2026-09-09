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
                    img { height: 640px; width: auto; max-width: 100%; transform: rotate(180deg); display: none; }
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
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
