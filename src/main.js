import * as THREE from '../node_modules/three/build/three.module.js';
import { GUI } from '../node_modules/three/examples/jsm/libs/lil-gui.module.min.js';
import World from './World.js';
import webrioLoader from './webrio.js'

/** The fundamental set up and animation structures for 3D Visualization */
export default class Main {

    constructor() {
        // Intercept Main Window Errors
        window.realConsoleError = console.error;
        window.addEventListener('error', (event) => {
            let path = event.filename.split("/");
            this.display((path[path.length - 1] + ":" + event.lineno + " - " + event.message));
        });
        console.error = this.fakeError.bind(this);
        this.deferredConstructor();
    }
    async deferredConstructor() {
        // Configure Settings
        this.sm64Params = {
            loadRom: this.loadFromFilePicker.bind(this),
            tickEveryMS: 33.333,
        };
        this.gui = new GUI();
        this.gui.add(this.sm64Params, 'loadRom' ).name( 'Load ROM' );
        this.gui.add(this.sm64Params, 'tickEveryMS', 1, 100).name( 'TickEveryMS' );

        // Construct the render world
        this.world = new World(this);

        this.mesh = new THREE.Mesh( this.cylinderGeo , this.material  );
        this.world.scene.add( this.mesh );
        this.mesh.position.set(0.0, 2.1, 0.4);

        this.isDeployed = document.pathname !== '/';
        this.assetsPath = this.isDeployed ? './assets/' : '../assets/';

        // Load the SM64 WASM Library
        this.webrio = await webrioLoader();
        window.Webrio = this.webrio; // for debugging.

        // Attempt to load the SM64 ROM
        this.loadFromURL(this.assetsPath+"baserom.us.z64");
    }

    async loadFromURL(url) {
        let response = await fetch(url);
        if(response.ok){
            let rom = new Uint8Array(await (response).arrayBuffer());
            await this.initializeFromROM(rom);
        }
    }

    // Load the SM64 ROM from a file picker
    async loadFromFilePicker() {
        let file = document.createElement('input');
        file.type = 'file';
        file.accept = '.z64';
        file.onchange = async (e) => {
            let file = e.target.files[0];
            let rom = new Uint8Array(await file.arrayBuffer());
            await this.initializeFromROM(rom);
        };
        file.click();
    }

