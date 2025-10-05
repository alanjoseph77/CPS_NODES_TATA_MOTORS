import { createFullESP32Assembly } from './esp32-assembly.js';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// --- SCENE & ANIMATION VARS ---
let scene, camera, renderer, controls;
let mainDoor, smallDoor;
let ceilingLights = [];
let ceilingLightFixtures = []; // Array to track ceiling light fixtures for visibility control
const clock = new THREE.Clock();
const infoDiv = document.getElementById('info-status');
const autoButton = document.getElementById('autoButton');

// --- DOOR PREVIEW VARS ---
let doorPreviewScene, doorPreviewCamera, doorPreviewRenderer;
let previewMainDoor, previewSmallDoor;
let doorPreviewContainer, doorPreviewCanvas;
let isDoorPreviewActive = false;
let currentCameraMode = 'front'; // 'front' or 'blueprint'
let blueprintCamera, frontCamera, motorCamera;
let blueprintMaterials = {};

// --- MATERIAL VARS ---
let wallMaterial; // Global brick wall material

// --- CONSOLE VARS ---
let consoleOutput;
let maxConsoleLines = 100;

// --- ESP32 LABEL VARS ---
let esp32Labels = []; // Array to store ESP32 time labels
let esp32Data = []; // Array to store ESP32 information

// --- LIGHTING CONTROL VARS ---
let lightIntensityTarget = 1.0; // Target intensity for all lights
let lightTransitionSpeed = 0.5; // Speed of light intensity transitions

// --- ROBOT VARS ---
let robot_arm, furnace;
let automationRunning = false;
let totalParcelsToProcess = 10;
let stopAllAutomation = false; // Global flag to stop everything
let boxCount = 0; // Track number of boxes processed
let currentParcel = null; // Track current parcel being processed
let currentCargo = null; // Track current cargo vehicle

// --- NEW RAIL & CARGO VARS ---
let cargoRailPath; // Changed: This will now be a single path object
let progressAtPickup;
let cargoStartPosition;

// --- 🤖 ROBOT CONFIGURATION OBJECT ---
// Change these values to easily move and resize the entire robot setup!
const robotSetupConfig = {
    scale: 2.5,
    position: new THREE.Vector3(5, 0, -9),
    path: {
        start: new THREE.Vector3(6, 0.2, 2),    // Pickup point in front of robot
        control1: new THREE.Vector3(0, 0.2, 25),   // First curve control point
        control2: new THREE.Vector3(-30, 0.2, 25), // Second curve control point
        end: new THREE.Vector3(-30, 0.2, 0)      // Final destination point
    }
};
// Position where parcels will appear from the furnace
const furnaceExitPosition = new THREE.Vector3(-5, 0.05, -7);


// --- ANIMATION STATE MACHINE (Door Entry) ---
let state = {
    authorized: false,
    mainDoorOpen: false,
    mainDoorClosed: false,
    smallDoorOpen: false,
    smallDoorClosed: false,
    sequenceComplete: false
};

// --- BACKEND COMMUNICATION ---
const DOOR_API_URL = 'http://localhost:5000/door-status';
const ROBOT_API_URL = 'http://localhost:5000/robot-status';
const RESET_DOOR_API_URL = 'http://localhost:5000/reset-door-status';

// Add state management for robot commands
let lastRobotCommand = null;
let lastCommandTime = 0;
let commandStabilityTimeout = null;
const COMMAND_STABILITY_DELAY = 200; // 0.2 seconds stability required
let pendingCommand = null;

function pollDoorStatus() {
    setInterval(async () => {
        try {
            const response = await fetch(DOOR_API_URL);
            if (!response.ok) {
                console.error('Failed to fetch door data');
                infoDiv.textContent = 'Status: Cannot connect to door API...';
                return;
            }
            const data = await response.json();

            // Only check for door authorization
            if (data.stringMessage === 'DOOR_AUTHORIZED') {
                console.log('Door authorization received!');
                addConsoleMessage('🔓 Access Granted - Door Authorization Received', 'success');
                state.authorized = true;
                infoDiv.textContent = 'Status: Authorized. Opening small door...';

                // --- NEW: Reset the state for a new cycle ---
                if (state.sequenceComplete) {
                    state.mainDoorOpen = false;
                    state.smallDoorOpen = false;
                    state.mainDoorClosed = false;
                    state.smallDoorClosed = false;
                    state.sequenceComplete = false;
                    addConsoleMessage('Door sequence reset for new cycle', 'debug');
                }
            }
        } catch (error) {
            console.error('Error fetching door data:', error);
            infoDiv.textContent = 'Status: Cannot connect to door API...';
        }
    }, 1000);
}

function pollRobotStatus() {
    console.log('Robot polling started...'); // Debug log
    setInterval(async () => {
        try {
            console.log('Checking robot status...'); // Debug log
            const response = await fetch(ROBOT_API_URL);
            if (!response.ok) {
                console.error('Failed to fetch robot data');
                return;
            }
            const data = await response.json();
            console.log('Robot API response:', data); // Debug log

            const currentCommand = data.stringMessage;
            const currentTime = Date.now();

            // Check if command has changed
            if (currentCommand !== lastRobotCommand) {
                console.log(`Command changed from ${lastRobotCommand} to ${currentCommand}`);
                lastRobotCommand = currentCommand;
                lastCommandTime = currentTime;
                pendingCommand = currentCommand;

                // Clear any existing timeout
                if (commandStabilityTimeout) {
                    clearTimeout(commandStabilityTimeout);
                    commandStabilityTimeout = null;
                }

                // Set new timeout for command stability
                commandStabilityTimeout = setTimeout(() => {
                    if (pendingCommand) {
                        processStableCommand(pendingCommand);
                        pendingCommand = null;
                    }
                    commandStabilityTimeout = null;
                }, COMMAND_STABILITY_DELAY);
            } else {
                // Command is stable, check if we need to process it immediately
                if (currentTime - lastCommandTime >= COMMAND_STABILITY_DELAY && pendingCommand) {
                    if (commandStabilityTimeout) {
                        clearTimeout(commandStabilityTimeout);
                        commandStabilityTimeout = null;
                    }
                    processStableCommand(pendingCommand);
                    pendingCommand = null;
                }
            }
        } catch (error) {
            console.error('Error fetching robot data:', error);
        }
    }, 1000);
}

// Global fog control
let isFogBlocked = false;
let fogDensity = 0;
const FOG_TRANSITION_SPEED = 2.0; // Speed of fog appearance/disappearance

function processStableCommand(command) {
    console.log(`Processing stable command: ${command}`);
    addConsoleMessage(`Processing stable command: ${command}`, 'debug');
    
    if (command === 'ROBOT_START') {
        if (automationRunning) {
            console.log('Automation is already running. Ignoring redundant ROBOT_START command.');
            addConsoleMessage('Automation already running - ignoring duplicate command', 'warn');
            return;
        }
        // Clear fog block
        isFogBlocked = false;
        console.log('ENV_ALERT confirmed stable! Starting robot automation...');
        addConsoleMessage('🤖 Robot Automation Started - Processing Cargo', 'success');
        stopAllAutomation = false;
        startAutomationSequence();
    } 
    else if (command === 'ROBOT_IDLE') {
        console.log('ENV_OK confirmed stable! Allowing current cargo to complete...');
        addConsoleMessage('Robot automation stopping after current cycle', 'info');
        
        if (automationRunning) {
            console.log('Current automation will complete, no new cycles will start...');
            stopAllAutomation = true;
        }
        
        console.log('Robot automation will complete current cycle.');
    }
    else if (command === 'FOG_BLOCK') {
        console.log('FOG_BLOCK received! Stopping automation and activating fog...');
        addConsoleMessage('⚠️ FOG ALERT: Environment Hazard Detected - Stopping Operations', 'error');
        
        // Activate fog block
        isFogBlocked = true;
        stopAllAutomation = true;
        
        // Force stop current automation immediately
        if (automationRunning) {
            clearAutomationObjects();
            automationRunning = false;
            switchBackToDoorView();
        }
        
        // Update button state
        autoButton.disabled = true;
        autoButton.innerText = 'Environment Blocked';
    }
}

// Function to reset door status on server when door sequence completes
async function resetDoorStatusOnServer() {
    try {
        console.log('Resetting door status on server...');
        const response = await fetch(RESET_DOOR_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        if (response.ok) {
            const data = await response.json();
            console.log('Door status reset successful:', data.message);
        } else {
            console.error('Failed to reset door status:', response.statusText);
        }
    } catch (error) {
        console.error('Error resetting door status:', error);
    }
}

function init() {
    // Basic Scene Setup
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x222233);
    scene.fog = new THREE.Fog(0x222233, 40, 300);

    const canvasContainer = document.getElementById('canvas-container');
    const containerWidth = canvasContainer.clientWidth;
    const containerHeight = canvasContainer.clientHeight;
    
    camera = new THREE.PerspectiveCamera(75, containerWidth / containerHeight, 0.1, 1000);
    camera.position.set(10, 50, 100);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(containerWidth, containerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    
    // Standard rendering settings
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0; // Standard exposure
    
    canvasContainer.appendChild(renderer.domElement);

    // Camera controls
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.screenSpacePanning = false;
    controls.minDistance = 2;
    controls.maxDistance = 300;
    controls.maxPolarAngle = Math.PI / 2;
    
    // Enable zoom with mouse wheel
    controls.enableZoom = true;
    controls.zoomSpeed = 1.2;
    
    // Enable panning
    controls.enablePan = true;
    controls.panSpeed = 0.8;
    
    // Enable rotation
    controls.enableRotate = true;
    controls.rotateSpeed = 0.5;

    // Create bright sky background
    createSkyBackground();
    
    // Enhanced Lighting System for Better Visibility
    const ambientLight = new THREE.AmbientLight(0x606060, 0.8); // Brighter neutral ambient light
    scene.add(ambientLight);

    // Main directional light - Enhanced for outside brightness
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.8); // Increased brightness
    directionalLight.position.set(20, 40, 30);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    directionalLight.shadow.camera.far = 150;
    directionalLight.shadow.camera.left = -80;
    directionalLight.shadow.camera.right = 80;
    directionalLight.shadow.camera.top = 80;
    directionalLight.shadow.camera.bottom = -80;
    scene.add(directionalLight);
    
    // Enhanced fill light for balanced lighting
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.7); // Increased intensity
    fillLight.position.set(-20, 30, -15);
    fillLight.castShadow = false;
    scene.add(fillLight);
    
    // Additional directional light for better coverage
    const backLight = new THREE.DirectionalLight(0xffffff, 0.6);
    backLight.position.set(-30, 35, -40);
    backLight.castShadow = false;
    scene.add(backLight);
    
    // Side lighting for better interior illumination
    const sideLight1 = new THREE.DirectionalLight(0xffffff, 0.5);
    sideLight1.position.set(40, 25, 0);
    sideLight1.castShadow = false;
    scene.add(sideLight1);
    
    const sideLight2 = new THREE.DirectionalLight(0xffffff, 0.5);
    sideLight2.position.set(-40, 25, 0);
    sideLight2.castShadow = false;
    scene.add(sideLight2);

    // --- CREATE LABORATORY ASSETS ---
    createEnhancedIndustrialTextures(); // Initialize enhanced industrial materials first
    createRoom();
    createDoors();
    
    // Store blueprint materials after doors are created
    setTimeout(() => {
        storeBlueprintMaterials();
    }, 100); // Small delay to ensure doors are fully created
    
    createCabinets();
    createShelves();
    createFumeHood();
    createMetallicTable();
    
    // Human model removed as requested
     // ✅ Create tunnel AFTER scene exists
     const outerRadius = 5.5;
     const innerRadius = 4;
     const tunnelLength = 10;
     const tunnelSegments = 32;
 
     const tunnelGeometry = createTunnel(outerRadius, innerRadius, tunnelLength, tunnelSegments);
     const tunnelMaterial = new THREE.MeshBasicMaterial({ color: 0x111111 });
     const tunnelMesh = new THREE.Mesh(tunnelGeometry, tunnelMaterial);
     tunnelMesh.position.set(20, 0, -45);
     scene.add(tunnelMesh);

     // ✅ Create duplicate tunnel near the left wall
     const tunnelGeometry2 = createTunnel(outerRadius, innerRadius, tunnelLength, tunnelSegments);
     const tunnelMaterial2 = new THREE.MeshBasicMaterial({ color: 0x111111 });
     const tunnelMesh2 = new THREE.Mesh(tunnelGeometry2, tunnelMaterial2);
     tunnelMesh2.position.set(-58.5, 0, 27); // Position near left wall
     tunnelMesh2.rotation.set(0, Math.PI / 3, 0); // Rotate to align with left wall
     scene.add(tunnelMesh2);
    // Add wall sconces for ambient lighting
    // // Left wall sconces
    // createWallSconce(-59, 12, -10, 0);
    // createWallSconce(-59, 12, 10, 0);
    // createWallSconce(-59, 12, 30, 0);
    // // Right wall sconces
    // createWallSconce(59, 12, -10, Math.PI);
    // createWallSconce(59, 12, 10, Math.PI);
    // createWallSconce(59, 12, 30, Math.PI);
    // // Back wall sconces
    // createWallSconce(-30, 12, -44, Math.PI/2);
    // createWallSconce(0, 12, -44, Math.PI/2);
    // createWallSconce(30, 12, -44, Math.PI/2);
    
   
    
    // Add spotlights to highlight specific areas
    // Spotlight for the ESP32 assembly
    createSpotlight(10, 20, -2, 10, 2, -5, 0xaaffaa); // Green tint for the ESP32
    // Spotlight for the fume hood
    createSpotlight(40, 20, -40, 45, 5, -42, 0xffffaa); // Warm light for the fume hood
    // Spotlight for the tunnel
    createSpotlight(15, 20, -35, 20, 0, -40, 0xaaaaff); // Blue tint for the tunnel
    // Spotlight for the robot area
    createSpotlight(5, 20, -5, 5, 0, -9, 0xffaaaa); // Red tint for the robot
    // Human model scaling removed

    // --- ADD ESP32 ASSEMBLY ---
    const esp32Assembly = createFullESP32Assembly(); 
    const esp32Group = esp32Assembly.getESP32Group();

    // Position the ESP32 board inside your lab
    esp32Group.position.set(6, 10, 60.5);   // adjust coordinates as needed
    esp32Group.scale.set(0.3, 0.3, 0.3);       // scale it up to match lab size
    esp32Group.rotation.set(1.6, 0, 0); // Rotate ESP32 to face the robot
    scene.add(esp32Group);


      // --- ADD ESP32 ASSEMBLY ---
      const esp32Assemblyacess = createFullESP32Assembly(); 
      const esp32Group1 = esp32Assemblyacess.getESP32Group();
  
      // Position the ESP32 board inside your lab
      esp32Group1.position.set(9, 10, 60.5);   // adjust coordinates as needed
      esp32Group1.scale.set(0.3, 0.3, 0.3);       // scale it up to match lab size
      esp32Group1.rotation.set(1.6, 0, 0); // Rotate ESP32 to face the robot
      scene.add(esp32Group1);

      // --- ADD ESP32 ON FRONT WALL BACKSIDE ---
      const esp32FrontWall = createFullESP32Assembly();
      const esp32Group2 = esp32FrontWall.getESP32Group();
      esp32Group2.position.set(-9, 8, 44.5);   // Front wall backside
      esp32Group2.scale.set(0.5, 0.5, 0.5);
      esp32Group2.rotation.set(-1.5, Math.PI, 0); // Rotate to face inward
      scene.add(esp32Group2);

      // --- ADD ESP32 ON RIGHT WALL ---
      const esp32RightWall = createFullESP32Assembly();
      const esp32Group3 = esp32RightWall.getESP32Group();
      esp32Group3.position.set(59.5, 10, -3);   // Right wall
      esp32Group3.scale.set(0.5, 0.5, 0.5);
      esp32Group3.rotation.set(0,0, 1.5); // Rotate to face inward
      scene.add(esp32Group3);

      // --- ADD ESP32 ON LEFT WALL ---
      const esp32LeftWall = createFullESP32Assembly();
      const esp32Group4 = esp32LeftWall.getESP32Group();
      esp32Group4.position.set(59.5, 10, 3);   // Left wall
      esp32Group4.scale.set(0.5, 0.5, 0.5);
      esp32Group4.rotation.set(0, 0, 1.5); // Rotate to face inward
      scene.add(esp32Group4);

      // --- ADD ESP32 NEAR ROBOT ON TABLE 1 ---
      const esp32RobotTable1 = createFullESP32Assembly();
      const esp32Group5 = esp32RobotTable1.getESP32Group();
      esp32Group5.position.set(-8, 4.5, -8);   // Near robot area on table
      esp32Group5.scale.set(0.4, 0.4, 0.4);
      esp32Group5.rotation.set(0, 8, 0); // Flat on table
      scene.add(esp32Group5);

      // --- ADD ESP32 NEAR ROBOT ON TABLE 2 ---
      const esp32RobotTable2 = createFullESP32Assembly();
      const esp32Group6 = esp32RobotTable2.getESP32Group();
      esp32Group6.position.set(-8, 4.5, -4);   // Near robot area on table
      esp32Group6.scale.set(0.4, 0.4, 0.4);
      esp32Group6.rotation.set(0, 0, 0); // Flat on table
      scene.add(esp32Group6);

      // --- ADD ESP32 ON CENTER TABLE ---
      const esp32CenterTable = createFullESP32Assembly();
      const esp32Group7 = esp32CenterTable.getESP32Group();
      esp32Group7.position.set(-12, 4.5, -4);   // Center lab area on table
      esp32Group7.scale.set(0.4, 0.4, 0.4);
      esp32Group7.rotation.set(0, 0, 0); // Flat on table
      scene.add(esp32Group7);


    // Ceiling Lights
    const newLightHeight = 24.5;
    // Original ceiling lights
    createCeilingLight(0, newLightHeight, 0);
    createCeilingLight(25, newLightHeight, 0);
    createCeilingLight(-25, newLightHeight, 0);
    
    // Additional ceiling lights in a grid pattern
    createCeilingLight(0, newLightHeight, -30);
    createCeilingLight(25, newLightHeight, -30);
    createCeilingLight(-25, newLightHeight, -30);
    createCeilingLight(0, newLightHeight, 30);
    createCeilingLight(25, newLightHeight, 30);
    createCeilingLight(-25, newLightHeight, 30);

    // --- CREATE ROBOT ASSETS ---
    const robotContainer = new THREE.Group();
    robotContainer.position.copy(robotSetupConfig.position);
    robotContainer.scale.set(robotSetupConfig.scale, robotSetupConfig.scale, robotSetupConfig.scale);
    scene.add(robotContainer);

    robot_arm = createRobot();
    robotContainer.add(robot_arm);
    createFurnace();

    // --- NEW: Create rails and calculate animation paths ---
    // Changed: This function now returns a single path for animation
    const railSystem = createSinglePathAndVisualRails(robotSetupConfig.path, robotContainer);
    cargoRailPath = railSystem.path; // Store the single, central path
    progressAtPickup = railSystem.progressAtPickup;
    cargoStartPosition = railSystem.startPosition;
    robotContainer.add(railSystem.rails); // Add the visual rails to the scene

    // Event Listeners
    autoButton.addEventListener('click', startAutomationSequence);
    window.addEventListener('resize', onWindowResize, false);

    // ESP32 Click Event Listeners
    setupESP32ClickListeners(esp32Group, esp32Group1, esp32Group2, esp32Group3, esp32Group4, esp32Group5, esp32Group6, esp32Group7);
    
    // Create ESP32 time labels
    createESP32TimeLabels([esp32Group, esp32Group1, esp32Group2, esp32Group3, esp32Group4, esp32Group5, esp32Group6, esp32Group7]);

    // Add keyboard controls for camera navigation
    document.addEventListener('keydown', (event) => {
        const moveDistance = 5;
        
        switch(event.code) {
            case 'KeyW': // Move forward
                camera.position.z -= moveDistance;
                break;
            case 'KeyS': // Move backward
                camera.position.z += moveDistance;
                break;
            case 'KeyA': // Move left
                camera.position.x -= moveDistance;
                break;
            case 'KeyD': // Move right
                camera.position.x += moveDistance;
                break;
            case 'KeyQ': // Move up
                camera.position.y += moveDistance;
                break;
            case 'KeyE': // Move down
                camera.position.y -= moveDistance;
                break;
            case 'Equal': // Zoom in (+ key)
            case 'NumpadAdd':
                camera.position.multiplyScalar(0.9);
                break;
            case 'Minus': // Zoom out (- key)
            case 'NumpadSubtract':
                camera.position.multiplyScalar(1.1);
                break;
            case 'KeyR': // Reset camera position
                camera.position.set(10, 50, 100);
                controls.target.set(0, 0, 0);
                break;
        }
        controls.update();
    });

    
