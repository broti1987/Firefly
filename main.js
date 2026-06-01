// ─── GRID — portrait 9:16 ─────────────────────────────────────────────────────
const GRID_W = 144;
const GRID_H = 256;
const N      = GRID_W * GRID_H;

const SPREAD_X = 4.0;
const SPREAD_Y = 7.1;

// Live config
let depthScale = 4.7;
let audioReact = false;

// ─── RENDERER ─────────────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);

// ─── SCENE / CAMERA ───────────────────────────────────────────────────────────
const scene  = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.01, 200);
camera.position.set(0, 0, 9);

// Camera animation state
const CAM_OUT_R = 9.0;   // rest orbit radius
const CAM_IN_R  = 2.2;   // inside-cloud orbit radius
let camAngle = 0;         // current angle around Y axis
let camRadius = CAM_OUT_R;

// ─── VIDEO (depth map) ────────────────────────────────────────────────────────
const video       = document.createElement('video');
video.src         = 'Source/video.mp4';
video.loop        = true;
video.muted       = true;
video.volume      = 0;
video.playsInline = true;

const sampleCanvas  = document.createElement('canvas');
sampleCanvas.width  = GRID_W;
sampleCanvas.height = GRID_H;
const ctx2d         = sampleCanvas.getContext('2d', { willReadFrequently: true });

// ─── AUDIO ────────────────────────────────────────────────────────────────────
const audioEl = new Audio('Source/audio.mp3');
audioEl.loop  = true;

let audioCtx, analyser, freqData, sampleRate;
let audioReady = false;

function initAudio() {
  if (audioCtx) return;
  audioCtx   = new AudioContext();
  sampleRate = audioCtx.sampleRate;
  const src  = audioCtx.createMediaElementSource(audioEl);
  analyser   = audioCtx.createAnalyser();
  analyser.fftSize               = 4096;
  analyser.smoothingTimeConstant = 0.75;
  src.connect(analyser);
  analyser.connect(audioCtx.destination);
  freqData = new Uint8Array(analyser.frequencyBinCount);
}

function band(loHz, hiHz) {
  const nyquist  = sampleRate / 2;
  const binCount = analyser.frequencyBinCount;
  const lo = Math.max(0,          Math.floor(loHz / nyquist * binCount));
  const hi = Math.min(binCount-1, Math.ceil( hiHz / nyquist * binCount));
  let sum = 0;
  for (let i = lo; i <= hi; i++) sum += freqData[i];
  return sum / ((hi - lo + 1) * 255);
}

// ─── GEOMETRY ────────────────────────────────────────────────────────────────
const posArr  = new Float32Array(N * 3);
const baseXY  = new Float32Array(N * 2);
const randArr = new Float32Array(N * 3);

for (let row = 0; row < GRID_H; row++) {
  for (let col = 0; col < GRID_W; col++) {
    const i = row * GRID_W + col;
    const x = (col / (GRID_W - 1) - 0.5) * SPREAD_X;
    const y = (0.5 - row / (GRID_H - 1)) * SPREAD_Y;
    baseXY[i * 2]     = x;
    baseXY[i * 2 + 1] = y;
    posArr[i * 3]     = x;
    posArr[i * 3 + 1] = y;
    posArr[i * 3 + 2] = 0;
    randArr[i * 3]     = Math.random() * 2 - 1;
    randArr[i * 3 + 1] = Math.random() * 2 - 1;
    randArr[i * 3 + 2] = Math.random() * 2 - 1;
  }
}

const geo     = new THREE.BufferGeometry();
const posAttr = new THREE.BufferAttribute(posArr, 3);
posAttr.setUsage(THREE.DynamicDrawUsage);
geo.setAttribute('position', posAttr);
geo.setAttribute('aRand', new THREE.BufferAttribute(randArr, 3));

// ─── SHADERS ──────────────────────────────────────────────────────────────────
const vertexShader = /* glsl */`
  attribute vec3 aRand;

  uniform float uPointSize;
  uniform float uBass;
  uniform float uBassSize;
  uniform float uTreble;
  uniform float uTrebleVib;

  varying float vDepth01;

  void main() {
    vec3 pos = position;

    // Treble: scatter each particle along its unique 3D random vector
    float scatter = uTreble * uTrebleVib;
    pos += aRand * scatter;

    vDepth01 = clamp((position.z + 3.0) / 6.0, 0.0, 1.0);

    vec4 mvPos   = modelViewMatrix * vec4(pos, 1.0);
    gl_PointSize = (uPointSize + uBass * uBassSize) * (18.0 / -mvPos.z);
    gl_Position  = projectionMatrix * mvPos;
  }
`;

const fragmentShader = /* glsl */`
  uniform float uBrightness;
  uniform float uContrast;
  uniform float uOpacity;
  uniform float uBass;

  varying float vDepth01;

  void main() {
    vec2  uv   = gl_PointCoord - 0.5;
    float dist = length(uv);
    if (dist > 0.5) discard;

    float core  = 1.0 - smoothstep(0.0,  0.22, dist);
    float aura  = 1.0 - smoothstep(0.12, 0.5,  dist);
    float alpha = (core * 0.9 + aura * 0.2) * uOpacity;

    float lum = pow(clamp(vDepth01, 0.001, 1.0), uContrast) * uBrightness;
    lum = clamp(lum + uBass * 0.4, 0.0, 1.0);

    gl_FragColor = vec4(vec3(lum), alpha);
  }
`;

