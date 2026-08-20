import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  createModelTask,
  getModelTask,
  listModels,
  listPhotos,
  savePhoto as uploadPhoto,
} from './api.js';
import { readImageAsDataUrl } from './image-data.js';
import { ModelGenerationQueue } from './model-generation-queue.js';
import { createPendingTaskStore } from './pending-tasks.js';
import { PhotoUploadQueue } from './photo-upload-queue.js';

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
const photoGalleryButton = document.querySelector('#photoGalleryButton');
const photoGalleryScreen = document.querySelector('#photoGalleryScreen');
const photoGalleryGrid = document.querySelector('#photoGalleryGrid');
const photoGalleryStatus = document.querySelector('#photoGalleryStatus');
const closePhotoGalleryButton = document.querySelector('#closePhotoGalleryButton');
const switchCameraButton = document.querySelector('#switchCameraButton');
const modelScaleRange = document.querySelector('#modelScaleRange');
const scaleLimitButtons = document.querySelectorAll('[data-scale-limit]');
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
let capturedPhotoId;
let lastControlTouchTime = 0;
let selectedModelReady = false;
let initialLoading = true;
let modelLoadVersion = 0;
let cameraStarting = false;
let cameraSwitching = false;
let captureInProgress = false;
let captureVersion = 0;
let photoGalleryLoadPromise;

const storedPhotos = new Map();

const pendingTaskStore = createPendingTaskStore();
const modelGenerationQueue = new ModelGenerationQueue({
  createTask: createModelTask,
  getTask: getModelTask,
  maxConcurrent: 2,
  onTaskPending(task, { restored }) {
    if (!restored) {
      pendingTaskStore.upsert(task);
    }
    addPendingModelOption(task);
    if (!restored) {
      setMode('home');
      setModelStatus('モデル作ってるよ！！');
    }
  },
  onTaskProgress(task) {
    pendingTaskStore.upsert(task);
    addPendingModelOption(task);
  },
  onTaskSuccess(task, model) {
    removePendingModelTask(task.taskId);
    addGeneratedModelOption(model);
    setModelStatus('モデルの生成が完了しました。');
  },
  onTaskFailure(task, error) {
    if (task) {
      removePendingModelTask(task.taskId);
      console.info(error);
    } else {
      console.error(error);
    }
    setModelStatus(error.message || 'モデル生成に失敗しました。');
  },
  onCreateRetry(_error, retryDelay) {
    setModelStatus(`APIが混み合っています。${Math.ceil(retryDelay / 1000)}秒後に再試行します。`);
  },
  onQueueChange({ queuedCount }) {
    if (queuedCount) {
      setModelStatus(`モデル生成中... 待機 ${queuedCount}件`);
    }
  },
});

const photoUploadQueue = new PhotoUploadQueue({
  upload: uploadPhoto,
  maxConcurrent: 2,
  onSuccess(job, photo) {
    upsertStoredPhoto(photo);
    if (capturedPhotoId === job.id && app.classList.contains('state-preview')) {
      setStatus('みんなの写真に保存したよ！！！');
    }
  },
  onRetry(job, _error, retryDelay) {
    if (capturedPhotoId === job.id && app.classList.contains('state-preview')) {
      setStatus(`写真を保存中... ${Math.ceil(retryDelay / 1000)}秒後に再試行します。`);
    }
  },
  onFailure(job, error) {
    console.error(error);
    if (capturedPhotoId === job.id && app.classList.contains('state-preview')) {
      setStatus('写真の自動保存に失敗しました。もう一度撮影してください。');
    }
  },
});

boot();

startButton.addEventListener('click', startCamera);
modelSelect.addEventListener('change', () => selectModel(modelSelect.value));
modelGallery.addEventListener('click', selectGalleryModel);
modelImageInput.addEventListener('change', generateFromUpload);
captureButton.addEventListener('click', capturePhoto);
photoGalleryButton.addEventListener('click', openPhotoGallery);
closePhotoGalleryButton.addEventListener('click', closePhotoGallery);
switchCameraButton.addEventListener('click', switchCamera);
modelScaleRange.addEventListener('input', updateModelScale);
scaleLimitButtons.forEach((button) => {
  button.addEventListener('pointerdown', handleScaleLimitInput);
  button.addEventListener('keydown', handleScaleLimitInput);
});
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
document.addEventListener('touchend', preventControlDoubleTapZoom, { passive: false });
window.addEventListener('resize', resizeThree);
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !photoGalleryScreen.hidden) {
    closePhotoGallery();
  }
});

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
    const models = await listModels();
    if (!models.length) {
      setModelStatus('モデルがありません。＋から追加できます。');
      finishInitialLoading();
      return;
    }

    models.forEach(addGeneratedModelOption);
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
    preserveDrawingBuffer: true,
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
    try {
      const image = document.createElement('img');
      image.src = thumbnailRenderer.domElement.toDataURL('image/png');
      image.alt = `${model.name}のプレビュー`;
      container.replaceChildren(image);
    } catch (error) {
      console.info('3Dプレビュー画像を作成できませんでした。', error);
    } finally {
      disposeModelObject(object);
      thumbnailRenderer.dispose();
      thumbnailRenderer.forceContextLoss();
    }
  };
  const onError = (error) => {
    console.error(error);
    container.textContent = '3D';
    thumbnailRenderer.dispose();
    thumbnailRenderer.forceContextLoss();
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
  modelLoadVersion += 1;
  loadModelOption(value, modelLoadVersion);
}