function endAutomationCycle() {
    // First reset robot arm to initial position
    if (robot_arm) {
        // Reset all rotations
        robot_arm.rotation.y = 0;
        
        if (robot_arm.children[3]) {
            robot_arm.children[3].rotation.z = 0; // Reset base joint
            
            if (robot_arm.children[3].children[0]) {
                const upperArm = robot_arm.children[3].children[0];
                upperArm.rotation.z = 0;
                
                if (upperArm.children[2]) {
                    upperArm.children[2].rotation.z = 0;
                    
                    if (upperArm.children[2].children[0]) {
                        upperArm.children[2].children[0].rotation.z = 0;
                    }
                }
            }
        }
    }
    
    automationRunning = false;   // robot is free again
    currentParcel = null;        // clear parcel
    currentCargo = null;         // clear cargo
    boxCount++;                  // count how many parcels processed

    addConsoleMessage(`📦 Cargo Cycle Complete - Total Processed: ${boxCount} packages`, 'success');

    // If automation is still allowed, continue automatically
    if (!stopAllAutomation && boxCount < totalParcelsToProcess) {
        setTimeout(() => {
            // Add an additional position check before starting next cycle
            if (robot_arm && robot_arm.rotation.y !== 0) {
                console.log('Correcting robot rotation before next cycle');
                robot_arm.rotation.y = 0;
            }
            startAutomationSequence();  // run again
        }, 1000); // Small delay to ensure complete reset
    } else {
        addConsoleMessage('Automation fully stopped.', 'info');
        switchBackToDoorView();
    }
}

    // Start
    animate();
    pollDoorStatus();
    pollRobotStatus();
    
    // Turn on all lights when the scene starts - enhanced brightness
    controlAllLights(2.0, 0.5);
    
    // Initialize door preview
    initDoorPreview();
    
    // Initialize console
    initConsole();
    
    // Initialize Socket.IO connection for robot animation
    initSocketConnection();
}

// --- CONSOLE FUNCTIONS ---
function initConsole() {
    consoleOutput = document.getElementById('console-output');
    if (consoleOutput) {
        addConsoleMessage('🚀 Molding Station – Manufacturing Unit Starting Up...', 'system');
        addConsoleMessage('✅ 3D Manufacturing Environment Loaded Successfully', 'success');
        addConsoleMessage('🔗 Door Control System Ready', 'info');
        addConsoleMessage('📡 MQTT Communication Active', 'info');
        addConsoleMessage('🤖 Robot Automation System Online', 'success');
        addConsoleMessage('📊 All ESP32 Devices Connected', 'info');
        addConsoleMessage('✨ Manufacturing Unit Ready for Operation', 'success');
        console.log('Console dashboard initialized');
    }
}

function addConsoleMessage(message, type = 'info') {
    if (!consoleOutput) return;
    
    const now = new Date();
    const timestamp = now.toLocaleTimeString('en-US', { 
        hour12: false, 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit' 
    });
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `console-line console-${type}`;
    messageDiv.innerHTML = `
        <span class="console-timestamp">${timestamp}</span>
        <span class="console-message">${message}</span>
    `;
    
    consoleOutput.appendChild(messageDiv);
    
    // Remove old messages if we exceed the limit
    const lines = consoleOutput.children;
    if (lines.length > maxConsoleLines) {
        consoleOutput.removeChild(lines[0]);
    }
    
    // Auto-scroll to bottom
    consoleOutput.scrollTop = consoleOutput.scrollHeight;
}

function clearConsole() {
    if (consoleOutput) {
        consoleOutput.innerHTML = '';
        addConsoleMessage('Console cleared', 'info');
    }
}

// --- SOCKET.IO CONNECTION FUNCTIONS ---
function initSocketConnection() {
    // Load Socket.IO dynamically if not already loaded
    if (typeof io === 'undefined') {
        const script = document.createElement('script');
        script.src = 'https://cdn.socket.io/4.7.2/socket.io.min.js';
        script.onload = function() {
            setupSocketConnection();
        };
        script.onerror = function() {
            console.error('Failed to load Socket.IO library');
            addConsoleMessage('Failed to load Socket.IO - robot animation may not work', 'error');
        };
        document.head.appendChild(script);
    } else {
        setupSocketConnection();
    }
}

function setupSocketConnection() {
    try {
        // Connect to the Socket.IO server
        const socket = io('http://localhost:5000');
        
        socket.on('connect', () => {
            console.log('Connected to Socket.IO server');
            addConsoleMessage('Socket.IO connection established', 'info');
        });
        
        socket.on('disconnect', () => {
            console.log('Disconnected from Socket.IO server');
            addConsoleMessage('Socket.IO connection lost', 'warn');
        });
        
        // Listen for robot animation events
        socket.on('robot_animation', (data) => {
            console.log('Robot animation event received:', data);
            addConsoleMessage(`Robot animation triggered for ${data.duration}ms`, 'info');
            triggerRobotAnimation(data.duration);
        });
        
        // Listen for MQTT messages (optional - for debugging)
        socket.on('mqtt_message', (data) => {
            console.log('MQTT message received via Socket.IO:', data);
            addConsoleMessage(`MQTT: ${data.topic} → ${data.message}`, 'debug');
        });
        
    } catch (error) {
        console.error('Error setting up Socket.IO connection:', error);
        addConsoleMessage('Socket.IO setup failed: ' + error.message, 'error');
    }
}

function triggerRobotAnimation(duration) {
    if (!robot_arm) {
        console.log('Robot arm not found - cannot animate');
        addConsoleMessage('Robot arm not available for animation', 'warn');
        return;
    }
    
    console.log(`Starting robot animation for ${duration}ms`);
    addConsoleMessage(`Robot animation started (${duration/1000}s)`, 'info');
    
    // Start the automation sequence if not already running
    if (!automationRunning) {
        console.log('Starting automation sequence from Socket.IO trigger');
        startAutomationSequence();
    } else {
        console.log('Automation already running - animation trigger acknowledged');
        addConsoleMessage('Robot already active - animation acknowledged', 'info');
    }
}

// --- DOOR PREVIEW FUNCTIONS ---
function initDoorPreview() {
    // Get DOM elements
    doorPreviewContainer = document.getElementById('door-preview-container');
    doorPreviewCanvas = document.getElementById('door-preview-canvas');
    
    if (!doorPreviewContainer || !doorPreviewCanvas) {
        console.error('Door preview elements not found');
        return;
    }
    
    // Calculate size based on sidebar container
    const sidebarWidth = window.innerWidth * 0.3;
    const previewWidth = sidebarWidth - 28; // Account for margins
    const previewHeight = (previewWidth * 10) / 13; // 16:9 aspect ratio
    
    // Create both cameras for viewing the MAIN scene
    // Front camera (3D view) - positioned closer for better fit in sidebar
    frontCamera = new THREE.PerspectiveCamera(45, previewWidth/previewHeight, 0.1, 1000);
    frontCamera.position.set(0, 10, 88); // Closer position for better fit in sidebar
    frontCamera.lookAt(0, 8, 52.5); // Look at center between both doors (main door at Z=45, small door at Z=60)
    
    // Motor camera (shows robot/motor area from upper angle when automation is running)
    motorCamera = new THREE.PerspectiveCamera(60, previewWidth/previewHeight, 0.1, 1000);
    motorCamera.position.set(5, 35, -2); // High overhead position above robot area
    motorCamera.lookAt(5, 0, -9); // Look down at robot/motor area from above
    
    // Blueprint camera (top-down orthographic view) - optimized for sidebar fit
    const orthoSize = 30; // Reduced size for better fit in sidebar container
    blueprintCamera = new THREE.OrthographicCamera(-orthoSize, orthoSize, orthoSize * (previewHeight/previewWidth), -orthoSize * (previewHeight/previewWidth), 0.1, 1000);
    blueprintCamera.position.set(0, 120, 52.5); // Higher position centered between doors
    blueprintCamera.lookAt(0, 0, 52.5); // Look down at center of door area
    
    // Set initial camera
    doorPreviewCamera = frontCamera;
    
    // Create preview renderer
    doorPreviewRenderer = new THREE.WebGLRenderer({ 
        canvas: doorPreviewCanvas,
        antialias: true 
    });
    
    doorPreviewRenderer.setSize(previewWidth, previewHeight);
    doorPreviewRenderer.shadowMap.enabled = true;
    doorPreviewRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
    
    // Create blueprint materials for switching
    createBlueprintMaterials();
    
    // Show the door preview immediately
    showDoorPreview();
    
    addConsoleMessage('Door preview cameras optimized - human eye perspective showing full door area', 'info');
    console.log('Door preview initialized - rendering main scene with dual cameras');
}

function createBlueprintMaterials() {
    // Blueprint-style materials with white lines on dark blue background
    blueprintMaterials.door = new THREE.MeshBasicMaterial({ 
        color: 0x00aaff, 
        wireframe: false,
        transparent: true,
        opacity: 0.8
    });
    
    blueprintMaterials.doorOutline = new THREE.LineBasicMaterial({ 
        color: 0xffffff, 
        linewidth: 2 
    });
    
    blueprintMaterials.wall = new THREE.MeshBasicMaterial({ 
        color: 0x004488,
        transparent: true,
        opacity: 0.6
    });
    
    blueprintMaterials.wallOutline = new THREE.LineBasicMaterial({ 
        color: 0xaaaaaa, 
        linewidth: 1 
    });
    
    blueprintMaterials.insideFloor = new THREE.MeshBasicMaterial({ 
        color: 0x003366, // Lighter blue for inside floor
        transparent: true,
        opacity: 0.4
    });
    
    blueprintMaterials.outsideFloor = new THREE.MeshBasicMaterial({ 
        color: 0x001122, // Darker blue for outside floor
        transparent: true,
        opacity: 0.3
    });
}

function storeBlueprintMaterials() {
    // Store blueprint materials in main scene objects for switching
    if (mainDoor) {
        mainDoor.userData.originalMaterial = mainDoor.material;
        mainDoor.userData.blueprintMaterial = blueprintMaterials.door;
    }
    
    if (smallDoor) {
        smallDoor.userData.originalMaterial = smallDoor.material;
        smallDoor.userData.blueprintMaterial = blueprintMaterials.door;
    }
    
    // Store materials for other scene objects (walls, floor, etc.)
    scene.traverse((child) => {
        if (child.isMesh && !child.userData.originalMaterial) {
            child.userData.originalMaterial = child.material;
            
            // Assign appropriate blueprint materials based on object type and position
            if (child.material && child.material.color) {
                const color = child.material.color.getHex();
                
                // Check if it's a floor by rotation (floors are rotated -90 degrees on X axis)
                if (child.rotation.x === -Math.PI / 2) {
                    // Determine floor type by size and position
                    if (child.geometry.parameters.width === 120 && child.geometry.parameters.height === 90) {
                        // Inside room floor
                        child.userData.blueprintMaterial = blueprintMaterials.insideFloor;
                        child.userData.floorType = 'inside';
                    } else if (child.geometry.parameters.width === 400 && child.geometry.parameters.height === 400) {
                        // Outside area floor
                        child.userData.blueprintMaterial = blueprintMaterials.outsideFloor;
                        child.userData.floorType = 'outside';
                    } else {
                        child.userData.blueprintMaterial = blueprintMaterials.wall;
                    }
                } else if (color === 0x664422 || color === 0x886644) {
                    // Door materials
                    child.userData.blueprintMaterial = blueprintMaterials.door;
                } else if (color === 0xf0f0f0) {
                    // Wall materials
                    child.userData.blueprintMaterial = blueprintMaterials.wall;
                } else {
                    // Default to wall material for other objects
                    child.userData.blueprintMaterial = blueprintMaterials.wall;
                }
            }
        }
    });
}

function showDoorPreview() {
    if (doorPreviewContainer) {
        doorPreviewContainer.style.display = 'block';
        isDoorPreviewActive = true;
        console.log('Door preview shown');
    }
}

function hideDoorPreview() {
    if (doorPreviewContainer) {
        doorPreviewContainer.style.display = 'none';
        isDoorPreviewActive = false;
        console.log('Door preview hidden');
    }
}

function restoreOriginalMaterials() {
    // Traverse the scene and restore original materials
    scene.traverse((child) => {
        if (child.isMesh && child.userData.originalMaterial) {
            child.material = child.userData.originalMaterial;
        }
    });
}

function applyBlueprintMaterials() {
    // Traverse the scene and apply blueprint materials
    scene.traverse((child) => {
        if (child.isMesh && child.userData.blueprintMaterial) {
            child.material = child.userData.blueprintMaterial;
        }
    });
}

function switchDoorCamera(mode) {
    if (!doorPreviewRenderer) return;
    
    // Remove active class from all buttons
    document.querySelectorAll('.camera-switch-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    if (mode === 'front') {
        doorPreviewCamera = frontCamera;
        document.querySelector('.camera-switch-btn[onclick*="front"]').classList.add('active');
        
        // Switch main scene back to 3D materials
        restoreOriginalMaterials();
        scene.background = new THREE.Color(0x87CEEB); // Sky blue background
        
    } else if (mode === 'blueprint') {
        doorPreviewCamera = blueprintCamera;
        document.querySelector('.camera-switch-btn[onclick*="blueprint"]').classList.add('active');
        
        // Switch main scene to blueprint materials
        applyBlueprintMaterials();
        scene.background = new THREE.Color(0x001122); // Dark navy background
        
    } else if (mode === 'motor') {
        doorPreviewCamera = motorCamera;
        // Keep 3D materials for motor view
        restoreOriginalMaterials();
        scene.background = new THREE.Color(0x87CEEB); // Sky blue background
    }
    
    currentCameraMode = mode;
    addConsoleMessage(`Switched to ${mode} camera mode`, 'debug');
    console.log(`Switched to ${mode} camera mode`);
}

// Function to automatically switch to motor view when automation starts
function switchToMotorView() {
    if (motorCamera) {
        switchDoorCamera('motor');
        addConsoleMessage('Camera switched to motor view', 'info');
    }
}

// Function to switch back to door view when automation stops
function switchBackToDoorView() {
    switchDoorCamera('front');
    addConsoleMessage('Camera switched back to door view', 'info');
}

function updateDoorPreview() {
    if (!isDoorPreviewActive || !doorPreviewRenderer || !scene || !doorPreviewCamera) {
        return;
    }
    
    // Render the MAIN scene with the door preview camera
    doorPreviewRenderer.render(scene, doorPreviewCamera);
}

