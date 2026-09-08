const express = require('express');
const app = express();

// Configure Express to accept raw binary data (the JPEG image)
app.use(express.raw({ type: 'image/jpeg', limit: '10mb' }));
// Enable JSON parsing for the App Inventor commands
app.use(express.json()); 

// Global variable to store the latest commands from App Inventor
let currentCommand = {
    pan: 90,
    tilt: 90,
    action: "stop"
};

// 1. Endpoint for ESP32-CAM (Uploads image, gets commands)
app.post('/upload', (req, res) => {
    if (req.body && req.body.length > 0) {
        console.log(`Received image from ESP32. Size: ${req.body.length} bytes`);
        // The raw JPEG buffer is in req.body. You can forward it to Gemini here later.
    }
    
    // Immediately reply with the latest servo and motor commands
    res.json(currentCommand);
});

// 2. Endpoint for App Inventor (Updates the commands)
app.post('/update-command', (req, res) => {
    currentCommand = {
        pan: req.body.pan || currentCommand.pan,
        tilt: req.body.tilt || currentCommand.tilt,
        action: req.body.action || currentCommand.action
    };
    console.log("Updated commands from app:", currentCommand);
    res.json({ status: "success", command: currentCommand });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});