function updateModelGallerySelection(value) {
  modelGallery.querySelectorAll('[data-model-id]').forEach((card) => {
    card.classList.toggle('is-selected', card.dataset.modelId === value);
    card.setAttribute('aria-pressed', String(card.dataset.modelId === value));
  });
}

function loadPendingModelTasks() {
  modelGenerationQueue.restore(pendingTaskStore.read());
}

function removePendingModelTask(taskId) {
  pendingTaskStore.remove(taskId);
  findModelOption(taskId)?.remove();
  findModelCard(taskId)?.remove();
  ensureAddModelCard();
}

function loadModelOption(value, loadVersion) {
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
    if (loadVersion !== modelLoadVersion || modelSelect.value !== value) {
      disposeModelObject(object);
      return;
    }

    const modelGroup = new THREE.Group();
    fitModel(object);
    modelGroup.add(object);

    if (duck) {
      scene.remove(duck);
      disposeModelObject(duck);
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
    if (loadVersion !== modelLoadVersion || modelSelect.value !== value) {
      return;
    }
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

function disposeModelObject(model) {
  model.traverse((object) => {
    object.geometry?.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.filter(Boolean).forEach((material) => {
      Object.values(material).forEach((value) => value?.isTexture && value.dispose());
      material.dispose();
    });
  });
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
  if (cameraStarting) {
    return;
  }

  if (!selectedModelReady) {
    setModelStatus('モデルを選択して読み込みが完了するまでお待ちください。');
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    startButton.disabled = true;
    setModelStatus('このブラウザではカメラを起動できません。');
    return;
  }

  cameraStarting = true;
  startButton.disabled = true;
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
    setModelStatus('カメラを起動できません。HTTPSのTunnel URLを確認してください。');
  } finally {
    cameraStarting = false;
    if (app.classList.contains('state-home')) {
      startButton.disabled = !selectedModelReady;
    }
  }
}

async function switchCamera() {
  if (cameraSwitching) {
    return;
  }

  cameraSwitching = true;
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
    cameraSwitching = false;
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
  if (captureInProgress) {
    return;
  }

  if (!video.videoWidth || !video.videoHeight) {
    setStatus('カメラ映像がまだ準備できていません。');
    return;
  }

  captureInProgress = true;
  captureVersion += 1;
  const currentCaptureVersion = captureVersion;
  captureButton.disabled = true;
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
    if (currentCaptureVersion === captureVersion) {
      setCapturedImage(canvas.toDataURL('image/jpeg', 0.86));
    }
    captureInProgress = false;
    return;
  }

  const imageDataUrl = canvas.toDataURL('image/jpeg', 0.86);
  canvas.toBlob(
    (blob) => {
      if (currentCaptureVersion !== captureVersion) {
        return;
      }
      if (blob) {
        setCapturedImage(URL.createObjectURL(blob), blob);
        captureInProgress = false;
        return;
      }

      setCapturedImage(imageDataUrl);
      captureInProgress = false;
    },
    'image/jpeg',
    0.86,
  );
}

function retakePhoto() {
  clearCapturedImage();
  captureInProgress = false;
  captureButton.disabled = false;
  setMode('camera');
  setStatus('撮影できるよ！！！');
  window.requestAnimationFrame(resizeThree);
}

function goHome() {
  captureVersion += 1;
  closePhotoGallery();
  clearCapturedImage();
  stopCameraStream();
  captureButton.disabled = true;
  captureInProgress = false;
  switchCameraButton.disabled = true;
  setMode('home');
  setStatus('');
}

function setCapturedImage(imageUrl, blob) {
  clearCapturedImage();
  const photoId = createPhotoId();
  capturedImageUrl = imageUrl;
  capturedImageBlob = blob;
  capturedPhotoId = photoId;
  resultImage.src = imageUrl;
  saveLink.href = imageUrl;
  saveLink.download = `duck-camera-${Date.now()}.jpg`;
  setMode('preview');
  setStatus('撮影できたよ！！！ 写真を保存中...');
  void queueCapturedPhoto(photoId, imageUrl, blob);
}