// --- SKY AND ENVIRONMENT FUNCTIONS ---
function createSkyBackground() {
    // Create a highly realistic sky
    const skyCanvas = document.createElement('canvas');
    skyCanvas.width = 1024;
    skyCanvas.height = 512;
    const skyContext = skyCanvas.getContext('2d');
    
    // Create realistic atmospheric gradient (horizon to zenith)
    const gradient = skyContext.createLinearGradient(0, 512, 0, 0);
    gradient.addColorStop(0, '#E6F3FF');    // Very light blue at horizon
    gradient.addColorStop(0.1, '#CCE7FF'); // Light horizon blue
    gradient.addColorStop(0.25, '#99D6FF'); // Mid-horizon blue
    gradient.addColorStop(0.5, '#66C2FF');  // Sky blue
    gradient.addColorStop(0.75, '#4DB8FF'); // Deeper blue
    gradient.addColorStop(0.9, '#3399FF');  // Deep sky blue
    gradient.addColorStop(1, '#1E7FCC');    // Zenith blue
    
    skyContext.fillStyle = gradient;
    skyContext.fillRect(0, 0, 1024, 512);
    
    // Add realistic cloud formations
    function drawRealisticCloud(x, y, size, opacity) {
        skyContext.save();
        skyContext.globalAlpha = opacity;
        
        // Create cloud gradient for 3D effect
        const cloudGradient = skyContext.createRadialGradient(x, y, 0, x, y, size);
        cloudGradient.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
        cloudGradient.addColorStop(0.4, 'rgba(255, 255, 255, 0.7)');
        cloudGradient.addColorStop(0.7, 'rgba(240, 240, 240, 0.4)');
        cloudGradient.addColorStop(1, 'rgba(220, 220, 220, 0.1)');
        
        skyContext.fillStyle = cloudGradient;
        
        // Draw multiple overlapping circles for realistic cloud shape
        const numPuffs = 5 + Math.floor(Math.random() * 4);
        for (let i = 0; i < numPuffs; i++) {
            const puffX = x + (Math.random() - 0.5) * size * 1.5;
            const puffY = y + (Math.random() - 0.5) * size * 0.6;
            const puffSize = size * (0.3 + Math.random() * 0.4);
            
            skyContext.beginPath();
            skyContext.arc(puffX, puffY, puffSize, 0, 2 * Math.PI);
            skyContext.fill();
        }
        
        skyContext.restore();
    }
    
    // Add various cloud layers
    // High altitude thin clouds
    for (let i = 0; i < 6; i++) {
        const x = Math.random() * 1024;
        const y = Math.random() * 150 + 50; // Upper sky
        const size = Math.random() * 40 + 20;
        drawRealisticCloud(x, y, size, 0.3);
    }
    
    // Mid-level cumulus clouds
    for (let i = 0; i < 4; i++) {
        const x = Math.random() * 1024;
        const y = Math.random() * 200 + 150; // Mid sky
        const size = Math.random() * 80 + 50;
        drawRealisticCloud(x, y, size, 0.6);
    }
    
    // Lower puffy clouds
    for (let i = 0; i < 3; i++) {
        const x = Math.random() * 1024;
        const y = Math.random() * 150 + 300; // Lower sky
        const size = Math.random() * 120 + 80;
        drawRealisticCloud(x, y, size, 0.8);
    }
    
    // Add subtle atmospheric haze near horizon
    const hazeGradient = skyContext.createLinearGradient(0, 400, 0, 512);
    hazeGradient.addColorStop(0, 'rgba(255, 255, 255, 0)');
    hazeGradient.addColorStop(1, 'rgba(255, 255, 255, 0.15)');
    
    skyContext.fillStyle = hazeGradient;
    skyContext.fillRect(0, 400, 1024, 112);
    
    const skyTexture = new THREE.CanvasTexture(skyCanvas);
    skyTexture.wrapS = THREE.RepeatWrapping;
    skyTexture.repeat.x = 2; // Repeat horizontally for seamless sky
    
    // Create sky dome
    const skyGeometry = new THREE.SphereGeometry(800, 64, 32);
    const skyMaterial = new THREE.MeshBasicMaterial({
        map: skyTexture,
        side: THREE.BackSide,
        fog: false // Sky shouldn't be affected by fog
    });
    
    const skySphere = new THREE.Mesh(skyGeometry, skyMaterial);
    scene.add(skySphere);
    
    // Set realistic scene background color
    scene.background = new THREE.Color(0x87CEEB);
}

// --- MATERIAL CREATION FUNCTIONS ---
function createEnhancedIndustrialTextures() {
    // Create enhanced industrial wall texture
    const wallCanvas = document.createElement('canvas');
    wallCanvas.width = 512;
    wallCanvas.height = 512;
    const wallContext = wallCanvas.getContext('2d');
    
    // Enhanced industrial colors
    const baseColor = '#2a2a2a';
    const panelColor = '#3d3d3d';
    const rivetColor = '#4a4a4a';
    const rustColor = '#8B4513';
    const weldColor = '#1a1a1a';
    const highlightColor = '#6a6a6a';
    
    // Fill base
    wallContext.fillStyle = baseColor;
    wallContext.fillRect(0, 0, 512, 512);
    
    // Create large industrial panels
    const panelSize = 128;
    for (let x = 0; x < 512; x += panelSize) {
        for (let y = 0; y < 512; y += panelSize) {
            // Main panel with metallic gradient
            const gradient = wallContext.createLinearGradient(x, y, x + panelSize, y + panelSize);
            gradient.addColorStop(0, panelColor);
            gradient.addColorStop(0.3, '#454545');
            gradient.addColorStop(0.7, '#353535');
            gradient.addColorStop(1, '#2d2d2d');
            wallContext.fillStyle = gradient;
            wallContext.fillRect(x + 4, y + 4, panelSize - 8, panelSize - 8);
            
            // Heavy weld seams
            wallContext.strokeStyle = weldColor;
            wallContext.lineWidth = 6;
            wallContext.strokeRect(x + 2, y + 2, panelSize - 4, panelSize - 4);
            
            // Industrial rivets at corners and edges
            const rivetPositions = [
                [x + 15, y + 15], [x + panelSize - 15, y + 15],
                [x + 15, y + panelSize - 15], [x + panelSize - 15, y + panelSize - 15],
                [x + panelSize/2, y + 15], [x + panelSize/2, y + panelSize - 15],
                [x + 15, y + panelSize/2], [x + panelSize - 15, y + panelSize/2]
            ];
            
            rivetPositions.forEach(([rx, ry]) => {
                // Rivet shadow
                wallContext.fillStyle = '#1a1a1a';
                wallContext.beginPath();
                wallContext.arc(rx + 1, ry + 1, 4, 0, Math.PI * 2);
                wallContext.fill();
                
                // Rivet body
                wallContext.fillStyle = rivetColor;
                wallContext.beginPath();
                wallContext.arc(rx, ry, 4, 0, Math.PI * 2);
                wallContext.fill();
                
                // Rivet highlight
                wallContext.fillStyle = highlightColor;
                wallContext.beginPath();
                wallContext.arc(rx - 1, ry - 1, 2, 0, Math.PI * 2);
                wallContext.fill();
            });
            
            // Add corrugated texture lines
            wallContext.strokeStyle = '#333333';
            wallContext.lineWidth = 2;
            for (let i = 1; i < 8; i++) {
                const lineX = x + (i * panelSize / 8);
                wallContext.beginPath();
                wallContext.moveTo(lineX, y + 8);
                wallContext.lineTo(lineX, y + panelSize - 8);
                wallContext.stroke();
            }
        }
    }
    
    // Add industrial wear, rust spots, and scratches
    for (let i = 0; i < 80; i++) {
        const rx = Math.random() * 512;
        const ry = Math.random() * 512;
        const size = Math.random() * 12 + 3;
        const opacity = Math.random() * 0.6 + 0.2;
        
        wallContext.fillStyle = `rgba(139, 69, 19, ${opacity})`;
        wallContext.beginPath();
        wallContext.arc(rx, ry, size, 0, Math.PI * 2);
        wallContext.fill();
    }
    
    // Add scratches and wear marks
    wallContext.strokeStyle = 'rgba(0, 0, 0, 0.4)';
    wallContext.lineWidth = 2;
    for (let i = 0; i < 40; i++) {
        const startX = Math.random() * 512;
        const startY = Math.random() * 512;
        const endX = startX + (Math.random() - 0.5) * 60;
        const endY = startY + (Math.random() - 0.5) * 30;
        
        wallContext.beginPath();
        wallContext.moveTo(startX, startY);
        wallContext.lineTo(endX, endY);
        wallContext.stroke();
    }
    
    const wallTexture = new THREE.CanvasTexture(wallCanvas);
    wallTexture.wrapS = THREE.RepeatWrapping;
    wallTexture.wrapT = THREE.RepeatWrapping;
    wallTexture.repeat.set(2, 2);
    
    wallMaterial = new THREE.MeshStandardMaterial({ 
        map: wallTexture, 
        roughness: 0.8, 
        metalness: 0.9,
        normalScale: new THREE.Vector2(0.5, 0.5)
    });
}

function createEnhancedIndustrialFloor() {
    // Create enhanced industrial diamond plate floor texture
    const floorCanvas = document.createElement('canvas');
    floorCanvas.width = 512;
    floorCanvas.height = 512;
    const floorContext = floorCanvas.getContext('2d');
    
    // Industrial floor colors
    const baseColor = '#2d2d2d';
    const plateColor = '#3a3a3a';
    const diamondColor = '#454545';
    const highlightColor = '#505050';
    const shadowColor = '#1a1a1a';
    const wearColor = '#252525';
    
    // Fill base
    floorContext.fillStyle = baseColor;
    floorContext.fillRect(0, 0, 512, 512);
    
    // Create diamond plate pattern
    const plateSize = 64;
    for (let x = 0; x < 512; x += plateSize) {
        for (let y = 0; y < 512; y += plateSize) {
            // Base plate with gradient
            const gradient = floorContext.createRadialGradient(
                x + plateSize/2, y + plateSize/2, 0,
                x + plateSize/2, y + plateSize/2, plateSize/2
            );
            gradient.addColorStop(0, plateColor);
            gradient.addColorStop(0.7, '#353535');
            gradient.addColorStop(1, '#2a2a2a');
            floorContext.fillStyle = gradient;
            floorContext.fillRect(x + 3, y + 3, plateSize - 6, plateSize - 6);
            
            // Plate border/weld seam
            floorContext.strokeStyle = shadowColor;
            floorContext.lineWidth = 4;
            floorContext.strokeRect(x + 2, y + 2, plateSize - 4, plateSize - 4);
            
            // Diamond pattern - more detailed
            const centerX = x + plateSize / 2;
            const centerY = y + plateSize / 2;
            const diamondSize = 12;
            const spacing = 16;
            
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    const diamondX = centerX + dx * spacing;
                    const diamondY = centerY + dy * spacing;
                    
                    // Diamond shadow
                    floorContext.fillStyle = shadowColor;
                    floorContext.beginPath();
                    floorContext.moveTo(diamondX + 1, diamondY - diamondSize/2 + 1);
                    floorContext.lineTo(diamondX + diamondSize/2 + 1, diamondY + 1);
                    floorContext.lineTo(diamondX + 1, diamondY + diamondSize/2 + 1);
                    floorContext.lineTo(diamondX - diamondSize/2 + 1, diamondY + 1);
                    floorContext.closePath();
                    floorContext.fill();
                    
                    // Diamond body
                    floorContext.fillStyle = diamondColor;
                    floorContext.beginPath();
                    floorContext.moveTo(diamondX, diamondY - diamondSize/2);
                    floorContext.lineTo(diamondX + diamondSize/2, diamondY);
                    floorContext.lineTo(diamondX, diamondY + diamondSize/2);
                    floorContext.lineTo(diamondX - diamondSize/2, diamondY);
                    floorContext.closePath();
                    floorContext.fill();
                    
                    // Diamond highlight
                    floorContext.fillStyle = highlightColor;
                    floorContext.beginPath();
                    floorContext.moveTo(diamondX, diamondY - diamondSize/2);
                    floorContext.lineTo(diamondX + diamondSize/2, diamondY);
                    floorContext.lineTo(diamondX, diamondY);
                    floorContext.closePath();
                    floorContext.fill();
                }
            }
        }
    }
    
    // Add industrial wear patterns
    for (let i = 0; i < 100; i++) {
        const x = Math.random() * 512;
        const y = Math.random() * 512;
        const size = Math.random() * 15 + 5;
        const opacity = Math.random() * 0.4 + 0.1;
        
        floorContext.fillStyle = `rgba(37, 37, 37, ${opacity})`;
        floorContext.beginPath();
        floorContext.arc(x, y, size, 0, Math.PI * 2);
        floorContext.fill();
    }
    
    // Add scuff marks and scratches
    floorContext.strokeStyle = 'rgba(20, 20, 20, 0.3)';
    floorContext.lineWidth = 3;
    for (let i = 0; i < 30; i++) {
        const startX = Math.random() * 512;
        const startY = Math.random() * 512;
        const endX = startX + (Math.random() - 0.5) * 80;
        const endY = startY + (Math.random() - 0.5) * 40;
        
        floorContext.beginPath();
        floorContext.moveTo(startX, startY);
        floorContext.lineTo(endX, endY);
        floorContext.stroke();
    }
    
    return floorCanvas;
}

function createEnhancedIndustrialConcrete() {
    // Create enhanced industrial concrete floor texture
    const concreteCanvas = document.createElement('canvas');
    concreteCanvas.width = 512;
    concreteCanvas.height = 512;
    const concreteContext = concreteCanvas.getContext('2d');
    
    // Industrial concrete colors
    const baseColor = '#2a2a2a';
    const concreteColor = '#353535';
    const crackColor = '#1a1a1a';
    const stainColor = '#252525';
    const jointColor = '#1f1f1f';
    
    // Fill base
    concreteContext.fillStyle = baseColor;
    concreteContext.fillRect(0, 0, 512, 512);
    
    // Create concrete slab pattern
    const slabSize = 128;
    for (let x = 0; x < 512; x += slabSize) {
        for (let y = 0; y < 512; y += slabSize) {
            // Main concrete slab with texture variation
            const gradient = concreteContext.createRadialGradient(
                x + slabSize/2, y + slabSize/2, 0,
                x + slabSize/2, y + slabSize/2, slabSize/1.5
            );
            gradient.addColorStop(0, concreteColor);
            gradient.addColorStop(0.6, '#323232');
            gradient.addColorStop(1, '#282828');
            concreteContext.fillStyle = gradient;
            concreteContext.fillRect(x + 2, y + 2, slabSize - 4, slabSize - 4);
            
            // Expansion joints
            concreteContext.fillStyle = jointColor;
            concreteContext.fillRect(x, y, slabSize, 4); // Horizontal joint
            concreteContext.fillRect(x, y, 4, slabSize); // Vertical joint
            
            // Add concrete texture noise
            for (let i = 0; i < 200; i++) {
                const nx = x + Math.random() * slabSize;
                const ny = y + Math.random() * slabSize;
                const size = Math.random() * 3 + 1;
                const opacity = Math.random() * 0.3 + 0.1;
                
                concreteContext.fillStyle = `rgba(${40 + Math.random() * 20}, ${40 + Math.random() * 20}, ${40 + Math.random() * 20}, ${opacity})`;
                concreteContext.beginPath();
                concreteContext.arc(nx, ny, size, 0, Math.PI * 2);
                concreteContext.fill();
            }
        }
    }
    
    // Add cracks and wear patterns
    concreteContext.strokeStyle = crackColor;
    concreteContext.lineWidth = 2;
    for (let i = 0; i < 15; i++) {
        const startX = Math.random() * 512;
        const startY = Math.random() * 512;
        const length = Math.random() * 100 + 50;
        const angle = Math.random() * Math.PI * 2;
        
        concreteContext.beginPath();
        concreteContext.moveTo(startX, startY);
        
        // Create jagged crack line
        let currentX = startX;
        let currentY = startY;
        const segments = 8;
        for (let j = 0; j < segments; j++) {
            currentX += (Math.cos(angle) + (Math.random() - 0.5) * 0.5) * (length / segments);
            currentY += (Math.sin(angle) + (Math.random() - 0.5) * 0.5) * (length / segments);
            concreteContext.lineTo(currentX, currentY);
        }
        concreteContext.stroke();
    }
    
    // Add oil stains and industrial wear
    for (let i = 0; i < 60; i++) {
        const x = Math.random() * 512;
        const y = Math.random() * 512;
        const size = Math.random() * 20 + 10;
        const opacity = Math.random() * 0.4 + 0.2;
        
        concreteContext.fillStyle = `rgba(25, 25, 25, ${opacity})`;
        concreteContext.beginPath();
        concreteContext.arc(x, y, size, 0, Math.PI * 2);
        concreteContext.fill();
    }
    
    return concreteCanvas;
}

