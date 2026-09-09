const express = require('express');
const app = express();

app.use(express.raw({ type: 'image/jpeg', limit: '10mb' }));
app.use(express.json()); 

// Global variables to store the robot's state
let currentCommand = {
    pan: 90,
    tilt: 90,
    action: "stop"
};
let latestImage = null; 
let latestHeight = "0.0"; // Stores the ultrasonic height

// 0. Default Home Route
app.get('/', (req, res) => {
    res.send('🤖 Robot Server is online and streaming successfully!');
});

// 1. Endpoint for ESP32-CAM (Uploads image & height, gets commands)
app.post('/upload', (req, res) => {
    if (req.body && req.body.length > 0) {
        latestImage = req.body; 
    }
    
    // Extract the height data sent in the custom header
    if (req.headers['x-object-height']) {
        latestHeight = req.headers['x-object-height'];
    }
    
    res.json(currentCommand);
});

// 2. Endpoint for App Inventor
app.post('/update-command', (req, res) => {
    currentCommand = {
        pan: req.body.pan !== undefined ? req.body.pan : currentCommand.pan,
        tilt: req.body.tilt !== undefined ? req.body.tilt : currentCommand.tilt,
        action: req.body.action !== undefined ? req.body.action : currentCommand.action
    };
    res.json({ status: "success", command: currentCommand });
});

// 3. Endpoint to serve the raw image data
app.get('/image', (req, res) => {
    if (latestImage) {
        res.setHeader('Content-Type', 'image/jpeg');
        res.send(latestImage);
    } else {
        // If no image is stored, send a 404 error
        res.status(404).send('No image received yet.');
    }
});

// 4. New Endpoint to serve just the height data
app.get('/height', (req, res) => {
    res.send(latestHeight);
});

// 5. Endpoint to stream the video feed and display UI
app.get('/stream', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
            <head>
                <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
                <style>
                    body {
                        margin: 0;
                        background-color: #000;
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        height: 100vh;
                        overflow: hidden;
                        font-family: sans-serif;
                    }
                    #feed-container {
                        position: relative;
                        width: 100%;
                        max-width: 640px;
                        display: flex;
                        justify-content: center;
                        align-items: center;
                    }
                    img {
                        width: 100%;
                        transform: rotate(90deg); 
                        z-index: 1;
                    }
                    #hud {
                        position: absolute;
                        top: 10px;
                        left: 10px;
                        background: rgba(0, 0, 0, 0.7);
                        color: #00ffcc;
                        padding: 8px 12px;
                        border-radius: 5px;
                        font-weight: bold;
                        z-index: 10;
                    }
                    #error-msg {
                        position: absolute;
                        color: #ff4a4a;
                        background: rgba(20, 0, 0, 0.8);
                        padding: 15px;
                        border: 1px solid #ff4a4a;
                        border-radius: 8px;
                        text-align: center;
                        font-weight: bold;
                        z-index: 5;
                        display: none; /* Hidden by default */
                    }
                </style>
            </head>
            <body>
                <div id="feed-container">
                    <div id="hud">Obj Height: <span id="height-val">0.0</span> cm</div>
                    <div id="error-msg">⚠️ Video feed unavailable.<br><br>ESP32 is offline or not sending frames.</div>
                    <img id="feed" src="/image" alt="Live Feed" />
                </div>
                
                <script>
                    const img = document.getElementById('feed');
                    const errorMsg = document.getElementById('error-msg');
                    const heightVal = document.getElementById('height-val');

                    // If the server returns 404, show the error message and hide the broken image
                    img.onerror = () => {
                        img.style.display = 'none';
                        errorMsg.style.display = 'block';
                    };
                    
                    // If the image loads successfully, hide the error message
                    img.onload = () => {
                        img.style.display = 'block';
                        errorMsg.style.display = 'none';
                    };

                    setInterval(() => {
                        // Refresh Image
                        img.src = '/image?' + new Date().getTime();
                        
                        // Fetch the latest height from the server independently
                        fetch('/height')
                            .then(response => response.text())
                            .then(data => {
                                // Convert to a clean number with 1 decimal place
                                let h = parseFloat(data);
                                heightVal.innerText = isNaN(h) ? "0.0" : h.toFixed(1);
                            })
                            .catch(err => console.error(err));
                    }, 200); // 5 FPS
                </script>
            </body>
        </html>
    `);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
