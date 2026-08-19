import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const pendingTasksStorageKey = 'web-cam.pending-model-tasks';
const generationPollInterval = 2000;
const preferredCameraWidth = 1920;
const preferredCameraHeight = 1080;
const maxModelRenderScale = 2.4;

const app = document.querySelector('.app');
const stage = document.querySelector('.stage');
const video = document.querySelector('#cameraVideo');
const threeLayer = document.querySelector('#threeLayer');
const startButton = document.querySelector('#startButton');
const modelSelect = document.querySelector('#modelSelect');
const modelGallery = document.querySelector('#modelGallery');
const modelImageInput = document.querySelector('#modelImageInput');
const captureButton = document.querySelector('#captureButton');
const switchCameraButton = document.querySelector('#switchCameraButton');
const modelScaleRange = document.querySelector('#modelScaleRange');
const moveButtons = document.querySelectorAll('[data-move]');
const saveLink = document.querySelector('#saveLink');
const resultImage = document.querySelector('#resultImage');
const retakeButton = document.querySelector('#retakeButton');
const homeFromCameraButton = document.querySelector('#homeFromCameraButton');
const homeFromPreviewButton = document.querySelector('#homeFromPreviewButton');
const statusText = document.querySelector('#statusText');
const startButtonIcon = document.querySelector('#startButtonIcon');
const startButtonLabel = document.querySelector('#startButtonLabel');

const modelState = {
  x: 0,
  y: 0.18,
  scale: 1,
  rotationX: 0,
  rotationY: 0,
};

const modelMoveSteps = {
  up: [0, 0.05],
  down: [0, -0.05],
  left: [-0.05, 0],
  right: [0.05, 0],
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
let lastMoveButtonTouchTime = 0;
let selectedModelReady = false;
let initialLoading = true;

boot();

startButton.addEventListener('click', startCamera);
modelSelect.addEventListener('change', () => selectModel(modelSelect.value));
modelGallery.addEventListener('click', selectGalleryModel);
modelImageInput.addEventListener('change', generateFromUpload);
captureButton.addEventListener('click', capturePhoto);
switchCameraButton.addEventListener('click', switchCamera);
modelScaleRange.addEventListener('input', updateModelScale);
moveButtons.forEach((button) => {
  button.addEventListener('pointerdown', handleMoveButtonInput);
  button.addEventListener('keydown', handleMoveButtonInput);
});
retakeButton.addEventListener('click', retakePhoto);
homeFromCameraButton.addEventListener('click', goHome);
homeFromPreviewButton.addEventListener('click', goHome);
saveLink.addEventListener('click', saveCapturedPhoto);
stage.addEventListener('pointerdown', startModelDrag);
window.addEventListener('pointermove', dragModel);
window.addEventListener('pointerup', stopModelDrag);
window.addEventListener('pointercancel', stopModelDrag);
document.addEventListener('touchend', preventMoveButtonDoubleTapZoom, { passive: false });
window.addEventListener('resize', resizeThree);

function boot() {
  initThree();
  loadPendingModelTasks();
  ensureAddModelCard();
  loadModelCatalog();
}

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
  setModelStatus('モデルを取得中...');

  try {
    const response = await fetch(apiUrl('/api/models'));
    if (!response.ok) {
      throw new Error('モデル一覧を取得できません。');
    }

    const payload = await response.json();
    if (!payload.models?.length) {
      setModelStatus('モデルがありません。＋から追加できます。');
      finishInitialLoading();
      return;
    }

    payload.models.forEach(addGeneratedModelOption);
  } catch (error) {
    console.info('生成済みモデル一覧はまだ利用できません。', error);
    startButton.disabled = true;
    setModelStatus('モデルを取得できません。再読み込みしてください。');
    finishInitialLoading();
  }
}

function addGeneratedModelOption(model) {
  const wasSelected = modelSelect.value === model.id || !modelSelect.value;
  findModelOption(model.id)?.remove();
  findModelCard(model.id)?.remove();
  findModelOption('')?.remove();

  const option = document.createElement('option');
  option.value = model.id;
  option.textContent = model.name;
  option.dataset.url = model.modelUrl;
  option.dataset.format = model.format || 'glb';
  modelSelect.appendChild(option);
  modelGallery.appendChild(createModelCard(model));
  ensureAddModelCard();

  if (wasSelected) {
    selectModel(model.id);
  }
}

function addPendingModelOption(task) {
  findModelOption(task.taskId)?.remove();
  findModelCard(task.taskId)?.remove();

  const option = document.createElement('option');
  option.value = task.taskId;
  option.textContent = `${task.name || '新しいモデル'}（生成中... ${task.progress || 0}%）`;
  option.disabled = true;
  option.dataset.pending = 'true';
  modelSelect.appendChild(option);
  modelGallery.appendChild(createModelCard({
    id: task.taskId,
    name: task.name || '新しいモデル',
    pending: true,
    progress: task.progress || 0,
  }));
  ensureAddModelCard();
}