function createBrickMaterial() {
    // Create enhanced industrial metal wall texture
    const wallCanvas = document.createElement('canvas');
    wallCanvas.width = 512;  // Higher resolution for better detail
    wallCanvas.height = 512;
    const wallContext = wallCanvas.getContext('2d');
    
    // Enhanced industrial metal colors
    const baseMetalColor = '#3a3a3a';      // Darker metal base
    const panelColor = '#4a4a4a';          // Panel color
    const rivetColor = '#5a5a5a';          // Rivet color
    const rustColor = '#8B4513';           // Rust/wear color
    const highlightColor = '#7a7a7a';      // Highlight color
    const shadowColor = '#2a2a2a';         // Shadow color
    const weldColor = '#1a1a1a';           // Weld seam color
    
    // Fill background with base metal
    wallContext.fillStyle = baseMetalColor;
    wallContext.fillRect(0, 0, 512, 512);
    
    // Create enhanced corrugated metal panel pattern
    const panelWidth = 85;   // Larger panels for more industrial look
    const panelHeight = 170;
    
    for (let x = 0; x < 512; x += panelWidth) {
        for (let y = 0; y < 512; y += panelHeight) {
            // Draw main panel with gradient for depth
            const gradient = wallContext.createLinearGradient(x, y, x + panelWidth, y + panelHeight);
            gradient.addColorStop(0, panelColor);
            gradient.addColorStop(0.5, '#525252');
            gradient.addColorStop(1, '#424242');
            wallContext.fillStyle = gradient;
            wallContext.fillRect(x + 3, y + 3, panelWidth - 6, panelHeight - 6);
            
            // Add vertical corrugation lines
            wallContext.strokeStyle = '#3a3a3a';
            wallContext.lineWidth = 2;
            for (let i = 1; i < 4; i++) {
                const lineX = x + (i * panelWidth / 4);
                wallContext.beginPath();
                wallContext.moveTo(lineX, y + 2);
                wallContext.lineTo(lineX, y + panelHeight - 2);
                wallContext.stroke();
            }
            
            // Add horizontal panel seams
            wallContext.strokeStyle = '#2a2a2a';
            wallContext.lineWidth = 3;
            wallContext.beginPath();
            wallContext.moveTo(x, y);
            wallContext.lineTo(x + panelWidth, y);
            wallContext.stroke();
            wallContext.beginPath();
            wallContext.moveTo(x, y + panelHeight);
            wallContext.lineTo(x + panelWidth, y + panelHeight);
            wallContext.stroke();
            
            // Add rivets at panel corners and edges
            const rivetPositions = [
                [x + 8, y + 8], [x + panelWidth - 8, y + 8],
                [x + 8, y + panelHeight - 8], [x + panelWidth - 8, y + panelHeight - 8],
                [x + panelWidth / 2, y + 8], [x + panelWidth / 2, y + panelHeight - 8]
            ];
            
            rivetPositions.forEach(([rivetX, rivetY]) => {
                // Rivet base
                wallContext.fillStyle = rivetColor;
                wallContext.beginPath();
                wallContext.arc(rivetX, rivetY, 3, 0, Math.PI * 2);
                wallContext.fill();
                
                // Rivet highlight
                wallContext.fillStyle = highlightColor;
                wallContext.beginPath();
                wallContext.arc(rivetX - 1, rivetY - 1, 1.5, 0, Math.PI * 2);
                wallContext.fill();
            });
            
            // Add panel highlights for 3D effect
            wallContext.fillStyle = 'rgba(255, 255, 255, 0.1)';
            wallContext.fillRect(x + 2, y + 2, 2, panelHeight - 4); // Left highlight
            wallContext.fillRect(x + 2, y + 2, panelWidth - 4, 2); // Top highlight
        }
    }
    
    // Add industrial wear and rust spots
    for (let i = 0; i < 40; i++) {
        const x = Math.random() * 256;
        const y = Math.random() * 256;
        const size = Math.random() * 6 + 2;
        const opacity = Math.random() * 0.4 + 0.1;
        
        wallContext.fillStyle = `rgba(139, 69, 19, ${opacity})`; // Rust color
        wallContext.beginPath();
        wallContext.arc(x, y, size, 0, Math.PI * 2);
        wallContext.fill();
    }
    
    // Add scratches and wear marks
    wallContext.strokeStyle = 'rgba(0, 0, 0, 0.3)';
    wallContext.lineWidth = 1;
    for (let i = 0; i < 20; i++) {
        const startX = Math.random() * 256;
        const startY = Math.random() * 256;
        const endX = startX + (Math.random() - 0.5) * 40;
        const endY = startY + (Math.random() - 0.5) * 20;
        
        wallContext.beginPath();
        wallContext.moveTo(startX, startY);
        wallContext.lineTo(endX, endY);
        wallContext.stroke();
    }
    
    const wallTexture = new THREE.CanvasTexture(wallCanvas);
    wallTexture.wrapS = THREE.RepeatWrapping;
    wallTexture.wrapT = THREE.RepeatWrapping;
    wallTexture.repeat.set(3, 2); // Repeat the metal panel pattern
    
    wallMaterial = new THREE.MeshStandardMaterial({ 
        map: wallTexture, 
        roughness: 0.6, 
        metalness: 0.7,
        normalScale: new THREE.Vector2(0.3, 0.3)
    });
}

// Function to create scaled industrial wall material for specific wall dimensions
function createScaledBrickMaterial(width, height) {
    // Create industrial metal wall texture with proper scaling
    const wallCanvas = document.createElement('canvas');
    wallCanvas.width = 256;
    wallCanvas.height = 256;
    const wallContext = wallCanvas.getContext('2d');
    
    // Industrial metal colors
    const baseMetalColor = '#4a4a4a';      // Dark metal base
    const panelColor = '#555555';          // Panel color
    const rivetColor = '#666666';          // Rivet color
    const highlightColor = '#6a6a6a';      // Highlight color
    
    // Fill background with base metal
    wallContext.fillStyle = baseMetalColor;
    wallContext.fillRect(0, 0, 256, 256);
    
    // Create corrugated metal panel pattern
    const panelWidth = 64;
    const panelHeight = 128;
    
    for (let x = 0; x < 256; x += panelWidth) {
        for (let y = 0; y < 256; y += panelHeight) {
            // Draw main panel
            wallContext.fillStyle = panelColor;
            wallContext.fillRect(x + 2, y + 2, panelWidth - 4, panelHeight - 4);
            
            // Add vertical corrugation lines
            wallContext.strokeStyle = '#3a3a3a';
            wallContext.lineWidth = 2;
            for (let i = 1; i < 4; i++) {
                const lineX = x + (i * panelWidth / 4);
                wallContext.beginPath();
                wallContext.moveTo(lineX, y + 2);
                wallContext.lineTo(lineX, y + panelHeight - 2);
                wallContext.stroke();
            }
            
            // Add horizontal panel seams
            wallContext.strokeStyle = '#2a2a2a';
            wallContext.lineWidth = 3;
            wallContext.beginPath();
            wallContext.moveTo(x, y);
            wallContext.lineTo(x + panelWidth, y);
            wallContext.stroke();
            wallContext.beginPath();
            wallContext.moveTo(x, y + panelHeight);
            wallContext.lineTo(x + panelWidth, y + panelHeight);
            wallContext.stroke();
            
            // Add rivets at panel corners and edges
            const rivetPositions = [
                [x + 8, y + 8], [x + panelWidth - 8, y + 8],
                [x + 8, y + panelHeight - 8], [x + panelWidth - 8, y + panelHeight - 8],
                [x + panelWidth / 2, y + 8], [x + panelWidth / 2, y + panelHeight - 8]
            ];
            
            rivetPositions.forEach(([rivetX, rivetY]) => {
                // Rivet base
                wallContext.fillStyle = rivetColor;
                wallContext.beginPath();
                wallContext.arc(rivetX, rivetY, 3, 0, Math.PI * 2);
                wallContext.fill();
                
                // Rivet highlight
                wallContext.fillStyle = highlightColor;
                wallContext.beginPath();
                wallContext.arc(rivetX - 1, rivetY - 1, 1.5, 0, Math.PI * 2);
                wallContext.fill();
            });
            
            // Add panel highlights for 3D effect
            wallContext.fillStyle = 'rgba(255, 255, 255, 0.1)';
            wallContext.fillRect(x + 2, y + 2, 2, panelHeight - 4); // Left highlight
            wallContext.fillRect(x + 2, y + 2, panelWidth - 4, 2); // Top highlight
        }
    }
    
    // Add industrial wear and rust spots
    for (let i = 0; i < 30; i++) {
        const x = Math.random() * 256;
        const y = Math.random() * 256;
        const size = Math.random() * 4 + 1;
        const opacity = Math.random() * 0.3 + 0.1;
        
        wallContext.fillStyle = `rgba(139, 69, 19, ${opacity})`; // Rust color
        wallContext.beginPath();
        wallContext.arc(x, y, size, 0, Math.PI * 2);
        wallContext.fill();
    }
    
    const wallTexture = new THREE.CanvasTexture(wallCanvas);
    wallTexture.wrapS = THREE.RepeatWrapping;
    wallTexture.wrapT = THREE.RepeatWrapping;
    
    // Calculate appropriate repeat based on wall dimensions
    // Assuming each panel is about 20 units wide and 25 units tall in world space
    const repeatX = Math.max(1, width / 20); // Adjust panel size as needed
    const repeatY = Math.max(1, height / 25);  // Adjust panel size as needed
    
    wallTexture.repeat.set(repeatX, repeatY);
    
    return new THREE.MeshStandardMaterial({ 
        map: wallTexture, 
        roughness: 0.6, 
        metalness: 0.7,
        normalScale: new THREE.Vector2(0.3, 0.3)
    });
}

// --- LABORATORY CREATION FUNCTIONS ---
function createRoom() {
    const roomWidth = 120, roomDepth = 90, wallHeight = 25, wallThickness = 1;
    
    // Create inside room floor (enhanced industrial laboratory flooring)
    const insideFloorGeometry = new THREE.PlaneGeometry(roomWidth, roomDepth);
    const insideCanvas = createEnhancedIndustrialFloor(); // Use enhanced floor texture
    
    const insideFloorTexture = new THREE.CanvasTexture(insideCanvas);
    insideFloorTexture.wrapS = THREE.RepeatWrapping; 
    insideFloorTexture.wrapT = THREE.RepeatWrapping;
    insideFloorTexture.repeat.set(4, 3); // Enhanced industrial plate repeat
    
    const insideFloorMaterial = new THREE.MeshStandardMaterial({ 
        map: insideFloorTexture, 
        roughness: 0.8, 
        metalness: 0.6,  // More metallic for industrial look
        normalScale: new THREE.Vector2(0.7, 0.7)  // Enhanced normal mapping
    });
    
    const insideFloor = new THREE.Mesh(insideFloorGeometry, insideFloorMaterial);
    insideFloor.rotation.x = -Math.PI / 2;
    insideFloor.position.set(0, 0.02, 0); // Slightly raised to avoid z-fighting
    insideFloor.receiveShadow = true;
    scene.add(insideFloor);
    
    // Create outside area floor (enhanced industrial concrete texture)
    const outsideFloorGeometry = new THREE.PlaneGeometry(400, 400);
    const outsideCanvas = createEnhancedIndustrialConcrete(); // Use enhanced concrete texture
    
    const outsideFloorTexture = new THREE.CanvasTexture(outsideCanvas);
    outsideFloorTexture.wrapS = THREE.RepeatWrapping; 
    outsideFloorTexture.wrapT = THREE.RepeatWrapping;
    outsideFloorTexture.repeat.set(8, 8); // Enhanced concrete detail
    
    const outsideFloorMaterial = new THREE.MeshStandardMaterial({ 
        map: outsideFloorTexture, 
        roughness: 0.9, 
        metalness: 0.1,  // Slightly more metallic for industrial concrete
        normalScale: new THREE.Vector2(0.4, 0.4)  // Add surface detail
    });
    
    const outsideFloor = new THREE.Mesh(outsideFloorGeometry, outsideFloorMaterial);
    outsideFloor.rotation.x = -Math.PI / 2;
    outsideFloor.position.set(0, -0.05, 0); // Lower to avoid z-fighting with inside floor
    outsideFloor.receiveShadow = true;
    scene.add(outsideFloor);

    // Use the global brick wall material
    const backWall = new THREE.Mesh(new THREE.BoxGeometry(roomWidth, wallHeight, wallThickness), wallMaterial);
    backWall.position.set(0, wallHeight / 2, -roomDepth / 2);
    backWall.receiveShadow = true;
    scene.add(backWall);

    const leftWall = new THREE.Mesh(new THREE.BoxGeometry(roomDepth, wallHeight, wallThickness), wallMaterial);
    leftWall.position.set(-roomWidth / 2, wallHeight / 2, 0);
    leftWall.rotation.y = Math.PI / 2;
    leftWall.receiveShadow = true;
    scene.add(leftWall);

    const rightWall = new THREE.Mesh(new THREE.BoxGeometry(roomDepth, wallHeight, wallThickness), wallMaterial);
    rightWall.position.set(roomWidth / 2, wallHeight / 2, 0);
    rightWall.rotation.y = Math.PI / 2;
    rightWall.receiveShadow = true;
    scene.add(rightWall);
    
    const doorWidth = 10;
    const sideWallWidth = (roomWidth / 2) - (doorWidth / 2);
    
    // Create properly scaled materials for front wall sections
    const frontWallLeftMaterial = createScaledBrickMaterial(sideWallWidth, wallHeight);
    const frontWallLeft = new THREE.Mesh(new THREE.BoxGeometry(sideWallWidth, wallHeight, wallThickness), frontWallLeftMaterial);
    frontWallLeft.position.set(-(doorWidth / 2 + sideWallWidth / 2), wallHeight / 2, roomDepth / 2);
    frontWallLeft.receiveShadow = true;
    scene.add(frontWallLeft);

    const frontWallLeft1Material = createScaledBrickMaterial(sideWallWidth-35, wallHeight-16);
    const frontWallLeft1 = new THREE.Mesh(new THREE.BoxGeometry(sideWallWidth-35, wallHeight-16, wallThickness-0.2), frontWallLeft1Material);
    frontWallLeft1.position.set(0,20.48,59.9);
    frontWallLeft1.receiveShadow = true;
    scene.add(frontWallLeft1);

    const frontWallLeft2Material = createScaledBrickMaterial(sideWallWidth-35, wallHeight-16);
    const frontWallLeft2 = new THREE.Mesh(new THREE.BoxGeometry(sideWallWidth-35, wallHeight-16, wallThickness), frontWallLeft2Material);
    frontWallLeft2.position.set(0,20.5,44.9);
    frontWallLeft2.receiveShadow = true;
    scene.add(frontWallLeft2);
    
    const frontWallRight = new THREE.Mesh(new THREE.BoxGeometry(sideWallWidth, wallHeight, wallThickness), frontWallLeftMaterial);
    frontWallRight.position.set((doorWidth / 2 + sideWallWidth / 2), wallHeight / 2, roomDepth / 2);
    frontWallRight.receiveShadow = true;
    scene.add(frontWallRight);

    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(roomWidth, roomDepth), new THREE.MeshStandardMaterial({ color: 0xffffff }));
    ceiling.position.y = wallHeight;
    ceiling.rotation.x = Math.PI / 2;
    scene.add(ceiling);
}

function createDoors() {
    const mainDoorMaterial = new THREE.MeshStandardMaterial({ color: 0x664422, roughness: 0.6 });
    const smallDoorMaterial = new THREE.MeshStandardMaterial({ color: 0x886644, roughness: 0.6 });
    const doorHeight = 16, mainDoorWidth = 10, smallDoorWidth = 8, doorDepth = 0.5, antechamberDepth = 15;

    mainDoor = new THREE.Mesh(new THREE.BoxGeometry(mainDoorWidth, doorHeight, doorDepth), mainDoorMaterial);
    mainDoor.castShadow = true;
    mainDoor.position.set(mainDoorWidth / 2, doorHeight / 2, 0);
    const mainDoorPivot = new THREE.Group();
    mainDoorPivot.position.set(-mainDoorWidth / 2, 0, 90 / 2);
    mainDoorPivot.add(mainDoor);
    scene.add(mainDoorPivot);

    

    const antechamberWallWidth = 20;
    const smallDoorSideWidth = (antechamberWallWidth / 2) - (smallDoorWidth / 2);
    
    // Create properly scaled materials for antechamber walls
    const antechamberFrontMaterial = createScaledBrickMaterial(smallDoorSideWidth, 25);
    const antechamberFrontLeft = new THREE.Mesh(new THREE.BoxGeometry(smallDoorSideWidth, 25, doorDepth), antechamberFrontMaterial);
    antechamberFrontLeft.position.set(-(smallDoorWidth / 2 + smallDoorSideWidth / 2), 12.5, 45 + antechamberDepth);
    scene.add(antechamberFrontLeft);

    const antechamberFrontRight = new THREE.Mesh(new THREE.BoxGeometry(smallDoorSideWidth, 25, doorDepth), antechamberFrontMaterial);
    antechamberFrontRight.position.set((smallDoorWidth / 2 + smallDoorSideWidth / 2), 12.5, 45 + antechamberDepth);
    scene.add(antechamberFrontRight);
    
    const antechamberSideMaterial = createScaledBrickMaterial(antechamberDepth, 25);
    const antechamberSideLeft = new THREE.Mesh(new THREE.BoxGeometry(antechamberDepth, 25, doorDepth), antechamberSideMaterial);
    antechamberSideLeft.rotation.y = Math.PI / 2;
    antechamberSideLeft.position.set(-antechamberWallWidth / 2, 12.5, 45 + antechamberDepth / 2);
    scene.add(antechamberSideLeft);

    const antechamberSideRight = new THREE.Mesh(new THREE.BoxGeometry(antechamberDepth, 25, doorDepth), antechamberSideMaterial);
    antechamberSideRight.rotation.y = Math.PI / 2;
    antechamberSideRight.position.set(antechamberWallWidth / 2, 12.5, 45 + antechamberDepth / 2);
    scene.add(antechamberSideRight);

    smallDoor = new THREE.Mesh(new THREE.BoxGeometry(smallDoorWidth, doorHeight, doorDepth), smallDoorMaterial);
    smallDoor.castShadow = true;
    smallDoor.position.set(smallDoorWidth / 2, doorHeight / 2, 0);
    const smallDoorPivot = new THREE.Group();
    smallDoorPivot.position.set(-smallDoorWidth / 2, 0, 45 + antechamberDepth);
    smallDoorPivot.add(smallDoor);
    scene.add(smallDoorPivot);
}



function createCeilingLight(x, y, z) {
    const light = new THREE.PointLight(0xffffee, 1.5, 60, 1.2); // Higher intensity and range for better coverage
    light.position.set(x, y, z);
    light.castShadow = false; // Disable shadows to reduce texture units usage
    scene.add(light);
    ceilingLights.push(light);

    const fixtureGeom = new THREE.BoxGeometry(8, 0.5, 2);
    const fixtureMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.5, roughness: 0.5 });
    const fixture = new THREE.Mesh(fixtureGeom, fixtureMat);
    fixture.position.set(x, y + 0.5, z);
    scene.add(fixture);
    
    // Store fixture reference for visibility control
    ceilingLightFixtures.push(fixture);
}

// function createWallSconce(x, y, z, rotationY = 0) {
//     // Create a wall sconce with a warm light
//     const light = new THREE.PointLight(0xffcc88, 0, 20, 2); // Warm light with intensity 0
//     light.position.set(x, y, z);
//     light.castShadow = false; // Disable shadows to reduce texture units usage
//     scene.add(light);
//     ceilingLights.push(light); // Add to the same array for control

