import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { KneeShader } from '../src/visual/grade.js';
import { ShapeLayer } from '../src/visual/layers/shapes.js';
import { generateVibe } from '../src/visual/vibe.js';

const renderer = new THREE.WebGLRenderer();
renderer.setSize(128, 128); document.body.append(renderer.domElement);
const vertex = `varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}`;
// Exact old compression formula, retained here to reproduce the regression.
const legacyKnee = { uniforms: { tDiffuse: { value: null }, uKnee: { value: 1 } }, vertexShader: vertex,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uKnee; varying vec2 vUv;
    void main(){vec4 t=texture2D(tDiffuse,vUv);float peak=max(max(t.r,t.g),t.b);
    float scaled=peak/(1.+peak*uKnee);gl_FragColor=vec4(t.rgb*(scaled/max(peak,1e-4)),t.a);}` };

function measure(shader, value) {
  const size = 128, data = new Float32Array(size * size * 4);
  for (let i = 0; i < size * size; i++) data.set([0.25, 0.4, 0.6, 1], i * 4);
  // A single invalid highlight must not spread into a whole-frame blackout.
  data.set([value, value, value, 1], (64 * size + 64) * 4);
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.FloatType); tex.needsUpdate = true;
  const target = new THREE.WebGLRenderTarget(size, size, { type: THREE.FloatType });
  const composer = new EffectComposer(renderer, target); composer.renderToScreen = false;
  const source = new ShaderPass({ uniforms: { source: { value: tex } }, vertexShader: vertex,
    fragmentShader: 'uniform sampler2D source; varying vec2 vUv; void main(){gl_FragColor=texture2D(source,vUv);}' });
  const knee = new ShaderPass(shader);
  const bloom = new UnrealBloomPass(new THREE.Vector2(size, size), 1.2, 0.5, 0.6);
  composer.addPass(source); composer.addPass(knee); composer.addPass(bloom); composer.render();
  const output = new Float32Array(data.length);
  renderer.readRenderTargetPixels(composer.readBuffer, 0, 0, size, size, output);
  let invalid = 0, dark = 0;
  for (let i = 0; i < output.length; i += 4) {
    if (![output[i], output[i + 1], output[i + 2]].every(Number.isFinite)) invalid++;
    else if (Math.max(output[i], output[i + 1], output[i + 2]) < 0.01) dark++;
  }
  source.dispose(); knee.dispose(); bloom.dispose(); composer.dispose(); tex.dispose();
  return { invalidPixels: invalid, darkPixels: dark };
}

function shapes() {
  const scene = new THREE.Scene(), vibe = generateVibe('shader-finiteness');
  const layer = new ShapeLayer(scene, vibe, vibe.palette);
  const fragment = layer.items[0].mesh.material.fragmentShader;
  const material = new THREE.ShaderMaterial({ uniforms: layer.items[0].uniforms,
    vertexShader: `varying vec3 vN;varying vec3 vV;void main(){
      vN=vec3(position.xy,1.);vV=vN;gl_Position=vec4(position.xy,0.,1.);}`, fragmentShader: fragment });
  material.uniforms.uOpacity.value = 1; material.uniforms.uCore.value = 0.1;
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  const testScene = new THREE.Scene(); testScene.add(quad);
  const target = new THREE.WebGLRenderTarget(128, 128, { type: THREE.FloatType });
  const output = new Float32Array(128 * 128 * 4);
  let invalid = 0;
  for (const power of [1.3, 1.7, 2.4, 3.6]) {
    material.uniforms.uPower.value = power;
    renderer.setRenderTarget(target); renderer.render(testScene, new THREE.Camera());
    renderer.readRenderTargetPixels(target, 0, 0, 128, 128, output);
    invalid += output.filter(x => !Number.isFinite(x)).length;
  }
  renderer.setRenderTarget(null); target.dispose(); material.dispose(); quad.geometry.dispose(); layer.dispose();
  return invalid;
}

try {
  if (!renderer.getContext().getExtension('EXT_color_buffer_float')) throw new Error('Esta GPU no permite verificar buffers float. Prueba inconclusa.');
  const results = {};
  for (const [name, value] of [['normal', 0.8], ['extremeHDR', 1e20], ['infinity', Infinity], ['nan', NaN], ['negativeInfinity', -Infinity]]) {
    results[name] = { before: measure(legacyKnee, value), after: measure(KneeShader, value) };
  }
  const invalidShapeComponents = shapes();
  const pass = Object.values(results).every(r => r.after.invalidPixels === 0 && r.after.darkPixels <= 1) && invalidShapeComponents === 0;
  document.getElementById('result').textContent = JSON.stringify({ status: pass ? 'PASS' : 'FAIL', results, invalidShapeComponents }, null, 2);
} catch (error) { document.getElementById('result').textContent = `ERROR: ${error.message}`; console.error(error); }