function findModelOption(value) {
  return [...modelSelect.options].find((option) => option.value === value);
}

function findModelCard(value) {
  return [...modelGallery.querySelectorAll('[data-model-id]')].find(
    (card) => card.dataset.modelId === value,
  );
}

function createModelCard(model) {
  const card = document.createElement('button');
  card.className = 'model-card';
  card.type = 'button';
  card.dataset.modelId = model.id;
  card.setAttribute('aria-label', model.name);
  card.setAttribute('aria-pressed', String(model.id === modelSelect.value));

  if (model.pending) {
    card.classList.add('is-pending');
    card.disabled = true;
  }

  const imageContainer = document.createElement('span');
  imageContainer.className = 'model-card-preview';

  if (model.previewUrl) {
    const image = document.createElement('img');
    image.src = model.previewUrl;
    image.alt = `${model.name}のプレビュー`;
    image.loading = 'lazy';
    imageContainer.appendChild(image);
  } else if (model.modelUrl) {
    mountModelThumbnail(model, imageContainer);
  } else {
    imageContainer.textContent = '3D';
  }

  card.appendChild(imageContainer);

  if (model.pending) {
    const progress = clamp(Number(model.progress) || 0, 0, 100);
    const progressTrack = document.createElement('span');
    progressTrack.className = 'model-card-progress';
    progressTrack.setAttribute('aria-hidden', 'true');

    const progressFill = document.createElement('span');
    progressFill.className = 'model-card-progress-fill';
    progressFill.style.width = `${progress}%`;
    progressTrack.appendChild(progressFill);

    const status = document.createElement('span');
    status.className = 'model-card-status';
    status.textContent = `作成中... ${progress}%`;
    card.append(progressTrack, status);
    card.setAttribute('aria-label', `モデル作成中 ${progress}%`);
  }

  return card;
}

function createAddModelCard() {
  const card = document.createElement('button');
  card.className = 'model-card add-model-card';
  card.type = 'button';
  card.dataset.action = 'add-model';
  card.setAttribute('aria-label', 'モデルを追加');

  const icon = document.createElement('span');
  icon.className = 'material-symbols-rounded';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = 'add';
  card.appendChild(icon);
  return card;
}

function ensureAddModelCard() {
  modelGallery.querySelector('[data-action="add-model"]')?.remove();
  modelGallery.appendChild(createAddModelCard());
}

function mountModelThumbnail(model, container) {
  const thumbnailRenderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
  });
  thumbnailRenderer.setClearColor(0x000000, 0);
  thumbnailRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  thumbnailRenderer.setSize(220, 220, false);
  thumbnailRenderer.domElement.className = 'model-card-canvas';
  container.replaceChildren(thumbnailRenderer.domElement);

  const thumbnailScene = new THREE.Scene();
  thumbnailScene.add(new THREE.HemisphereLight(0xffffff, 0x5f6f89, 2.2));
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
  keyLight.position.set(2, 4, 4);
  thumbnailScene.add(keyLight);

  const thumbnailCamera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  thumbnailCamera.position.set(0, 0.35, 2.6);
  thumbnailCamera.lookAt(0, 0.15, 0);

  const onLoad = (loadedModel) => {
    const object = model.format === 'glb' ? loadedModel.scene : loadedModel;
    fitThumbnailModel(object);
    thumbnailScene.add(object);
    thumbnailRenderer.render(thumbnailScene, thumbnailCamera);
  };
  const onError = (error) => {
    console.error(error);
    container.textContent = '3D';
  };

  if (model.format === 'glb') {
    new GLTFLoader().load(model.modelUrl, onLoad, undefined, onError);
    return;
  }

  new FBXLoader().load(model.modelUrl, onLoad, undefined, onError);
}

function fitThumbnailModel(model) {
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxSize = Math.max(size.x, size.y, size.z) || 1;
  const scale = 0.9 / maxSize;

  model.scale.setScalar(scale);
  model.position.set(-center.x * scale, -center.y * scale - 0.04, -center.z * scale);
}

function selectGalleryModel(event) {
  const addCard = event.target.closest('[data-action="add-model"]');
  if (addCard) {
    openLibrary();
    return;
  }

  const card = event.target.closest('[data-model-id]');
  if (!card || card.disabled) {
    return;
  }

  selectModel(card.dataset.modelId);
}

function openLibrary() {
  modelImageInput.click();
}

function selectModel(value) {
  modelSelect.value = value;
  selectedModelReady = false;
  startButton.disabled = true;
  setModelStatus('モデルを読み込み中...');
  updateModelGallerySelection(value);
  loadModelOption(value);
}

