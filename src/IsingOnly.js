import * as THREE from 'three/build/three.module.js';
import { GUI } from 'three/examples/jsm/libs/dat.gui.module.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { IsingExhibit } from './Ising.js'

var container;
var camera, scene, renderer, controls;

// Some variables for physics / movement
var time, delta;
var prevTime = performance.now();

var Ising, IsingDelta = 0.0;

const params = { // These get set in the GUI.
	temperature: 2.5,
	stepsPerFrame: 1,
	gridSize: 64
};

init();
animate();

function init_controls() {
	controls = new OrbitControls( camera, document.body );
    controls.enableRotate = false;
    controls.enablePan = false;
}

function onWindowResize() {
	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();
	renderer.setSize( window.innerWidth, window.innerHeight );
}

function init() {
	// Set up the page and renderer
	container = document.createElement( 'div' );
	document.body.appendChild( container );
	renderer = new THREE.WebGLRenderer( {  } );
	renderer.setPixelRatio( window.devicePixelRatio );
	renderer.setSize( window.innerWidth, window.innerHeight );
	container.appendChild( renderer.domElement );
	window.addEventListener( 'resize', onWindowResize, false );
	
	// Set up an empty scene
	scene = new THREE.Scene();
	scene.background = new THREE.Color( 0xAAAAAA );

	// Set up camera and controls
	camera = new THREE.PerspectiveCamera( 70, window.innerWidth / window.innerHeight, 0.001, 1000 ); // Near=1mm, far=1000m
	camera.position.z = 3.2;
	init_controls();

	// Set up the options / GUI
	const gui = new GUI( {} );
	gui.domElement.id = 'gui';
	document.body.appendChild( gui.domElement );
	gui.add( params, 'temperature', 0, 5, 0.01 ).onChange( function () {
		Ising.setTemperature(params.temperature);
	} );
	gui.add( params, 'stepsPerFrame', 1, 10, 1);
	gui.add( params, 'gridSize', [4, 16, 64, 256, 1024, 4096, 8192]).onChange( function () {
		Ising = new IsingExhibit(parseInt(params.gridSize), renderer, scene);
		Ising.init();
	} ); // gridSize > 8192 run into issues with memory allocations, they need Float32Arrays larger than 2^32 elements.

	// Set up exhibits
	Ising = new IsingExhibit(params.gridSize, renderer, scene);
	Ising.init();
}

function animate() {
	time = performance.now(); // Returns total elapsed time in ms
	delta = ( time - prevTime ) / 1000; // In seconds
    
    controls.update();

	requestAnimationFrame( animate );

	// Do a single Ising model step every frame
	IsingDelta += delta
	if( IsingDelta > 1/60 ){
		IsingDelta = 0
		for (let i = 0; i < params.stepsPerFrame; i++) { Ising.update(); }
	}

	renderer.render( scene, camera );
	
	prevTime = time;
}
