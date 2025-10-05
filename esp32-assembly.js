// esp32-assembly.js

// ✅ ADD THIS LINE
import * as THREE from 'three';

// ESP32 WROOM DevKit V1 - 3D Model (Three.js ES Module)
function createFullESP32Assembly(containerId = 'container') {
    let scene, camera, renderer, esp32Group;
    let isAnimating = true;
    let targetRotationX = 0, targetRotationY = 0;

    function init() {
        // Scene setup
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x1a1a2e);

        // Camera setup
        camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        camera.position.set(15, 10, 15);

        // Renderer setup
        renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        // document.getElementById(containerId).appendChild(renderer.domElement);

        // Lighting
        const ambientLight = new THREE.AmbientLight(0x404040, 0.6);
        scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(20, 20, 20);
        directionalLight.castShadow = true;
        directionalLight.shadow.mapSize.width = 2048;
        directionalLight.shadow.mapSize.height = 2048;
        scene.add(directionalLight);

        const pointLight = new THREE.PointLight(0x4080ff, 0.5, 100);
        pointLight.position.set(-10, 10, 10);
        scene.add(pointLight);

        // ESP32 model
        createESP32Model();

        // Ground plane
        const groundGeometry = new THREE.PlaneGeometry(50, 50);
        const groundMaterial = new THREE.MeshLambertMaterial({
            color: 0x2c3e50,
            transparent: true,
            opacity: 0.3
        });
        const ground = new THREE.Mesh(groundGeometry, groundMaterial);
        ground.rotation.x = -Math.PI / 2;
        ground.position.y = -3;
        ground.receiveShadow = true;
        scene.add(ground);

        // Transparent enclosure
        createEnclosureBox();

        // Controls
        setupMouseControls();

        // Start animation
        animate();

        // Handle window resize
        window.addEventListener('resize', handleResize);
    }

    // ----------------- HELPER FUNCTIONS -----------------

    function createRoundedPCB(width, height, depth, radius) {
        const shape = new THREE.Shape();
        const x = -width / 2;
        const y = -height / 2;
        const w = width;
        const h = height;
        const r = radius;

        shape.moveTo(x + r, y);
        shape.lineTo(x + w - r, y);
        shape.quadraticCurveTo(x + w, y, x + w, y + r);
        shape.lineTo(x + w, y + h - r);
        shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        shape.lineTo(x + r, y + h);
        shape.quadraticCurveTo(x, y + h, x, y + h - r);
        shape.lineTo(x, y + r);
        shape.quadraticCurveTo(x, y, x + r, y);

        return new THREE.ExtrudeGeometry(shape, { depth: depth, bevelEnabled: false });
    }

    function createESP32Model() {
        esp32Group = new THREE.Group();

        // PCB
        const pcbGeometry = createRoundedPCB(3, 5, 0.15, 0.15);
        const pcbMaterial = new THREE.MeshLambertMaterial({ color: 0x383B39 });
        const pcb = new THREE.Mesh(pcbGeometry, pcbMaterial);
        pcb.rotation.x = -Math.PI / 2;
        pcb.position.y = 0;
        pcb.castShadow = true;
        esp32Group.add(pcb);

        // ESP32 module with label
        const esp32Texture = createTextTexture("ESP WROOM-32");
        const moduleGeometry = new THREE.BoxGeometry(1.5, 0.08, 2);
        const moduleMaterial = new THREE.MeshPhysicalMaterial({
            color: 0xfff000,
            metalness: 0.8,
            roughness: 0.2,
            map: esp32Texture
        });
        const module = new THREE.Mesh(moduleGeometry, moduleMaterial);
        module.position.set(0, 0.2, 1.5);
        module.castShadow = true;
        esp32Group.add(module);

        // USB connector
        const usbGeometry = new THREE.BoxGeometry(0.8, 0.1, 0.6);
        const usbMaterial = new THREE.MeshLambertMaterial({ color: 0xB2beb5 });
        const usb = new THREE.Mesh(usbGeometry, usbMaterial);
        usb.position.set(0, 0.15, -2.4);
        usb.castShadow = true;
        esp32Group.add(usb);

        // Mounting holes
        createMountingHoles();

        // GPIO headers
        createGPIOHeaders();

        // LEDs, buttons, SMDs, etc.
        createButton(0.8, 0.2, -2.2, 0x333333);
        createButton(-0.8, 0.2, -2.2, 0x333333);
        led();
        createBlackLED(); // <-- ADDED THIS
        esp32Group.add(createSMD(0.6, 0.15, -0.5, 'C1'));
        esp32Group.add(createSMD(0.4, 0.15, -0.2, 'C2'));
        esp32Group.add(createSMD(0, 0.15, 0.8, 'R1'));

        // Text labels
        createPCBLabels();

        scene.add(esp32Group);
    }

    function createTextTexture(text) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = 400;
        canvas.height = 100;
        ctx.fillStyle = '#2a2a2a';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#000000';
        ctx.font = 'bold 20px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, canvas.width / 2, canvas.height / 2);
        const texture = new THREE.CanvasTexture(canvas);
        texture.flipY = true;
        return texture;
    }