function updateModelGallerySelection(value) {
  modelGallery.querySelectorAll('[data-model-id]').forEach((card) => {
    card.classList.toggle('is-selected', card.dataset.modelId === value);
    card.setAttribute('aria-pressed', String(card.dataset.modelId === value));
  });
}

function loadPendingModelTasks() {
  readPendingModelTasks().forEach((task) => {
    addPendingModelOption(task);
    pollModelTask(task);
  });
}

function readPendingModelTasks() {
  try {
    return JSON.parse(localStorage.getItem(pendingTasksStorageKey) || '[]');
  } catch (error) {
    console.error(error);
    return [];
  }
}

function writePendingModelTasks(tasks) {
  localStorage.setItem(pendingTasksStorageKey, JSON.stringify(tasks));
}

function savePendingModelTask(task) {
  const tasks = readPendingModelTasks().filter((item) => item.taskId !== task.taskId);
  tasks.push(task);
  writePendingModelTasks(tasks);
}

function removePendingModelTask(taskId) {
  writePendingModelTasks(readPendingModelTasks().filter((task) => task.taskId !== taskId));
  findModelOption(taskId)?.remove();
  findModelCard(taskId)?.remove();
  ensureAddModelCard();
}

function updatePendingModelTask(task) {
  addPendingModelOption(task);
  savePendingModelTask(task);
}

function loadModelOption(value) {
  if (!value) {
    return;
  }

  const option = modelSelect.querySelector(`option[value="${CSS.escape(value)}"]`);
  if (!option) {
    return;
  }

  setModelStatus('モデルを読み込み中...');
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
    updateModelGallerySelection(value);
    selectedModelReady = true;
    startButton.disabled = false;
    setModelStatus('');
    finishInitialLoading();
  };
  const onError = (error) => {
    console.error(error);
    selectedModelReady = false;
    startButton.disabled = true;
    setModelStatus('モデルの読み込みに失敗しました。');
    finishInitialLoading();
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
  if (!selectedModelReady) {
    setModelStatus('モデルを選択して読み込みが完了するまでお待ちください。');
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    startButton.disabled = true;
    setModelStatus('このブラウザではカメラを起動できません。');
    return;
  }

  try {
    setStatus('カメラを起動中...');
    await startCameraStream(currentFacingMode);

    setMode('camera');
    captureButton.disabled = false;
    switchCameraButton.disabled = false;
    window.requestAnimationFrame(resizeThree);
    setStatus('撮影できるよ！！！');
  } catch (error) {
    console.error(error);
    startButton.disabled = true;
    setModelStatus('カメラを起動できません。HTTPSのTunnel URLを確認してください。');
  }
}

async function switchCamera() {
  const previousFacingMode = currentFacingMode;
  const nextFacingMode = currentFacingMode === 'environment' ? 'user' : 'environment';

  try {
    switchCameraButton.disabled = true;
    setStatus('カメラを切り替え中...');
    await startCameraStream(nextFacingMode);
    setStatus('撮影できるよ！！！');
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
      width: { ideal: preferredCameraWidth },
      height: { ideal: preferredCameraHeight },
    },
  });

  const videoTrack = stream.getVideoTracks()[0];
  await maximizeVideoResolution(videoTrack);

  stopCameraStream();
  currentStream = stream;
  currentFacingMode = facingMode;
  video.srcObject = stream;
  video.classList.toggle('is-mirrored', currentFacingMode === 'user');
  await video.play();
}

async function maximizeVideoResolution(videoTrack) {
  if (!videoTrack?.getCapabilities || !videoTrack.applyConstraints) {
    return;
  }

  const capabilities = videoTrack.getCapabilities();
  const maxWidth = capabilities.width?.max;
  const maxHeight = capabilities.height?.max;

  if (!maxWidth || !maxHeight) {
    return;
  }

  try {
    const targetWidth = Math.min(maxWidth, preferredCameraWidth);
    const targetHeight = Math.min(maxHeight, preferredCameraHeight);

    await videoTrack.applyConstraints({
      width: { ideal: targetWidth, max: targetWidth },
      height: { ideal: targetHeight, max: targetHeight },
    });
  } catch (error) {
    console.info('カメラの最大解像度へ切り替えられませんでした。', error);
  }
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

  const rect = (threeLayer.parentElement || stage).getBoundingClientRect();
  const outputRatio = Math.max(rect.width / Math.max(rect.height, 1), 0.01);
  let outputWidth = video.videoWidth;
  let outputHeight = Math.round(outputWidth / outputRatio);

  if (outputHeight > video.videoHeight) {
    outputHeight = video.videoHeight;
    outputWidth = Math.round(outputHeight * outputRatio);
  }

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
        setCapturedImage(URL.createObjectURL(blob), blob);
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
  setStatus('撮影できるよ！！！');
  window.requestAnimationFrame(resizeThree);
}

