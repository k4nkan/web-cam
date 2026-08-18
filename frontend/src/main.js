import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import './style.css';

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

const app = document.querySelector('.app');
const stage = document.querySelector('.stage');
const video = document.querySelector('#cameraVideo');
const threeLayer = document.querySelector('#threeLayer');
const startButton = document.querySelector('#startButton');
const modelSelect = document.querySelector('#modelSelect');
const modelImageInput = document.querySelector('#modelImageInput');
const generateUploadButton = document.querySelector('#generateUploadButton');
const captureButton = document.querySelector('#captureButton');
const switchCameraButton = document.querySelector('#switchCameraButton');
const modelScaleRange = document.querySelector('#modelScaleRange');
const moveButtons = document.querySelectorAll('[data-move]');
const saveLink = document.querySelector('#saveLink');
const resultImage = document.querySelector('#resultImage');
const retakeButton = document.querySelector('#retakeButton');
const generateCapturedButton = document.querySelector('#generateCapturedButton');
const statusText = document.querySelector('#statusText');

const modelState = {
  x: 0,
  y: 0,
  scale: 1,
  rotationX: 0,
  rotationY: 0,
};

const modelMoveSteps = {
  up: [0, 0.12],
  down: [0, -0.12],
  left: [-0.12, 0],
  right: [0.12, 0],
};

const dragState = {
  active: false,
  pointerId: null,
  lastX: 0,
  lastY: 0,
};

let renderer;
let scene;
let camera;
let duck;
let currentStream;
let currentFacingMode = 'environment';
let animationFrameId;
let capturedImageUrl;
let capturedImageBlob;
let capturedImageDataUrl;
let lastMoveButtonTouchTime = 0;

initThree();
loadModelCatalog();
loadModelOption(modelSelect.value);

startButton.addEventListener('click', startCamera);
modelSelect.addEventListener('change', () => loadModelOption(modelSelect.value));
generateUploadButton.addEventListener('click', generateFromUpload);
captureButton.addEventListener('click', capturePhoto);
switchCameraButton.addEventListener('click', switchCamera);
modelScaleRange.addEventListener('input', updateModelScale);
moveButtons.forEach((button) => {
  button.addEventListener('pointerdown', handleMoveButtonInput);
  button.addEventListener('keydown', handleMoveButtonInput);
});
retakeButton.addEventListener('click', retakePhoto);
generateCapturedButton.addEventListener('click', generateFromCapturedImage);
saveLink.addEventListener('click', saveCapturedPhoto);
stage.addEventListener('pointerdown', startModelDrag);
window.addEventListener('pointermove', dragModel);
window.addEventListener('pointerup', stopModelDrag);
window.addEventListener('pointercancel', stopModelDrag);
document.addEventListener('touchend', preventMoveButtonDoubleTapZoom, { passive: false });
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

async function loadModelCatalog() {
  try {
    const response = await fetch(apiUrl('/api/models'));
    if (!response.ok) {
      return;
    }

    const payload = await response.json();
    payload.models.forEach(addGeneratedModelOption);
  } catch (error) {
    console.info('生成済みモデル一覧はまだ利用できません。', error);
  }
}

function addGeneratedModelOption(model) {
  if (modelSelect.querySelector(`option[value="${CSS.escape(model.id)}"]`)) {
    return;
  }

  const option = document.createElement('option');
  option.value = model.id;
  option.textContent = model.name;
  option.dataset.url = model.modelUrl;
  option.dataset.format = 'glb';
  modelSelect.appendChild(option);
}

function loadModelOption(value) {
  const option = modelSelect.querySelector(`option[value="${CSS.escape(value)}"]`);
  if (!option) {
    return;
  }

  setStatus(`${option.textContent} モデルを読み込み中...`);
  const modelUrl = option.dataset.url;
  const format = option.dataset.format;
  const onLoad = (model) => {
    const object = format === 'glb' ? model.scene : model;
    const modelGroup = new THREE.Group();
    fitModel(object);
    modelGroup.add(object);

    if (duck) {
      scene.remove(duck);
    }
    duck = modelGroup;
    applyModelTransform();
    scene.add(duck);
    setStatus('カメラを起動できます。');
  };
  const onError = (error) => {
    console.error(error);
    setStatus(`${option.textContent} モデルの読み込みに失敗しました。`);
  };

  if (format === 'glb') {
    new GLTFLoader().load(modelUrl, onLoad, undefined, onError);
    return;
  }

  new FBXLoader().load(modelUrl, onLoad, undefined, onError);
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
    await startCameraStream(currentFacingMode);

    setMode('camera');
    captureButton.disabled = false;
    switchCameraButton.disabled = false;
    window.requestAnimationFrame(resizeThree);
    setStatus('撮影できます。');
  } catch (error) {
    console.error(error);
    setStatus('カメラを起動できません。スマホ確認は HTTPS の Tunnel URL で開いてください。');
  }
}