//     // Create the sconce fixture
//     const sconceGroup = new THREE.Group();
//     sconceGroup.position.set(x, y, z);
//     sconceGroup.rotation.y = rotationY;
    
//     // Base attached to wall
//     const baseGeom = new THREE.BoxGeometry(0.5, 1.5, 1.5);
//     const baseMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 0.7, roughness: 0.3 });
//     const base = new THREE.Mesh(baseGeom, baseMat);
//     base.position.set(-0.25, 0, 0);
    
//     // Light cover (semi-transparent)
//     const coverGeom = new THREE.CylinderGeometry(0.6, 0.6, 1.2, 8, 1, false, 0, Math.PI);
//     const coverMat = new THREE.MeshPhysicalMaterial({
//         color: 0xffffee, 
//         metalness: 0.1, 
//         roughness: 0.2,
//         transmission: 0.6, 
//         transparent: true, 
//         opacity: 0.7
//     });
//     const cover = new THREE.Mesh(coverGeom, coverMat);
//     cover.rotation.y = Math.PI / 2;
//     cover.position.set(0.3, 0, 0);
    
//     sconceGroup.add(base, cover);
//     sconceGroup.children.forEach(c => { c.castShadow = true; c.receiveShadow = true; });
//     scene.add(sconceGroup);
// }


function createSpotlight(x, y, z, targetX, targetY, targetZ, color = 0xffffff) {
    // Create a spotlight to highlight specific areas
    const spotlight = new THREE.SpotLight(color, 1.2, 70, Math.PI/5, 0.3, 1.5); // Higher intensity and range
    spotlight.position.set(x, y, z);
    
    // Set the target for the spotlight
    const target = new THREE.Object3D();
    target.position.set(targetX, targetY, targetZ);
    scene.add(target);
    spotlight.target = target;
    
    
    // Disable shadows for spotlights to reduce texture units usage
    spotlight.castShadow = false;
    spotlight.shadow.mapSize.width = 512;
    spotlight.shadow.mapSize.height = 512;
    scene.add(spotlight);
    ceilingLights.push(spotlight); // Add to the same array for control

    // Create the spotlight fixture
    const fixtureGroup = new THREE.Group();
    fixtureGroup.position.set(x, y, z);
    
    // Aim the fixture at the target
    fixtureGroup.lookAt(targetX, targetY, targetZ);
    
    return spotlight;
}

function createCabinets() {
    const cabinetMaterial = new THREE.MeshStandardMaterial({ color: 0xddeeff, roughness: 0.4 });
    createCabinet(-58.5, 0, 20, 4, 3, 12, cabinetMaterial);
    createCabinet(-58.5, 0, -20, 4, 3, 12, cabinetMaterial);
    createCabinet(-58.5, 15, 20, 8, 2, 12, cabinetMaterial);
    createCabinet(-58.5, 15, -20, 8, 2, 12, cabinetMaterial);
}

function createCabinet(x, y, z, height, depth, width, material) {
    const cabinet = new THREE.Mesh(new THREE.BoxGeometry(depth, height, width), material);
    cabinet.position.set(x, y + height/2, z);
    cabinet.castShadow = true;
    cabinet.receiveShadow = true;
    scene.add(cabinet);
}

function createShelves() {
    const shelfMat = new THREE.MeshStandardMaterial({ color: 0xaaaaaa, metalness: 0.9, roughness: 0.3 });
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(30, 0.2, 2), shelfMat);
    shelf.position.set(0, 12, -44);
    shelf.castShadow = true;
    scene.add(shelf);
    
    const shelf2 = shelf.clone();
    shelf2.position.y = 17;
    scene.add(shelf2);
}



function createTunnel(outerRadius, innerRadius, height, segments = 64) {
    // Create the outer semicircular shape
    const shape = new THREE.Shape();
    shape.absarc(0, 0, outerRadius, 0, Math.PI, false);
    shape.lineTo(-outerRadius, 0); // Close the shape at the bottom
    
    // Create the inner semicircular hole
    const hole = new THREE.Path();
    hole.absarc(0, 0, innerRadius, Math.PI, 0, true); // Reverse direction for hole
    shape.holes.push(hole);

    // Set up extrusion settings
    const extrudeSettings = {
        depth: height,
        bevelEnabled: false,
        curveSegments: segments
    };

    // Create the geometry
    const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);

    // Position and orient the geometry properly
    geometry.rotateZ(0); // Rotate to align with tunnel direction
    geometry.translate(0, -0.1, 0); // Position on the ground

    return geometry;
}






function createFumeHood() {
    const hoodGroup = new THREE.Group();
    const baseMat = new THREE.MeshStandardMaterial({color: 0xbbbbbb});
    const glassMat = new THREE.MeshPhysicalMaterial({
        color: 0xeeffff, metalness: 0.1, roughness: 0.1,
        transmission: 0.9, transparent: true, opacity: 0.3
    });

    const base = new THREE.Mesh(new THREE.BoxGeometry(8, 4, 4), baseMat);
    base.position.y = 2;
    const back = new THREE.Mesh(new THREE.BoxGeometry(8, 6, 0.5), baseMat);
    back.position.y = 7; back.position.z = -1.75;
    const top = new THREE.Mesh(new THREE.BoxGeometry(8, 0.5, 4), baseMat);
    top.position.y = 10.25;
    const sideL = new THREE.Mesh(new THREE.BoxGeometry(0.5, 6, 4), baseMat);
    sideL.position.y = 7; sideL.position.x = -3.75;
    const sideR = sideL.clone(); sideR.position.x = 3.75;
    const glass = new THREE.Mesh(new THREE.BoxGeometry(8, 6, 0.2), glassMat);
    glass.position.y = 7; glass.position.z = 1.9;
    
    hoodGroup.add(base, back, top, sideL, sideR, glass);
    hoodGroup.position.set(45, 0, -42);
    hoodGroup.children.forEach(c => { c.castShadow = true; c.receiveShadow = true; });
    scene.add(hoodGroup);
}

function createMetallicTable() {
    const tableGroup = new THREE.Group();
    
    // Industrial metallic material
    const metallicMaterial = new THREE.MeshStandardMaterial({
        color: 0x4a4a4a,
        metalness: 0.8,
        roughness: 0.3,
        envMapIntensity: 1.0
    });
    
    // Darker metal for legs
    const legMaterial = new THREE.MeshStandardMaterial({
        color: 0x3a3a3a,
        metalness: 0.9,
        roughness: 0.4
    });
    
    // Table top - industrial steel plate
    const tableTopGeometry = new THREE.BoxGeometry(20, 0.8, 12);
    const tableTop = new THREE.Mesh(tableTopGeometry, metallicMaterial);
    tableTop.position.y = 4; // Height of table surface
    tableTop.castShadow = true;
    tableTop.receiveShadow = true;
    tableGroup.add(tableTop);
    
    // Table legs - industrial steel tubes
    const legGeometry = new THREE.CylinderGeometry(0.4, 0.4, 4, 8);
    
    // Create 4 legs
    const legPositions = [
        [-8.5, 2, -5], [8.5, 2, -5],  // Back legs
        [-8.5, 2, 5], [8.5, 2, 5]    // Front legs
    ];
    
    legPositions.forEach(([x, y, z]) => {
        const leg = new THREE.Mesh(legGeometry, legMaterial);
        leg.position.set(x, y, z);
        leg.castShadow = true;
        leg.receiveShadow = true;
        tableGroup.add(leg);
    });
    
    // Cross braces for stability - industrial design
    const braceGeometry = new THREE.BoxGeometry(16, 0.3, 0.3);
    
    // Side braces
    const leftBrace = new THREE.Mesh(braceGeometry, legMaterial);
    leftBrace.position.set(0, 1.5, -5);
    leftBrace.castShadow = true;
    leftBrace.receiveShadow = true;
    tableGroup.add(leftBrace);
    
    const rightBrace = new THREE.Mesh(braceGeometry, legMaterial);
    rightBrace.position.set(0, 1.5, 5);
    rightBrace.castShadow = true;
    rightBrace.receiveShadow = true;
    tableGroup.add(rightBrace);
    
    // End braces
    const endBraceGeometry = new THREE.BoxGeometry(0.3, 0.3, 9);
    
    const backBrace = new THREE.Mesh(endBraceGeometry, legMaterial);
    backBrace.position.set(-8.5, 1.5, 0);
    backBrace.castShadow = true;
    backBrace.receiveShadow = true;
    tableGroup.add(backBrace);
    
    const frontBrace = new THREE.Mesh(endBraceGeometry, legMaterial);
    frontBrace.position.set(8.5, 1.5, 0);
    frontBrace.castShadow = true;
    frontBrace.receiveShadow = true;
    tableGroup.add(frontBrace);
    
    // Add industrial details - corner reinforcements
    const cornerGeometry = new THREE.BoxGeometry(1, 1, 1);
    const cornerPositions = [
        [-9, 3.6, -5.5], [9, 3.6, -5.5],  // Back corners
        [-9, 3.6, 5.5], [9, 3.6, 5.5]    // Front corners
    ];
    
    cornerPositions.forEach(([x, y, z]) => {
        const corner = new THREE.Mesh(cornerGeometry, legMaterial);
        corner.position.set(x, y, z);
        corner.castShadow = true;
        corner.receiveShadow = true;
        tableGroup.add(corner);
    });
    
    // Position the table inside the laboratory room

    tableGroup.position.set(-15, 0, -5); // Left side of the room
    // tableGroup.scale.set(1,1,1);   
    scene.add(tableGroup);
    
    return tableGroup;
}

// Human model function removed as requested

// --- ROBOT & AUTOMATION FUNCTIONS ---

function createFurnace() {
    furnace = new THREE.Group();

    const wallMat = new THREE.MeshStandardMaterial({ color: 0x3d3d3d, metalness: 0.8, roughness: 0.4 });
    const thickness = 0.2;

    const back = new THREE.Mesh(new THREE.BoxGeometry(4, 3, thickness), wallMat);
    back.position.set(0, 1.5, -2);
    furnace.add(back);

    const left = new THREE.Mesh(new THREE.BoxGeometry(thickness, 3, 4), wallMat);
    left.position.set(-2, 1.5, 0);
    furnace.add(left);

    const right = new THREE.Mesh(new THREE.BoxGeometry(thickness, 3, 4), wallMat);
    right.position.set(2, 1.5, 0);
    furnace.add(right);

    const top = new THREE.Mesh(new THREE.BoxGeometry(4, thickness, 4), wallMat);
    top.position.set(0, 3, 0);
    furnace.add(top);

    const bottom = new THREE.Mesh(new THREE.BoxGeometry(4, thickness, 4), wallMat);
    bottom.position.set(0, 0, 0);
    furnace.add(bottom);

    const fireGeo = new THREE.PlaneGeometry(2.5, 1.8);
    const fireMat = new THREE.MeshStandardMaterial({
        color: 0xff6600, emissive: 0xff3300, emissiveIntensity: 2.0,
        transparent: true, opacity: 0.9, side: THREE.DoubleSide
    });
    const fire = new THREE.Mesh(fireGeo, fireMat);
    fire.position.set(0, 1.5, -1.8);
    furnace.add(fire);

    const fireLight = new THREE.PointLight(0xff4400, 2, 8, 2);
    fireLight.position.set(0, 1.5, -1.2);
    fireLight.castShadow = false; // Disable shadows to reduce texture units usage
    fireLight.shadow.mapSize.width = 256; // Small shadow map size
    fireLight.shadow.mapSize.height = 256;
    furnace.add(fireLight);

    furnace.userData.fireLight = fireLight;
    furnace.userData.fireMesh = fire;

    const extLength = 1, extHeight = 2.2, extWidth = 2.5;
    const extWallMat = new THREE.MeshStandardMaterial({ color: 0x2b2b2b, metalness: 0.7, roughness: 0.5 });
    const extTop = new THREE.Mesh(new THREE.BoxGeometry(extWidth, thickness, extLength), extWallMat);
    extTop.position.set(0, 2.6, extLength / 2);
    furnace.add(extTop);

    const extBottom = new THREE.Mesh(new THREE.BoxGeometry(extWidth, thickness, extLength + 3), extWallMat);
    extBottom.position.set(0, 0.1, 4);
    furnace.add(extBottom);

    const extLeft = new THREE.Mesh(new THREE.BoxGeometry(thickness, extHeight, extLength), extWallMat);
    extLeft.position.set(-extWidth / 2, 1.5, extLength / 2);
    furnace.add(extLeft);

    const extRight = new THREE.Mesh(new THREE.BoxGeometry(thickness, extHeight, extLength), extWallMat);
    extRight.position.set(extWidth / 2, 1.5, extLength / 2);
    furnace.add(extRight);

    furnace.position.set(furnaceExitPosition.x + 4.2, 0, furnaceExitPosition.z - 5);
    const robotContainer = robot_arm.parent;
    robotContainer.add(furnace);
}

function createRobot() {
    const yellow_mesh = new THREE.MeshStandardMaterial({ color: 0xFF6A00, metalness: 0.8, roughness: 0.3 });
    const grey_mesh = new THREE.MeshStandardMaterial({ color: 0x2B2B2B, metalness: 0.7, roughness: 0.4 });
    const arm_group = new THREE.Group();
    const grey_base_geometry = new THREE.CylinderGeometry(2.5, 2.5, 0.8, 32);
    const gray_base = new THREE.Mesh(grey_base_geometry, grey_mesh);
    gray_base.position.set(0, 0.4, 0);
    gray_base.castShadow = true;
    arm_group.add(gray_base);
    const orange_base_geometry = new THREE.CylinderGeometry(2, 2, 0.5, 32);
    const orange_base = new THREE.Mesh(orange_base_geometry, grey_mesh);
    orange_base.castShadow = true;
    orange_base.position.set(0, 0.7, 0);
    arm_group.add(orange_base);
    const base_box_geometry = new THREE.BoxGeometry(0.2, 3.0, 0.3);
    const base_box = new THREE.Mesh(base_box_geometry, grey_mesh);
    base_box.position.set(-0.4, 1.2, -0.2);
    base_box.rotation.z = Math.PI / 4;
    base_box.castShadow = true;
    arm_group.add(base_box);
    const bbox = new THREE.Group();
    const first_junc_group = new THREE.Group();
    bbox.add(first_junc_group);
    first_junc_group.position.set(0.9, -1.9, 0);
    bbox.position.set(-0.9, 1.9, 0);
    const junction_geometry = new THREE.CylinderGeometry(0.6, 0.6, 1.7, 32);
    const first_junction = new THREE.Mesh(junction_geometry, grey_mesh);
    first_junction.position.set(-0.9, 2, 0);
    first_junction.rotation.x = Math.PI / 2;
    first_junction.castShadow = true;
    first_junc_group.add(first_junction);
    const first_arm_geometry = new THREE.CylinderGeometry(0.3, 0.5, 3.5, 32);
    const first_arm = new THREE.Mesh(first_arm_geometry, grey_mesh);
    first_arm.position.set(-2.4, 3.4, 0.2);
    first_arm.rotation.z = Math.PI / 4;
    first_arm.castShadow = true;
    first_junc_group.add(first_arm);
    const bbox2 = new THREE.Group();
    const second_junc_group = new THREE.Group();
    bbox2.add(second_junc_group);
    second_junc_group.position.set(3.9, -4.5, 0);
    bbox2.position.set(-3.9, 4.5, 0);
    const second_junction = new THREE.Mesh(junction_geometry, grey_mesh);
    second_junction.position.set(-3.9, 4.5, 0);
    second_junction.rotation.x = Math.PI / 2;
    second_junction.castShadow = true;
    second_junc_group.add(second_junction);
    const second_base_geometry = new THREE.CylinderGeometry(0.4, 0.6, 3, 32);
    const second_base = new THREE.Mesh(second_base_geometry, grey_mesh);
    second_base.position.set(-3.5, 4.9, -0.8);
    second_base.rotation.z = -Math.PI / 3;
    second_base.castShadow = true;
    second_junc_group.add(second_base);
    const second_arm_geometry = new THREE.CylinderGeometry(0.3, 0.3, 2, 32);
    const second_arm = new THREE.Mesh(second_arm_geometry, yellow_mesh);
    second_arm.position.set(-1.5, 6.1, -0.8);
    second_arm.rotation.z = -Math.PI / 3;
    second_arm.castShadow = true;
    second_junc_group.add(second_arm);
    const side_arm_geometry = new THREE.BoxGeometry(0.8, 3.0, 0.3);
    const arm_sides = new THREE.Mesh(side_arm_geometry, yellow_mesh);
    arm_sides.position.set(-1.5, 6.1, -0.8);
    arm_sides.rotation.z = -Math.PI / 3;
    arm_sides.castShadow = true;
    second_junc_group.add(arm_sides);
    const hand_group = new THREE.Group();
    const hand_junction_geometry = new THREE.BoxGeometry(0.7, 0.7, 0.7);
    const hand_junction = new THREE.Mesh(hand_junction_geometry, yellow_mesh);
    hand_junction.position.set(-0.5, 6.65, -0.8);
    hand_junction.rotation.z = -Math.PI / 3;
    hand_junction.castShadow = true;
    hand_group.add(hand_junction);
    const wrist_bottom_geometry = new THREE.CylinderGeometry(0.45, 0.3, 0.8, 32);
    const wrist_bottom = new THREE.Mesh(wrist_bottom_geometry, grey_mesh);
    wrist_bottom.position.set(-0.12, 6.85, -0.8);
    wrist_bottom.rotation.z = -Math.PI / 3;
    wrist_bottom.castShadow = true;
    hand_group.add(wrist_bottom);
    const wrist_top_geometry = new THREE.CylinderGeometry(0.3, 0.45, 0.3, 32);
    const wrist_top = new THREE.Mesh(wrist_top_geometry, yellow_mesh);
    wrist_top.position.set(0.35, 7.1, -0.8);
    wrist_top.rotation.z = -Math.PI / 3;
    wrist_top.castShadow = true;
    hand_group.add(wrist_top);
    const pliersBaseGeometry = new THREE.BoxGeometry(0.2, 0.4, 0.1);
    const pliersBase = new THREE.Mesh(pliersBaseGeometry, grey_mesh);
    pliersBase.position.set(0.5, 7.2, -0.8);
    pliersBase.rotation.x = Math.PI / 2;
    hand_group.add(pliersBase);
    const pliersRotGeometry = new THREE.SphereGeometry(0.1, 12, 8);
    const pliersleftRot = new THREE.Mesh(pliersRotGeometry, grey_mesh);
    pliersleftRot.position.set(0.5, 7.2, -0.6);
    hand_group.add(pliersleftRot);
    const pliersrightRot = new THREE.Mesh(pliersRotGeometry, grey_mesh);
    pliersrightRot.position.set(0.5, 7.2, -1);
    hand_group.add(pliersrightRot);
    const lowLeftPlierGeom = new THREE.CylinderGeometry(0.05, 0.1, 0.5);
    const lowLeftPlier = new THREE.Mesh(lowLeftPlierGeom, grey_mesh);
    lowLeftPlier.position.set(0.6, 7.26, -0.54);
    lowLeftPlier.rotation.set(0, -Math.PI / 6, -Math.PI / 3);
    hand_group.add(lowLeftPlier);
    const lowRightPlier = new THREE.Mesh(lowLeftPlierGeom, grey_mesh);
    lowRightPlier.position.set(0.6, 7.26, -1.06);
    lowRightPlier.rotation.set(0, Math.PI / 6, -Math.PI / 3);
    hand_group.add(lowRightPlier);
    const leftPlierMid = new THREE.Mesh(pliersRotGeometry, grey_mesh);
    leftPlierMid.position.set(0.8, 7.38, -0.42);
    hand_group.add(leftPlierMid);
    const rightPlierMid = new THREE.Mesh(pliersRotGeometry, grey_mesh);
    rightPlierMid.position.set(0.8, 7.38, -1.16);
    hand_group.add(rightPlierMid);
    const leftPlierTopGeom = new THREE.CylinderGeometry(0.02, 0.08, 0.3);
    const leftPlierTop = new THREE.Mesh(leftPlierTopGeom, grey_mesh);
    leftPlierTop.position.set(0.88, 7.42, -0.47);
    leftPlierTop.rotation.set(0, Math.PI / 6, -Math.PI / 3);
    hand_group.add(leftPlierTop);
    const rightPlierTop = new THREE.Mesh(leftPlierTopGeom, grey_mesh);
    rightPlierTop.position.set(0.88, 7.42, -1.11);
    rightPlierTop.rotation.set(0, -Math.PI / 6, -Math.PI / 3);
    hand_group.add(rightPlierTop);
    const invisibleBoxGeometry = new THREE.BoxGeometry(0.8, 0.8, 0.8);
    const invisibleBox = new THREE.Mesh(invisibleBoxGeometry, yellow_mesh);
    invisibleBox.position.set(0.35, 7.1, 0);
    invisibleBox.rotation.z = -Math.PI / 3;
    invisibleBox.visible = false;
    hand_group.add(invisibleBox);
    second_junc_group.add(hand_group);
    first_junc_group.add(bbox2);
    arm_group.add(bbox);
    return arm_group;
}


