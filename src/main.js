import * as THREE from '../node_modules/three/build/three.module.js';
import { GUI } from '../node_modules/three/examples/jsm/libs/lil-gui.module.min.js';
import World from './World.js';
import memhelpers from '../node_modules/cmem_helpers/dist/cmem_helpers.modern.js'
import libs64Loader from './libsm64.js'

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
            //loadMesh: this.loadMesh.bind(this),
            //showMesh: true,
            resolution: 10,
        };
        this.gui = new GUI();
        //this.gui.add(this.latticeParams, 'loadMesh' ).name( 'Load Mesh' );
        //this.gui.add(this.contactParams, 'showMesh').name( 'Show Mesh' ).onFinishChange(async (value) => {
        //    if(this.mesh){ this.mesh.visible = value; }});
        //this.gui.add(this.sm64Params, 'resolution', 3, 40, 1).name( 'Resolution' ).onFinishChange(async (value) => { this.updateImplicitMesh(); });

        // Construct the render world
        this.world = new World(this);

        this.mesh = new THREE.Mesh( this.cylinderGeo , this.material  );
        this.world.scene.add( this.mesh );
        this.mesh.position.set(0.0, 2.1, 0.4);

        this.isDeployed = document.pathname !== '/';
        this.assetsPath = this.isDeployed ? './assets/' : '../assets/';

        // Load the SM64 WASM Library
        this.libsm64 = await libs64Loader();
        const { struct, structClass, setString, getString } = memhelpers(this.libsm64.HEAPU8.buffer, this.libsm64._malloc)

        // Initialize the SM64 Global State by loading the rom into it
        let rom = new Uint8Array(await (await fetch(this.assetsPath+"baserom.us.z64")).arrayBuffer());
        let heapRomPtr = this.libsm64._malloc(rom.length);
        let heapRom = new Uint8Array(this.libsm64.HEAPU8.buffer, heapRomPtr, rom.length);
        heapRom.set(rom);
        let heapTexLength = (64 * 11) * 64 * 4;
        let heapTexPtr = this.libsm64._malloc(heapTexLength);

        // Initialize the player's mesh buffers; these will get updated in the player tick
        const sizeofFloat = 4;
        const SM64_GEO_MAX_TRIANGLES = 1024;
        let positionBufPtr = this.libsm64._malloc(sizeofFloat * 9 * SM64_GEO_MAX_TRIANGLES);
        let colorBufPtr    = this.libsm64._malloc(sizeofFloat * 9 * SM64_GEO_MAX_TRIANGLES);
        let normalBufPtr   = this.libsm64._malloc(sizeofFloat * 9 * SM64_GEO_MAX_TRIANGLES);
        let uvBufPtr       = this.libsm64._malloc(sizeofFloat * 6 * SM64_GEO_MAX_TRIANGLES);
        let positionArr = new Float32Array(this.libsm64.HEAPF32.buffer, positionBufPtr, 9 * SM64_GEO_MAX_TRIANGLES);
        let colorArr    = new Float32Array(this.libsm64.HEAPF32.buffer,    colorBufPtr, 9 * SM64_GEO_MAX_TRIANGLES);
        let normalArr   = new Float32Array(this.libsm64.HEAPF32.buffer,   normalBufPtr, 9 * SM64_GEO_MAX_TRIANGLES);
        let uvArr       = new Float32Array(this.libsm64.HEAPF32.buffer,       uvBufPtr, 6 * SM64_GEO_MAX_TRIANGLES);

        const SM64MarioGeometryBuffers = struct({
            position: 'Uint32',
            normal  : 'Uint32',
            color   : 'Uint32',
            uv      : 'Uint32',
            numTrianglesUsed: 'Uint16'
        });
        this.marioGeometry = SM64MarioGeometryBuffers({ 
            position: positionBufPtr, 
            normal: normalBufPtr, 
            color: colorBufPtr, 
            uv: uvBufPtr, 
            numTrianglesUsed: 0 });
        const SM64MarioInputs = struct({
            camLookX: 'Float32',
            camLookZ: 'Float32',
            stickX  : 'Float32',
            stickY  : 'Float32',
            buttonA : 'Uint8',
            buttonB : 'Uint8',
            buttonZ : 'Uint8'
        });
        this.inputs = SM64MarioInputs();
        const SM64ObjectTransform = struct({
            positionX     : 'Float32',
            positionY     : 'Float32',
            positionZ     : 'Float32',
            eulerRotationX: 'Float32',
            eulerRotationY: 'Float32',
            eulerRotationZ: 'Float32'
        });
        this.sm64Transform = SM64ObjectTransform();
        const SM64MarioState = struct({
            positionX     : 'Float32',
            positionY     : 'Float32',
            positionZ     : 'Float32',
            velocityX     : 'Float32',
            velocityY     : 'Float32',
            velocityZ     : 'Float32',
            faceAngle     : 'Float32',
            health        : 'Int16',
            action        : 'Uint32',
            flags         : 'Uint32',
            particleFlags : 'Uint32',
            invincTimer   : 'Int16'
        });
        this.outState = SM64MarioState();

        const SM64Surface = struct({
            type: 'Int16',
            force: 'Int16',
            terrain: 'Uint16',
            vAX: 'Int32',
            vAY: 'Int32',
            vAZ: 'Int32',
            vBX: 'Int32',
            vBY: 'Int32',
            vBZ: 'Int32',
            vCX: 'Int32',
            vCY: 'Int32',
            vCZ: 'Int32'
        });
        this.surfaces = SM64Surface({
            type:    0,
            force:   0,
            terrain: 0,
            vAX: -1000,
            vAY:     0,
            vAZ:     0,
            vBX:  1000,
            vBY:     0,
            vBZ:  1000,
            vCX:  1000,
            vCY:     0,
            vCZ: -1000
        });

        // This doesn't seem to work at all!
        this.libsm64._sm64_register_debug_print_function((str)=>{console.log(getString(str));});

        // Initialize the SM64 Global State and retrieve the player texture
        this.libsm64._sm64_global_init(heapRomPtr, heapTexPtr); // This works.

        // Load the static surfaces
        this.libsm64._sm64_static_surfaces_load(this.surfaces._address, 1); // I don't know if this works.

        // Create the player
        this.marioId = this.libsm64._sm64_mario_create( 0, 2000, 0 ); // THIS FAILS AND OUTPUTS -1!
        if(this.marioId == -1){
            console.error("Failed to create Mario; he is not over terrain!");
        }

        // THIS SHOULD PRINT AN ERROR TO THE CONSOLE, BUT DOESN'T!
        this.libsm64._sm64_audio_tick(0, 0, 0);

        // Display the Texture in three.js
        let heapTex = new Uint8Array(this.libsm64.HEAPU8.buffer, heapTexPtr, heapTexLength);
        let texture = new THREE.DataTexture(heapTex, 64 * 11, 64, THREE.RGBAFormat, THREE.UnsignedByteType);
        texture.needsUpdate = true;
        texture.flipY = true;
        let material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide });
        let geometry = new THREE.PlaneGeometry(1, 1);
        let plane = new THREE.Mesh(geometry, material);
        plane.position.set(0, 1, 0);
        plane.scale.set(11, 1, 1);
        this.world.scene.add(plane);
    }

    /** Update the simulation */
    update(timeMS) {
        this.timeMS = timeMS;
        this.world.renderer.render(this.world.scene, this.world.camera);

        if(this.libsm64 && this.outState){
            this.libsm64._sm64_mario_tick(this.marioId, this.inputs._address, this.outState._address, this.marioGeometry._address);
            //console.log(this.outState.positionY);
        }

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
