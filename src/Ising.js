import * as THREE from 'three/build/three.module.js';
import { GPUComputationRenderer } from 'three/examples/jsm/misc/GPUComputationRenderer.js';


const IsingComputefs = `
    uniform float BoltzmannWeights[5];
    uniform int checkerboardColor;

    void main() {

        vec2 uv = gl_FragCoord.xy / resolution.xy;
    
        float spin = texture2D(textureSpin, uv).r;

        // Since fragments are processed in parallel, each fragment is given its 
        // own RNG state by storing the generated random number in the green channel.
        highp uint rand = uint(texture2D(textureSpin, uv).g); // highp -> 32 bit. Required!
        highp float randf = float(rand);

        // Update the spins in a checkerboard pattern, so that only non-interacting 
        // spins are processed in parallel.
        if( ((int(resolution.x*uv.x) + int(resolution.y*uv.y)) & 1) == checkerboardColor){
            // Use a multiplicative linear congruential generator (MLCG) for random numbers
            // Magic number from https://doi.org/10.1090/S0025-5718-99-00996-5, table 5, for m=2^32
            randf = float(747796405u * rand); 
            //randf = float(1664525u * rand + 1013904223u); // "bad" RNG: always converges to spin up
            // up
            vec2 neighbour_uv = uv + vec2(0.0, 1.0) / resolution.xy;
            lowp int neighbourSum = int(texture2D(textureSpin, neighbour_uv).r);
            // down
            neighbour_uv = uv + vec2(0.0, -1.0) / resolution.xy;
            neighbourSum += int(texture2D(textureSpin, neighbour_uv).r);
            // left
            neighbour_uv = uv + vec2(-1.0, 0.0) / resolution.xy;
            neighbourSum += int(texture2D(textureSpin, neighbour_uv).r);
            // right
            neighbour_uv = uv + vec2(1.0, 0.0) / resolution.xy;
            neighbourSum += int(texture2D(textureSpin, neighbour_uv).r);
        
            // Accept spin flip according to Metropolis criterion
            spin = (randf < BoltzmannWeights[neighbourSum]) ? 0.0 : 1.0;
        }
        
        gl_FragColor = vec4(spin, randf, 0.0, 1.0);
    }
`
const IsingShowvs = `
    varying vec2 vUv; // Pass vertex uv coords through to fragment shader

    void main() {
        vUv = uv; // "uv" is already defined by threejs
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
    }
`
const IsingShowfs = `
    uniform sampler2D spinTexture;
    varying vec2 vUv;

    void main(void) {
        // Show only the red channel, which are the spins.
        // Green channel is used to propagate the RNG state. Blue is unused.
        float spin = texture(spinTexture, vUv).r;
        //float spin = texture(spinTexture, vUv).g / 4294967295.0; // visualize the rng
        gl_FragColor = vec4(spin, spin, spin, 1.0);
    }
`


var IsingExhibit = function ( resolution, renderer, scene ) {

    var IsingResolution = resolution;
    var IsingGPUCompute, IsingMesh, spinVariable, spinUniforms, IsingMaterial;	

    this.init = function () {
        // First set up the compute shader.
        IsingGPUCompute = new GPUComputationRenderer( IsingResolution, IsingResolution, renderer );

        var initialSpin = IsingGPUCompute.createTexture();
        // Random initial configuration
        var theArray = initialSpin.image.data;
        for ( var k = 0, kl = theArray.length; k < kl; k += 4 ) {
            theArray[k + 0] = Math.round(Math.random()) // Initial spin, either 0 or 1.
            theArray[k + 1] = Math.random() * Math.pow(2, 16) // GPU RNG seed.
            theArray[k + 2] = 0.0 // Unused.
            theArray[k + 3] = 1.0 // Unused. Set to 1 since it's an "opacity".
        }

        spinVariable = IsingGPUCompute.addVariable("textureSpin", IsingComputefs, initialSpin);
        spinVariable.wrapS = THREE.RepeatWrapping;
        spinVariable.wrapT = THREE.RepeatWrapping;

        IsingGPUCompute.setVariableDependencies(spinVariable, [spinVariable]);

        spinUniforms = spinVariable.material.uniforms;

        spinUniforms[ "temperature" ] = { value: 2.27 } 
        spinUniforms[ "checkerboardColor" ] = { value: 1 } // We update in a checkerboard pattern, arbitrarily starting with "black squares"
        this.setTemperature(2.27); // (reduced) temperature: kB T / coupling constant. Critical temperature ~ 2.27

        var error = IsingGPUCompute.init();
        if ( error !== null ) {
            console.error( error );
        }

        // Now set up the display
        var geometry = new THREE.PlaneBufferGeometry( 4, 4 );
        IsingMaterial = new THREE.ShaderMaterial( {
            side: THREE.DoubleSide,
            uniforms: {
                spinTexture: { value: spinVariable }
            },
            vertexShader: IsingShowvs,
            fragmentShader: IsingShowfs
        } );
        IsingMesh = new THREE.Mesh( geometry, IsingMaterial );
        scene.add( IsingMesh );
    };

    this.setTemperature = function (temperature) {
        spinUniforms[ "temperature" ].value = temperature;
        // Precompute the Boltzmann weights of spin flips, since there's only a few options
        var BoltzmannWeights = new Float32Array(5);
        for(var i = 0; i < 5; i++){
            var nbSpinSum = (2*i - 4) // 0,1,2,3,4 to -4,-2,0,2,4
            // Multiply the weights by 2^32-1 to save an operation in the compute shader
            BoltzmannWeights[i] = 4294967295.0 / (1.0 + Math.exp(2*nbSpinSum/spinUniforms[ "temperature" ].value) )
            // console.log(BoltzmannWeights[i] / 4294967295.0) // these should sum to 1
        }
        spinUniforms[ "BoltzmannWeights" ] = { value: BoltzmannWeights };
    }

    this.getTemperature = function() {
        return spinUniforms[ "temperature" ].value;
    }
    
    this.setExhibitPosition = function (position) {
        IsingMesh.position.set(position.x, position.y, position.z);
    }

    this.update = function (steps = 1) {
        for(var i = 0; i < steps; i++){
            // Run the Ising model compute shader twice, first for "black squares", then for "white squares"
            // TODO: Shouldn't I just have two textures?
            spinUniforms.checkerboardColor.value = 0;
            IsingGPUCompute.compute();
            spinUniforms.checkerboardColor.value = 1;
            IsingGPUCompute.compute();
        }
        // then update the texture to show the new spin configuration
        IsingMaterial.uniforms.spinTexture.value = IsingGPUCompute.getCurrentRenderTarget(spinVariable).texture;
    };

}


export { IsingExhibit };