async function switchCamera() {
  const previousFacingMode = currentFacingMode;
  const nextFacingMode = currentFacingMode === 'environment' ? 'user' : 'environment';

  try {
    switchCameraButton.disabled = true;
    setStatus('カメラを切り替え中...');
    await startCameraStream(nextFacingMode);
    setStatus('撮影できます。');
  } catch (error) {
    console.error(error);
    setStatus('カメラを切り替えられません。');

    if (!currentStream && previousFacingMode !== nextFacingMode) {
      try {
        await startCameraStream(previousFacingMode);
      } catch (fallbackError) {
        console.error(fallbackError);
      }
    }
  } finally {
    switchCameraButton.disabled = !currentStream;
  }
}

async function startCameraStream(facingMode) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: { ideal: facingMode },
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
  });

  stopCameraStream();
  currentStream = stream;
  currentFacingMode = facingMode;
  video.srcObject = stream;
  video.classList.toggle('is-mirrored', currentFacingMode === 'user');
  await video.play();
}

function stopCameraStream() {
  if (!currentStream) {
    return;
  }

  currentStream.getTracks().forEach((track) => track.stop());
  currentStream = undefined;
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

  if (!canvas.toBlob) {
    setCapturedImage(canvas.toDataURL('image/jpeg', 0.86));
    return;
  }

  const imageDataUrl = canvas.toDataURL('image/jpeg', 0.86);
  canvas.toBlob(
    (blob) => {
      if (blob) {
        setCapturedImage(URL.createObjectURL(blob), blob, imageDataUrl);
        return;
      }

      setCapturedImage(imageDataUrl);
    },
    'image/jpeg',
    0.86,
  );
}

function retakePhoto() {
  clearCapturedImage();
  setMode('camera');
  window.requestAnimationFrame(resizeThree);
}

function setCapturedImage(imageUrl, blob, imageDataUrl = imageUrl) {
  clearCapturedImage();
  capturedImageUrl = imageUrl;
  capturedImageBlob = blob;
  capturedImageDataUrl = imageDataUrl;
  resultImage.src = imageUrl;
  saveLink.href = imageUrl;
  saveLink.download = `duck-camera-${Date.now()}.jpg`;
  setMode('preview');
  setStatus('撮影しました。保存ボタンから画像を保存できます。');
}

function clearCapturedImage() {
  if (capturedImageUrl?.startsWith('blob:')) {
    URL.revokeObjectURL(capturedImageUrl);
  }

  capturedImageUrl = undefined;
  capturedImageBlob = undefined;
  capturedImageDataUrl = undefined;
  resultImage.removeAttribute('src');
  saveLink.removeAttribute('href');
}

async function generateFromUpload() {
  const file = modelImageInput.files?.[0];
  if (!file) {
    setStatus('モデル生成に使う画像を選択してください。');
    return;
  }

  try {
    await generateModelFromImage(await readFileAsDataUrl(file), file.name);
    modelImageInput.value = '';
  } catch (error) {
    console.error(error);
    setStatus(error.message || 'モデル生成に失敗しました。');
  }
}

async function generateFromCapturedImage() {
  if (!capturedImageDataUrl) {
    setStatus('先に画像を撮影してください。');
    return;
  }

  try {
    await generateModelFromImage(capturedImageDataUrl, 'camera-model');
  } catch (error) {
    console.error(error);
    setStatus(error.message || 'モデル生成に失敗しました。');
  }
}