function goHome() {
  clearCapturedImage();
  stopCameraStream();
  captureButton.disabled = true;
  switchCameraButton.disabled = true;
  setMode('home');
  setStatus('');
}

function setCapturedImage(imageUrl, blob) {
  clearCapturedImage();
  capturedImageUrl = imageUrl;
  capturedImageBlob = blob;
  resultImage.src = imageUrl;
  saveLink.href = imageUrl;
  saveLink.download = `duck-camera-${Date.now()}.jpg`;
  setMode('preview');
  setStatus('撮影できたよ！！！');
}

function clearCapturedImage() {
  if (capturedImageUrl?.startsWith('blob:')) {
    URL.revokeObjectURL(capturedImageUrl);
  }

  capturedImageUrl = undefined;
  capturedImageBlob = undefined;
  resultImage.removeAttribute('src');
  saveLink.removeAttribute('href');
}

async function generateFromUpload() {
  const file = modelImageInput.files?.[0];
  if (!file) {
    setModelStatus('モデル生成に使う画像を選択してください。');
    return;
  }

  try {
    await startModelGeneration(await readFileAsDataUrl(file), file.name);
    modelImageInput.value = '';
  } catch (error) {
    console.error(error);
    setModelStatus(error.message || 'モデル生成に失敗しました。');
  }
}

async function startModelGeneration(image, name) {
  setModelStatus('Tripoに画像を送信中...');

  const createResponse = await fetch(apiUrl('/api/models'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ image, name }),
  });
  const created = await readApiResponse(createResponse);
  const task = {
    taskId: created.taskId,
    name: name?.trim() || '新しいモデル',
    progress: created.progress || 0,
  };
  savePendingModelTask(task);
  addPendingModelOption(task);
  setMode('home');
  setModelStatus('モデル作ってるよ！！');
  pollModelTask(task);
}

async function pollModelTask(task) {
  try {
    const taskUrl = new URL(apiUrl('/api/task'), window.location.origin);
    taskUrl.searchParams.set('taskId', task.taskId);
    if (task.name) {
      taskUrl.searchParams.set('name', task.name);
    }

    const taskResponse = await fetch(taskUrl);
    const currentTask = await readApiResponse(taskResponse);

    if (currentTask.status === 'success') {
      removePendingModelTask(task.taskId);
      addGeneratedModelOption(currentTask.model);
      setModelStatus('モデルの生成が完了しました。');
      return;
    }

    if (['failed', 'cancelled', 'banned'].includes(currentTask.status)) {
      removePendingModelTask(task.taskId);
      setModelStatus(currentTask.error || 'モデル生成に失敗しました。');
      return;
    }

    updatePendingModelTask({
      ...task,
      progress: currentTask.progress || 0,
    });
  } catch (error) {
    console.info('モデル生成の状態確認を再試行します。', error);
  }

  window.setTimeout(() => pollModelTask(task), generationPollInterval);
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
  const requestedScale = Number(event.target.value);
  modelState.scale = Number.isFinite(requestedScale)
    ? clamp(requestedScale, 0.5, 1.8)
    : 1;
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
  event.currentTarget.setPointerCapture(event.pointerId);
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
  const modelScale = Number.isFinite(modelState.scale)
    ? clamp(modelState.scale, 0.5, 1.8)
    : 1;
  const landscapeScale = window.innerWidth > window.innerHeight
    ? Math.min(window.innerWidth / Math.max(window.innerHeight, 1), 2.2)
    : 1;
  duck.scale.setScalar(Math.min(modelScale * landscapeScale, maxModelRenderScale));
  duck.rotation.set(modelState.rotationX, modelState.rotationY, 0);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function resizeThree() {
  const container = threeLayer.parentElement || stage;
  const rect = container.getBoundingClientRect();
  const width = Math.max(rect.width, 1);
  const height = Math.max(rect.height, 1);

  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
  applyModelTransform();
}

function animate() {
  renderer.render(scene, camera);
  animationFrameId = window.requestAnimationFrame(animate);
}

function setStatus(message) {
  statusText.textContent = message;
}

function setModelStatus(message) {
  startButtonIcon.hidden = Boolean(message);
  startButtonLabel.textContent = message || '写真を！！撮る！！';
}

function setMode(mode) {
  app.classList.remove('state-loading', 'state-home', 'state-camera', 'state-preview');
  app.classList.add(`state-${mode}`);
  window.requestAnimationFrame(resizeThree);
}

function finishInitialLoading() {
  if (!initialLoading) {
    return;
  }

  initialLoading = false;
  setMode('home');
}

window.addEventListener('beforeunload', () => {
  if (animationFrameId) {
    window.cancelAnimationFrame(animationFrameId);
  }
  clearCapturedImage();
  stopCameraStream();
});