    async initializeFromROM(rom) {
        // THE FOLLOWING IS ENTIRELY BASED ON CODE RIPPED FROM https://github.com/osnr/Webrio -------------------------------

        // Initialize the SM64 Global State by loading the rom into it
        let heapRomPtr = this.webrio._malloc(rom.length);
        let heapRom = new Uint8Array(this.webrio.HEAPU8.buffer, heapRomPtr, rom.length);
        heapRom.set(rom);
        let heapTexLength = (64 * 11) * 64 * 4;
        let heapTexPtr = this.webrio._malloc(heapTexLength);

        // Initialize the player's mesh buffers; these will get updated in the player tick
        const sizeofFloat = 4;
        const SM64_GEO_MAX_TRIANGLES = 1024;
        let positionBufPtr = this.webrio._malloc(sizeofFloat * 9 * SM64_GEO_MAX_TRIANGLES);
        let colorBufPtr    = this.webrio._malloc(sizeofFloat * 9 * SM64_GEO_MAX_TRIANGLES);
        let normalBufPtr   = this.webrio._malloc(sizeofFloat * 9 * SM64_GEO_MAX_TRIANGLES);
        let uvBufPtr       = this.webrio._malloc(sizeofFloat * 6 * SM64_GEO_MAX_TRIANGLES);

        Webrio._webrio_init(heapRomPtr, heapTexPtr,
                            positionBufPtr, colorBufPtr,
                            normalBufPtr, uvBufPtr);

        // Load world:
        const surfaces = [];
        const surfacesCount = Webrio._webrio_get_surfaces_count();
        for (let i = 0; i < surfacesCount; i++) {
            const verticesPtr = Webrio._malloc(4 * 9); // int32_t[3][3]
            const verticesArr = new Int32Array(Webrio.HEAP32.buffer, verticesPtr, 4 * 9);
            Webrio._webrio_get_surface_vertices(i, verticesPtr);

            surfaces.push({
                type: Webrio._webrio_get_surface_type(i),
                force: Webrio._webrio_get_surface_force(i),
                terrain: Webrio._webrio_get_surface_terrain(i),
                vertices: verticesArr
            });
        }

        // Create a new mesh, and accumulate the surface triangles
        // First, create the vertex buffer for three.js
        this.levelVertices = new Float32Array(surfacesCount * 9);
        for (let i = 0; i < surfacesCount; i++) {
            const surface = surfaces[i];
            for (let j = 0; j < 3; j++) {
                this.levelVertices[i * 9 + j * 3 + 0] = surface.vertices[j * 3 + 0] / 100;
                this.levelVertices[i * 9 + j * 3 + 1] = surface.vertices[j * 3 + 1] / 100;
                this.levelVertices[i * 9 + j * 3 + 2] = surface.vertices[j * 3 + 2] / 100;
            }
        }
        // Create the geometry
        this.levelGeometry = new THREE.BufferGeometry();
        this.levelGeometry.setAttribute('position', new THREE.BufferAttribute(this.levelVertices, 3));
        this.levelGeometry.computeVertexNormals();
        this.levelMaterial = new THREE.MeshPhysicalMaterial({ color: 0x00ff00, side: THREE.DoubleSide });
        this.levelMesh = new THREE.Mesh(this.levelGeometry, this.levelMaterial);
        this.world.scene.add(this.levelMesh);

        // Load webrio's Data
        this.positionArr     = new Float32Array(this.webrio.HEAPF32.buffer, positionBufPtr, 9 * SM64_GEO_MAX_TRIANGLES);
        this.prevPositionArr = new Float32Array(9 * SM64_GEO_MAX_TRIANGLES); this.interPositionArr = new Float32Array(9 * SM64_GEO_MAX_TRIANGLES);
        let colorArr         = new Float32Array(this.webrio.HEAPF32.buffer,    colorBufPtr, 9 * SM64_GEO_MAX_TRIANGLES);
        let normalArr        = new Float32Array(this.webrio.HEAPF32.buffer,   normalBufPtr, 9 * SM64_GEO_MAX_TRIANGLES);
        let uvArr            = new Float32Array(this.webrio.HEAPF32.buffer,       uvBufPtr, 6 * SM64_GEO_MAX_TRIANGLES);
        // Load the Texture and Display in three.js
        const heapTex = new Uint8Array(Webrio.HEAPU8.buffer, heapTexPtr, heapTexLength);
        let texture = new THREE.DataTexture(heapTex, 
                                            Webrio._webrio_get_sm64_texture_width(), 
                                            Webrio._webrio_get_sm64_texture_height(), THREE.RGBAFormat, THREE.UnsignedByteType);
        texture.needsUpdate = true;
        texture.flipY = true;
        let material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide });
        let geometry = new THREE.PlaneGeometry(1, 1);
        let plane = new THREE.Mesh(geometry, material);
        plane.position.set(0, 1, 0);
        plane.scale.set(11, 1, 1);
        this.world.scene.add(plane);

        this.webrioPositionPtr      = Webrio._malloc(sizeofFloat * 3);
        this.webrioPositionArr      = new Float32Array(Webrio.HEAPF32.buffer, this.webrioPositionPtr, 3);
        this.webrioPrevPositionArr  = new Float32Array(3);
        this.webrioInterPositionArr = new Float32Array(3);
      
        this.webrioGeometry = new THREE.BufferGeometry();
        this.webrioGeometry.setAttribute('position', new THREE.BufferAttribute(this.interPositionArr, 3));
        this.webrioGeometry.setAttribute('color'   , new THREE.BufferAttribute(   colorArr, 3));
        this.webrioGeometry.setAttribute('normal'  , new THREE.BufferAttribute(  normalArr, 3));
        this.webrioGeometry.setAttribute('uv'      , new THREE.BufferAttribute(      uvArr, 2));
        this.webrioMaterial = new THREE.MeshPhysicalMaterial({ side: THREE.DoubleSide, vertexColors: true }); //map: texture, 
        this.webrioMesh = new THREE.Mesh(this.webrioGeometry, this.webrioMaterial);
        this.world.scene.add(this.webrioMesh);

        this.webrioLastPosition = new THREE.Vector3(0, 0, 0);

        this.keysDown = {};
        window.addEventListener('keydown', (e) => { this.keysDown[e.key] = true; });
        window.addEventListener('keyup'  , (e) => { delete this.keysDown[e.key]; });

        this.lastTimeMS = 0.1;
        this.fixedTimestamp = 0.1;
    }

    /** Update the simulation */
    update(timeMS) {
        if(!this.lastTimeMS) { return; }
        this.timeMS = timeMS;
        //this.deltaTimeMS = timeMS - this.lastTimeMS;

        if (this.timeMS - this.fixedTimestamp > this.sm64Params.tickEveryMS) {
            // Get the keyboard inputs
            let stickX  = 0.0;
            let stickY  = 0.0;
            let buttonA = 0.0;
            if ("ArrowLeft"  in this.keysDown) { stickX += 1.0; }
            if ("ArrowRight" in this.keysDown) { stickX -= 1.0; }
            if ("ArrowUp"    in this.keysDown) { stickY += 1.0; }
            if ("ArrowDown"  in this.keysDown) { stickY -= 1.0; }
            if ("z"          in this.keysDown) { buttonA = 1.0; }

            // Rotate the Joystick by the Camera Rotation
            let stick = new THREE.Vector3(stickX, 0, stickY).applyQuaternion(this.world.camera.quaternion);
            if (stick.length() > 0.0) { stick.normalize(); }

            // Tick the Game
            this.prevPositionArr.set(this.positionArr);
            this.webrioPrevPositionArr.set(this.webrioPositionArr);
            const numTrianglesUsed = Webrio._webrio_tick(0, 0, stick.x, stick.z, buttonA, 0, 0, this.webrioPositionPtr);

            // Update Webrio's Mesh
            this.webrioMesh.scale.set(0.01, 0.01, 0.01);
            this.webrioMesh.geometry.getAttribute('color'   ).needsUpdate = true;
            this.webrioMesh.geometry.getAttribute('normal'  ).needsUpdate = true;
            this.webrioMesh.geometry.getAttribute('uv'      ).needsUpdate = true;

            if(this.timeMS - this.fixedTimestamp > this.sm64Params.tickEveryMS * 10){
                this.fixedTimestamp = this.timeMS;
            }else{
                this.fixedTimestamp += this.sm64Params.tickEveryMS;
            }
        }

        // Interpolate this.interPositionArr between this.prevPositionArr and this.positionArr
        let t = Math.min(Math.max((this.timeMS - this.fixedTimestamp) / this.sm64Params.tickEveryMS, 0.0), 1.0);
        for (let i = 0; i < 9 * 1024; i++) {
            if(i < 3){ this.webrioInterPositionArr[i] = (this.webrioPrevPositionArr[i] * (1 - t) + this.webrioPositionArr[i] * t); }
            this.interPositionArr[i] = (this.prevPositionArr[i] * (1 - t) + this.positionArr[i] * t) - this.webrioInterPositionArr[i % 3];
        }
        this.webrioGeometry.getAttribute('position').needsUpdate = true;
        this.webrioMesh.position.set(this.webrioInterPositionArr[0] * 0.01,
                                     this.webrioInterPositionArr[1] * 0.01,
                                     this.webrioInterPositionArr[2] * 0.01);

        // Update the Camera using the interpolated position
        this.world.camera.position.add(this.webrioMesh.position.clone().sub(this.webrioLastPosition));
        this.world.controls.target.set(this.webrioInterPositionArr[0] * 0.01,
                                       this.webrioInterPositionArr[1] * 0.01 + 1.5,
                                       this.webrioInterPositionArr[2] * 0.01);
        this.world.controls.update();
        this.webrioLastPosition.copy(this.webrioMesh.position);

        // Render the three.js Scene
        this.world.renderer.render(this.world.scene, this.world.camera);
        this.world.stats.update();
    }

    // Log Errors as <div>s over the main viewport
    fakeError(...args) {
        if (args.length > 0 && args[0]) { this.display(JSON.stringify(args[0])); }
        window.realConsoleError.apply(console, arguments);
    }

    display(text) {
        let errorNode = window.document.createElement("div");
        errorNode.innerHTML = text.fontcolor("red");
        window.document.getElementById("info").appendChild(errorNode);
    }
}

var main = new Main();