//////////////////////////////////////////////////////////////////

function createMountingHoles() {
    // Create 4 circular mounting holes at PCB corners
    const holeRadius = 0.15;
    const holeGeometry = new THREE.CylinderGeometry(holeRadius, holeRadius, 0.2, 16);
    const holeMaterial = new THREE.MeshBasicMaterial({ 
        color: 0x000000,
        transparent: true,
        opacity: 0.9
    });
    
    // Corner positions (slightly inset from edges)
    const cornerOffset = 0.2;
    const corners = [
        { x: -1.5 + cornerOffset, z: -2.5 + cornerOffset },  // Top-left
        { x: 1.5 - cornerOffset, z: -2.5 + cornerOffset },   // Top-right
        { x: -1.5 + cornerOffset, z: 2.5 - cornerOffset },   // Bottom-left
        { x: 1.5 - cornerOffset, z: 2.5 - cornerOffset }     // Bottom-right
    ];
    
    corners.forEach(corner => {
        const hole = new THREE.Mesh(holeGeometry, holeMaterial);
        hole.position.set(corner.x, 0.08, corner.z);
     
        esp32Group.add(hole);
    });
}

    function led()
    {
    const ledGroup = new THREE.Group();
    
    // LED housing (clear/translucent dome)
    const ledDomeGeometry = new THREE.SphereGeometry(0.08, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    const ledDomeMaterial = new THREE.MeshPhysicalMaterial({ 
        color: 0xffffff,
        transparent: true,
        opacity: 0.3,
        roughness: 0.1,
        metalness: 0.0,
        transmission: 0.9,
        ior: 1.5
    });
    const ledDome = new THREE.Mesh(ledDomeGeometry, ledDomeMaterial);
    ledDome.position.y = 2;
    ledGroup.add(ledDome);
    
    // LED base (black plastic housing)
    const ledBaseGeometry = new THREE.CylinderGeometry(0.08, 0.08, 0.08, 16);
    const ledBaseMaterial = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });
    const ledBase = new THREE.Mesh(ledBaseGeometry, ledBaseMaterial);
    ledBase.position.y = 1.9;
    ledGroup.add(ledBase);
    
    // LED chip (emissive core) - realistic glow
    const ledChipGeometry = new THREE.SphereGeometry(0.04, 16, 16);
    const ledChipMaterial = new THREE.MeshBasicMaterial({ 
        color: 0xFFEA00,
        toneMapped: false
    });
    const ledChip = new THREE.Mesh(ledChipGeometry, ledChipMaterial);
    ledChip.position.y = 2;
    ledGroup.add(ledChip);
    
    // Add realistic point light for LED illumination
    const ledLight = new THREE.PointLight(0xFFEA00, 2.0, 15);
    ledLight.position.copy(ledChip.position);
    ledLight.position.y += 0.02;
    ledLight.castShadow = false; // Disable shadows to reduce texture units usage
    ledLight.shadow.mapSize.width = 256;
    ledLight.shadow.mapSize.height = 256;
    ledLight.shadow.camera.near = 0.1;
    ledLight.shadow.camera.far = 25;
    ledGroup.add(ledLight);
    
    // Add subtle outer glow sphere
    const glowGeometry = new THREE.SphereGeometry(0.08, 16, 16);
    const glowMaterial = new THREE.MeshBasicMaterial({
        color: 0xFFEA00,
        transparent: true,
        opacity: 0.3,
        side: THREE.BackSide
    });
    const glowSphere = new THREE.Mesh(glowGeometry, glowMaterial);
    glowSphere.position.copy(ledChip.position);
    ledGroup.add(glowSphere);
    
    // LED leads (metal wires)
    const leadGeometry = new THREE.CylinderGeometry(0.005, 0.005, 0.3, 8);
    const leadMaterial = new THREE.MeshLambertMaterial({ 
        color: 0xc0c0c0
    });
    
    // Positive lead (longer)
    const positiveLead = new THREE.Mesh(leadGeometry, leadMaterial);
    positiveLead.position.set(0.03, 1.8, 0);
    ledGroup.add(positiveLead);
    
    // Negative lead (shorter)
    const negativeLead = new THREE.Mesh(leadGeometry, leadMaterial);
    negativeLead.position.set(-0.03, 1.8, 0);
    negativeLead.scale.y = 0.8; // Make it shorter
    ledGroup.add(negativeLead);
    
    // Position the entire LED assembly off the board
    ledGroup.position.set(-2.5, 1.2, -1.0); // Positioned to the left of the ESP32 board
    ledGroup.rotation.y = Math.PI / 4; // Slight rotation for better visibility
    
    // Create wire connections from ESP32 pins to LED
    createWireConnections(ledGroup);
    
    esp32Group.add(ledGroup); 
}

    // --- NEW FUNCTION FOR BLACK LED ---
    function createBlackLED() {
        const ledGroup = new THREE.Group();

        const ledDomeMaterial = new THREE.MeshPhysicalMaterial({
            color: 0x111111,
            transparent: true,
            opacity: 0.8,
            roughness: 0.1,
            metalness: 0.1,
        });
        const ledDomeGeometry = new THREE.SphereGeometry(0.08, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
        const ledDome = new THREE.Mesh(ledDomeGeometry, ledDomeMaterial);
        ledDome.position.y = 2;
        ledGroup.add(ledDome);

        const ledBaseGeometry = new THREE.CylinderGeometry(0.08, 0.08, 0.08, 16);
        const ledBaseMaterial = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });
        const ledBase = new THREE.Mesh(ledBaseGeometry, ledBaseMaterial);
        ledBase.position.y = 1.9;
        ledGroup.add(ledBase);

        const ledChipGeometry = new THREE.SphereGeometry(0.04, 16, 16);
        const ledChipMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 });
        const ledChip = new THREE.Mesh(ledChipGeometry, ledChipMaterial);
        ledChip.position.y = 2;
        ledGroup.add(ledChip);

        const leadGeometry = new THREE.CylinderGeometry(0.005, 0.005, 0.3, 8);
        const leadMaterial = new THREE.MeshLambertMaterial({ color: 0xc0c0c0 });

        const positiveLead = new THREE.Mesh(leadGeometry, leadMaterial);
        positiveLead.position.set(0.03, 1.8, 0);
        ledGroup.add(positiveLead);

        const negativeLead = new THREE.Mesh(leadGeometry, leadMaterial);
        negativeLead.position.set(-0.03, 1.8, 0);
        negativeLead.scale.y = 0.8;
        ledGroup.add(negativeLead);
        
        // Position on the right side of the board
        ledGroup.position.set(2.5, 1.2, -1.0); 
        ledGroup.rotation.y = -Math.PI / 4;
        
        createWireConnectionsForBlackLED(ledGroup);
        
        esp32Group.add(ledGroup);
    }

    function createWireConnections(ledGroup) {
        // This function connects the YELLOW LED to the LEFT side of the board.
        
        // Define connection points on the PCB
        const positivePinPos = new THREE.Vector3(-1.2, 0.16, 2.0); // Left side, "3V3" pin
        const negativePinPos = new THREE.Vector3(-1.2, 0.16, 2 - 0.28); // Left side, "GND" pin
        
        // Define local connection points on the LED
        const positiveLedLeadLocalPos = new THREE.Vector3(0.03, 1.7, 0);
        const negativeLedLeadLocalPos = new THREE.Vector3(-0.03, 1.7, 0);
        
        // Get the LED group's position and rotation relative to the main esp32Group
        const ledGroupPos = ledGroup.position;
        const ledGroupRotY = ledGroup.rotation.y;
        
        // Calculate the final position of the LED leads in the esp32Group's coordinate space
        const positiveLedLeadFinalPos = positiveLedLeadLocalPos.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), ledGroupRotY).add(ledGroupPos);
        const negativeLedLeadFinalPos = negativeLedLeadLocalPos.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), ledGroupRotY).add(ledGroupPos);
        
        // Create the wires and add them to the main group
        const redWire = createWire(positivePinPos, positiveLedLeadFinalPos, 0xff0000);
        esp32Group.add(redWire);
        
        const blackWire = createWire(negativePinPos, negativeLedLeadFinalPos, 0x000000);
        esp32Group.add(blackWire);
    }
    
    function createWireConnectionsForBlackLED(ledGroup) {
        // This function connects the BLACK LED to the RIGHT side of the board.

        // Define connection points on the PCB
        const positivePinPos = new THREE.Vector3(1.2, 0.16, 2 - (2 * 0.28)); // Right side, "D13" pin
        const negativePinPos = new THREE.Vector3(1.2, 0.16, 2 - (3 * 0.28)); // Right side, "D12" pin
        
        // Define local connection points on the LED
        const positiveLedLeadLocalPos = new THREE.Vector3(0.03, 1.7, 0);
        const negativeLedLeadLocalPos = new THREE.Vector3(-0.03, 1.7, 0);
        
        // Get the LED group's position and rotation relative to the main esp32Group
        const ledGroupPos = ledGroup.position;
        const ledGroupRotY = ledGroup.rotation.y;
        
        // Calculate the final position of the LED leads in the esp32Group's coordinate space
        const positiveLedLeadFinalPos = positiveLedLeadLocalPos.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), ledGroupRotY).add(ledGroupPos);
        const negativeLedLeadFinalPos = negativeLedLeadLocalPos.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), ledGroupRotY).add(ledGroupPos);

        // Create the wires and add them to the main group
        const redWire = createWire(positivePinPos, positiveLedLeadFinalPos, 0xff0000);
        esp32Group.add(redWire);
        
        const blackWire = createWire(negativePinPos, negativeLedLeadFinalPos, 0x000000);
        esp32Group.add(blackWire);
    }

    function createWire(startPos, endPos, color) {
        const wireGroup = new THREE.Group();
        
        // Create curved path for more realistic wire
        const curve = new THREE.QuadraticBezierCurve3(
            startPos,
            new THREE.Vector3(
                (startPos.x + endPos.x) / 2,
                Math.max(startPos.y, endPos.y) + 0.8, // Arc upward
                (startPos.z + endPos.z) / 2
            ),
            endPos
        );
        
        // Create wire geometry from curve
        const wireGeometry = new THREE.TubeGeometry(curve, 20, 0.008, 8, false);
        const wireMaterial = new THREE.MeshLambertMaterial({ color: color });
        const wire = new THREE.Mesh(wireGeometry, wireMaterial);
        
        wireGroup.add(wire);
        return wireGroup;
    }

    function createEnclosureBox() {
    const enclosureGroup = new THREE.Group();
    
    // Box dimensions - large enough to contain ESP32 and LED
    const boxWidth = 8; // Increased width for both LEDs
    const boxHeight = 3;
    const boxDepth = 8;
    const wallThickness = 0.05;
    
    // Transparent material for the walls
    const wallMaterial = new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.3,
        roughness: 0.1,
        metalness: 0.0,
        transmission: 0.9,
        ior: 1.5,
        side: THREE.DoubleSide
    });
    
    // Front wall
    const frontWallGeometry = new THREE.BoxGeometry(boxWidth, boxHeight, wallThickness);
    const frontWall = new THREE.Mesh(frontWallGeometry, wallMaterial);
    frontWall.position.set(0, boxHeight/2, boxDepth/2);
    enclosureGroup.add(frontWall);
    
    // Back wall
    const backWall = new THREE.Mesh(frontWallGeometry, wallMaterial);
    backWall.position.set(0, boxHeight/2, -boxDepth/2);
    enclosureGroup.add(backWall);
    
    // Left wall
    const sideWallGeometry = new THREE.BoxGeometry(wallThickness, boxHeight, boxDepth);
    const leftWall = new THREE.Mesh(sideWallGeometry, wallMaterial);
    leftWall.position.set(-boxWidth/2, boxHeight/2, 0);
    enclosureGroup.add(leftWall);
    
    // Right wall
    const rightWall = new THREE.Mesh(sideWallGeometry, wallMaterial);
    rightWall.position.set(boxWidth/2, boxHeight/2, 0);
    enclosureGroup.add(rightWall);
    
    // Top wall (optional - can be removed for open top)
    const topWallGeometry = new THREE.BoxGeometry(boxWidth, wallThickness, boxDepth);
    const topWall = new THREE.Mesh(topWallGeometry, wallMaterial);
    topWall.position.set(0, boxHeight, 0);
    enclosureGroup.add(topWall);
    
    // Bottom wall/base
    const bottomWall = new THREE.Mesh(topWallGeometry, wallMaterial);
    bottomWall.position.set(0, 0, 0);
    enclosureGroup.add(bottomWall);
    
    // Position the enclosure to center around the ESP32 and LED
    enclosureGroup.position.set(0, 0, 0); // Centered
    
    esp32Group.add(enclosureGroup);
}

    function createPinHeader(x , y , z , scale = 0.2, rotationY = 0) {
    const group = new THREE.Group();

    // Main rectangular slot (black header) - oriented along board width
    const bodyGeometry = new THREE.BoxGeometry(4.2, 0.1, 0.3);
    const bodyMaterial = new THREE.MeshPhongMaterial({ color: 0x222222 });
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.castShadow = true;
    group.add(body);

    // Hole style: realistic ring (torus) + inner cutout
    const ringMaterial = new THREE.MeshPhongMaterial({ color:0xFfd700, shininess: 100 });
    const holeXStart = -2.6;

    for (let i = 0; i < 15; i++) {
        const xOffset = holeXStart + i * 0.35;

        // Outer ring (via/pad)
        const ring = new THREE.Mesh(
            new THREE.TorusGeometry(0.1, 0.008, 8, 16),
            ringMaterial
        );
        ring.rotation.x = Math.PI / 2;
        ring.position.set(xOffset, 0.08, 0);
        group.add(ring);
    }

    group.position.set(x, y, z);
    group.rotation.y = rotationY;
    group.scale.set(scale, scale, scale);

    return group;
}

    function createPinLabel(text, position, rotation = { x: -Math.PI / 2, y: 0, z: 0 }, size = { width: 0.3, height: 0.15 }) {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    
    canvas.width = 256;
    canvas.height = 64;
    
    // Clear background - smaller rectangle centered in canvas
    const rectWidth = 120;
    const rectHeight = 40;
    const rectX = (canvas.width - rectWidth) / 2;
    const rectY = (canvas.height - rectHeight) / 2;
    
    context.fillStyle = '#ffffff';
    context.fillRect(rectX, rectY, rectWidth, rectHeight);
    
    // Draw text centered in the rectangle
    context.fillStyle = '#000000';
    context.font = 'bold 20px Arial';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, canvas.width / 2, canvas.height / 2);
    
    const texture = new THREE.CanvasTexture(canvas);
    texture.flipY = true;
    
    const labelGeometry = new THREE.PlaneGeometry(size.width, size.height);
    const labelMaterial = new THREE.MeshBasicMaterial({ 
        map: texture, 
        transparent: true,
        alphaTest: 0.1
    });
    
    const label = new THREE.Mesh(labelGeometry, labelMaterial);
    label.position.set(position.x, position.y, position.z);
    label.rotation.set(rotation.x, rotation.y, rotation.z);
    
    return label;
}

    function createGPIOHeaders() {
    // Create detailed pin headers on both sides
    esp32Group.add(createPinHeader(1.2, 0.1, -0.1, 0.8, Math.PI / 2));
    esp32Group.add(createPinHeader(-1.2, 0.1, 0, 0.8, Math.PI / 2));
    
    // Pin labels for left side (15 pins)
    const leftPinLabels = [
        "3V3", "GND", "D15", "D2", "D4", "RX2", "TX2", "D5", "D18", 
        "D19", "D21", "RX0", "TX0", "D22", "D23"
    ];
    
    // Pin labels for right side (15 pins)
    const rightPinLabels = [
        "VIN", "GND", "D13", "D12", "D14", "D27", "D26", "D25",
        "D33", "D32", "D35", "D34", "VN", "VP", "EN"
    ];
    
    // Add left side labels
    leftPinLabels.forEach((label, index) => {
        const yPos = 2 - (index * 0.28); // Spacing between pins
        esp32Group.add(createPinLabel(label, 
            { x: -1.4, y: 0.16, z: yPos },
            { x: -Math.PI / 2, y: 0, z: 0 },
            { width: 0.25, height: 0.12 }
        ));
    });
    
    // Add right side labels
    rightPinLabels.forEach((label, index) => {
        const yPos = 2 - (index * 0.28); // Spacing between pins
        esp32Group.add(createPinLabel(label, 
            { x: 1.4, y: 0.16, z: yPos },
            { x: -Math.PI / 2, y: 0, z: 0 },
            { width: 0.25, height: 0.12 }
        ));
    });
}


    function createSMD(x, y, z, label = '', rotationY = 0) {
    const smdGroup = new THREE.Group();

    // Green PCB Pad
    const padGeometry = new THREE.BoxGeometry(1.2, 0.05, 0.6);
    const padMaterial = new THREE.MeshPhongMaterial({ color: 0x3e7d3e });
    const pad = new THREE.Mesh(padGeometry, padMaterial);
    pad.position.set(0, -0.075, 0);
    smdGroup.add(pad);

    // Yellow solder pads
    const padSize = [0.3, 0.1, 0.6];
    const yellowMaterial = new THREE.MeshPhongMaterial({ color: 0xffd700 });

    const leftPad = new THREE.Mesh(new THREE.BoxGeometry(...padSize), yellowMaterial);
    leftPad.position.set(-0.45, 0, 0);
    smdGroup.add(leftPad);

    const rightPad = new THREE.Mesh(new THREE.BoxGeometry(...padSize), yellowMaterial);
    rightPad.position.set(0.45, 0, 0);
    smdGroup.add(rightPad);

    // White terminals
    const terminalSize = [0.2, 0.2, 0.6];
    const whiteMaterial = new THREE.MeshPhongMaterial({ color: 0xffffff });

    const leftTerminal = new THREE.Mesh(new THREE.BoxGeometry(...terminalSize), whiteMaterial);
    leftTerminal.position.set(-0.3, 0.1, 0);
    smdGroup.add(leftTerminal);

    const rightTerminal = new THREE.Mesh(new THREE.BoxGeometry(...terminalSize), whiteMaterial);
    rightTerminal.position.set(0.3, 0.1, 0);
    smdGroup.add(rightTerminal);

    // Brown body
    const bodyGeometry = new THREE.BoxGeometry(0.4, 0.2, 0.6);
    const bodyMaterial = new THREE.MeshPhongMaterial({ color: 0xA0522D });
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.position.set(0, 0.1, 0);
    smdGroup.add(body);

    // Set position, rotation, scale
    smdGroup.position.set(x, y, z);
    smdGroup.rotation.y = rotationY;
    smdGroup.castShadow = true;
    smdGroup.scale.set(0.3, 0.3, 0.3);

    return smdGroup;
}



    function createButton(x, y, z, color) {
    const buttonBaseGeometry = new THREE.CylinderGeometry(0.15, 0.15, 0.05, 16);
    const buttonBaseMaterial = new THREE.MeshLambertMaterial({ color: 0x666666 });
    const buttonBase = new THREE.Mesh(buttonBaseGeometry, buttonBaseMaterial);
    buttonBase.position.set(x, y, z);

    const buttonTopGeometry = new THREE.CylinderGeometry(0.12, 0.12, 0.03, 16);
    const buttonTopMaterial = new THREE.MeshLambertMaterial({ color: color });
    const buttonTop = new THREE.Mesh(buttonTopGeometry, buttonTopMaterial);
    buttonTop.position.set(x, y + 0.04, z);

    esp32Group.add(buttonBase);
    esp32Group.add(buttonTop);
}

    function createCapacitor(x, y, z, color) {
    const capGeometry = new THREE.CylinderGeometry(0.1, 0.1, 0.2, 16);
    const capMaterial = new THREE.MeshLambertMaterial({ color: color });
    const capacitor = new THREE.Mesh(capGeometry, capMaterial);
    capacitor.position.set(x, y, z);
    esp32Group.add(capacitor);
}

    function createResistor(x, y, z) {
    const resistorGeometry = new THREE.CylinderGeometry(0.03, 0.03, 0.15, 8);
    const resistorMaterial = new THREE.MeshLambertMaterial({ color: 0x8B4513 });
    const resistor = new THREE.Mesh(resistorGeometry, resistorMaterial);
    resistor.position.set(x, y, z);
    resistor.rotation.z = Math.PI / 2;
    // esp32Group.add(resistor);
}

    function createPCBLabels() {
    // Create simple geometric shapes to represent labels and text
    const labelMaterial = new THREE.MeshBasicMaterial({ 
        color: 0xffffff, 
        transparent: true, 
        opacity: 0.9 
    });

    // GPIO labels (small rectangles) - adjusted for new PCB size
    for (let i = 0; i < 15; i++) {
        const labelGeometry = new THREE.PlaneGeometry(0.15, 0.08);
        const leftLabel = new THREE.Mesh(labelGeometry, labelMaterial);
        leftLabel.position.set(-1.2, 0.08, -2.3 + (i * 0.31));
        leftLabel.rotation.x = -Math.PI / 2;

        const rightLabel = new THREE.Mesh(labelGeometry, labelMaterial);
        rightLabel.position.set(1.2, 0.08, -2.3 + (i * 0.31));
        rightLabel.rotation.x = -Math.PI / 2;

        esp32Group.add(leftLabel);
        esp32Group.add(rightLabel);
    }
}

    function setupMouseControls() {
    let isDragging = false;
    let previousMousePosition = { x: 0, y: 0 };
    
    // Camera orbit parameters
    let cameraDistance = 10;
    let cameraTheta = 0; // Horizontal rotation
    let cameraPhi = Math.PI / 4; // Vertical rotation (start at 45 degrees)
    
    function updateCameraPosition() {
        // Convert spherical coordinates to cartesian
        const x = cameraDistance * Math.sin(cameraPhi) * Math.cos(cameraTheta);
        const y = cameraDistance * Math.cos(cameraPhi);
        const z = cameraDistance * Math.sin(cameraPhi) * Math.sin(cameraTheta);
        
        camera.position.set(x, y, z);
        camera.lookAt(0, 0, 0); // Always look at the center of the scene
    }
    
    // Initialize camera position
    updateCameraPosition();

    renderer.domElement.addEventListener('mousedown', (e) => {
        isDragging = true;
        previousMousePosition = { x: e.clientX, y: e.clientY };
        renderer.domElement.style.cursor = 'grabbing';
    });

    renderer.domElement.addEventListener('mousemove', (e) => {
        if (isDragging) {
            const deltaMove = {
                x: e.clientX - previousMousePosition.x,
                y: e.clientY - previousMousePosition.y
            };

            // Update camera angles based on mouse movement
            cameraTheta -= deltaMove.x * 0.01; // Horizontal rotation
            cameraPhi += deltaMove.y * 0.01;   // Vertical rotation
            
            // Clamp vertical rotation to prevent flipping
            cameraPhi = Math.max(0.1, Math.min(Math.PI - 0.1, cameraPhi));
            
            updateCameraPosition();
            previousMousePosition = { x: e.clientX, y: e.clientY };
        }
    });

    renderer.domElement.addEventListener('mouseup', () => {
        isDragging = false;
        renderer.domElement.style.cursor = 'grab';
    });
    
    renderer.domElement.addEventListener('mouseleave', () => {
        isDragging = false;
        renderer.domElement.style.cursor = 'grab';
    });

    renderer.domElement.addEventListener('wheel', (e) => {
        e.preventDefault();
        cameraDistance += e.deltaY * 0.01;
        cameraDistance = Math.max(2, Math.min(50, cameraDistance)); // Clamp zoom
        updateCameraPosition();
    });
    
    // Set initial cursor style
    renderer.domElement.style.cursor = 'grab';
}

////////////////////////////////////////////////////////////

// ----------------- CORE FUNCTIONS -----------------

    function animate() {
        requestAnimationFrame(animate);
        camera.lookAt(esp32Group.position);
        renderer.render(scene, camera);
    }

    function resetView() {
        camera.position.set(15, 10, 15);
        targetRotationX = 0;
        targetRotationY = 0;
        esp32Group.rotation.set(0, 0, 0);
    }

    function toggleAnimation() {
        isAnimating = !isAnimating;
    }

    function handleResize() {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    }

    // Initialize
    init();

    // Public API
    return {
        resetView,
        toggleAnimation,
        getScene: () => scene,
        getCamera: () => camera,
        getRenderer: () => renderer,
        getESP32Group: () => esp32Group
    };
}

// ✅ Export for import usage
export { createFullESP32Assembly };