function updateAnimationSequence(delta) {
    // Door preview is always visible now - no need to show/hide
    
    // 1️⃣ Open small (inner) door first
    if (state.authorized && !state.smallDoorOpen) {
        const doorPivot = smallDoor.parent;
        doorPivot.rotation.y += delta * 0.5;
        if (doorPivot.rotation.y >= Math.PI / 2) {
            state.smallDoorOpen = true;
            infoDiv.textContent = 'Small door opened.';
            addConsoleMessage('Small door opened successfully', 'info');
        }
    }
    // 2️⃣ Wait for the small door to open, then close it
    else if (state.smallDoorOpen && !state.smallDoorClosed) {
        const doorPivot = smallDoor.parent;
        doorPivot.rotation.y -= delta * 0.5;
        if (doorPivot.rotation.y <= 0) {
            state.smallDoorClosed = true;
            infoDiv.textContent = 'Small door closed.';
            addConsoleMessage('Small door closed', 'info');
        }
    }
    // 3️⃣ Open main (outer) door after the small door is closed
    else if (state.smallDoorClosed && !state.mainDoorOpen) {
        const doorPivot = mainDoor.parent;
        doorPivot.rotation.y += delta * 0.5;
        if (doorPivot.rotation.y >= Math.PI / 2) {
            state.mainDoorOpen = true;
            infoDiv.textContent = 'Main door opened.';
            addConsoleMessage('Main door opened successfully', 'info');
        }
    }
    // 4️⃣ Close main (outer) door after it's been opened
    else if (state.mainDoorOpen && !state.mainDoorClosed) {
        const doorPivot = mainDoor.parent;
        doorPivot.rotation.y -= delta * 0.5;
        if (doorPivot.rotation.y <= 0) {
            state.mainDoorClosed = true;
            infoDiv.textContent = 'Main door closed.';
            addConsoleMessage('Main door closed - sequence complete', 'info');
            state.sequenceComplete = true;
            state.authorized = false; // Reset authorized state for next cycle
            
            // Door preview stays visible - no need to hide
            
            // Reset door status on server to prevent continuous opening
            resetDoorStatusOnServer();
        }
    }
    
    // Update door preview if active
    updateDoorPreview();
    
    // Update fog density with smooth transition
    if (isFogBlocked) {
        fogDensity = Math.min(fogDensity + delta * FOG_TRANSITION_SPEED, 0.1);
    } else {
        fogDensity = Math.max(fogDensity - delta * FOG_TRANSITION_SPEED, 0);
    }
    scene.fog.density = fogDensity;
}

/**
 * FIX: This new function only removes objects from the scene.
 * It does NOT modify state variables like `automationRunning`.
 * This allows us to clean up before a new sequence without breaking the state lock.
 */
function clearAutomationObjects() {
    console.log('Clearing scene and resetting robot position...');
    const robotContainer = robot_arm?.parent;
    if (!robotContainer) {
        currentCargo = null;
        currentParcel = null;
        return;
    }

    // First, cancel any ongoing animations
    robotContainer.traverse((child) => {
        if (child.userData && child.userData.dropAnimationId) {
            cancelAnimationFrame(child.userData.dropAnimationId);
            child.userData.dropAnimationId = null;
        }
    });

    // Reset robot arm position
    if (robot_arm) {
        // Main rotation reset
        robot_arm.rotation.y = 0;
        
        // Reset lower arm (base joint)
        if (robot_arm.children[3]) {
            robot_arm.children[3].rotation.z = 0;
        }
        
        // Reset upper arm segments
        if (robot_arm.children[3] && robot_arm.children[3].children[0]) {
            const upperArm = robot_arm.children[3].children[0];
            upperArm.rotation.z = 0;
            
            // Reset second joint group if it exists
            if (upperArm.children[2]) {
                upperArm.children[2].rotation.z = 0;
                
                // Reset hand/gripper group if it exists
                if (upperArm.children[2].children[0]) {
                    upperArm.children[2].children[0].rotation.z = 0;
                }
            }
        }
    }

    const objectsToRemove = [];
    robotContainer.traverse((child) => {
        if (child.userData && (child.userData.isCargo || child.userData.isParcel || child.userData.isPlatform)) {
            // Cancel any ongoing animations for this object
            if (child.userData.dropAnimationId) {
                cancelAnimationFrame(child.userData.dropAnimationId);
                child.userData.dropAnimationId = null;
            }
            objectsToRemove.push(child);
        }
    });

    if (objectsToRemove.length > 0) {
        console.log(`Found and removing ${objectsToRemove.length} leftover objects.`);
        objectsToRemove.forEach(obj => {
            if (obj.parent) {
                obj.parent.remove(obj);
                // Clear any references or animations
                obj.userData = {};
            }
        });
    }

    // Clear references and ensure robot arm is reset
    currentCargo = null;
    currentParcel = null;
    
    // Reset robot arm position if needed
    if (robot_arm) {
        robot_arm.rotation.y = 0;
        if (robot_arm.children[3]) {
            robot_arm.children[3].rotation.z = 0; // Reset lower arm
        }
    }
}


function startAutomationSequence() {
    console.log('=== startAutomationSequence called ===');
    
    // FIX: Main defense against race conditions.
    // Lock the automation state immediately. If already running, exit.
    if (automationRunning) {
        console.log("Automation is already running, skipping duplicate start request.");
        return;
    }
    automationRunning = true; // LOCK ACQUIRED

    stopAllAutomation = false;
    
    // Switch camera to motor view when automation starts
    switchToMotorView();
    
    // Handle restart logic if all parcels were processed previously.
    if (totalParcelsToProcess <= 0) {
        console.log("All parcels were processed. Resetting for continuous operation.");
        totalParcelsToProcess = 999; // Set high number for continuous cycling
        boxCount = 0;
    }

    // FIX: Safely clean up any objects from a *previous*, failed run
    // without resetting the `automationRunning` lock we just acquired.
    clearAutomationObjects();
    
    // Now that the scene is clean and the lock is held, proceed.
    autoButton.disabled = true;
    autoButton.innerText = `Processing... (Boxes: ${boxCount})`;
    totalParcelsToProcess--;
    
    console.log('Starting automation sequence - remaining parcels:', totalParcelsToProcess);

    // STEP 1: Create the cargo carrier.
    const cargo = createCargo();
    const robotContainer = robot_arm.parent;
    robotContainer.add(cargo);
    currentCargo = cargo;
    
    console.log('New cargo created and tracked.');
    
    if (!cargoStartPosition || !cargoRailPath) {
        console.error('Rail system not properly initialized! Aborting sequence.');
        // FIX: Make sure to unlock if we abort early.
        automationRunning = false;
        autoButton.disabled = false;
        autoButton.innerText = 'Start Automation';
        return;
    }

    // Position cargo at the very beginning of the rails.
    cargo.position.copy(cargoStartPosition);
    cargo.position.y = 0.2; // Ensure proper height
    console.log('Cargo initial position set to:', cargo.position);
    
    // Set initial orientation.
    const tangent = cargoRailPath.getTangentAt(0);
    cargo.lookAt(cargoStartPosition.clone().add(tangent));

    // STEP 2: Animate the empty cargo from the back wall to the pickup spot.
    animateCargoOnPath(cargo, cargoRailPath, 0.0, progressAtPickup, 3000, () => {
        console.log('=== CARGO ARRIVED AT PICKUP ===');

        // STEP 3: Create a single parcel from the furnace.
        createAndAnimateParcelFromFurnace((nextParcel, _platform, retractPlatform) => {
            console.log('=== PARCEL CREATED, STARTING ROBOT ===');
            
            // Check if parcel creation was successful
            if (!nextParcel) {
                console.log('=== PARCEL CREATION FAILED OR AUTOMATION STOPPED ===');
                return;
            }
            
            if (currentParcel) {
                console.warn('A parcel already exists. Removing new one to prevent duplication.');
                if (nextParcel.parent) nextParcel.parent.remove(nextParcel);
                return;
            }
            currentParcel = nextParcel;

            // STEP 4: Animate the robot to place the parcel on the waiting cargo.
            animateRobotToParcel(nextParcel, cargo, () => {
                console.log('=== ROBOT FINISHED, RETRACTING PLATFORM ===');
                boxCount++;
                console.log(`Box ${boxCount} processed!`);

                // STEP 5: Retract the furnace platform.
                retractPlatform(() => {
                    console.log('=== PLATFORM RETRACTED, MOVING CARGO TO END ===');
                    
                    // STEP 6: Animate the full cargo from pickup to the end of the path.
                    animateCargoOnPath(cargo, cargoRailPath, progressAtPickup, 1.0, 6000, () => {
                        console.log('=== CARGO REACHED END, CLEANING UP FOR NEXT CYCLE ===');

                        // Full cleanup of this cycle's objects.
                        cleanupCurrentAutomation();
                        endAutomationCycle();
                        
                        // Check if automation should continue
                        if (totalParcelsToProcess > 0 && !stopAllAutomation) {
                            console.log("Cycle completed! Preparing for next cycle...");
                            autoButton.innerText = `Cycling... (Boxes: ${boxCount})`;
                            
                            // Start next cycle after a brief delay
                            setTimeout(() => {
                                if (!stopAllAutomation && totalParcelsToProcess > 0) {
                                    console.log("Starting next automation cycle...");
                                    startAutomationSequence();
                                }
                            }, 2000); // 2 second delay between cycles
                        } else {
                            console.log("Automation stopped or no more parcels to process.");
                            autoButton.innerText = "Automation Complete";
                            autoButton.disabled = false;
                        }
                    });
                });
            });
        });
    });
}

/**
 * FIX: This function now performs a full cleanup, including resetting the
 * `automationRunning` state. It's called only at the *end* of a successful cycle.
 */
function cleanupCurrentAutomation() {
    console.log('Performing full cleanup of completed cycle...');
    clearAutomationObjects(); // Remove objects from scene
    
    // Switch camera back to door view when automation stops
    switchBackToDoorView();
    
    // Reset state variables and UI for the next run
    automationRunning = false; // UNLOCK
    autoButton.disabled = false;
    autoButton.innerText = `Start Automation (Boxes: ${boxCount})`;
    
    console.log('Cleanup completed. System is ready for a new sequence.');
}

function animateCargoOnPath(cargo, path, startProgress, endProgress, duration, onCompleteCallback) {
    const startTime = Date.now();

    function move() {
        const elapsedTime = Date.now() - startTime;
        let progress = Math.min(elapsedTime / duration, 1);
        
        // Calculate current position along the single path
        const pathProgress = startProgress + progress * (endProgress - startProgress);
        const newPosition = path.getPointAt(pathProgress);
        cargo.position.copy(newPosition);

        // Smoothly rotate the cargo to face the direction of travel
        if (pathProgress < 1) {
            const tangent = path.getTangentAt(pathProgress);
            const lookAtPosition = newPosition.clone().add(tangent);
            
            // Using a temporary matrix to get the target rotation avoids gimbal lock
            const targetRotationMatrix = new THREE.Matrix4();
            targetRotationMatrix.lookAt(lookAtPosition, newPosition, cargo.up);
            const targetQuaternion = new THREE.Quaternion().setFromRotationMatrix(targetRotationMatrix);

            // Slerp (Spherical Linear Interpolation) for smooth rotation
            cargo.quaternion.slerp(targetQuaternion, 0.15);
        }
        
        if (progress < 1) {
            requestAnimationFrame(move);
        } else {
            if (onCompleteCallback) onCompleteCallback();
        }
    }
    move();
}

function animateRobotToParcel(parcelObj, cargoObj, onCompleteCallback) {
    // Add null checks to prevent errors
    if (!parcelObj || !cargoObj) {
        console.error('animateRobotToParcel: parcelObj or cargoObj is null');
        if (onCompleteCallback) onCompleteCallback();
        return;
    }
    
    const robotHand = robot_arm.children[3].children[0].children[2].children[0].children[4];
    const lowerArm = robot_arm.children[3];
    const upperArm = robot_arm.children[3].children[0].children[2];
    const tau = 0.3; // Changed to 0.5 for a faster animation
    const step = 1 / (tau * 60);

    const angleToParcel = Math.atan2(parcelObj.position.z, parcelObj.position.x);
    
    const placementPosition = new THREE.Vector3(
        cargoObj.position.x, 0.6, cargoObj.position.z
    );
    const angleToCargo = Math.atan2(placementPosition.z, placementPosition.x);
    
    const corrAngle = Math.acos(upperArm.position.distanceTo(robotHand.children[12].position) / upperArm.position.distanceTo(robotHand.children[2].position));
    
    const angleStepToParcel = (angleToParcel + corrAngle) * step;
    const angleStepToCargo = (angleToCargo + corrAngle) * step;

    const [theta, alpha] = calculateAngles(parcelObj);
    const [thetaPlace, alphaPlace] = calculatePlacementAngles(placementPosition);

    let t = 0;
    
    function animate() {
        if (t < 1) { // Go down to pick
            robot_arm.rotation.y -= angleStepToParcel;
            lowerArm.rotateZ(-alpha * step);
            upperArm.rotateZ(-theta * step);
        } else if (t < 2) { // Pick up and lift
            if (t >= 1 && t < 1 + step) {
                robotHand.add(parcelObj);
                parcelObj.position.set(0.8, 7.38, -0.79);
            }
            robot_arm.rotation.y += angleStepToParcel;
            lowerArm.rotateZ(alpha * step);
            upperArm.rotateZ(theta * step);
        } else if (t < 3) { // Rotate to placement
            robot_arm.rotation.y -= angleStepToCargo;
        } else if (t < 4) { // Go down to place
            lowerArm.rotateZ(-alphaPlace * step);
            upperArm.rotateZ(-thetaPlace * step);
        } else if (t < 5) { // Release and lift
            if (t >= 4 && t < 4 + step) {
                // To ensure the parcel is placed correctly and consistently, we will
                // set its position *locally* relative to the cargo vehicle after reparenting.
                cargoObj.add(parcelObj);
                
                // The cargo platform's top surface is at y=1.0 in local coordinates.
                // The parcel has a height of 0.8, so its center should be at y = 1.0 + (0.8 / 2) = 1.4.
                // We place it at the center of the cargo platform (local x=0, z=0).
                parcelObj.position.set(0, 1.4, 0);

                // Also, reset the parcel's rotation so it's aligned squarely with the cargo vehicle.
                parcelObj.rotation.set(0, 0, 0);
            }
            lowerArm.rotateZ(alphaPlace * step);
            upperArm.rotateZ(thetaPlace * step);
        } else if (t < 6) { // Return to start rotation
            robot_arm.rotation.y += angleStepToCargo;
        } else {
            if (onCompleteCallback) onCompleteCallback();
            return;
        }
        t += step;
        requestAnimationFrame(animate);
    }
    
    function calculateAngles(target) {
        const pToC = lowerArm.position.distanceTo(target.position);
        const cToC = lowerArm.position.distanceTo(upperArm.position);
        const cToH = upperArm.position.distanceTo(robotHand.children[5].position);
        let alpha = Math.acos((cToC**2 + pToC**2 - cToH**2) / (2 * cToC * pToC));
        alpha = Math.PI / 2 - alpha - (-Math.PI / 4) + 0.3;
        let theta = Math.acos((cToH**2 + cToC**2 - pToC**2) / (2 * cToH * cToC));
        theta = Math.PI / 2 - theta - (Math.PI / 2 - Math.PI / 3) + 0.1;
        return [theta, alpha];
    }

    function calculatePlacementAngles(target) {
        return calculateAngles({position: target});
    }
    
    animate();
}