async function generateModelFromImage(image, name) {
  generateUploadButton.disabled = true;
  generateCapturedButton.disabled = true;
  setStatus('Tripoに画像を送信中...');

  try {
    const createResponse = await fetch(apiUrl('/api/models'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ image, name }),
    });
    const created = await readApiResponse(createResponse);
    const taskUrl = new URL(apiUrl('/api/task'), window.location.origin);
    taskUrl.searchParams.set('taskId', created.taskId);
    if (name) {
      taskUrl.searchParams.set('name', name);
    }

    let task = created;
    while (task.status !== 'success') {
      if (['failed', 'cancelled', 'banned'].includes(task.status)) {
        throw new Error(task.error || 'Tripoでモデル生成に失敗しました。');
      }
      setStatus(`モデルを生成中... ${task.progress || 0}%`);
      await wait(1500);
      const taskResponse = await fetch(taskUrl);
      task = await readApiResponse(taskResponse);
    }

    addGeneratedModelOption(task.model);
    modelSelect.value = task.model.id;
    loadModelOption(task.model.id);
    setStatus('モデルを追加しました。');
  } finally {
    generateUploadButton.disabled = false;
    generateCapturedButton.disabled = false;
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(reader.result));
    reader.addEventListener('error', () => reject(new Error('画像を読み込めません。')));
    reader.readAsDataURL(file);
  });
}

async function readApiResponse(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || 'バックエンドAPIでエラーが発生しました。');
  }
  return payload;
}

function apiUrl(path) {
  return `${apiBaseUrl}${path}`;
}

function wait(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function saveCapturedPhoto(event) {
  if (!capturedImageUrl) {
    event.preventDefault();
    setStatus('保存できる画像がありません。');
    return;
  }

  if (!capturedImageBlob || !navigator.canShare || !navigator.share) {
    return;
  }

  const imageFile = new File([capturedImageBlob], saveLink.download, {
    type: 'image/jpeg',
  });

  if (!navigator.canShare({ files: [imageFile] })) {
    return;
  }

  event.preventDefault();

  try {
    await navigator.share({
      files: [imageFile],
      title: 'Duck Camera',
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      return;
    }

    console.error(error);
    window.open(capturedImageUrl, '_blank', 'noopener');
  }
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

  if (currentFacingMode === 'user') {
    context.save();
    context.translate(outputWidth, 0);
    context.scale(-1, 1);
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

  if (currentFacingMode === 'user') {
    context.restore();
  }
}

function updateModelScale(event) {
  modelState.scale = Number(event.target.value);
  applyModelTransform();
}

function handleMoveButtonInput(event) {
  if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') {
    return;
  }

  event.preventDefault();
  moveModel(event.currentTarget.dataset.move);
}

function preventMoveButtonDoubleTapZoom(event) {
  if (!event.target.closest('.move-pad button')) {
    return;
  }

  const now = Date.now();

  if (now - lastMoveButtonTouchTime < 350) {
    event.preventDefault();
  }

  lastMoveButtonTouchTime = now;
}

function moveModel(direction) {
  const moveStep = modelMoveSteps[direction];

  if (!moveStep) {
    return;
  }

  modelState.x += moveStep[0];
  modelState.y += moveStep[1];
  modelState.x = clamp(modelState.x, -1.4, 1.4);
  modelState.y = clamp(modelState.y, -1.2, 1.2);
  applyModelTransform();
}

function startModelDrag(event) {
  if (event.target.closest('button, input, a')) {
    return;
  }

  dragState.active = true;
  dragState.pointerId = event.pointerId;
  dragState.lastX = event.clientX;
  dragState.lastY = event.clientY;
  stage.setPointerCapture(event.pointerId);
}

function dragModel(event) {
  if (!dragState.active || event.pointerId !== dragState.pointerId) {
    return;
  }

  const deltaX = event.clientX - dragState.lastX;
  const deltaY = event.clientY - dragState.lastY;

  modelState.rotationY += deltaX * 0.01;
  modelState.rotationX = clamp(modelState.rotationX + deltaY * 0.01, -0.75, 0.75);
  dragState.lastX = event.clientX;
  dragState.lastY = event.clientY;
  applyModelTransform();
}

function stopModelDrag(event) {
  if (!dragState.active || event.pointerId !== dragState.pointerId) {
    return;
  }

  dragState.active = false;
  dragState.pointerId = null;
}

function applyModelTransform() {
  if (!duck) {
    return;
  }

  duck.position.set(modelState.x, modelState.y, 0);
  duck.scale.setScalar(modelState.scale);
  duck.rotation.set(modelState.rotationX, modelState.rotationY, 0);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function resizeThree() {
  const rect = stage.getBoundingClientRect();
  const width = Math.max(rect.width, 1);
  const height = Math.max(rect.height, 1);

  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}

function animate() {
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
  clearCapturedImage();
  stopCameraStream();
});