function clearCapturedImage() {
  if (capturedImageUrl?.startsWith('blob:')) {
    URL.revokeObjectURL(capturedImageUrl);
  }

  capturedImageUrl = undefined;
  capturedImageBlob = undefined;
  capturedPhotoId = undefined;
  resultImage.removeAttribute('src');
  saveLink.removeAttribute('href');
}

function createPhotoId() {
  const randomId = globalThis.crypto?.randomUUID?.()
    || `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
  return `${Date.now()}-${randomId}`;
}

async function queueCapturedPhoto(id, imageUrl, blob) {
  try {
    const image = blob ? await readImageAsDataUrl(blob) : imageUrl;
    photoUploadQueue.enqueue({ id, image });
  } catch (error) {
    console.error(error);
    if (capturedPhotoId === id && app.classList.contains('state-preview')) {
      setStatus('写真の自動保存に失敗しました。もう一度撮影してください。');
    }
  }
}

function openPhotoGallery() {
  photoGalleryScreen.hidden = false;
  photoGalleryButton.setAttribute('aria-expanded', 'true');
  renderPhotoGallery();
  void refreshPhotoGallery();
}

function closePhotoGallery() {
  photoGalleryScreen.hidden = true;
  photoGalleryButton.setAttribute('aria-expanded', 'false');
}

async function refreshPhotoGallery() {
  if (photoGalleryLoadPromise) {
    return photoGalleryLoadPromise;
  }

  photoGalleryStatus.textContent = storedPhotos.size ? '' : '写真を読み込み中...';
  const request = listPhotos();
  photoGalleryLoadPromise = request;

  try {
    const photos = await request;
    photos.forEach((photo) => storedPhotos.set(photo.id, photo));
    renderPhotoGallery();
    photoGalleryStatus.textContent = storedPhotos.size ? '' : 'まだ写真がありません。';
  } catch (error) {
    console.error(error);
    photoGalleryStatus.textContent = '写真一覧を読み込めませんでした。';
  } finally {
    if (photoGalleryLoadPromise === request) {
      photoGalleryLoadPromise = undefined;
    }
  }
}

function upsertStoredPhoto(photo) {
  storedPhotos.set(photo.id, photo);
  if (!photoGalleryScreen.hidden) {
    renderPhotoGallery();
  }
}

function renderPhotoGallery() {
  const photos = [...storedPhotos.values()]
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  const fragment = document.createDocumentFragment();

  photos.forEach((photo) => {
    const link = document.createElement('a');
    link.className = 'photo-gallery-card';
    link.href = photo.url;
    link.target = '_blank';
    link.rel = 'noopener';
    link.setAttribute('aria-label', '写真を大きく見る');

    const image = document.createElement('img');
    image.src = photo.url;
    image.alt = 'みんなの写真';
    image.loading = 'lazy';
    link.appendChild(image);
    fragment.appendChild(link);
  });

  photoGalleryGrid.replaceChildren(fragment);
  if (photos.length) {
    photoGalleryStatus.textContent = '';
  }
}

async function generateFromUpload() {
  const file = modelImageInput.files?.[0];
  if (!file) {
    setModelStatus('モデル生成に使う画像を選択してください。');
    return;
  }

  modelImageInput.value = '';

  try {
    const image = await readImageAsDataUrl(file);
    setModelStatus('Tripoに画像を送信中...');
    modelGenerationQueue.enqueue({ image, name: file.name });
  } catch (error) {
    console.error(error);
    setModelStatus(error.message || 'モデル生成に失敗しました。');
  }
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
  setModelScale(event.target.value);
}

function handleScaleLimitInput(event) {
  if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') {
    return;
  }

  event.preventDefault();
  const value = event.currentTarget.dataset.scaleLimit === 'max'
    ? modelScaleRange.max
    : modelScaleRange.min;
  setModelScale(value);
}

function setModelScale(value) {
  const requestedScale = Number(value);
  const minScale = Number(modelScaleRange.min);
  const maxScale = Number(modelScaleRange.max);
  modelState.scale = Number.isFinite(requestedScale)
    ? clamp(requestedScale, minScale, maxScale)
    : 1;
  modelScaleRange.value = String(modelState.scale);
  applyModelTransform();
}

function handleMoveButtonInput(event) {
  if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') {
    return;
  }

  event.preventDefault();
  moveModel(event.currentTarget.dataset.move);
}

function preventControlDoubleTapZoom(event) {
  if (!event.target.closest('.move-pad button, .scale-limit-button')) {
    return;
  }

  const now = Date.now();

  if (now - lastControlTouchTime < 350) {
    event.preventDefault();
  }

  lastControlTouchTime = now;
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
  modelGenerationQueue.stop();
  photoUploadQueue.stop();
  if (animationFrameId) {
    window.cancelAnimationFrame(animationFrameId);
  }
  clearCapturedImage();
  stopCameraStream();
});
