const express = require('express');
const app = express();

// Configure Express to accept raw binary data (the JPEG image from ESP32)
app.use(express.raw({ type: 'image/jpeg', limit: '10mb' }));
// Enable JSON parsing for the App Inventor command updates
app.use(express.json()); 

// Global variables to store the robot's state
let currentCommand = {
    pan: 90,
    tilt: 90,
    action: "stop"
};
let latestImage = null; // Stores the most recent image frame

// 0. Default Home Route (Health Check)
app.get('/', (req, res) => {
    res.send('🤖 Robot Server is online and streaming successfully!');
});

// 1. Endpoint for ESP32-CAM (Uploads image frame, gets commands)
app.post('/upload', (req, res) => {
    if (req.body && req.body.length > 0) {
        latestImage = req.body; // Store the incoming JPEG buffer
    }
    
    // Immediately reply to the ESP32 with the latest servo and motor commands
    res.json(currentCommand);
});

// 2. Endpoint for App Inventor (Updates the control commands)
app.post('/update-command', (req, res) => {
    currentCommand = {
        pan: req.body.pan !== undefined ? req.body.pan : currentCommand.pan,
        tilt: req.body.tilt !== undefined ? req.body.tilt : currentCommand.tilt,
        action: req.body.action !== undefined ? req.body.action : currentCommand.action
    };
    console.log("Updated commands from app:", currentCommand);
    res.json({ status: "success", command: currentCommand });
});

// 3. Endpoint to serve the raw image data to the browser
app.get('/image', (req, res) => {
    if (latestImage) {
        res.setHeader('Content-Type', 'image/jpeg');
        res.send(latestImage);
    } else {
        res.status(404).send('No image received yet from ESP32.');
    }
});

// 4. Endpoint to stream the video feed to App Inventor's WebViewer2
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
                    }
                    img {
                        width: 100%;
                        max-width: 640px;
                        /* Remove or change the transform below if your camera is mounted differently */
                        transform: rotate(90deg); 
                    }
                </style>
            </head>
            <body>
                <img id="feed" src="/image" alt="Live Feed" />
                <script>
                    // Rapidly refresh the image source to create a video stream
                    setInterval(() => {
                        const img = document.getElementById('feed');
                        // Append a timestamp to bypass browser caching
                        img.src = '/image?' + new Date().getTime();
                    }, 200); // 200ms = 5 frames per second
                </script>
            </body>
        </html>
    `);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