function createAndAnimateParcelFromFurnace(onCompleteCallback) {
    if (stopAllAutomation) {
        if (onCompleteCallback) onCompleteCallback(null, null, () => {});
        return;
    }
    
    console.log('=== CREATING PARCEL FROM FURNACE ===');
    
    const textureLoader = new THREE.TextureLoader();
    const boxTexture = textureLoader.load('https://threejs.org/examples/textures/crate.gif');

    const parcelGeo = new THREE.BoxGeometry(0.8, 0.8, 0.8);
    const parcelMat = new THREE.MeshStandardMaterial({ map: boxTexture });
    const parcel = new THREE.Mesh(parcelGeo, parcelMat);
    parcel.castShadow = true;
    parcel.receiveShadow = true;
    parcel.userData.isParcel = true; // Mark for cleanup

    const platformGeo = new THREE.BoxGeometry(1.2, 0.15, 1.2);
    const platformMat = new THREE.MeshStandardMaterial({ color: 0x6b6b77, metalness: 0.6, roughness: 0.4 });
    const platform = new THREE.Mesh(platformGeo, platformMat);
    platform.castShadow = true;
    platform.receiveShadow = true;
    platform.userData.isPlatform = true; // Mark for cleanup

    const startInside = furnaceExitPosition.clone().add(new THREE.Vector3(4, -0.25, -3.0));
    const pickupPos = furnaceExitPosition.clone().add(new THREE.Vector3(4, -0.25, 0));

    const robotContainer = robot_arm.parent;
    if (!robotContainer) {
        console.error('Robot container not found!');
        if (onCompleteCallback) onCompleteCallback(null, null, () => {});
        return;
    }
    
    platform.position.copy(startInside);
    parcel.position.copy(startInside.clone().add(new THREE.Vector3(0, 0.55, 0)));
    robotContainer.add(platform);
    robotContainer.add(parcel);

    console.log('Parcel and platform created, starting slide animation');
    
    const easeOut = t => 1 - Math.pow(1 - t, 2);
    const outDuration = 1500;
    const outStart = Date.now();
    let slideOutCompleted = false;

    function slideOut() {
        if (slideOutCompleted) return;
        
        const elapsed = Date.now() - outStart;
        const t = Math.min(elapsed / outDuration, 1);
        const k = easeOut(t);

        const targetPlatformPos = startInside.clone().lerp(pickupPos, k);
        const targetParcelPos = startInside.clone().add(new THREE.Vector3(0, 0.55, 0)).lerp(
            pickupPos.clone().add(new THREE.Vector3(0, 0.55, 0)), k
        );
        
        platform.position.copy(targetPlatformPos);
        parcel.position.copy(targetParcelPos);

        if (t < 1.0) {
            requestAnimationFrame(slideOut);
        } else {
            slideOutCompleted = true;
            console.log('Parcel slide-out complete, parcel ready for pickup');
            
            const retractPlatform = (done) => {
                console.log('Starting platform retraction');
                const inDuration = 1000;
                const inStart = Date.now();
                
                function retract() {
                    const elapsedRetract = Date.now() - inStart;
                    const t2 = Math.min(elapsedRetract / inDuration, 1);
                    const k2 = easeOut(t2);
                    
                    platform.position.copy(pickupPos.clone().lerp(startInside, k2));
                    
                    if (t2 < 1.0) {
                        requestAnimationFrame(retract);
                    } else {
                        if (platform.parent) platform.parent.remove(platform);
                        console.log('Platform retraction complete');
                        if (done) done();
                    }
                }
                retract();
            };
            

            function animate() {
                requestAnimationFrame(animate);
                
                const deltaTime = clock.getDelta();
                
                // Update controls
                controls.update();
                
                // Update light intensities smoothly
                updateLightIntensities(deltaTime);
                
                // Update door animations
                updateDoorAnimations();
                
                // Update robot arm animation
                if (robot_arm) {
                    robot_arm.update();
                }
                
                // Update furnace animation
                if (furnace) {
                    furnace.update();
                }
                
                renderer.render(scene, camera);
            }

            if (onCompleteCallback) onCompleteCallback(parcel, platform, retractPlatform);
        }
    }
    slideOut();
}

function createCargo() {
    // Materials
    const orangeMaterial = new THREE.MeshPhongMaterial({
        color: 0xff6600,
        shininess: 300,
        specular: 0x444444
    });

    const blackMaterial = new THREE.MeshPhongMaterial({
        color: 0x1a1a1a,
        shininess: 80,
        specular: 0x666666
    });

    const grayMaterial = new THREE.MeshPhongMaterial({
        color: 0x555555,
        shininess: 50,
        specular: 0x333333
    });

    const wheelMaterial = new THREE.MeshPhongMaterial({
        color: 0x2a2a2a,
        shininess: 20
    });

    const lightMaterial = new THREE.MeshPhongMaterial({
        color: 0xffffff,
        emissive: 0xffffaa,
        emissiveIntensity: 0.3
    });

    // Create cargo robot group
    const cargoRobot = new THREE.Group();
    cargoRobot.userData.isCargo = true; // Mark for cleanup

    // Main base (orange body) - Scaled down
    const baseGeometry = new THREE.BoxGeometry(2.5, 0.7, 2.5);
    const baseMesh = new THREE.Mesh(baseGeometry, orangeMaterial);
    baseMesh.position.y = 0.35; // Adjusted position to sit on the floor
    baseMesh.castShadow = true;
    baseMesh.receiveShadow = true;
    cargoRobot.add(baseMesh);

    // Top cargo platform (black) - Scaled down
    const platformGeometry = new THREE.BoxGeometry(0.2, 0.2, 2.2);
    const platformMesh1 = new THREE.Mesh(platformGeometry, blackMaterial);
    platformMesh1.position.y = 0.9;
    platformMesh1.castShadow = true;
    platformMesh1.receiveShadow = true;
    cargoRobot.add(platformMesh1);

    const platformMesh2 = new THREE.Mesh(platformGeometry, blackMaterial);
    platformMesh2.position.y = 0.9;
    platformMesh2.position.x = 0.4;
    platformMesh2.castShadow = true;
    platformMesh2.receiveShadow = true;
    cargoRobot.add(platformMesh2);

    const platformMesh3 = new THREE.Mesh(platformGeometry, blackMaterial);
    platformMesh3.position.y = 0.9;
    platformMesh3.position.x = 0.8;
    platformMesh3.castShadow = true;
    platformMesh3.receiveShadow = true;
    cargoRobot.add(platformMesh3);

    const platformMesh4 = new THREE.Mesh(platformGeometry, blackMaterial);
    platformMesh4.position.y = 0.9;
    platformMesh4.position.x = -0.4;
    platformMesh4.castShadow = true;
    platformMesh4.receiveShadow = true;
    cargoRobot.add(platformMesh4);

    const platformMesh5 = new THREE.Mesh(platformGeometry, blackMaterial);
    platformMesh5.position.y = 0.9;
    platformMesh5.position.x = -0.8;
    platformMesh5.castShadow = true;
    platformMesh5.receiveShadow = true;
    cargoRobot.add(platformMesh5);

    // Platform raised edges - Scaled down
    const edgeHeight = 0.2;
    const edgeDepth = 0.1;
    const edgeWidth = 2.3;
    const sideEdgeDepth = 2.2;
    
    const frontEdge = new THREE.Mesh(new THREE.BoxGeometry(edgeWidth, edgeHeight, edgeDepth), blackMaterial);
    frontEdge.position.set(0, 0.9, 1.15);
    frontEdge.castShadow = true;
    cargoRobot.add(frontEdge);

    const backEdge = frontEdge.clone();
    backEdge.position.z = -1.15;
    cargoRobot.add(backEdge);

    const leftEdge = new THREE.Mesh(new THREE.BoxGeometry(edgeDepth, edgeHeight, sideEdgeDepth), blackMaterial);
    leftEdge.position.set(1.15, 0.9, 0);
    leftEdge.castShadow = true;
    cargoRobot.add(leftEdge);

    const rightEdge = leftEdge.clone();
    rightEdge.position.x = -1.15;
    cargoRobot.add(rightEdge);

    // Wheels - Scaled down
    const wheelRadius = 0.2;
    const wheelThickness = 0.1;
    const wheelGeometry = new THREE.CylinderGeometry(wheelRadius, wheelRadius, wheelThickness, 16);
    const wheelPositions = [
        { x: 1.3, z: 0.8 }, { x: -1.3, z: 0.8 },
        { x: 1.3, z: -0.8 }, { x: -1.3, z: -0.8 }
    ];

    const wheelY = -0.1;
    wheelPositions.forEach(pos => {
        const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
        wheel.position.set(pos.x, wheelY, pos.z);
        wheel.rotation.z = Math.PI / 2;
        wheel.castShadow = true;
        cargoRobot.add(wheel);

        // Wheel rims - Scaled down
        const rimGeometry = new THREE.CylinderGeometry(0.22, 0.22, 0.05, 16);
        const rim = new THREE.Mesh(rimGeometry, grayMaterial);
        rim.position.set(pos.x, wheelY, pos.z);
        rim.rotation.z = Math.PI / 2;
        cargoRobot.add(rim);
    });

    // LED lights (white rectangles on front and back) - Scaled down
    const lightGeometry = new THREE.BoxGeometry(0.5, 0.3, 0.05);
    
    // Front lights
    const frontLight1 = new THREE.Mesh(lightGeometry, lightMaterial);
    frontLight1.position.set(-0.6, 0.4, 1.3);
    cargoRobot.add(frontLight1);

    const frontLight2 = new THREE.Mesh(lightGeometry, lightMaterial);
    frontLight2.position.set(0.6, 0.4, 1.3);
    cargoRobot.add(frontLight2);

    // Back lights
    const backLight1 = new THREE.Mesh(lightGeometry, lightMaterial);
    backLight1.position.set(-0.6, 0.4, -1.3);
    cargoRobot.add(backLight1);

    const backLight2 = new THREE.Mesh(lightGeometry, lightMaterial);
    backLight2.position.set(0.6, 0.4, -1.3);
    cargoRobot.add(backLight2);

    // Central sensor/control unit - Scaled down
    const sensorGeometry = new THREE.BoxGeometry(0.6, 0.2, 0.5);
    const sensorMesh = new THREE.Mesh(sensorGeometry, blackMaterial);
    sensorMesh.position.set(0, 0.8, 0);
    sensorMesh.castShadow = true;
    cargoRobot.add(sensorMesh);

    return cargoRobot;
}

function createSinglePathAndVisualRails(pathDef, container) {
    const railsGroup = new THREE.Group();
    const railMaterial = new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.8, roughness: 0.3 });
    const railOffset = 1.4; // The distance from the center path to each rail
    const rail_y = pathDef.start.y;

    const pickupPosition = pathDef.start.clone();
    const backWallWorldZ = -45;
    const backWallLocalZ = (backWallWorldZ - container.position.z) / container.scale.z;
    const startPosition = new THREE.Vector3(pickupPosition.x, rail_y, backWallLocalZ);

    // 1. Define the single, central path for the vehicle to follow.
    const centerPath = new THREE.CurvePath();
    const straightSegment = new THREE.LineCurve3(startPosition, pickupPosition);
    const curvedSegment = new THREE.CubicBezierCurve3(pickupPosition, pathDef.control1, pathDef.control2, pathDef.end);
    centerPath.add(straightSegment);
    centerPath.add(curvedSegment);

    // 2. Calculate the total length and the progress at the pickup point.
    const straightLength = straightSegment.getLength();
    const totalLength = centerPath.getLength();
    const progressAtPickupPoint = straightLength / totalLength;

    // 3. Generate points for the two VISUAL rails by offsetting from the central path.
    const numPoints = 256; // More points for a smoother visual rail
    const points1 = []; // Points for the left rail
    const points2 = []; // Points for the right rail

    for (let i = 0; i <= numPoints; i++) {
        const u = i / numPoints;
        const point = centerPath.getPointAt(u);
        const tangent = centerPath.getTangentAt(u);
        const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize(); // Perpendicular vector in the XZ plane

        // Create points for each rail by moving along the normal
        const point1 = point.clone().add(normal.clone().multiplyScalar(railOffset / 2));
        const point2 = point.clone().add(normal.clone().multiplyScalar(-railOffset / 2));
        points1.push(point1);
        points2.push(point2);
    }

    // 4. Create smooth curves through the offset points for the visual rails.
    const railCurve1 = new THREE.CatmullRomCurve3(points1);
    const railCurve2 = new THREE.CatmullRomCurve3(points2);

    // 5. Create the 3D tube geometry for the visual rails.
    const tubeGeometry1 = new THREE.TubeGeometry(railCurve1, 256, 0.05, 8, false);
    const tubeGeometry2 = new THREE.TubeGeometry(railCurve2, 256, 0.05, 8, false);
    railsGroup.add(new THREE.Mesh(tubeGeometry1, railMaterial));
    railsGroup.add(new THREE.Mesh(tubeGeometry2, railMaterial));
    
    return {
        rails: railsGroup,
        path: centerPath, // Return the single central path for animation
        progressAtPickup: progressAtPickupPoint,
        startPosition: startPosition
    };
}

// Function to control all lights together
function controlAllLights(targetIntensity, transitionSpeed = 0.5) {
    lightIntensityTarget = targetIntensity;
    lightTransitionSpeed = transitionSpeed;
}

// Function to update light intensities smoothly
function updateLightIntensities(deltaTime) {
    ceilingLights.forEach(light => {
        if (light.intensity < lightIntensityTarget) {
            light.intensity += deltaTime * lightTransitionSpeed;
            if (light.intensity > lightIntensityTarget) light.intensity = lightIntensityTarget;
        } else if (light.intensity > lightIntensityTarget) {
            light.intensity -= deltaTime * lightTransitionSpeed;
            if (light.intensity < lightIntensityTarget) light.intensity = lightIntensityTarget;
        }
    });
}

// Function to control ceiling fixture visibility based on camera position
function updateCeilingFixtureVisibility() {
    if (!camera || ceilingLightFixtures.length === 0) return;
    
    // Room dimensions (from createRoom function)
    const roomWidth = 120;
    const roomDepth = 90;
    const wallHeight = 25;
    const ceilingHeight = wallHeight; // 25 units
    
    // Get camera position
    const cameraX = camera.position.x;
    const cameraY = camera.position.y;
    const cameraZ = camera.position.z;
    
    // Check if camera is inside room boundaries and below ceiling
    const isInsideRoomX = cameraX >= -roomWidth/2 && cameraX <= roomWidth/2;
    const isInsideRoomZ = cameraZ >= -roomDepth/2 && cameraZ <= roomDepth/2;
    const isBelowCeiling = cameraY < ceilingHeight;
    
    // Show fixtures only when camera is inside the room AND below ceiling level
    const shouldShowFixtures = isInsideRoomX && isInsideRoomZ && isBelowCeiling;
    
    ceilingLightFixtures.forEach(fixture => {
        fixture.visible = shouldShowFixtures;
    });
}

// Function to update door animations
function updateDoorAnimations() {
    const delta = clock.getDelta();
    updateAnimationSequence(delta);
}

