const mqtt = require("mqtt");
const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const BROKER_IP = "192.168.0.5"; // Pi3 MQTT broker
const PORT = 1883; // MQTT port

// MQTT client
const mqttClient = mqtt.connect(`mqtt://${BROKER_IP}:${PORT}`);

let doorStatus = "BLOCKED"; // store latest door status
let robotStatus = "IDLE"; // store robot automation status
let lastCommandTime = 0; // timestamp of last robot command
let commandTimeout = null; // timeout handler
let isProcessing = false; // track if robot is currently processing
let processingTimeout = null; // processing completion timer
let isDoorProcessing = false; // track if door is currently processing
let doorProcessingTimeout = null; // door processing completion timer

// De-duplication helpers per topic
const lastPayloadByTopic = {}; // topic -> last payload string
const lastMessageTimeByTopic = {}; // topic -> timestamp ms

const COMMAND_TIMEOUT_MS = 15000; // 15 seconds timeout
const PROCESSING_DURATION_MS = 15000; // 15 seconds for robot to complete processing
const DOOR_PROCESSING_DURATION_MS = 10000; // 10 seconds for door sequence to complete
const DUPLICATE_WINDOW_MS = 2000; // suppress identical payloads within this window

// --- Feedback helper (robot only) ---
function sendRobotFeedback(message) {
  mqttClient.publish("granted/feedback", message, { qos: 0, retain: false }, (err) => {
    if (err) {
      console.error("Error publishing robot feedback:", err);
    } else {
      console.log(`Robot feedback published → granted/feedback: ${message}`);
    }
  });
}

mqttClient.on("connect", () => {
  console.log("Connected to MQTT broker at", BROKER_IP);

  // Subscribe ONLY to the door topic
  mqttClient.subscribe("granted/command", (err) => {
    if (!err) console.log("Subscribed to door topic (granted/command)");
  });
});

// Express & HTTP server
const app = express();
app.use(cors());

const server = http.createServer(app);

// Socket.IO server with CORS
const io = new Server(server, {
  cors: { origin: "*" }
});

// Serve frontend HTML
app.get("/", (req, res) => {
  res.sendFile(__dirname + "/index.html");
});

// REST API: Door status
app.get("/door-status", (req, res) => {
  const currentStatus = doorStatus === "Authorized" ? "DOOR_AUTHORIZED" : "DOOR_BLOCKED";
  res.json({
    stringMessage: currentStatus
  });
});

// REST API: Robot status
app.get("/robot-status", (req, res) => {
  const currentStatus = robotStatus === "START" ? "ROBOT_START" : "ROBOT_IDLE";
  res.json({
    stringMessage: currentStatus
  });
});

// REST API: Reset door status
app.post("/reset-door-status", (req, res) => {
  console.log("Door status reset requested by frontend");
  doorStatus = "BLOCKED";
  res.json({
    success: true,
    message: "Door status reset to BLOCKED"
  });
});

// Forward MQTT messages → WebSocket + save door status
mqttClient.on("message", (topic, message, packet) => {
  const payload = message.toString();

  // Check retained flag
  const isRetained = packet && packet.retain === true;

  // Duplicate suppression
  const now = Date.now();
  const lastPayload = lastPayloadByTopic[topic];
  const lastTime = lastMessageTimeByTopic[topic] || 0;
  const isDuplicate = lastPayload === payload && (now - lastTime) < DUPLICATE_WINDOW_MS;
  lastPayloadByTopic[topic] = payload;
  lastMessageTimeByTopic[topic] = now;

  if (isDuplicate) {
    return;
  }

  console.log(`${topic} → ${payload}${isRetained ? " (retained)" : ""}`);

  // Handle different message types
  if (payload === "Authorized") {
    if (isProcessing) {
      console.log("Door authorization received during robot processing - IGNORED");
      sendRobotFeedback("DOOR_AUTH_IGNORED");
    } else {
      doorStatus = payload;
      isDoorProcessing = true;
      console.log("Door authorization received - setting door status to Authorized");
  
      clearTimeout(doorProcessingTimeout);
      doorProcessingTimeout = setTimeout(() => {
        console.log("Door processing completed");
        isDoorProcessing = false;
  
        // ✅ Send feedback when door processing completes
        mqttClient.publish("granted/feedback", "DOOR_PROCESSING_COMPLETED", { qos: 0, retain: false }, (err) => {
          if (err) console.error("Error publishing door feedback:", err);
          else console.log("Door feedback published → DOOR_PROCESSING_COMPLETED");
        });
      }, DOOR_PROCESSING_DURATION_MS);
    }
  }
   else if (payload === "BLOCKED" || payload.startsWith("FOG_BLOCK")) {
    // Treat FOG_BLOCK same as BLOCKED
    if (isDoorProcessing) {
      console.log(`Robot command ${payload} received during door processing - IGNORED`);
    } else {
      handleRobotCommand("BLOCKED");
    }

  } else if (payload === "ENV_OK" || payload === "STOP" || payload === "IDLE") {
    console.log(`Stop command received: ${payload}`);
    robotStatus = "IDLE";
    isProcessing = false;
    isDoorProcessing = false;
    clearTimeout(commandTimeout);
    clearTimeout(processingTimeout);
    clearTimeout(doorProcessingTimeout);

    sendRobotFeedback("ROBOT_STOPPED");

  } else if (payload === "DENIED" || payload === "UNAUTHORIZED") {
    doorStatus = "BLOCKED";
    console.log(`Door access denied - setting door status to BLOCKED`);
    // ❌ no feedback for door

  } else {
    console.log(`Unknown command received: ${payload} - ignoring`);
  }

  // Emit to all WebSocket clients
  io.emit("mqtt_message", { topic, message: payload });
});

// Function to handle robot commands with processing timer
function handleRobotCommand(command) {
  console.log(`Received robot command: ${command}`);

  if (isProcessing) {
    console.log("Robot is already processing, ignoring new command until done");
    return;
  }

  // Start processing
  console.log(`Starting robot processing for command: ${command}`);
  robotStatus = "START";
  isProcessing = true;
  lastCommandTime = Date.now();

  clearTimeout(commandTimeout);
  clearTimeout(processingTimeout);

  // Trigger robot animation
  io.emit("robot_animation", { duration: PROCESSING_DURATION_MS });
  console.log(`Robot animation triggered for ${PROCESSING_DURATION_MS} ms`);

  processingTimeout = setTimeout(() => {
    console.log("Robot processing completed");
    isProcessing = false;
    robotStatus = "IDLE";
    console.log("Robot ready for next command immediately");

    sendRobotFeedback("ROBOT_COMPLETED");
  }, PROCESSING_DURATION_MS);
}

// Function to reset command timeout
function resetCommandTimeout() {
  clearTimeout(commandTimeout);
  if (!isProcessing) {
    commandTimeout = setTimeout(() => {
      console.log("Command timeout - setting robot to IDLE");
      robotStatus = "IDLE";
      isProcessing = false;
      clearTimeout(processingTimeout);
      sendRobotFeedback("ROBOT_TIMEOUT");
    }, COMMAND_TIMEOUT_MS);
  }
}

// Start server
server.listen(5000, () => {
  console.log("Web server running at http://localhost:5000");
  console.log("Door API running at http://localhost:5000/door-status");
  console.log("Robot API running at http://localhost:5000/robot-status");
});
