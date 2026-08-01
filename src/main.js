import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import './style.css';

const duckModelUrl = '/material/duck.fbx';

const app = document.querySelector('.app');
const stage = document.querySelector('.stage');
const video = document.querySelector('#cameraVideo');
const threeLayer = document.querySelector('#threeLayer');
const startButton = document.querySelector('#startButton');
const captureButton = document.querySelector('#captureButton');
const saveLink = document.querySelector('#saveLink');
const resultImage = document.querySelector('#resultImage');
const retakeButton = document.querySelector('#retakeButton');
const statusText = document.querySelector('#statusText');

let renderer;
let scene;
let camera;
let duck;
let animationFrameId;
let lastFrameTime = 0;

initThree();
loadDuck();

startButton.addEventListener('click', startCamera);
captureButton.addEventListener('click', capturePhoto);
retakeButton.addEventListener('click', retakePhoto);
window.addEventListener('resize', resizeThree);

function initThree() {
  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(0, 0.6, 4.2);
  camera.lookAt(0, 0.2, 0);

  renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
    preserveDrawingBuffer: true,
  });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  threeLayer.appendChild(renderer.domElement);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x5f6f89, 2.2));

  const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
  keyLight.position.set(2, 4, 4);
  scene.add(keyLight);

  resizeThree();
  animate();
}

function loadDuck() {
  setStatus('duck モデルを読み込み中...');

  const loader = new FBXLoader();
  loader.load(
    duckModelUrl,
    (model) => {
      const duckGroup = new THREE.Group();
      fitModel(model);
      duckGroup.add(model);
      duckGroup.rotation.set(0, -0.25, 0);
      duck = duckGroup;
      scene.add(duck);
      setStatus('カメラを起動できます。');
    },
    undefined,
    (error) => {
      console.error(error);
      setStatus('duck モデルの読み込みに失敗しました。');
    },
  );
}

function fitModel(model) {
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxSize = Math.max(size.x, size.y, size.z) || 1;
  const scale = 0.75 / maxSize;

  model.scale.setScalar(scale);
  model.position.set(-center.x * scale, -center.y * scale - 0.05, -center.z * scale);
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus('このブラウザではカメラを起動できません。');
    return;
  }

  try {
    setStatus('カメラを起動中...');
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    });

    video.srcObject = stream;
    await video.play();

    setMode('camera');
    captureButton.disabled = false;
    window.requestAnimationFrame(resizeThree);
    setStatus('撮影できます。');
  } catch (error) {
    console.error(error);
    setStatus('カメラを起動できません。スマホ確認は HTTPS の Tunnel URL で開いてください。');
  }
}

function capturePhoto() {
  if (!video.videoWidth || !video.videoHeight) {
    setStatus('カメラ映像がまだ準備できていません。');
    return;
  }

  renderer.render(scene, camera);

  const rect = stage.getBoundingClientRect();
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  const outputWidth = Math.round(rect.width * pixelRatio);
  const outputHeight = Math.round(rect.height * pixelRatio);
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');

  canvas.width = outputWidth;
  canvas.height = outputHeight;

  drawVideoCover(context, outputWidth, outputHeight);
  context.drawImage(renderer.domElement, 0, 0, outputWidth, outputHeight);

  const imageUrl = canvas.toDataURL('image/jpeg', 0.92);
  resultImage.src = imageUrl;
  saveLink.href = imageUrl;
  setMode('preview');
  setStatus('撮影しました。保存ボタンから画像を保存できます。');
}

function retakePhoto() {
  setMode('camera');
  window.requestAnimationFrame(resizeThree);
}

function drawVideoCover(context, outputWidth, outputHeight) {
  const videoRatio = video.videoWidth / video.videoHeight;
  const outputRatio = outputWidth / outputHeight;
  let sourceWidth = video.videoWidth;
  let sourceHeight = video.videoHeight;
  let sourceX = 0;
  let sourceY = 0;

  if (videoRatio > outputRatio) {
    sourceWidth = video.videoHeight * outputRatio;
    sourceX = (video.videoWidth - sourceWidth) / 2;
  } else {
    sourceHeight = video.videoWidth / outputRatio;
    sourceY = (video.videoHeight - sourceHeight) / 2;
  }

  context.drawImage(
    video,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    outputWidth,
    outputHeight,
  );
}

function resizeThree() {
  const rect = stage.getBoundingClientRect();
  const width = Math.max(rect.width, 1);
  const height = Math.max(rect.height, 1);

  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}

function animate(time = 0) {
  const deltaSeconds = Math.min((time - lastFrameTime) / 1000, 0.04);
  lastFrameTime = time;

  if (duck) {
    duck.rotation.x += deltaSeconds * 0.45;
    duck.rotation.y += deltaSeconds * 0.75;
    duck.rotation.z += deltaSeconds * 0.35;
  }

  renderer.render(scene, camera);
  animationFrameId = window.requestAnimationFrame(animate);
}

function setStatus(message) {
  statusText.textContent = message;
}

function setMode(mode) {
  app.classList.remove('state-home', 'state-camera', 'state-preview');
  app.classList.add(`state-${mode}`);
}

window.addEventListener('beforeunload', () => {
  if (animationFrameId) {
    window.cancelAnimationFrame(animationFrameId);
  }
});