// --- ESP32 DATA AND LABELS ---
function initializeESP32Data() {
    esp32Data = [
        {
            name: "Motion Detector",
            description: "The Motion Detector, equipped with an ESP8266, detects movement using a PIR sensor, making it an essential component for security systems in homes and businesses. This node's functionality highlights its role in automated security setups, where real-time motion detection triggers alerts and recordings, enhancing the safety and surveillance capabilities of the system.",
            image: "img/motiondetect.jpg",
            functions: ["Motion Detection", "Security Alerts", "Real-time Monitoring", "Automated Recording"],
            status: "Active",
            lastUpdate: new Date(),
            components: [
                { type: "Controller", name: "ESP8266 Dev Board (NodeMCU)" },
                { type: "Sensor", name: "PIR Motion Sensor" },
                { type: "Actuators", name: "Servo Motor" },
                { type: "Actuators", name: "Green LED" }
            ]
        },
        {
            name: "Access Control System",
            description: "The Access Control System, utilizes the Raspberry Pi Pico W to implement RFID-based access control, enhancing security by allowing or denying entry based on authorized credentials. This system integrates with IoT platforms to monitor access in real-time, making it ideal for secure areas in educational, corporate, or residential environments. Its role within the cyber-physical system framework is to ensure a secure and manageable entry point that leverages cloud connectivity for efficient access logging and control.",
            image: "img/access_control.jpg", 
            functions: ["RFID Authentication", "Door Control", "Security Logging", "IoT Integration"],
            status: "Active",
            lastUpdate: new Date(),
            components: [
                { type: "Controller", name: "Raspberry Pi Pico W" },
                { type: "Sensor", name: "RC522 RFID Reader" },
                { type: "Actuators", name: "Servo Motor" },
                { type: "Actuators", name: "Buzzer" },
                { type: "Actuators", name: "Red LED" },
                { type: "Actuators", name: "Green LED" }
            ]
        },
        {
            name: "Obstacle Detector",
            description: "This node utilizes an ESP32 to process signals from ultrasonic sensors for detecting obstacles, crucial for robotic navigation and automated vehicle systems. It helps prevent collisions and facilitates smooth operational pathways in complex environments, showcasing the integration of sensory data and machine response in real-time applications.",
            image: "img/ObstacleDetector.jpg",
            functions: ["Obstacle Detection", "Collision Prevention", "Robotic Navigation", "Real-time Processing"],
            status: "Active", 
            lastUpdate: new Date(),
            components: [
                { type: "Controller", name: "ESP32 Dev Board" },
                { type: "Sensor", name: "Ultrasonic Sensor (HC-SR04)" },
                { type: "Actuators", name: "Buzzer" },
                { type: "Actuators", name: "Red LED" }
            ]
        },
        {
            name: "Temperature Control System",
            description: "The Temperature Control System employs the ESP32 Dev Board alongside the LM35 temperature sensor to manage and regulate temperature in controlled environments such as greenhouses or server rooms. This node optimizes conditions through automated adjustments, ensuring environmental stability—crucial for sensitive operations and processes.",
            image: "img/TemperatureControlSystem.jpg",
            functions: ["Temperature Monitoring", "Environmental Control", "Automated Regulation", "Climate Optimization"],
            status: "Active",
            lastUpdate: new Date(),
            components: [
                { type: "Controller", name: "ESP32 Dev Board" },
                { type: "Sensor", name: "LM35 Temperature Sensor" },
                { type: "Actuators", name: "Red LED" },
                { type: "Actuators", name: "Relay" },
                { type: "Actuators", name: "5V DC Fan" }
            ]
        },
        {
            name: "ENVIRONMENTAL MONITORING SYSTEM",
            description: "The Environmental Monitoring System, utilizes the ESP32 microcontroller to monitor and control environmental conditions such as temperature, humidity, and air quality. It uses sensors like DHT11, MQ135, and LDR to collect data and provides real-time monitoring through an LCD display. This system helps ensure healthier indoor environments and supports smart monitoring for homes, offices, and industries.",
            image: "img/envmonitor.jpg",
            functions: ["Video Monitoring", "Intrusion Detection", "Emergency Response"],
            status: "Active",
            lastUpdate: new Date(),
            components: [
                { type: "Controller", name: "ESP32 Dev Board" },
                { type: "Sensor", name: "DHT11 Digital Relative Humidity and Temperature Sensor Module" },
                { type: "Sensor", name: "MQ135 Air/Gas Detector Sensor Module" },
                { type: "Sensor", name: "LM393 Photosensitive Light-Dependent Control Sensor LDR Module" },
                
            ]
        },
        {
            name: "Energy Management System",
            description: "The Energy Management System, leverages the ESP32 microcontroller to monitor and control energy usage efficiently in buildings and industrial settings. It uses sensors to track power consumption and automates the management of energy resources to optimize usage and reduce costs, demonstrating the potential of smart systems to enhance sustainability and operational efficiency.",
            image: "img/EnergyManagementSystem.jpg",
            functions: ["Power Monitoring", "Energy Optimization", "Resource Management", "Cost Reduction"],
            status: "Active",
            lastUpdate: new Date(),
            components: [
                { type: "Controller", name: "ESP32 Dev Board" },
                { type: "Sensors", name: "INA219 DC Power Monitor Module" },
                { type: "Sensors", name: "Momentary Tactile Push Button" },
                { type: "Motor Driver", name: "Cytron MD10C" },
                { type: "Actuators", name: "Incandescent Bulb" },
                { type: "Actuators", name: "Heater (Power Resistor)" },
                { type: "Actuators", name: "DC Motor" },
                { type: "Actuators", name: "LCD, 16x2 Character" },
                { type: "Actuators", name: "Relay" }
            ]
        },
        {
            name: "MOTOR MONITORING SYSTEM",
            description: "The Motor Monitoring System uses the ESP32 microcontroller to monitor and control motor operations with real-time feedback. It integrates multiple sensors including VL6180X distance sensor, piezoelectric vibration sensor, and INA219 current sensor for comprehensive motor monitoring. The system provides automated safety controls, vibration detection, power monitoring, and visual feedback through an OLED display. This system is ideal for industrial automation, predictive maintenance, and motor safety applications.",
            image: "img/motormonitoring.jpg",
            functions: ["Device Communication", "Data Relay", "Protocol Translation"],
            status: "Active",
            lastUpdate: new Date(),
            components: [
                { type: "Controller", name: "ESP32 Dev Board" },
                { type: "Sensor", name: "MLX90614 Infrared Temperature Sensor" },
                { type: "Sensor", name: "MLX90614 ESF Non-Contact Infrared Temperature Measurement Module" },
                { type: "Sensor", name: "Photoelectric Speed Sensor with coded Encoder Disc " },
                { type: "Actuators", name: "DC Motor " },
                { type: "Actuators", name: "Servo Motor" },
                
            ]
            

        },
        {
            name: "Machine Monitoring System",
            description: "The Machine Monitoring System uses the ESP32 microcontroller to monitor and control lathe operations with real-time feedback. It integrates multiple sensors including VL6180X distance sensor, piezoelectric vibration sensor, and INA219 current sensor for comprehensive machine monitoring. The system provides automated safety controls, vibration detection, power monitoring, and visual feedback through an OLED display. This system is ideal for industrial automation, predictive maintenance, and machine safety applications.",
            image: "img/monitoring.jpg",
            functions: ["Robot Control", "Process Automation", "Task Scheduling"],
            status: "Active",
            lastUpdate: new Date(),
            components: [
                { type: "Controller", name: "ESP32 Dev Board" },
                { type: "Sensor", name: "VL6180X Distance Sensor" },
                { type: "Sensor", name: "Piezoelectric Vibration Sensor" },
                { type: "Sensor", name: "INA219 Current Sensor" },
                { type: "Actuators", name: "LR7843 Mosfet" },
                { type: "Actuators", name: "DC Motor " },
                { type: "Actuators", name: "I1.3 inch Oled Display" },
                { type: "Actuators", name: "Led" },
                { type: "Actuators", name: "Buzzer" },
                { type: "Actuators", name: "SG90 Servo motor" },
            ]
        }
    ];
}

function createESP32TimeLabels(esp32Groups) {
    initializeESP32Data();
    
    esp32Groups.forEach((group, index) => {
        if (group && esp32Data[index]) {
            const labelGroup = new THREE.Group();
            
            // Create name display canvas
            const canvas = document.createElement('canvas');
            canvas.width = 600;
            canvas.height = 140;
            const ctx = canvas.getContext('2d');
            
            // Create label texture
            const texture = new THREE.CanvasTexture(canvas);
            texture.flipY = true;
            
            // Create label geometry and material (larger size for long text)
            const labelGeometry = new THREE.PlaneGeometry(6, 1.4);
            const labelMaterial = new THREE.MeshBasicMaterial({
                map: texture,
                transparent: true,
                alphaTest: 0.1,
                side: THREE.DoubleSide
            });
            
            const labelMesh = new THREE.Mesh(labelGeometry, labelMaterial);
            
            // Position label above ESP32
            const labelOffset = new THREE.Vector3(0, 3, 0);
            labelMesh.position.copy(group.position).add(labelOffset);
            
            // Make label always face camera
            labelMesh.lookAt(camera.position);
            
            labelGroup.add(labelMesh);
            scene.add(labelGroup);
            
            // Store references
            esp32Labels.push({
                mesh: labelMesh,
                canvas: canvas,
                ctx: ctx,
                texture: texture,
                data: esp32Data[index],
                group: labelGroup
            });
            
            // Update initial label content
            updateLabelContent(esp32Labels[index]);
        }
    });
    
    // Start time update interval
    setInterval(updateAllLabels, 1000);
}

function updateLabelContent(label) {
    const ctx = label.ctx;
    const data = label.data;
    
    // Clear canvas
    ctx.clearRect(0, 0, 600, 140);
    
    // Background with rounded corners
    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.fillRect(0, 0, 600, 140);
    
    // Border
    ctx.strokeStyle = '#00ff00';
    ctx.lineWidth = 2;
    ctx.strokeRect(2, 2, 596, 136);
    
    // Device name with text wrapping for long names
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    
    // Check if text is too long and needs wrapping
    const maxWidth = 580;
    let fontSize = 40;
    ctx.font = `bold ${fontSize}px Arial`;
    
    // Reduce font size if text is too wide
    while (ctx.measureText(data.name).width > maxWidth && fontSize > 20) {
        fontSize -= 2;
        ctx.font = `bold ${fontSize}px Arial`;
    }
    
    // If still too wide, split into multiple lines
    if (ctx.measureText(data.name).width > maxWidth) {
        const words = data.name.split(' ');
        const lines = [];
        let currentLine = '';
        
        for (let word of words) {
            const testLine = currentLine + (currentLine ? ' ' : '') + word;
            if (ctx.measureText(testLine).width > maxWidth && currentLine) {
                lines.push(currentLine);
                currentLine = word;
            } else {
                currentLine = testLine;
            }
        }
        if (currentLine) lines.push(currentLine);
        
        // Draw multiple lines
        const lineHeight = fontSize + 5;
        const startY = 70 - ((lines.length - 1) * lineHeight / 2);
        
        lines.forEach((line, index) => {
            ctx.fillText(line, 300, startY + (index * lineHeight));
        });
    } else {
        // Draw single line
        ctx.fillText(data.name, 300, 80);
    }
    
    // Click instruction (smaller, at bottom)
    ctx.fillStyle = '#ffff00';
    ctx.font = '12px Arial';
    ctx.fillText('Click for details', 300, 120);
    
    // Update texture
    label.texture.needsUpdate = true;
}

function updateAllLabels() {
    esp32Labels.forEach(label => {
        // Update timestamp
        label.data.lastUpdate = new Date();
        updateLabelContent(label);
        
        // Make label face camera
        if (camera) {
            label.mesh.lookAt(camera.position);
        }
    });
}

// --- ESP32 POPUP FUNCTIONALITY ---
let raycaster, mouse;

function setupESP32ClickListeners(esp32Group, esp32Group1, esp32Group2, esp32Group3, esp32Group4, esp32Group5, esp32Group6, esp32Group7) {
    // Initialize raycaster and mouse for click detection
    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();

    // Add click event listener to the renderer canvas
    renderer.domElement.addEventListener('click', onESP32Click, false);
    
    // Store references to ESP32 groups for click detection with data indices
    const esp32Groups = [esp32Group, esp32Group1, esp32Group2, esp32Group3, esp32Group4, esp32Group5, esp32Group6, esp32Group7];
    const popupIds = ['esp32-popup', 'esp32-access-popup', 'esp32-motion-popup', 'esp32-lighting-popup', 'esp32-security-popup', 'esp32-environmental-popup', 'esp32-iot-popup', 'esp32-automation-popup'];
    
    esp32Groups.forEach((group, index) => {
        if (group) {
            group.userData.popupId = popupIds[index];
            group.userData.dataIndex = index;
            group.userData.name = esp32Data[index] ? esp32Data[index].name : `ESP32_${index}`;
        }
    });
}

function onESP32Click(event) {
    // Calculate mouse position in normalized device coordinates (-1 to +1)
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    // Update the picking ray with the camera and mouse position
    raycaster.setFromCamera(mouse, camera);

    // Calculate objects intersecting the picking ray
    const intersects = raycaster.intersectObjects(scene.children, true);

    if (intersects.length > 0) {
        // Find the first intersected object that belongs to an ESP32 group or label
        for (let i = 0; i < intersects.length; i++) {
            let object = intersects[i].object;
            
            // Check if clicked object is a label
            const labelIndex = esp32Labels.findIndex(label => label.mesh === object);
            if (labelIndex !== -1) {
                console.log(`Clicked on label for ${esp32Labels[labelIndex].data.name}`);
                showDynamicPopup(labelIndex);
                return;
            }
            
            // Traverse up the hierarchy to find ESP32 group
            while (object.parent) {
                if (object.userData.popupId && object.userData.dataIndex !== undefined) {
                    console.log(`Clicked on ${object.userData.name}`);
                    showDynamicPopup(object.userData.dataIndex);
                    return;
                }
                object = object.parent;
            }
        }
    }
}

function showDynamicPopup(dataIndex) {
    if (!esp32Data[dataIndex]) return;
    
    const data = esp32Data[dataIndex];
    
    // Create or get dynamic popup
    let popup = document.getElementById('dynamic-esp32-popup');
    if (!popup) {
        popup = createDynamicPopup();
    }
    
    // Update popup content
    updatePopupContent(popup, data);
    
    // Show popup
    popup.style.display = 'flex';
    console.log(`Showing dynamic popup for: ${data.name}`);
}

function createDynamicPopup() {
    const popup = document.createElement('div');
    popup.id = 'dynamic-esp32-popup';
    popup.className = 'popup-overlay';
    popup.innerHTML = `
        <div class="popup-content">
            <div class="popup-header">
                <h2 class="popup-title" id="dynamic-popup-title">ESP32 Device</h2>
                <button class="close-btn" onclick="closePopup('dynamic-esp32-popup')">&times;</button>
            </div>
            <div class="popup-body">
                <div class="popup-left">
                    <img id="dynamic-popup-image" src="" alt="ESP32 Device" class="popup-image">
                </div>
                <div class="popup-right">
                    <div class="popup-description">
                        <p id="dynamic-popup-description">Device description</p>
                        
                        <div id="dynamic-popup-components" class="popup-specs" style="display: none;">
                            <h3>Components Summary:</h3>
                            <table class="components-table">
                                <thead>
                                    <tr>
                                        <th>Component Type</th>
                                        <th>Component Name</th>
                                    </tr>
                                </thead>
                                <tbody id="dynamic-popup-components-table">
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(popup);
    return popup;
}

function updatePopupContent(popup, data) {
    // Update title
    const title = popup.querySelector('#dynamic-popup-title');
    if (title) title.textContent = data.name;
    
    // Update image
    const image = popup.querySelector('#dynamic-popup-image');
    if (image) {
        image.src = data.image;
        image.alt = data.name;
    }
    
    // Update description
    const description = popup.querySelector('#dynamic-popup-description');
    if (description) description.textContent = data.description;
    
    // Update components table if available
    const componentsSection = popup.querySelector('#dynamic-popup-components');
    const componentsTable = popup.querySelector('#dynamic-popup-components-table');
    if (data.components && componentsTable) {
        componentsSection.style.display = 'block';
        componentsTable.innerHTML = '';
        data.components.forEach(component => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${component.type}</td>
                <td>${component.name}</td>
            `;
            componentsTable.appendChild(row);
        });
    } else if (componentsSection) {
        componentsSection.style.display = 'none';
    }
}

function showPopup(popupId) {
    const popup = document.getElementById(popupId);
    if (popup) {
        popup.style.display = 'flex';
        console.log(`Showing popup: ${popupId}`);
    }
}

function closePopup(popupId) {
    const popup = document.getElementById(popupId);
    if (popup) {
        popup.style.display = 'none';
        console.log(`Closing popup: ${popupId}`);
    }
}

// Make closePopup function globally available for HTML onclick
window.closePopup = closePopup;

// Make switchDoorCamera function globally available for HTML onclick
window.switchDoorCamera = switchDoorCamera;

// Close popup when clicking outside the content
document.addEventListener('click', function(event) {
    const popups = document.querySelectorAll('.popup-overlay');
    popups.forEach(popup => {
        if (event.target === popup) {
            popup.style.display = 'none';
        }
    });
});

// Close popup with Escape key
document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') {
        const popups = document.querySelectorAll('.popup-overlay');
        popups.forEach(popup => {
            if (popup.style.display === 'flex') {
                popup.style.display = 'none';
            }
        });
    }
});

// --- MAIN ANIMATION LOOP ---
function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();
    const elapsedTime = clock.getElapsedTime();

    // ✅ Replace custom human entry animation with our new function
    updateAnimationSequence(delta);

    // Walking animation logic removed
    
    // --- LIGHTS ANIMATION ---
    // Gradually adjust all lights to target intensity
    ceilingLights.forEach(light => {
        if (light.intensity < lightIntensityTarget) {
            light.intensity += delta * lightTransitionSpeed;
            if (light.intensity > lightIntensityTarget) light.intensity = lightIntensityTarget;
        } else if (light.intensity > lightIntensityTarget) {
            light.intensity -= delta * lightTransitionSpeed;
            if (light.intensity < lightIntensityTarget) light.intensity = lightIntensityTarget;
        }
    });

    // Furnace flicker effect
    if (furnace && furnace.userData.fireLight) {
        const flicker = 1.2 + Math.sin(elapsedTime * 5) * 0.3 + Math.random() * 0.2;
        furnace.userData.fireLight.intensity = flicker * 2;
        furnace.userData.fireMesh.material.emissiveIntensity = flicker * 1.5;
    }

    // Update ceiling fixture visibility based on camera position
    updateCeilingFixtureVisibility();

    // Update and Render
    controls.update();
    renderer.render(scene, camera);
}

function onWindowResize() {
    const canvasContainer = document.getElementById('canvas-container');
    const containerWidth = canvasContainer.clientWidth;
    const containerHeight = canvasContainer.clientHeight;
    
    camera.aspect = containerWidth / containerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(containerWidth, containerHeight);
    
    // Also resize door preview if it exists
    if (doorPreviewRenderer) {
        const sidebarWidth = window.innerWidth * 0.3;
        const previewWidth = sidebarWidth - 40;
        const previewHeight = (previewWidth * 9) / 16;
        
        if (frontCamera) {
            frontCamera.aspect = previewWidth / previewHeight;
            frontCamera.updateProjectionMatrix();
        }
        if (motorCamera) {
            motorCamera.aspect = previewWidth / previewHeight;
            motorCamera.updateProjectionMatrix();
        }
        if (blueprintCamera) {
            const orthoSize = 30; // Match the optimized size from init
            blueprintCamera.left = -orthoSize;
            blueprintCamera.right = orthoSize;
            blueprintCamera.top = orthoSize * (previewHeight/previewWidth);
            blueprintCamera.bottom = -orthoSize * (previewHeight/previewWidth);
            blueprintCamera.updateProjectionMatrix();
        }
        doorPreviewRenderer.setSize(previewWidth, previewHeight);
    }
}

// --- START EVERYTHING ---
init();