const mat = new THREE.ShaderMaterial({
  vertexShader,
  fragmentShader,
  uniforms: {
    uPointSize:  { value: 6.0  },
    uBrightness: { value: 2.7  },
    uContrast:   { value: 2.3  },
    uOpacity:    { value: 1.0  },
    uBass:       { value: 0.0  },
    uBassSize:   { value: 3.0  },
    uTreble:     { value: 0.0  },
    uTrebleVib:  { value: 3.0  },
  },
  transparent: true,
  depthWrite:  false,
  blending:    THREE.AdditiveBlending,
});

const points = new THREE.Points(geo, mat);
scene.add(points);

// ─── DEPTH UPDATE ─────────────────────────────────────────────────────────────
function updateDepth() {
  if (video.readyState < 2) return;
  ctx2d.drawImage(video, 0, 0, GRID_W, GRID_H);
  const { data } = ctx2d.getImageData(0, 0, GRID_W, GRID_H);
  for (let i = 0; i < N; i++) {
    const p   = i * 4;
    const bri = (data[p] + data[p + 1] + data[p + 2]) / (3 * 255);
    posArr[i * 3]     = baseXY[i * 2];
    posArr[i * 3 + 1] = baseXY[i * 2 + 1];
    posArr[i * 3 + 2] = (bri - 0.5) * depthScale;
  }
  posAttr.needsUpdate = true;
}

// ─── CAMERA ANIMATION ─────────────────────────────────────────────────────────
function updateCamera() {
  const targetRadius = audioReact ? CAM_IN_R : CAM_OUT_R;
  camRadius += (targetRadius - camRadius) * 0.035;

  if (audioReact) {
    camAngle += 0.007; // continuous rotation
  } else {
    // Slowly wind angle back toward 0 once almost stopped
    camAngle *= 0.98;
  }

  camera.position.x = Math.sin(camAngle) * camRadius;
  camera.position.z = Math.cos(camAngle) * camRadius;
  camera.lookAt(0, 0, 0);
}

// ─── ANIMATION LOOP ───────────────────────────────────────────────────────────
let playing    = false;
let bassSmooth = 0;
let trebSmooth = 0;

function animate() {
  requestAnimationFrame(animate);

  if (playing) {
    if (audioReact && analyser) {
      analyser.getByteFrequencyData(freqData);
      bassSmooth += (band(20, 250)     - bassSmooth) * 0.18;
      trebSmooth += (band(4000, 16000) - trebSmooth) * 0.22;
      mat.uniforms.uBass.value   = bassSmooth;
      mat.uniforms.uTreble.value = trebSmooth;
    } else {
      mat.uniforms.uBass.value   *= 0.85;
      mat.uniforms.uTreble.value *= 0.85;
    }

    updateDepth();
  }

  updateCamera();
  renderer.render(scene, camera);
}

animate();

// ─── LOADER + AUTO-START ──────────────────────────────────────────────────────
const loader   = document.getElementById('loader');
const audioBar = document.getElementById('audio-bar');
const btnAudio = document.getElementById('btn-audio');

const landing   = document.getElementById('landing');
const btnRelease = document.getElementById('btn-release');

// Loader auto-dismisses when video is ready, reveals landing button
function onVideoReady() {
  loader.classList.add('fade-out');
  setTimeout(() => loader.remove(), 900);
}

if (video.readyState >= 3) {
  onVideoReady();
} else {
  video.addEventListener('canplaythrough', onVideoReady, { once: true });
}

// Landing button — user gesture unlocks audio and starts everything
btnRelease.addEventListener('click', async () => {
  landing.classList.add('fade-out');
  setTimeout(() => landing.remove(), 1100);

  // Start audio (requires this user gesture)
  initAudio();
  await audioCtx.resume();
  try { await audioEl.play(); } catch (e) { console.error('[depth] audio:', e); }

  video.play().catch(console.error);
  playing = true;
  audioBar.classList.add('visible');
});

// ─── AUDIO REACT TOGGLE ───────────────────────────────────────────────────────
btnAudio.addEventListener('click', () => {
  audioReact = !audioReact;
  btnAudio.textContent = audioReact ? 'Ignited' : 'Ignite';
  btnAudio.classList.toggle('active', audioReact);
});

// ─── CONTROLS ─────────────────────────────────────────────────────────────────
function bind(id, valId, dec, fn) {
  const sl  = document.getElementById(id);
  const lbl = document.getElementById(valId);
  sl.addEventListener('input', () => {
    const v = parseFloat(sl.value);
    lbl.textContent = v.toFixed(dec);
    fn(v);
  });
}

bind('sl-bass-size',  'val-bass-size',  1, v => { mat.uniforms.uBassSize.value  = v; });
bind('sl-treble-vib', 'val-treble-vib', 1, v => { mat.uniforms.uTrebleVib.value = v; });

// ─── RESIZE ───────────────────────────────────────────────────────────────────
window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
