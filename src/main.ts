import type { InferenceDevice, MainToWorker, WorkerToMain } from "./transcribe.worker";
import {
  DEFAULT_WHISPER_MODEL_ID,
  whisperOptionDetail,
  whisperOptionTrigger,
  resolveWhisperModelId,
  WHISPER_MODEL_OPTIONS,
  type WhisperModelId,
} from "./whisper-models";
import TranscribeWorker from "./transcribe.worker?worker";

type WhisperChunkSec = 10 | 20 | 30;

// Always start at the top after reload/navigation restore.
if ("scrollRestoration" in history) {
  history.scrollRestoration = "manual";
}
window.scrollTo({ top: 0, left: 0, behavior: "auto" });
window.addEventListener("pageshow", () => {
  window.scrollTo({ top: 0, left: 0, behavior: "auto" });
});

const WHISPER_CHUNK_UI_ROWS: {
  sec: WhisperChunkSec;
  triggerSummary: string;
  title: string;
  detail: string;
}[] = [
  {
    sec: 10,
    triggerSummary: "~10 s — more frequent text updates",
    title: "~10 s",
    detail: "More frequent text updates",
  },
  { sec: 20, triggerSummary: "~20 s", title: "~20 s", detail: "Moderate refresh rate" },
  {
    sec: 30,
    triggerSummary: "~30 s — default (fewer updates)",
    title: "~30 s",
    detail: "Default — fewer updates",
  },
];

const fileInput = document.querySelector<HTMLInputElement>("#file")!;
const dropzone = document.querySelector<HTMLElement>("#dropzone")!;
const statusEl = document.querySelector<HTMLElement>("#status")!;
const statusHintEl = document.querySelector<HTMLElement>("#statusHint")!;
const errorDetails = document.querySelector<HTMLDetailsElement>("#errorDetails")!;
const errorDetailsPre = document.querySelector<HTMLPreElement>("#errorDetailsPre")!;
const lastUpdatedLine = document.querySelector<HTMLElement>("#lastUpdatedLine")!;
const simpleAnalyticsOptOutLink = document.querySelector<HTMLAnchorElement>(
  "#simpleAnalyticsOptOutLink",
);
function updateSimpleAnalyticsOptText(): void {
  if (!simpleAnalyticsOptOutLink) return;
  const isOptedOut = (() => {
    try {
      return localStorage.getItem("simpleanalytics:user-actions-opt-out") === "1";
    } catch {
      return false;
    }
  })();
  simpleAnalyticsOptOutLink.textContent = isOptedOut ? "Opt back in." : "Opt out.";
}

simpleAnalyticsOptOutLink?.addEventListener("click", (ev) => {
  ev.preventDefault();
  ev.stopPropagation();
  try {
    const isOptedOut = localStorage.getItem("simpleanalytics:user-actions-opt-out") === "1";
    if (isOptedOut) localStorage.removeItem("simpleanalytics:user-actions-opt-out");
    else localStorage.setItem("simpleanalytics:user-actions-opt-out", "1");
  } catch {
    // Ignore storage failures (private mode / blocked storage).
  }
  updateSimpleAnalyticsOptText();
});

updateSimpleAnalyticsOptText();
const previewPanel = document.querySelector<HTMLElement>("#previewPanel")!;
const previewFileName = document.querySelector<HTMLElement>("#previewFileName")!;
const previewDurationLabel = document.querySelector<HTMLElement>("#previewDurationLabel")!;
const previewDuration = document.querySelector<HTMLElement>("#previewDuration")!;
const previewRangeSummary = document.querySelector<HTMLElement>("#previewRangeSummary")!;
const previewRangeTimeline = document.querySelector<HTMLElement>("#previewRangeTimeline")!;
const previewRangeToggle = document.querySelector<HTMLButtonElement>("#previewRangeToggle")!;
const previewRangeExpand = document.querySelector<HTMLElement>("#previewRangeExpand")!;
const previewRangeRoot = document.querySelector<HTMLElement>("#previewRange")!;
const previewRangeOptionsPanel =
  document.querySelector<HTMLElement>("#previewRangeOptionsPanel")!;
const rangeStartSec = document.querySelector<HTMLInputElement>("#rangeStartSec")!;
const rangeEndSec = document.querySelector<HTMLInputElement>("#rangeEndSec")!;
const rangeStartTs = document.querySelector<HTMLElement>("#rangeStartTs")!;
const rangeEndTs = document.querySelector<HTMLElement>("#rangeEndTs")!;
const skipAnimationsEl = document.querySelector<HTMLInputElement>("#skipAnimations")!;
const sentencesOnNewLinesEl = document.querySelector<HTMLInputElement>("#sentencesOnNewLines")!;
const timestampSentencesWrap = document.querySelector<HTMLElement>("#timestampSentencesWrap")!;
const timestampSentencesEl = document.querySelector<HTMLInputElement>("#timestampSentences")!;
const cachedModelsPanel = document.querySelector<HTMLElement>("#cachedModelsPanel")!;
const cachedModelsTotal = document.querySelector<HTMLElement>("#cachedModelsTotal")!;
const cachedModelsEmpty = document.querySelector<HTMLElement>("#cachedModelsEmpty")!;
const cachedModelsList = document.querySelector<HTMLUListElement>("#cachedModelsList")!;
const startBtn = document.querySelector<HTMLButtonElement>("#startBtn")!;
const changeFileBtn = document.querySelector<HTMLButtonElement>("#changeFileBtn")!;
const whisperChunkRoot = document.querySelector<HTMLElement>("#whisperChunkRoot")!;
const whisperChunkToggle = document.querySelector<HTMLButtonElement>("#whisperChunkToggle")!;
const whisperChunkExpand = document.querySelector<HTMLElement>("#whisperChunkExpand")!;
const whisperChunkPanel = document.querySelector<HTMLElement>("#whisperChunkPanel")!;
const whisperChunkSecEl = document.querySelector<HTMLInputElement>("#whisperChunkSec")!;
const whisperChunkTriggerSummary =
  document.querySelector<HTMLElement>("#whisperChunkTriggerSummary")!;
const whisperChunkListbox = document.querySelector<HTMLUListElement>("#whisperChunkListbox")!;
const inferenceDeviceEl = document.querySelector<HTMLInputElement>("#inferenceDevice")!;
const inferenceDeviceSelectRoot =
  document.querySelector<HTMLElement>("#inferenceDeviceSelectRoot")!;
const inferenceDeviceTrigger =
  document.querySelector<HTMLButtonElement>("#inferenceDeviceTrigger")!;
const inferenceDeviceTriggerText =
  document.querySelector<HTMLElement>("#inferenceDeviceTriggerText")!;
const inferenceDevicePanel = document.querySelector<HTMLElement>("#inferenceDevicePanel")!;
const inferenceDeviceListbox =
  document.querySelector<HTMLUListElement>("#inferenceDeviceListbox")!;
const whisperModelIdHidden = document.querySelector<HTMLInputElement>("#whisperModelId")!;
const whisperModelSelectRoot = document.querySelector<HTMLElement>("#whisperModelSelectRoot")!;
const whisperModelTrigger = document.querySelector<HTMLButtonElement>("#whisperModelTrigger")!;
const whisperModelTriggerText =
  document.querySelector<HTMLElement>("#whisperModelTriggerText")!;
const whisperModelPanel = document.querySelector<HTMLElement>("#whisperModelPanel")!;
const whisperModelListbox = document.querySelector<HTMLUListElement>("#whisperModelListbox")!;

const LS_MODEL_ID_KEY = "browser-whisper:model-id";
const LS_INFERENCE_DEVICE_KEY = "browser-whisper:inference-device";
const LS_WHISPER_CHUNK_SEC_KEY = "browser-whisper:chunk-sec";
const LS_CACHED_MODELS_KEY = "browser-whisper:cached-model-ids";
const GITHUB_REPO = "JoyousJohn/browser-whisper";
const GITHUB_LATEST_COMMIT_API = `https://api.github.com/repos/${GITHUB_REPO}/commits?per_page=1`;
let doneStatusColorResetTimer: number | null = null;
const deletingCachedModelIds = new Set<WhisperModelId>();

function formatCommitDate(isoDate: string): string {
  const d = new Date(isoDate);
  if (!Number.isFinite(d.getTime())) return isoDate;
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(d);
}

async function renderLastUpdatedFromGitHub(): Promise<void> {
  try {
    const res = await fetch(GITHUB_LATEST_COMMIT_API, {
      method: "GET",
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) return;
    const data = (await res.json()) as Array<{ commit?: { committer?: { date?: string } } }>;
    const iso = data[0]?.commit?.committer?.date;
    if (!iso) return;
    lastUpdatedLine.textContent = `Updated ${formatCommitDate(iso)}`;
    lastUpdatedLine.hidden = false;
  } catch {
    // If GitHub fetch fails, leave the line hidden.
  }
}

function readCachedModelIds(): Set<WhisperModelId> {
  const raw = readLocalSetting(LS_CACHED_MODELS_KEY);
  if (!raw) return new Set<WhisperModelId>();
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set<WhisperModelId>();
    const out = new Set<WhisperModelId>();
    for (const v of parsed) {
      if (typeof v !== "string") continue;
      out.add(resolveWhisperModelId(v));
    }
    return out;
  } catch {
    return new Set<WhisperModelId>();
  }
}

function writeCachedModelIds(ids: Set<WhisperModelId>): void {
  writeLocalSetting(LS_CACHED_MODELS_KEY, JSON.stringify([...ids]));
}

const cachedModelIds = readCachedModelIds();

function markModelCached(modelId: WhisperModelId): void {
  if (cachedModelIds.has(modelId)) return;
  cachedModelIds.add(modelId);
  writeCachedModelIds(cachedModelIds);
}

function readLocalSetting(key: string): string | null {
  try {
    return globalThis.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocalSetting(key: string, value: string): void {
  try {
    globalThis.localStorage.setItem(key, value);
  } catch {
    // Ignore storage failures (private mode / blocked storage).
  }
}

function restorePersistedUiSettings(): void {
  const savedModel = readLocalSetting(LS_MODEL_ID_KEY);
  const restoredModelId = resolveWhisperModelId(savedModel ?? DEFAULT_WHISPER_MODEL_ID);
  whisperModelIdHidden.value = restoredModelId;
  writeLocalSetting(LS_MODEL_ID_KEY, restoredModelId);

  const savedDevice = readLocalSetting(LS_INFERENCE_DEVICE_KEY);
  const wantsWebGpu = savedDevice === "webgpu";
  inferenceDeviceEl.value = wantsWebGpu && inferenceWebGpuAvailable ? "webgpu" : "wasm";
  writeLocalSetting(LS_INFERENCE_DEVICE_KEY, getInferenceDevice());

  const savedChunkSec = readLocalSetting(LS_WHISPER_CHUNK_SEC_KEY);
  const restoredChunkSec = resolveWhisperChunkSec(savedChunkSec ?? "30");
  whisperChunkSecEl.value = String(restoredChunkSec);
  writeLocalSetting(LS_WHISPER_CHUNK_SEC_KEY, String(restoredChunkSec));
}

function whisperUiRow(id: WhisperModelId) {
  return WHISPER_MODEL_OPTIONS.find((r) => r.id === id) ?? WHISPER_MODEL_OPTIONS[0]!;
}

function formatApproxStorageMb(mb: number): string {
  if (mb >= 1024) return `~${(mb / 1024).toFixed(2)} GB`;
  return `~${Math.round(mb)} MB`;
}

function cachedModelApproxMb(modelId: WhisperModelId): number {
  return whisperUiRow(modelId).approxDownloadMb;
}

async function deleteModelFromBrowserCaches(modelId: WhisperModelId): Promise<void> {
  if (!("caches" in globalThis)) return;
  const encoded = encodeURIComponent(modelId);
  const names = await caches.keys();
  for (const cacheName of names) {
    const cache = await caches.open(cacheName);
    const requests = await cache.keys();
    for (const req of requests) {
      const u = req.url;
      if (u.includes(modelId) || u.includes(encoded)) {
        await cache.delete(req);
      }
    }
  }
}

async function onDeleteCachedModel(modelId: WhisperModelId): Promise<void> {
  if (deletingCachedModelIds.has(modelId)) return;
  deletingCachedModelIds.add(modelId);
  renderCachedModelsPanel();
  try {
    await deleteModelFromBrowserCaches(whisperUiRow(modelId).repo);
    // Ensure next transcription cannot reuse an in-memory pipeline for this model.
    if (transcribeWorker) {
      transcribeWorker.terminate();
      transcribeWorker = null;
    }
    cachedModelIds.delete(modelId);
    writeCachedModelIds(cachedModelIds);
    whisperModelDdSyncChrome();
  } finally {
    deletingCachedModelIds.delete(modelId);
    renderCachedModelsPanel();
  }
}

function renderCachedModelsPanel(): void {
  const ids = [...cachedModelIds];
  if (ids.length === 0) {
    cachedModelsPanel.hidden = true;
    cachedModelsTotal.textContent = "Estimated storage: 0 MB";
    cachedModelsEmpty.hidden = false;
    cachedModelsList.replaceChildren();
    return;
  }

  cachedModelsPanel.hidden = false;
  const totalMb = ids.reduce((sum, id) => sum + cachedModelApproxMb(id), 0);
  cachedModelsTotal.textContent = `Estimated storage: ${formatApproxStorageMb(totalMb)}`;
  cachedModelsEmpty.hidden = true;
  const frag = document.createDocumentFragment();
  for (const id of ids) {
    const row = whisperUiRow(id);
    const li = document.createElement("li");
    li.className = "cached-models-item";

    const meta = document.createElement("span");
    meta.className = "cached-models-meta";
    meta.textContent = `${row.title} (${formatApproxStorageMb(row.approxDownloadMb)})`;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn ghost cached-models-delete";
    btn.textContent = deletingCachedModelIds.has(id) ? "Deleting..." : "Delete";
    btn.disabled = deletingCachedModelIds.has(id);
    btn.addEventListener("click", () => void onDeleteCachedModel(id));

    li.append(meta, btn);
    frag.append(li);
  }
  cachedModelsList.replaceChildren(frag);
}

function whisperModelDdGetItems(): HTMLElement[] {
  return [...whisperModelListbox.querySelectorAll<HTMLElement>(`[role="option"]`)];
}

let whisperModelDdOpen = false;
let whisperModelDdKbdIdx = 0;

function whisperModelDdSetKbdHighlight() {
  const items = whisperModelDdGetItems();
  if (!items.length) return;
  whisperModelDdKbdIdx = ((whisperModelDdKbdIdx % items.length) + items.length) % items.length;
  for (let i = 0; i < items.length; i++) {
    const el = items[i]!;
    const on = i === whisperModelDdKbdIdx;
    el.classList.toggle("custom-dd-opt--kbd", on);
    if (on) whisperModelListbox.setAttribute("aria-activedescendant", el.id);
  }
}

function whisperModelDdClearKbdHighlight() {
  for (const el of whisperModelDdGetItems()) el.classList.remove("custom-dd-opt--kbd");
  whisperModelListbox.removeAttribute("aria-activedescendant");
}

function whisperModelDdSyncChrome() {
  const id = resolveWhisperModelId(whisperModelIdHidden.value);
  whisperModelIdHidden.value = id;
  whisperModelTriggerText.textContent = whisperOptionTrigger(whisperUiRow(id));
  for (const el of whisperModelDdGetItems()) {
    el.setAttribute("aria-selected", el.dataset.value === id ? "true" : "false");
    const badge = el.querySelector<HTMLElement>(".custom-dd-cache-badge");
    const optModelId = resolveWhisperModelId(el.dataset.value ?? "");
    if (badge) badge.hidden = !cachedModelIds.has(optModelId);
  }
}

function whisperModelDdEnsureDom() {
  if (whisperModelListbox.childElementCount > 0) return;
  for (let i = 0; i < WHISPER_MODEL_OPTIONS.length; i++) {
    const row = WHISPER_MODEL_OPTIONS[i]!;
    const li = document.createElement("li");
    li.className = "custom-dd-opt";
    li.setAttribute("role", "option");
    li.id = `whisper-model-opt-${i}`;
    li.tabIndex = -1;
    li.dataset.value = row.id;

    const stack = document.createElement("span");
    stack.className = "custom-dd-opt-stack";
    const title = document.createElement("span");
    title.className = "custom-dd-opt-title";
    title.textContent = row.title;
    const detail = document.createElement("span");
    detail.className = "custom-dd-opt-detail";
    detail.textContent = whisperOptionDetail(row);
    const cacheBadge = document.createElement("span");
    cacheBadge.className = "custom-dd-cache-badge";
    cacheBadge.textContent = "cached";
    cacheBadge.hidden = !cachedModelIds.has(row.id);
    detail.append(document.createTextNode(" "), cacheBadge);
    stack.append(title, detail);
    li.append(stack);

    li.addEventListener("pointerdown", (e) => e.preventDefault());
    li.addEventListener("click", () => whisperModelDdSelect(row.id));
    whisperModelListbox.appendChild(li);
  }
}

function whisperModelDdSelect(modelId: WhisperModelId) {
  whisperModelIdHidden.value = modelId;
  writeLocalSetting(LS_MODEL_ID_KEY, modelId);
  whisperModelDdSyncChrome();
  whisperModelDdClose();
}

function whisperModelDdClose() {
  if (!whisperModelDdOpen) return;
  whisperModelDdOpen = false;
  whisperModelTrigger.setAttribute("aria-expanded", "false");
  whisperModelTrigger.classList.remove("custom-dd-trigger--open");
  whisperModelPanel.hidden = true;
  whisperModelDdClearKbdHighlight();
  document.removeEventListener("pointerdown", whisperModelDdOnDocCapture, true);
  whisperModelTrigger.focus({ preventScroll: true });
}

function whisperModelDdOnDocCapture(ev: PointerEvent) {
  if (!whisperModelDdOpen) return;
  if (whisperModelSelectRoot.contains(ev.target as Node)) return;
  whisperModelDdClose();
}

function whisperModelDdOpenMenu() {
  whisperModelDdEnsureDom();
  whisperModelDdSyncChrome();
  const idx = WHISPER_MODEL_OPTIONS.findIndex(
    (r) => r.id === resolveWhisperModelId(whisperModelIdHidden.value),
  );
  whisperModelDdKbdIdx = idx >= 0 ? idx : 0;
  whisperModelDdOpen = true;
  whisperModelTrigger.setAttribute("aria-expanded", "true");
  whisperModelTrigger.classList.add("custom-dd-trigger--open");
  whisperModelPanel.hidden = false;
  whisperModelDdSetKbdHighlight();
  queueMicrotask(() => whisperModelListbox.focus({ preventScroll: true }));
  document.addEventListener("pointerdown", whisperModelDdOnDocCapture, true);
}

function whisperModelDdToggle() {
  if (whisperModelDdOpen) whisperModelDdClose();
  else whisperModelDdOpenMenu();
}

function getSelectedWhisperModelId(): WhisperModelId {
  return resolveWhisperModelId(whisperModelIdHidden.value);
}

function getInferenceDevice(): InferenceDevice {
  if (inferenceDeviceEl.value === "webgpu" && inferenceWebGpuAvailable) return "webgpu";
  return "wasm";
}

function inferenceDeviceUiLabel(device: InferenceDevice): string {
  return device === "webgpu" ? "GPU" : "CPU";
}

/** Disable GPU option when WebGPU is unavailable so users default to WASM. */
let inferenceWebGpuAvailable = true;
function setInferenceDeviceOptionsForBrowser() {
  const nav = globalThis.navigator as Navigator & { gpu?: unknown };
  inferenceWebGpuAvailable = Boolean(nav.gpu);
}

type InferenceDeviceUiRow = {
  id: InferenceDevice;
  title: string;
  detail: string;
};

const INFERENCE_DEVICE_UI_ROWS: InferenceDeviceUiRow[] = [
  { id: "wasm", title: "CPU", detail: "CPU (WebAssembly) · most compatible" },
  { id: "webgpu", title: "GPU", detail: "GPU (WebGPU) · faster on some devices" },
];

function inferenceDeviceDdGetItems(): HTMLElement[] {
  return [...inferenceDeviceListbox.querySelectorAll<HTMLElement>(`[role="option"]`)];
}

let inferenceDeviceDdOpen = false;
let inferenceDeviceDdKbdIdx = 0;

function inferenceDeviceDdSetKbdHighlight() {
  const items = inferenceDeviceDdGetItems();
  if (!items.length) return;
  inferenceDeviceDdKbdIdx = ((inferenceDeviceDdKbdIdx % items.length) + items.length) % items.length;
  for (let i = 0; i < items.length; i++) {
    const el = items[i]!;
    const on = i === inferenceDeviceDdKbdIdx;
    el.classList.toggle("custom-dd-opt--kbd", on);
    if (on) inferenceDeviceListbox.setAttribute("aria-activedescendant", el.id);
  }
}

function inferenceDeviceDdClearKbdHighlight() {
  for (const el of inferenceDeviceDdGetItems()) el.classList.remove("custom-dd-opt--kbd");
  inferenceDeviceListbox.removeAttribute("aria-activedescendant");
}

function inferenceDeviceDdSyncChrome() {
  const id = getInferenceDevice();
  inferenceDeviceEl.value = id;
  inferenceDeviceTriggerText.textContent = id === "webgpu" ? "GPU (WebGPU)" : "CPU (WebAssembly)";
  for (const el of inferenceDeviceDdGetItems()) {
    const optId = (el.dataset.value ?? "wasm") as InferenceDevice;
    const disabled = optId === "webgpu" && !inferenceWebGpuAvailable;
    el.setAttribute("aria-selected", optId === id ? "true" : "false");
    el.setAttribute("aria-disabled", disabled ? "true" : "false");
  }
}

function inferenceDeviceDdEnsureDom() {
  if (inferenceDeviceListbox.childElementCount > 0) return;
  for (let i = 0; i < INFERENCE_DEVICE_UI_ROWS.length; i++) {
    const row = INFERENCE_DEVICE_UI_ROWS[i]!;
    const li = document.createElement("li");
    li.className = "custom-dd-opt";
    li.setAttribute("role", "option");
    li.id = `inference-device-opt-${i}`;
    li.tabIndex = -1;
    li.dataset.value = row.id;

    const stack = document.createElement("span");
    stack.className = "custom-dd-opt-stack";
    const title = document.createElement("span");
    title.className = "custom-dd-opt-title";
    title.textContent = row.title;
    const detail = document.createElement("span");
    detail.className = "custom-dd-opt-detail";
    detail.textContent = row.detail;
    stack.append(title, detail);
    li.append(stack);

    li.addEventListener("pointerdown", (e) => e.preventDefault());
    li.addEventListener("click", () => inferenceDeviceDdSelect(row.id));
    inferenceDeviceListbox.appendChild(li);
  }
}

function inferenceDeviceDdSelect(id: InferenceDevice) {
  if (id === "webgpu" && !inferenceWebGpuAvailable) return;
  inferenceDeviceEl.value = id;
  writeLocalSetting(LS_INFERENCE_DEVICE_KEY, id);
  inferenceDeviceDdSyncChrome();
  inferenceDeviceDdClose();
}

function inferenceDeviceDdClose() {
  if (!inferenceDeviceDdOpen) return;
  inferenceDeviceDdOpen = false;
  inferenceDeviceTrigger.setAttribute("aria-expanded", "false");
  inferenceDeviceTrigger.classList.remove("custom-dd-trigger--open");
  inferenceDevicePanel.hidden = true;
  inferenceDeviceDdClearKbdHighlight();
  document.removeEventListener("pointerdown", inferenceDeviceDdOnDocCapture, true);
  inferenceDeviceTrigger.focus({ preventScroll: true });
}

function inferenceDeviceDdOnDocCapture(ev: PointerEvent) {
  if (!inferenceDeviceDdOpen) return;
  if (inferenceDeviceSelectRoot.contains(ev.target as Node)) return;
  inferenceDeviceDdClose();
}

function inferenceDeviceDdOpenMenu() {
  inferenceDeviceDdEnsureDom();
  inferenceDeviceDdSyncChrome();
  const id = getInferenceDevice();
  const idx = INFERENCE_DEVICE_UI_ROWS.findIndex((r) => r.id === id);
  inferenceDeviceDdKbdIdx = idx >= 0 ? idx : 0;
  inferenceDeviceDdOpen = true;
  inferenceDeviceTrigger.setAttribute("aria-expanded", "true");
  inferenceDeviceTrigger.classList.add("custom-dd-trigger--open");
  inferenceDevicePanel.hidden = false;
  inferenceDeviceDdSetKbdHighlight();
  queueMicrotask(() => inferenceDeviceListbox.focus({ preventScroll: true }));
  document.addEventListener("pointerdown", inferenceDeviceDdOnDocCapture, true);
}

function inferenceDeviceDdToggle() {
  if (inferenceDeviceDdOpen) inferenceDeviceDdClose();
  else inferenceDeviceDdOpenMenu();
}

whisperModelDdEnsureDom();
inferenceDeviceDdEnsureDom();
setInferenceDeviceOptionsForBrowser();
restorePersistedUiSettings();
syncTimestampSentenceToggleVisibility();
whisperModelDdSyncChrome();
inferenceDeviceDdSyncChrome();
renderCachedModelsPanel();
void renderLastUpdatedFromGitHub();

whisperChunkEnsureDom();
whisperChunkSyncChrome();

whisperModelTrigger.addEventListener("click", (e) => {
  e.preventDefault();
  whisperModelDdToggle();
});

inferenceDeviceTrigger.addEventListener("click", (e) => {
  e.preventDefault();
  inferenceDeviceDdToggle();
});

inferenceDeviceTrigger.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    if (!inferenceDeviceDdOpen) inferenceDeviceDdOpenMenu();
  }
});

inferenceDeviceListbox.addEventListener("keydown", (e) => {
  if (!inferenceDeviceDdOpen) return;
  const items = inferenceDeviceDdGetItems();
  if (items.length === 0) return;
  switch (e.key) {
    case "Escape":
      e.preventDefault();
      inferenceDeviceDdClose();
      return;
    case "ArrowDown":
      e.preventDefault();
      inferenceDeviceDdKbdIdx = (inferenceDeviceDdKbdIdx + 1) % items.length;
      inferenceDeviceDdSetKbdHighlight();
      items[inferenceDeviceDdKbdIdx]!.scrollIntoView({ block: "nearest" });
      return;
    case "ArrowUp":
      e.preventDefault();
      inferenceDeviceDdKbdIdx = (inferenceDeviceDdKbdIdx - 1 + items.length) % items.length;
      inferenceDeviceDdSetKbdHighlight();
      items[inferenceDeviceDdKbdIdx]!.scrollIntoView({ block: "nearest" });
      return;
    case "Enter":
    case " ": {
      e.preventDefault();
      const pick = INFERENCE_DEVICE_UI_ROWS[inferenceDeviceDdKbdIdx]!.id;
      inferenceDeviceDdSelect(pick);
      return;
    }
    case "Tab":
      inferenceDeviceDdClose();
      return;
    default:
      break;
  }
});

whisperModelTrigger.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    if (!whisperModelDdOpen) whisperModelDdOpenMenu();
  }
});

whisperModelListbox.addEventListener("keydown", (e) => {
  if (!whisperModelDdOpen) return;
  const items = whisperModelDdGetItems();
  if (items.length === 0) return;
  switch (e.key) {
    case "Escape":
      e.preventDefault();
      whisperModelDdClose();
      return;
    case "ArrowDown":
      e.preventDefault();
      whisperModelDdKbdIdx = (whisperModelDdKbdIdx + 1) % items.length;
      whisperModelDdSetKbdHighlight();
      items[whisperModelDdKbdIdx]!.scrollIntoView({ block: "nearest" });
      return;
    case "ArrowUp":
      e.preventDefault();
      whisperModelDdKbdIdx = (whisperModelDdKbdIdx - 1 + items.length) % items.length;
      whisperModelDdSetKbdHighlight();
      items[whisperModelDdKbdIdx]!.scrollIntoView({ block: "nearest" });
      return;
    case "Enter":
    case " ": {
      e.preventDefault();
      const pick = WHISPER_MODEL_OPTIONS[whisperModelDdKbdIdx]!.id;
      whisperModelDdSelect(pick);
      return;
    }
    case "Tab":
      whisperModelDdClose();
      return;
    default:
      break;
  }
});

const outputSection = document.querySelector<HTMLElement>("#outputSection")!;
const outputEl = document.querySelector<HTMLElement>("#output")!;
const copyBtn = document.querySelector<HTMLButtonElement>("#copyBtn")!;
const rawBtn = document.querySelector<HTMLButtonElement>("#rawBtn")!;
const downloadTxtBtn = document.querySelector<HTMLButtonElement>("#downloadTxtBtn")!;
const outputWordCountEl = document.querySelector<HTMLElement>("#outputWordCount")!;
const OUTPUT_BOTTOM_EPSILON_PX = 8;
/** Turns off once user scrolls up during a run. */
let outputAutoFollowEnabled = true;
let outputScrollIsProgrammatic = false;

function isOutputNearBottom(): boolean {
  const remaining = outputEl.scrollHeight - outputEl.clientHeight - outputEl.scrollTop;
  return remaining <= OUTPUT_BOTTOM_EPSILON_PX;
}

function scrollOutputToBottomIfFollowing() {
  if (!outputAutoFollowEnabled) return;
  outputScrollIsProgrammatic = true;
  outputEl.scrollTop = outputEl.scrollHeight;
  queueMicrotask(() => {
    outputScrollIsProgrammatic = false;
  });
}

/** After completion, put the status line at viewport top and reset transcript viewport to the start. */
function focusCompletedTranscriptView() {
  outputScrollIsProgrammatic = true;
  outputEl.scrollTop = 0;
  queueMicrotask(() => {
    outputScrollIsProgrammatic = false;
  });
  const targetY = window.scrollY + statusEl.getBoundingClientRect().top;
  window.scrollTo({ top: targetY, behavior: "smooth" });
}

outputEl.addEventListener("scroll", () => {
  if (outputScrollIsProgrammatic) return;
  if (!isOutputNearBottom()) outputAutoFollowEnabled = false;
});

function getOutputTranscriptText(): string {
  let t = outputEl.textContent ?? "";
  t = t.replace(/\s*\u2026\s*$/, "").trim();
  t = t.replace(/\s*\.\.\.\s*$/, "").trim();
  return t;
}

/** Enable output actions when transcript text exists; TXT/RAW require final (non-streaming) output. */
function syncCopyButtonFromOutput() {
  const t = getOutputTranscriptText();
  const onlyPlaceholder = t.length === 0 || t === "\u2014";
  copyBtn.disabled = onlyPlaceholder;
  const isStreaming = outputEl.classList.contains("streaming");
  rawBtn.disabled = onlyPlaceholder || isStreaming;
  downloadTxtBtn.disabled = onlyPlaceholder || isStreaming;
}

const SAMPLE_RATE = 16_000;
/** How often the “Transcribing… elapsed” status line refreshes while inference runs. */
const TRANSCRIBE_STATUS_TICK_MS = 1000;

const AUDIO_EXT = /\.(mp3|wav|m4a|aac|webm|ogg|opus|flac)$/i;

/** Minimum span (seconds) for the selected transcribe range; matches short-audio guard. */
const MIN_TRANSCRIBE_RANGE_SEC = 0.5;

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function isProbablyAudioFile(f: File) {
  return f.type.startsWith("audio/") || AUDIO_EXT.test(f.name);
}

function shouldSkipTranscriptAnimations(): boolean {
  return skipAnimationsEl.checked;
}

function shouldUseSentenceLineBreaks(): boolean {
  return sentencesOnNewLinesEl.checked;
}

function shouldTimestampSentences(): boolean {
  return shouldUseSentenceLineBreaks() && timestampSentencesEl.checked;
}

function formatTranscriptDisplayText(text: string): string {
  if (!shouldUseSentenceLineBreaks()) return text;
  return text.replace(/([.!?])\s/g, "$1\n");
}

type TimedChunkLike = {
  text?: string;
  timestamp?: [number, number] | [number | null, number | null] | number[];
};

function splitIntoSentenceParts(text: string): Array<{ text: string; complete: boolean }> {
  const out = text.match(/[^.!?]+[.!?]+(?:["')\]]+)?|[^.!?]+$/g) ?? [];
  return out
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => ({ text: s, complete: /[.!?]["')\]]*$/.test(s) }));
}

function formatTimestampSec(secIn: number): string {
  const sec = Math.max(0, secIn);
  const whole = Math.round(sec);
  return formatClock(whole);
}

function formatTimestampedSentenceLinesFromChunks(
  chunks: TimedChunkLike[],
  opts?: { includeIncomplete?: boolean },
): string | null {
  const includeIncomplete = Boolean(opts?.includeIncomplete);
  const lines: string[] = [];
  for (const ch of chunks) {
    const text = String(ch.text ?? "").trim();
    if (!text) continue;
    const ts = ch.timestamp;
    if (!Array.isArray(ts) || ts.length < 2) continue;
    const start = Number(ts[0]);
    const end = Number(ts[1]);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) continue;
    const parts = splitIntoSentenceParts(text);
    if (parts.length === 0) continue;
    const effectiveParts = includeIncomplete ? parts : parts.filter((p) => p.complete);
    if (effectiveParts.length === 0) continue;
    if (effectiveParts.length === 1) {
      lines.push(
        `[${formatTimestampSec(start)} -> ${formatTimestampSec(end)}] ${effectiveParts[0]!.text}`,
      );
      continue;
    }
    const totalChars = effectiveParts.reduce((n, s) => n + s.text.length, 0) || 1;
    let consumed = 0;
    const span = end - start;
    for (const part of effectiveParts) {
      const s0 = start + (consumed / totalChars) * span;
      consumed += part.text.length;
      const s1 = start + (consumed / totalChars) * span;
      lines.push(`[${formatTimestampSec(s0)} -> ${formatTimestampSec(s1)}] ${part.text}`);
    }
  }
  return lines.length > 0 ? lines.join("\n") : null;
}

function syncTimestampSentenceToggleVisibility(): void {
  const enabled = shouldUseSentenceLineBreaks();
  timestampSentencesEl.disabled = !enabled;
  timestampSentencesWrap.classList.toggle("preview-toggle-label--disabled", !enabled);
  timestampSentencesWrap.setAttribute("aria-disabled", enabled ? "false" : "true");
  if (!enabled) timestampSentencesEl.checked = false;
}

let busy = false;

/** File waiting for the user to press Start (after preview). */
let pendingFile: File | null = null;

/** Duration (seconds) from metadata decode; used for range slider max. */
let previewFullDurationSec = 0;

/** One worker keeps the loaded model in memory between files. */
let transcribeWorker: Worker | null = null;

function getTranscribeWorker(): Worker {
  if (!transcribeWorker) {
    transcribeWorker = new TranscribeWorker();
    transcribeWorker.addEventListener("error", () => {
      transcribeWorker?.terminate();
      transcribeWorker = null;
    });
  }
  return transcribeWorker;
}

function clearErrorDetails() {
  errorDetails.hidden = true;
  errorDetails.open = false;
  errorDetailsPre.textContent = "";
}

function setStatusLine(
  text: string,
  isError = false,
  options?: { modelDownloaded?: boolean; done?: boolean; hintText?: string },
) {
  if (doneStatusColorResetTimer !== null) {
    window.clearTimeout(doneStatusColorResetTimer);
    doneStatusColorResetTimer = null;
  }
  if (!isError) clearErrorDetails();
  statusEl.textContent = text;
  statusHintEl.textContent = options?.hintText ?? "";
  statusEl.classList.toggle("error", isError);
  statusEl.classList.toggle("status--model-downloaded", Boolean(options?.modelDownloaded));
  statusEl.classList.toggle("status--done", Boolean(options?.done));
  if (options?.done) {
    doneStatusColorResetTimer = window.setTimeout(() => {
      statusEl.classList.remove("status--done");
      doneStatusColorResetTimer = null;
    }, 3000);
  }
}

function setStatus(text: string, isError = false) {
  statusEl.classList.remove("working");
  statusEl.classList.remove("status--decoding");
  clearErrorDetails();
  setStatusLine(text, isError);
}

/** Full-page error with optional stack / technical block (collapsible). */
function setStatusError(message: string, detail?: string) {
  statusEl.classList.remove("working");
  statusEl.classList.remove("status--decoding");
  clearErrorDetails();
  statusEl.textContent = message;
  statusEl.classList.add("error");
  const trimmed = detail?.trim();
  if (trimmed) {
    errorDetails.hidden = false;
    errorDetailsPre.textContent = trimmed;
  }
}

let modelDownloadMaxPct = 0;

function resetWorkerModelProgressTracking() {
  modelDownloadMaxPct = 0;
}

function applyWorkerModelProgress(
  d: Extract<WorkerToMain, { type: "model_progress" }>,
  sawDownloadInThisRun: boolean,
) {
  if (d.phase === "download") {
    setStatus(`Fetching ${d.file}…`);
  } else {
    const pct = Math.round(d.progress);
    if (!Number.isFinite(pct)) return;
    modelDownloadMaxPct = Math.max(modelDownloadMaxPct, clamp(pct, 0, 100));
    if (sawDownloadInThisRun && modelDownloadMaxPct >= 100) {
      setStatusLine("Model downloaded...", false, { modelDownloaded: true });
      return;
    }
    if (sawDownloadInThisRun) {
      setStatus(`Downloading model… ${modelDownloadMaxPct}%`);
    } else {
      setStatus(`Loading model… ${modelDownloadMaxPct}%`);
    }
  }
}

/** Match Whisper pipeline stride chunking (see chunk_length_s / stride_length_s). */
function countWhisperStrideChunks(
  sampleCount: number,
  sampleRate: number,
  chunkLenS: number,
  strideLenS: number,
): number {
  const windowSamples = sampleRate * chunkLenS;
  const strideSamples = sampleRate * strideLenS;
  const jump = windowSamples - 2 * strideSamples;
  let offset = 0;
  let n = 0;
  while (true) {
    n++;
    const offsetEnd = offset + windowSamples;
    if (offsetEnd >= sampleCount) break;
    offset += jump;
  }
  return n;
}

function formatClock(totalSec: number): string {
  const sec = Math.floor(totalSec % 60);
  const min = Math.floor(totalSec / 60) % 60;
  const hr = Math.floor(totalSec / 3600);
  const pad = (x: number) => String(x).padStart(2, "0");
  if (hr > 0) return `${hr}:${pad(min)}:${pad(sec)}`;
  return `${min}:${pad(sec)}`;
}

/** Coerce start/end (seconds) to [0, maxSec], ordered, with at least minSpan (capped by file length). */
function normalizeTimeRangeSec(
  startSec: number,
  endSec: number,
  maxSec: number,
  minSpanSec = MIN_TRANSCRIBE_RANGE_SEC,
): { start: number; end: number } {
  if (!(maxSec > 0) || !Number.isFinite(maxSec)) return { start: 0, end: 0 };
  let s = clamp(Number(startSec), 0, maxSec);
  let e = clamp(Number(endSec), 0, maxSec);
  if (e < s) [s, e] = [e, s];
  const minLen = Math.min(minSpanSec, maxSec);
  if (e - s < minLen) {
    e = Math.min(maxSec, s + minLen);
    if (e - s < minLen) s = Math.max(0, e - minLen);
  }
  return { start: s, end: e };
}

function getRangeStep(durationSec: number): string {
  if (durationSec <= 1) return "0.01";
  if (durationSec <= 10) return "0.05";
  return "0.1";
}

/** Re-entrancy guard: programmatic field updates must not recurse into `input` handlers. */
let previewRangeApplyDepth = 0;

function snapSecToRangeStep(sec: number): number {
  const step = Number(rangeStartSec.step);
  if (!(step > 0) || !Number.isFinite(sec)) return sec;
  return Math.round(sec / step) * step;
}

/**
 * Format seconds as `m:ss`, or `h:mm:ss` from one hour upward.
 * Seconds use two digits when whole; fractional seconds keep up to two decimals (matches slider step).
 */
function formatColonTimestampFromSec(secIn: number): string {
  const sec = Math.max(0, secIn);
  const stepped = snapSecToRangeStep(sec);
  const hr = Math.floor(stepped / 3600);
  const rem = stepped - hr * 3600;
  const min = Math.floor(rem / 60);
  const sRem = rem - min * 60;
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const isWhole = Math.abs(sRem - Math.round(sRem)) < 1e-6;
  const secPart = isWhole
    ? pad2(Math.round(sRem))
    : (() => {
        const t = Number(sRem.toFixed(2));
        const str = String(t);
        const dot = str.indexOf(".");
        if (dot === -1) return pad2(Math.round(Number(str)));
        const intS = str.slice(0, dot);
        const fracRaw = str.slice(dot + 1).replace(/0+$/, "");
        return intS.padStart(2, "0") + (fracRaw ? `.${fracRaw}` : "");
      })();
  if (hr > 0) return `${hr}:${pad2(min)}:${secPart}`;
  return `${min}:${secPart}`;
}

/** Digit-only entry for Start/End: last two digits are seconds, rest are minutes (`500` → 5:00). */
type TsRoot = HTMLElement;

const timestampFieldState = new Map<TsRoot, { buf: string; caret: number }>();
/** True while rewriting range timestamp widgets from sliders / apply (avoid re-entrant handlers). */
let applyingTimestampInputs = false;

const MAX_TIMESTAMP_DIGITS = 10;
const TS_FACE_SEL = ".preview-range-ts-face";

function getTsFace(root: TsRoot): HTMLElement {
  return root.querySelector<HTMLElement>(TS_FACE_SEL)!;
}

function tsState(root: TsRoot): { buf: string; caret: number } | undefined {
  return timestampFieldState.get(root);
}

/** Decode keypad / main-key row to a single digit character, if any. */
function digitCharFromKeyboard(ev: KeyboardEvent): string | null {
  const { key, code } = ev;
  if (/^[0-9]$/.test(key)) return key;
  const m = /^Numpad(\d)$/.exec(code) ?? /^Digit(\d)$/.exec(code);
  if (m?.[1] != null) return m[1]!;
  return null;
}

function countFormattedDigits(fmt: string): number {
  let n = 0;
  for (const ch of fmt) {
    if (/[0-9]/.test(ch)) n++;
  }
  return n;
}

/** Map insertion index in the digit buffer to “which displayed digit” highlights (colons are skipped). */
function caretHighlightDigitIndexInFormatted(
  caretPos: number,
  bufLen: number,
  formattedDigitCount: number,
): number {
  if (formattedDigitCount <= 0) return 0;
  if (bufLen === 0) return 0;
  const c = clamp(caretPos, 0, bufLen);
  if (c <= 0) return 0;
  if (c >= bufLen) return formattedDigitCount - 1;
  if (formattedDigitCount === 1) return 0;
  return clamp(
    Math.round((c / bufLen) * (formattedDigitCount - 1)),
    0,
    formattedDigitCount - 1,
  );
}

function renderTimestampWidget(root: TsRoot) {
  const face = getTsFace(root);
  face.replaceChildren();
  const placeholder = root.dataset.placeholder ?? "0:00";
  const st = tsState(root);

  if (!st?.buf || st.buf === "") {
    const ph = document.createElement("span");
    ph.className = "preview-range-ts-placeholder";
    ph.textContent = placeholder;
    face.appendChild(ph);
    root.removeAttribute("aria-valuetext");
    return;
  }

  const sec = secondsFromDigitBuffer(st.buf);
  if (sec === null) return;

  const fmt = formatColonTimestampFromSec(sec);
  const fd = countFormattedDigits(fmt);
  let digitRun = -1;
  const hi = caretHighlightDigitIndexInFormatted(st.caret, st.buf.length, fd);

  for (const ch of fmt) {
    if (/[0-9]/.test(ch)) {
      digitRun++;
      const span = document.createElement("span");
      span.className =
        digitRun === hi
          ? "preview-range-ts-digit preview-range-ts-digit--focused"
          : "preview-range-ts-digit";
      span.textContent = ch;
      span.dataset.digitIx = String(digitRun);
      face.appendChild(span);
    } else {
      const sep = document.createElement("span");
      sep.className = "preview-range-ts-sep";
      sep.textContent = ch;
      face.appendChild(sep);
    }
  }
  root.setAttribute("aria-valuetext", fmt);
}

/**
 * 1–2 digits: seconds only (00–99). 3+: last two digits = seconds (00–59), prefix = whole minutes (any size; hours rolled into minute count).
 */
function secondsFromDigitBuffer(digits: string): number | null {
  const d = digits.replace(/\D/g, "");
  if (!d) return null;
  if (d.length <= 2) {
    const n = parseInt(d, 10);
    if (!Number.isFinite(n)) return null;
    return clamp(n, 0, 99);
  }
  const secPart = parseInt(d.slice(-2), 10);
  const minPart = parseInt(d.slice(0, -2), 10) || 0;
  if (!Number.isFinite(secPart) || !Number.isFinite(minPart)) return null;
  return minPart * 60 + clamp(secPart, 0, 59);
}

/** Reverse of `secondsFromDigitBuffer` for whole seconds (matches snapped slider seconds). */
function digitBufferFromTotalSeconds(secInt: number): string {
  const s = clamp(Math.round(secInt), 0, Number.MAX_SAFE_INTEGER);
  const min = Math.floor(s / 60);
  const rem = s % 60;
  if (min === 0) return String(rem);
  return `${min}${String(rem).padStart(2, "0")}`;
}

function setTimestampWidgetsFromAppliedRange(startSec: number, endSec: number) {
  applyingTimestampInputs = true;
  try {
    for (const [root, rawSec] of [
      [rangeStartTs, startSec],
      [rangeEndTs, endSec],
    ] as const) {
      const stepped = snapSecToRangeStep(rawSec);
      const buf = digitBufferFromTotalSeconds(Math.round(stepped));
      timestampFieldState.set(root, { buf, caret: buf.length });
      renderTimestampWidget(root);
    }
  } finally {
    applyingTimestampInputs = false;
  }
}

function tsInsertDigitsAtCaret(root: TsRoot, batch: string) {
  if (root.classList.contains("preview-range-ts--disabled")) return;
  const only = batch.replace(/\D/g, "");
  if (!only) return;
  const prev = tsState(root) ?? { buf: "", caret: 0 };
  let { buf, caret } = prev;
  caret = clamp(caret, 0, buf.length);
  buf = buf.slice(0, caret) + only + buf.slice(caret);
  buf = buf.replace(/\D/g, "");
  caret = caret + only.length;
  if (buf.length > MAX_TIMESTAMP_DIGITS) {
    const drop = buf.length - MAX_TIMESTAMP_DIGITS;
    buf = buf.slice(drop);
    caret = Math.max(0, caret - drop);
  }
  caret = clamp(caret, 0, buf.length);
  timestampFieldState.set(root, { buf, caret });
  renderTimestampWidget(root);
  enforcePreviewRangeFromTimestampFields();
}

function tsDeleteBackward(root: TsRoot) {
  if (root.classList.contains("preview-range-ts--disabled")) return;
  const st = tsState(root);
  if (!st || st.buf === "") return;
  let { buf, caret } = st;
  if (caret <= 0) return;
  buf = buf.slice(0, caret - 1) + buf.slice(caret);
  caret -= 1;
  if (!buf) {
    timestampFieldState.set(root, { buf: "0", caret: 1 });
    renderTimestampWidget(root);
    enforcePreviewRangeFromTimestampFields();
    return;
  }
  timestampFieldState.set(root, { buf, caret });
  renderTimestampWidget(root);
  enforcePreviewRangeFromTimestampFields();
}

function tsDeleteForward(root: TsRoot) {
  if (root.classList.contains("preview-range-ts--disabled")) return;
  const st = tsState(root);
  if (!st || st.caret >= st.buf.length) return;
  const { buf, caret } = st;
  const next = buf.slice(0, caret) + buf.slice(caret + 1);
  if (!next) {
    timestampFieldState.set(root, { buf: "0", caret: 1 });
  } else {
    timestampFieldState.set(root, { buf: next, caret });
  }
  renderTimestampWidget(root);
  enforcePreviewRangeFromTimestampFields();
}

function tsPasteReplace(root: TsRoot, text: string) {
  if (root.classList.contains("preview-range-ts--disabled")) return;
  const extra = text.replace(/\D/g, "").slice(-MAX_TIMESTAMP_DIGITS);
  if (!extra) return;
  timestampFieldState.set(root, { buf: extra, caret: extra.length });
  renderTimestampWidget(root);
  enforcePreviewRangeFromTimestampFields();
}

function setTsWidgetsInteractive(enabled: boolean) {
  for (const root of [rangeStartTs, rangeEndTs]) {
    root.classList.toggle("preview-range-ts--disabled", !enabled);
    root.toggleAttribute("inert", !enabled);
    root.tabIndex = enabled ? 0 : -1;
  }
}

function moveTsCaretDelta(root: TsRoot, delta: number) {
  const st = tsState(root);
  if (!st?.buf) return;
  const c = clamp(st.caret + delta, 0, st.buf.length);
  timestampFieldState.set(root, { buf: st.buf, caret: c });
  renderTimestampWidget(root);
}

/** Tap a digit: reposition the logical caret (digits only; colons stay out of the caret path). */
function onTsFacePointerDown(ev: MouseEvent | PointerEvent, root: TsRoot) {
  if (root.classList.contains("preview-range-ts--disabled")) return;
  const t = ev.target as HTMLElement | null;
  const digitEl = t?.closest?.("[data-digit-ix]") as HTMLElement | null;
  if (!digitEl || !root.contains(digitEl)) return;
  ev.preventDefault();
  root.focus();
  const st = tsState(root);
  if (!st?.buf) return;
  const sec = secondsFromDigitBuffer(st.buf);
  if (sec === null) return;
  const fmt = formatColonTimestampFromSec(sec);
  const fd = countFormattedDigits(fmt);
  const clicked = Number(digitEl.dataset.digitIx);
  if (!Number.isFinite(clicked)) return;
  const caret = clamp(
    Math.round(((clicked + 0.5) / Math.max(fd, 1)) * st.buf.length),
    0,
    st.buf.length,
  );
  timestampFieldState.set(root, { buf: st.buf, caret });
  renderTimestampWidget(root);
}

function onTsKeyDown(ev: KeyboardEvent, root: TsRoot) {
  if (applyingTimestampInputs || root.classList.contains("preview-range-ts--disabled")) return;
  if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
  if (ev.isComposing) return;

  const digit = digitCharFromKeyboard(ev);
  if (digit) {
    ev.preventDefault();
    tsInsertDigitsAtCaret(root, digit);
    return;
  }

  switch (ev.key) {
    case "Backspace":
      ev.preventDefault();
      tsDeleteBackward(root);
      return;
    case "Delete":
      ev.preventDefault();
      tsDeleteForward(root);
      return;
    case "ArrowLeft":
      ev.preventDefault();
      moveTsCaretDelta(root, -1);
      return;
    case "ArrowRight":
      ev.preventDefault();
      moveTsCaretDelta(root, 1);
      return;
    case "Home":
      ev.preventDefault();
      {
        const st = tsState(root);
        if (st) timestampFieldState.set(root, { buf: st.buf, caret: 0 });
        renderTimestampWidget(root);
      }
      return;
    case "End":
      ev.preventDefault();
      {
        const st = tsState(root);
        if (st) timestampFieldState.set(root, { buf: st.buf, caret: st.buf.length });
        renderTimestampWidget(root);
      }
      return;
    default:
      break;
  }
}

function attachRangeTimestampWidgetHandlers(root: TsRoot) {
  root.addEventListener("keydown", (ev) => onTsKeyDown(ev, root));
  root.addEventListener("paste", (ev) => {
    if (applyingTimestampInputs) return;
    ev.preventDefault();
    tsPasteReplace(root, ev.clipboardData?.getData("text/plain") ?? "");
  });
  const face = getTsFace(root);
  face.addEventListener("pointerdown", (ev) => onTsFacePointerDown(ev, root));
}

function previewRangeOptionsIsOpen(): boolean {
  return previewRangeExpand.classList.contains("preview-range-expand--open");
}

function setPreviewRangeOptionsOpen(open: boolean) {
  previewRangeExpand.classList.toggle("preview-range-expand--open", open);
  previewRangeToggle.classList.toggle("preview-range-trigger--open", open);
  previewRangeToggle.setAttribute("aria-expanded", open ? "true" : "false");
  previewRangeExpand.setAttribute("aria-hidden", open ? "false" : "true");
  if (open) {
    previewRangeOptionsPanel.removeAttribute("inert");
  } else {
    previewRangeOptionsPanel.setAttribute("inert", "");
    const ae = document.activeElement;
    if (ae instanceof Node && previewRangeOptionsPanel.contains(ae)) previewRangeToggle.focus();
  }
}

function collapsePreviewRangeOptions() {
  setPreviewRangeOptionsOpen(false);
}

function whisperChunkUiRow(sec: WhisperChunkSec) {
  return WHISPER_CHUNK_UI_ROWS.find((r) => r.sec === sec) ?? WHISPER_CHUNK_UI_ROWS[3]!;
}

function resolveWhisperChunkSec(v: string): WhisperChunkSec {
  const n = Number(v);
  if (n === 10 || n === 20 || n === 30) return n;
  return 30;
}

function whisperChunkDdGetItems(): HTMLElement[] {
  return [...whisperChunkListbox.querySelectorAll<HTMLElement>(`[role="option"]`)];
}

let whisperChunkDdKbdIdx = 0;

function whisperChunkDdSetKbdHighlight() {
  const items = whisperChunkDdGetItems();
  if (!items.length) return;
  whisperChunkDdKbdIdx = ((whisperChunkDdKbdIdx % items.length) + items.length) % items.length;
  for (let i = 0; i < items.length; i++) {
    const el = items[i]!;
    const on = i === whisperChunkDdKbdIdx;
    el.classList.toggle("custom-dd-opt--kbd", on);
    if (on) whisperChunkListbox.setAttribute("aria-activedescendant", el.id);
  }
}

function whisperChunkDdClearKbdHighlight() {
  for (const el of whisperChunkDdGetItems()) el.classList.remove("custom-dd-opt--kbd");
  whisperChunkListbox.removeAttribute("aria-activedescendant");
}

function whisperChunkSyncChrome() {
  const sec = resolveWhisperChunkSec(whisperChunkSecEl.value);
  whisperChunkSecEl.value = String(sec);
  whisperChunkTriggerSummary.textContent = whisperChunkUiRow(sec).triggerSummary;
  for (const el of whisperChunkDdGetItems()) {
    el.setAttribute("aria-selected", el.dataset.value === String(sec) ? "true" : "false");
  }
}

function whisperChunkEnsureDom() {
  if (whisperChunkListbox.childElementCount > 0) return;
  for (let i = 0; i < WHISPER_CHUNK_UI_ROWS.length; i++) {
    const row = WHISPER_CHUNK_UI_ROWS[i]!;
    const li = document.createElement("li");
    li.className = "custom-dd-opt";
    li.setAttribute("role", "option");
    li.id = `whisper-chunk-opt-${i}`;
    li.tabIndex = -1;
    li.dataset.value = String(row.sec);

    const stack = document.createElement("span");
    stack.className = "custom-dd-opt-stack";
    const title = document.createElement("span");
    title.className = "custom-dd-opt-title";
    title.textContent = row.title;
    const detail = document.createElement("span");
    detail.className = "custom-dd-opt-detail";
    detail.textContent = row.detail;
    stack.append(title, detail);
    li.append(stack);

    li.addEventListener("pointerdown", (e) => e.preventDefault());
    li.addEventListener("click", () => whisperChunkSelect(row.sec));
    whisperChunkListbox.appendChild(li);
  }
}

function whisperChunkSelect(sec: WhisperChunkSec) {
  whisperChunkSecEl.value = String(sec);
  writeLocalSetting(LS_WHISPER_CHUNK_SEC_KEY, String(sec));
  whisperChunkSyncChrome();
  setWhisperChunkOptionsOpen(false);
}

function whisperChunkOptionsIsOpen(): boolean {
  return whisperChunkExpand.classList.contains("preview-range-expand--open");
}

function setWhisperChunkOptionsOpen(open: boolean) {
  whisperChunkExpand.classList.toggle("preview-range-expand--open", open);
  whisperChunkToggle.classList.toggle("preview-range-trigger--open", open);
  whisperChunkToggle.setAttribute("aria-expanded", open ? "true" : "false");
  whisperChunkExpand.setAttribute("aria-hidden", open ? "false" : "true");
  if (open) {
    whisperChunkPanel.removeAttribute("inert");
    whisperChunkEnsureDom();
    whisperChunkSyncChrome();
    const idx = WHISPER_CHUNK_UI_ROWS.findIndex(
      (r) => r.sec === resolveWhisperChunkSec(whisperChunkSecEl.value),
    );
    whisperChunkDdKbdIdx = idx >= 0 ? idx : 0;
    whisperChunkDdSetKbdHighlight();
    queueMicrotask(() => whisperChunkListbox.focus({ preventScroll: true }));
    document.addEventListener("pointerdown", whisperChunkDdOnDocCapture, true);
  } else {
    whisperChunkPanel.setAttribute("inert", "");
    whisperChunkDdClearKbdHighlight();
    document.removeEventListener("pointerdown", whisperChunkDdOnDocCapture, true);
    const ae = document.activeElement;
    if (ae instanceof Node && whisperChunkPanel.contains(ae)) whisperChunkToggle.focus();
  }
}

function whisperChunkDdOnDocCapture(ev: PointerEvent) {
  if (!whisperChunkOptionsIsOpen()) return;
  const t = ev.target as Node;
  if (whisperChunkRoot.contains(t)) return;
  if (previewRangeRoot.contains(t)) return;
  if (whisperModelSelectRoot.contains(t)) return;
  if (inferenceDeviceSelectRoot.contains(t)) return;
  setWhisperChunkOptionsOpen(false);
}

function whisperChunkDdToggle() {
  if (whisperChunkOptionsIsOpen()) setWhisperChunkOptionsOpen(false);
  else setWhisperChunkOptionsOpen(true);
}

function collapseWhisperChunkOptions() {
  setWhisperChunkOptionsOpen(false);
}

function applyPreviewRange(startIn: number, endIn: number) {
  previewRangeApplyDepth++;
  try {
    if (previewRangeApplyDepth !== 1) return;
    const max = previewFullDurationSec;
    const { start, end } = normalizeTimeRangeSec(startIn, endIn, max);
    rangeStartSec.value = String(start);
    rangeEndSec.value = String(end);
    setTimestampWidgetsFromAppliedRange(start, end);
    setPreviewRangeTimelineHighlight(start, end);
    const sel = end - start;
    previewRangeSummary.textContent = `${formatClock(start)} → ${formatClock(end)} (${formatTranscribeDuration(sel)} to transcribe)`;
  } finally {
    previewRangeApplyDepth--;
  }
}

function setPreviewRangeTimelineHighlight(start: number, end: number) {
  const max = previewFullDurationSec;
  if (!(max > 0)) return;
  const p0 = (start / max) * 100;
  const p1 = (end / max) * 100;
  previewRangeTimeline.style.setProperty("--range-p0", `${p0}%`);
  previewRangeTimeline.style.setProperty("--range-p1", `${p1}%`);
}

function clearPreviewRangeTimelineHighlight() {
  previewRangeTimeline.style.setProperty("--range-p0", "0%");
  previewRangeTimeline.style.setProperty("--range-p1", "0%");
}

function disablePreviewRangeControls() {
  rangeStartSec.disabled = true;
  rangeEndSec.disabled = true;
  timestampFieldState.delete(rangeStartTs);
  timestampFieldState.delete(rangeEndTs);
  setTsWidgetsInteractive(false);
  renderTimestampWidget(rangeStartTs);
  renderTimestampWidget(rangeEndTs);
  previewRangeSummary.textContent = "";
  clearPreviewRangeTimelineHighlight();
}

function configurePreviewRange(durationSec: number) {
  previewFullDurationSec = durationSec;
  const step = getRangeStep(durationSec);
  for (const el of [rangeStartSec, rangeEndSec]) {
    el.min = "0";
    el.max = String(durationSec);
    el.step = step;
  }
  rangeStartSec.disabled = false;
  rangeEndSec.disabled = false;
  rangeStartTs.dataset.placeholder = "0:00";
  rangeEndTs.dataset.placeholder = formatColonTimestampFromSec(durationSec);
  setTsWidgetsInteractive(true);
  applyPreviewRange(0, durationSec);
}

function enforcePreviewRangeSliders() {
  applyPreviewRange(Number(rangeStartSec.value), Number(rangeEndSec.value));
}

function enforcePreviewRangeFromTimestampFields() {
  const bs = tsState(rangeStartTs)?.buf;
  const be = tsState(rangeEndTs)?.buf;
  const fs =
    bs !== undefined && bs !== ""
      ? secondsFromDigitBuffer(bs)
      : Number(rangeStartSec.value);
  const fe =
    be !== undefined && be !== ""
      ? secondsFromDigitBuffer(be)
      : Number(rangeEndSec.value);
  if (fs === null || fe === null) return;
  if (!Number.isFinite(fs) || !Number.isFinite(fe)) return;
  applyPreviewRange(fs, fe);
}

/** Readable duration for the final summary (sub-minute shows decimal seconds). */
function formatTranscribeDuration(totalSec: number): string {
  if (totalSec < 60) {
    const decimals = totalSec >= 10 ? 0 : 1;
    return `${totalSec.toFixed(decimals)}s`;
  }
  return formatClock(totalSec);
}

function formatErrorDetail(err: Error): string {
  const parts: string[] = [];
  if (err.stack?.trim()) parts.push(err.stack.trim());
  let c: unknown = err.cause;
  let depth = 0;
  while (c != null && depth < 5) {
    parts.push(
      `Cause (${depth + 1}): ${c instanceof Error ? `${c.name}: ${c.message}` : String(c)}`,
    );
    if (c instanceof Error && c.stack?.trim()) parts.push(c.stack.trim());
    c = c instanceof Error ? c.cause : null;
    depth++;
  }
  return parts.join("\n\n");
}

function countWords(text: string): number {
  const t = text.trim();
  if (!t) return 0;
  return t.split(/\s+/).length;
}

function clearLiveWordCount(): void {
  outputWordCountEl.hidden = true;
  outputWordCountEl.textContent = "";
}

type OutputStats = {
  elapsedSec?: number;
  audioDurationSec?: number;
  chunk?: number;
  totalChunks?: number;
};

/** Word and char counts under the transcript. */
function setOutputWordCountFromText(raw: string, live: boolean, stats?: OutputStats): void {
  const t = raw.trim();
  if (!t || t === "\u2014") {
    clearLiveWordCount();
    return;
  }
  const words = countWords(t);
  const chars = t.length;
  outputWordCountEl.hidden = false;
  const wordPart = words === 1 ? "1 word" : `${words.toLocaleString("en-US")} words`;
  const charPart = chars === 1 ? "1 char" : `${chars.toLocaleString("en-US")} chars`;
  let body = `${wordPart} · ${charPart}`;
  const elapsedSec =
    typeof stats?.elapsedSec === "number" && stats.elapsedSec > 0 ? stats.elapsedSec : 0;
  const elapsedMin = elapsedSec > 0 ? elapsedSec / 60 : 0;
  const wpm = elapsedMin >= 0.05 && words > 0 ? Math.round(words / elapsedMin) : null;
  const wpmPart = wpm === null ? "— words/min" : `${wpm.toLocaleString("en-US")} words/min`;
  const audioDurationSec =
    typeof stats?.audioDurationSec === "number" && stats.audioDurationSec > 0
      ? stats.audioDurationSec
      : 0;
  const ratio =
    elapsedSec > 0 && audioDurationSec > 0 ? audioDurationSec / elapsedSec : null;
  const ratioPart = ratio === null ? null : `${ratio.toFixed(2)}x audio/time`;
  if (live) {
    const chunk = typeof stats?.chunk === "number" && stats.chunk > 0 ? Math.floor(stats.chunk) : 0;
    const total =
      typeof stats?.totalChunks === "number" && stats.totalChunks > 0
        ? Math.floor(stats.totalChunks)
        : 0;
    const partsPart =
      chunk > 0 && total > 0 ? `${chunk}/${total} parts` : total > 0 ? `${total} parts` : null;
    const remainingParts = total > 0 && chunk > 0 ? Math.max(0, total - chunk) : 0;
    const etaSec =
      elapsedSec > 0 && chunk > 0 && remainingParts > 0
        ? Math.round((elapsedSec / chunk) * remainingParts)
        : null;
  const etaPart = etaSec !== null ? `~${formatClock(etaSec)} est. time remaining` : null;
    body += ` · ${wpmPart}`;
    if (ratioPart) body += ` · ${ratioPart}`;
    if (partsPart) body += ` · ${partsPart}`;
    if (etaPart) body += ` · ${etaPart}`;
    outputWordCountEl.textContent = body;
    return;
  }
  body += ` · ${wpmPart}`;
  if (ratioPart) body += ` · ${ratioPart}`;
  outputWordCountEl.textContent = body;
}

/**
 * Whisper long-form window: each completed window triggers one live transcript update.
 * Stride matches the prior 30s/5s ratio where possible (capped, and always < chunk).
 */
function getWhisperWindowForLiveTranscript(): { chunkLenS: number; strideLenS: number } {
  const raw = Number(whisperChunkSecEl.value);
  const chunkLenS =
    Number.isFinite(raw) && raw >= 8 && raw <= 30 ? raw : 30;
  let strideLenS = Math.min(5, Math.max(1, chunkLenS / 6));
  if (strideLenS >= chunkLenS) {
    strideLenS = Math.max(0.5, chunkLenS * 0.2);
  }
  return { chunkLenS, strideLenS };
}

function mixToMono(buffer: AudioBuffer): AudioBuffer {
  if (buffer.numberOfChannels === 1) return buffer;
  const { length, sampleRate } = buffer;
  const mono = new AudioBuffer({ length, numberOfChannels: 1, sampleRate });
  const out = mono.getChannelData(0);
  for (let i = 0; i < length; i++) {
    let sum = 0;
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      sum += buffer.getChannelData(c)[i]!;
    }
    out[i] = sum / buffer.numberOfChannels;
  }
  return mono;
}

/** Decode once to read duration (native timeline; matches what you hear). */
async function getAudioDurationSec(file: File): Promise<number> {
  const ctx = new AudioContext();
  try {
    const arrayBuf = await file.arrayBuffer();
    const decoded = await ctx.decodeAudioData(arrayBuf.slice(0));
    return decoded.duration;
  } finally {
    await ctx.close();
  }
}

async function decodeFileToMono16k(file: File): Promise<Float32Array> {
  const ctx = new AudioContext();
  const arrayBuf = await file.arrayBuffer();
  const decoded = await ctx.decodeAudioData(arrayBuf.slice(0));
  await ctx.close();

  const mono = mixToMono(decoded);
  const duration = mono.length / mono.sampleRate;
  const outFrames = Math.max(1, Math.ceil(duration * SAMPLE_RATE));
  const offline = new OfflineAudioContext(1, outFrames, SAMPLE_RATE);
  const src = offline.createBufferSource();
  src.buffer = mono;
  src.connect(offline.destination);
  src.start(0);
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0).slice();
}

type RunTranscribeInWorkerOpts = {
  /**
   * Fires once after the pipeline has finished downloading/loading — when Whisper inference
   * actually begins (before any partial text is required).
   */
  onInferenceStarted?: () => void;
  /** Fires once when the worker has finished model prep for this run. */
  onModelPrepared?: (fromLocalCache: boolean) => void;
  /** Selected clipped audio duration for live speed ratio metrics. */
  audioDurationSec?: number;
};

/**
 * Runs inference in a dedicated worker so the main thread stays responsive:
 * timers can update "elapsed" while inference runs on the worker thread.
 */
function runTranscribeInWorker(
  samples: Float32Array,
  chunk_length_s: number,
  stride_length_s: number,
  opts?: RunTranscribeInWorkerOpts,
): Promise<unknown> {
  const w = getTranscribeWorker();
  resetWorkerModelProgressTracking();
  let sawModelDownload = false;
  let inferenceLifecycleNotified = false;
  let lastPartialText = "";
  let lastPartialAtMs = 0;
  /** Persistent stable text node — updated in-place, never removed during streaming. */
  let domStableNode: Text | null = null;
  /** Already revealed, not-yet-promoted text; stays unmasked across partial updates. */
  let domCarryNode: Text | null = null;
  /** Persistent reveal span — animation restarted in-place, never removed during streaming. */
  let domRevealSpan: HTMLSpanElement | null = null;
  // Keep reveal slightly behind incoming partial cadence to reduce visible end-of-part revisions.
  const REVEAL_TIME_BUFFER_MS = 220;
  const REVEAL_TIME_BUFFER_RATIO = 0.18;
  let revealDurationMs = 900;
  let revealStartedMs = 0;
  let revealTargetText = "";
  let revealFrameId: number | null = null;
  /** Chars in domStableNode (never includes suffix). */
  let stableLen = 0;
  /** Chars in domCarryNode (never includes suffix). */
  let carryLen = 0;
  const DEBUG_REVEAL = true;
  let revealRunId = 0;
  const revealSnippet = (text: string, len = 56) =>
    text.length <= len ? text : `${text.slice(0, Math.floor(len / 2))}…${text.slice(-Math.floor(len / 2))}`;
  const revealDebug = (event: string, detail?: Record<string, unknown>) => {
    if (!DEBUG_REVEAL) return;
    console.debug("[reveal-debug]", { event, ...(detail ?? {}) });
  };
  let modelPreparedNotified = false;
  const notifyModelPrepared = () => {
    if (modelPreparedNotified) return;
    modelPreparedNotified = true;
    opts?.onModelPrepared?.(!sawModelDownload);
  };
  let liveInferenceStartMs = 0;
  const notifyInferenceStarted = () => {
    if (inferenceLifecycleNotified) return;
    inferenceLifecycleNotified = true;
    liveInferenceStartMs = performance.now();
    opts?.onInferenceStarted?.();
  };

  return new Promise((resolve, reject) => {
    const commonPrefixLength = (a: string, b: string): number => {
      const n = Math.min(a.length, b.length);
      let i = 0;
      while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++;
      return i;
    };

    /**
     * Ensure exactly three persistent child nodes exist:
     *   [0] Text node  — stable confirmed text (no mask)
     *   [1] Text node  — already revealed carry-over text (no mask)
     *   [2] span.output-text-reveal — text being revealed (mask driven by RAF)
     * Both are updated in-place, never removed, so nothing flickers.
     */
    const ensureRevealDom = () => {
      if (
        domStableNode &&
        domCarryNode &&
        domRevealSpan &&
        domStableNode.parentNode === outputEl &&
        domCarryNode.parentNode === outputEl &&
        domRevealSpan.parentNode === outputEl
      ) return;
      outputEl.textContent = "";
      domStableNode = document.createTextNode("");
      domCarryNode = document.createTextNode("");
      domRevealSpan = document.createElement("span");
      domRevealSpan.className = "output-text-reveal";
      outputEl.append(domStableNode, domCarryNode, domRevealSpan);
    };

    const setMaskPosition = (progress: number) => {
      if (!domRevealSpan) return;
      const maskX = `${(1 - progress) * 100}% 0`;
      domRevealSpan.style.setProperty("-webkit-mask-position", maskX);
      domRevealSpan.style.setProperty("mask-position", maskX);
    };

    /**
     * Sweep the mask from `skipLen/targetLen` progress to 1.0 over `durationMs`.
     * The span receives the full revealTargetText immediately (no text growth);
     * the mask-position drives what is visually revealed, left to right.
     * No CSS animation is ever restarted — no opacity flash.
     */
    const restartRevealAnimation = (durationMs: number, skipLen = 0) => {
      if (!domRevealSpan) return;
      const runId = ++revealRunId;
      const bufferedMs =
        durationMs + REVEAL_TIME_BUFFER_MS + durationMs * REVEAL_TIME_BUFFER_RATIO;
      const totalMs = clamp(bufferedMs, 540, 12_000);
      if (revealFrameId !== null) {
        cancelAnimationFrame(revealFrameId);
        revealFrameId = null;
      }
      const targetLen = revealTargetText.length;
      const safeSkip = clamp(skipLen, 0, targetLen);
      const initialProgress = targetLen > 0 ? safeSkip / targetLen : 0;
      revealDebug("restartRevealAnimation", {
        runId, durationMs, totalMs, targetLen, skipLen, safeSkip, initialProgress,
        targetHead: revealSnippet(revealTargetText.slice(0, 96)),
        targetTail: revealSnippet(revealTargetText.slice(-96)),
      });

      revealDurationMs = totalMs;
      revealStartedMs = performance.now() - totalMs * initialProgress;

      // Put full text in span; mask position controls what's visible.
      // No animation restart — zero flash risk.
      domRevealSpan.textContent = revealTargetText;
      setMaskPosition(initialProgress);

      const tick = () => {
        if (!domRevealSpan || runId !== revealRunId) return;
        const elapsedMs = Math.max(0, performance.now() - revealStartedMs);
        const progress = clamp(elapsedMs / revealDurationMs, 0, 1);
        setMaskPosition(progress);
        scrollOutputToBottomIfFollowing();
        if (progress < 1) {
          revealFrameId = requestAnimationFrame(tick);
        } else {
          setMaskPosition(1);
          scrollOutputToBottomIfFollowing();
          revealFrameId = null;
        }
      };
      revealFrameId = requestAnimationFrame(tick);
    };

    const renderStreamingPartial = (rawText: string, suffix: string, alreadyFormatted = false) => {
      const now = performance.now();
      const previousPartMs =
        lastPartialAtMs > 0
          ? now - lastPartialAtMs
          : liveInferenceStartMs > 0
            ? now - liveInferenceStartMs
            : 900;
      lastPartialAtMs = now;

      if (!rawText) {
        outputEl.textContent = "\u2014" + suffix;
        scrollOutputToBottomIfFollowing();
        if (revealFrameId !== null) {
          cancelAnimationFrame(revealFrameId);
          revealFrameId = null;
        }
        revealTargetText = "";
        stableLen = 0;
        carryLen = 0;
        domStableNode = null;
        domCarryNode = null;
        domRevealSpan = null;
        lastPartialText = "";
        return;
      }

      if (shouldSkipTranscriptAnimations()) {
        if (revealFrameId !== null) {
          cancelAnimationFrame(revealFrameId);
          revealFrameId = null;
        }
        revealTargetText = "";
        domStableNode = null;
        domCarryNode = null;
        domRevealSpan = null;
        stableLen = 0;
        carryLen = 0;
        const displayText = alreadyFormatted ? rawText : formatTranscriptDisplayText(rawText);
        outputEl.textContent = displayText + suffix;
        scrollOutputToBottomIfFollowing();
        lastPartialText = rawText;
        return;
      }

      ensureRevealDom();

      revealDebug("renderStreamingPartial.start", {
        rawLen: rawText.length,
        suffixLen: suffix.length,
        lastPartialLen: lastPartialText.length,
        previousPartMs,
        stableLen,
        revealTargetLen: revealTargetText.length,
        rawTail: revealSnippet(rawText.slice(-96)),
      });

      if (!lastPartialText) {
        // First partial — stable is empty, everything animates in.
        stableLen = 0;
        carryLen = 0;
        domStableNode!.textContent = "";
        domCarryNode!.textContent = "";
        const displayText = alreadyFormatted ? rawText : formatTranscriptDisplayText(rawText);
        revealTargetText = displayText + suffix;
        restartRevealAnimation(previousPartMs, 0);
        revealDebug("renderStreamingPartial.firstPartial", {
          rawLen: rawText.length, targetLen: revealTargetText.length,
        });
        lastPartialText = rawText;
        return;
      }

      // Track timing for animation duration only (not for what's visible).
      const elapsedMs = Math.max(0, now - revealStartedMs);
      const progress = clamp(elapsedMs / revealDurationMs, 0, 1);
      const prevRevealRaw = revealTargetText.endsWith(" …")
        ? revealTargetText.slice(0, -2)
        : revealTargetText;

      // CRITICAL: promote the ENTIRE prior reveal text to carry, not just the
      // "solid" portion. The mask gradient extends past the solid boundary, so
      // chars in the fade band were already partially visible. If we leave them
      // in the new reveal span they'd reset to invisible and re-fade — exactly
      // the bug. Bound by Whisper's confirmed prefix so revisions are honored.
      const formattedRawText = alreadyFormatted ? rawText : formatTranscriptDisplayText(rawText);
      const formattedLastPartialText = alreadyFormatted
        ? lastPartialText
        : formatTranscriptDisplayText(lastPartialText);
      const cpLen = commonPrefixLength(formattedLastPartialText, formattedRawText);
      const nextCarryEnd = Math.min(stableLen + carryLen + prevRevealRaw.length, cpLen, rawText.length);
      const totalVisibleLen = nextCarryEnd; // for debug/alreadyShown computation
      const nextCarryLen = Math.max(0, nextCarryEnd - stableLen);
      const nextCarryText = formattedRawText.slice(stableLen, nextCarryEnd);
      const previousCarryText = domCarryNode!.textContent ?? "";
      if (nextCarryText.startsWith(previousCarryText)) {
        domCarryNode!.appendData(nextCarryText.slice(previousCarryText.length));
      } else if (previousCarryText !== nextCarryText) {
        domCarryNode!.textContent = nextCarryText;
      }
      carryLen = nextCarryLen;

      const revealStartLen = stableLen + carryLen;
      revealTargetText = formattedRawText.slice(revealStartLen) + suffix;
      // If visible text could not be carried forward because Whisper revised it,
      // resume partway through the new masked text. Otherwise this is usually 0.
      const alreadyShown = Math.max(0, totalVisibleLen - revealStartLen);

      revealDebug("renderStreamingPartial.transition", {
        progress, elapsedMs, totalVisibleLen,
        cpLen, stableLen, carryLen, revealStartLen, alreadyShown,
        prevRevealRawLen: prevRevealRaw.length,
        newTargetLen: revealTargetText.length,
        carryTail: revealSnippet(nextCarryText.slice(-96)),
        newRevealHead: revealSnippet(revealTargetText.slice(0, 96)),
      });

      restartRevealAnimation(previousPartMs, alreadyShown);
      lastPartialText = rawText;
    };

    const onMessage = (e: MessageEvent<WorkerToMain>) => {
      const d = e.data;
      if (d.type === "model_progress") {
        if (d.phase === "download") sawModelDownload = true;
        applyWorkerModelProgress(d, sawModelDownload);
        return;
      }
      if (d.type === "model_ready") {
        notifyModelPrepared();
        notifyInferenceStarted();
        return;
      }
      if (d.type === "partial") {
        notifyModelPrepared();
        notifyInferenceStarted();
        outputSection.hidden = false;
        outputEl.classList.add("streaming");
        const suffix = d.chunk < d.total ? " …" : "";
        const liveTimestamped =
          shouldTimestampSentences() && Array.isArray(d.chunks)
            ? formatTimestampedSentenceLinesFromChunks(d.chunks, { includeIncomplete: false })
            : null;
        const liveText = liveTimestamped ?? (d.text || "");
        renderStreamingPartial(liveText, suffix, liveTimestamped !== null);
        syncCopyButtonFromOutput();
        const elapsedSec =
          liveInferenceStartMs > 0 ? (performance.now() - liveInferenceStartMs) / 1000 : 0;
        setOutputWordCountFromText(d.text ?? "", true, {
          elapsedSec,
          audioDurationSec: opts?.audioDurationSec,
          chunk: d.chunk,
          totalChunks: d.total,
        });
        return;
      }
      if (d.type === "transcribe_done") {
        notifyModelPrepared();
        notifyInferenceStarted();
        w.removeEventListener("message", onMessage);
        resolve(d.result);
        return;
      }
      if (d.type === "transcribe_error") {
        w.removeEventListener("message", onMessage);
        const err = new Error(d.message);
        if (d.stack) err.stack = d.stack;
        reject(err);
      }
    };
    w.addEventListener("message", onMessage);
    const msg: MainToWorker = {
      cmd: "transcribe",
      samples: samples.slice(),
      chunk_length_s,
      stride_length_s,
      model_id: getSelectedWhisperModelId(),
      inference_device: getInferenceDevice(),
      return_timestamps: shouldTimestampSentences(),
    };
    w.postMessage(msg);
  });
}

function hidePreviewPanel() {
  previewPanel.hidden = true;
  startBtn.disabled = true;
  disablePreviewRangeControls();
}

function showPreviewPanel() {
  previewPanel.hidden = false;
}

/** After a successful run, show preview again so the user can change the range or chunk options and tap Start. */
function restorePreviewAfterTranscribe() {
  showPreviewPanel();
  rangeStartSec.disabled = false;
  rangeEndSec.disabled = false;
  setTsWidgetsInteractive(true);
  startBtn.disabled = false;
  enforcePreviewRangeSliders();
}

async function onAudioFileChosen(file: File) {
  if (!isProbablyAudioFile(file) || busy) return;

  pendingFile = file;
  collapsePreviewRangeOptions();
  collapseWhisperChunkOptions();
  showPreviewPanel();
  previewFileName.textContent = file.name;
  previewDurationLabel.hidden = true;
  previewDuration.textContent = "Reading audio…";
  previewDuration.classList.add("preview-duration--pending");
  startBtn.disabled = true;
  disablePreviewRangeControls();
  setStatus("Check the details below, then tap Start transcription.");
  dropzone.hidden = true;

  try {
    const durationSec = await getAudioDurationSec(file);
    if (!Number.isFinite(durationSec) || durationSec <= 0) {
      throw new Error("Could not read a valid duration for this file.");
    }
    previewDuration.classList.remove("preview-duration--pending");
    previewDurationLabel.hidden = false;
    previewDuration.textContent = formatClock(durationSec);
    configurePreviewRange(durationSec);
    startBtn.disabled = false;
  } catch (e) {
    previewDuration.classList.remove("preview-duration--pending");
    previewDurationLabel.hidden = true;
    pendingFile = null;
    hidePreviewPanel();
    dropzone.hidden = false;
    if (e instanceof Error) {
      setStatusError(e.message || "Could not read that audio file.", formatErrorDetail(e));
    } else {
      setStatusError("Could not read that audio file.");
    }
  }
}

async function startTranscription(file: File) {
  if (busy) return;
  busy = true;
  cachedModelsPanel.hidden = true;
  dropzone.hidden = true;
  previewPanel.hidden = true;
  startBtn.disabled = true;
  outputSection.hidden = true;
  outputEl.classList.remove("streaming");
  outputEl.textContent = "";
  outputAutoFollowEnabled = true;
  syncCopyButtonFromOutput();
  clearLiveWordCount();

  try {
    setStatus("Decoding audio…");
    statusEl.classList.add("status--decoding");
    const audio = await decodeFileToMono16k(file);

    const minSamples = Math.ceil(SAMPLE_RATE * MIN_TRANSCRIBE_RANGE_SEC);
    const decodedDur = audio.length / SAMPLE_RATE;
    const { start: rangeStart, end: rangeEnd } = normalizeTimeRangeSec(
      Number(rangeStartSec.value),
      Number(rangeEndSec.value),
      decodedDur,
    );
    let i0 = Math.min(audio.length, Math.max(0, Math.floor(rangeStart * SAMPLE_RATE)));
    let i1 = Math.min(audio.length, Math.max(i0 + 1, Math.ceil(rangeEnd * SAMPLE_RATE)));
    if (i1 - i0 < minSamples) {
      i1 = Math.min(audio.length, i0 + minSamples);
    }
    const clipped = audio.slice(i0, i1);

    if (clipped.length < minSamples) {
      setStatus(
        "Selected range is too short. Use at least ~0.5 seconds of audio (or pick a longer file).",
        true,
      );
      showPreviewPanel();
      startBtn.disabled = false;
      return;
    }

    const audioSec = clipped.length / SAMPLE_RATE;
    const { chunkLenS, strideLenS } = getWhisperWindowForLiveTranscript();
    const segmentCount = countWhisperStrideChunks(
      clipped.length,
      SAMPLE_RATE,
      chunkLenS,
      strideLenS,
    );
    const segmentHint = segmentCount > 1 ? ` · ${segmentCount} parts` : "";
    const inferenceDeviceForRun = getInferenceDevice();
    const deviceHint = ` · ${inferenceDeviceUiLabel(inferenceDeviceForRun)}`;

    /** Wall-clock from posting to worker through completion (decode excluded); used for Done summary. */
    const started = performance.now();

    let transcribeTickId: number | undefined;
    /** When Whisper inference actually begins (pipeline ready — not audio decode or weight download). */
    let inferenceClockStartMs = 0;

    const tick = () => {
      const elapsed =
        inferenceClockStartMs > 0 ? (performance.now() - inferenceClockStartMs) / 1000 : 0;
      setStatusLine(
        `Transcribing… ${formatClock(elapsed)} elapsed · ${formatClock(audioSec)} audio${segmentHint}${deviceHint}`,
        false,
        { hintText: "Stay on this tab for best performance." },
      );
    };
    const transcribePromise = runTranscribeInWorker(clipped, chunkLenS, strideLenS, {
      onModelPrepared: () => {
        markModelCached(getSelectedWhisperModelId());
        whisperModelDdSyncChrome();
      },
      onInferenceStarted: () => {
        if (transcribeTickId !== undefined) return;
        statusEl.classList.remove("status--decoding");
        inferenceClockStartMs = performance.now();
        tick();
        statusEl.classList.add("working");
        transcribeTickId = window.setInterval(tick, TRANSCRIBE_STATUS_TICK_MS);
      },
      audioDurationSec: audioSec,
    });

    let result: unknown;
    try {
      result = await transcribePromise;
    } finally {
      if (transcribeTickId !== undefined) {
        window.clearInterval(transcribeTickId);
      }
      statusEl.classList.remove("working");
    }

    outputEl.classList.remove("streaming");

    const text =
      typeof result === "object" && result !== null && "text" in result
        ? String((result as { text: string }).text).trim()
        : String(result).trim();
    const timedChunks =
      typeof result === "object" && result !== null && "chunks" in result
        ? ((result as { chunks?: TimedChunkLike[] }).chunks ?? [])
        : [];

    if (!text) {
      setStatus("No speech detected.", true);
      outputSection.hidden = true;
      clearLiveWordCount();
      showPreviewPanel();
      startBtn.disabled = false;
      return;
    }

    const timestampedOutput =
      shouldTimestampSentences() && timedChunks.length > 0
        ? formatTimestampedSentenceLinesFromChunks(timedChunks, { includeIncomplete: true })
        : null;
    outputEl.textContent = timestampedOutput ?? formatTranscriptDisplayText(text);
    outputSection.hidden = false;
    scrollOutputToBottomIfFollowing();
    const transcribeSec = (performance.now() - started) / 1000;
    setOutputWordCountFromText(text, false, {
      elapsedSec: transcribeSec,
      audioDurationSec: audioSec,
    });
    syncCopyButtonFromOutput();
    setStatusLine(`Done in ${formatTranscribeDuration(transcribeSec)}`, false, { done: true });
    restorePreviewAfterTranscribe();
    focusCompletedTranscriptView();
  } catch (e) {
    outputEl.classList.remove("streaming");
    clearLiveWordCount();
    if (e instanceof Error) {
      const detail = formatErrorDetail(e);
      setStatusError(e.message || "Something went wrong.", detail);
    } else {
      setStatusError(String(e) || "Something went wrong.");
    }
    if (pendingFile) {
      showPreviewPanel();
      startBtn.disabled = false;
    }
  } finally {
    busy = false;
    renderCachedModelsPanel();
    /* Large dropzone only when no file is loaded; after a run, Different file + page drag-drop suffice. */
    dropzone.hidden = pendingFile !== null;
  }
}

dropzone.addEventListener("dragover", (ev) => {
  if (dataTransferIsFileDrag(ev.dataTransfer)) ev.preventDefault();
});

function dataTransferIsFileDrag(dt: DataTransfer | null): boolean {
  if (!dt) return false;
  if (dt.types && [...dt.types].includes("Files")) return true;
  if (dt.items && [...dt.items].some((item) => item.kind === "file")) return true;
  return false;
}

function setPageFileDragHighlight(on: boolean) {
  document.body.classList.toggle("app-file-drag", on);
}

function setDropzoneFileDragOver(on: boolean) {
  dropzone.classList.toggle("dropzone--drag-file-over", on);
}

function clearAllFileDragChrome() {
  setPageFileDragHighlight(false);
  setDropzoneFileDragOver(false);
}

/** Full-page tint except when the pointer is over the visible drop zone (that area uses its own highlight). */
function syncFileDragVisualFromPoint(ev: DragEvent): void {
  if (!dataTransferIsFileDrag(ev.dataTransfer)) return;
  let overDropzone = false;
  if (!dropzone.hidden) {
    const el = document.elementFromPoint(ev.clientX, ev.clientY);
    overDropzone = el !== null && dropzone.contains(el);
  }
  setPageFileDragHighlight(!overDropzone);
  setDropzoneFileDragOver(overDropzone);
}

/** Whole-page drop target + dropzone highlight coordinated from pointer position. */
document.addEventListener(
  "dragenter",
  (ev) => {
    if (!dataTransferIsFileDrag(ev.dataTransfer)) return;
    ev.preventDefault();
    syncFileDragVisualFromPoint(ev);
  },
  true,
);

document.addEventListener(
  "dragleave",
  (ev) => {
    if (!dataTransferIsFileDrag(ev.dataTransfer)) return;
    const next = ev.relatedTarget;
    if (next instanceof Node && document.documentElement.contains(next)) return;
    clearAllFileDragChrome();
  },
  true,
);

/** allow dropping files anywhere on the page (not only the labeled control) */
document.addEventListener(
  "dragover",
  (ev) => {
    if (!dataTransferIsFileDrag(ev.dataTransfer)) return;
    ev.preventDefault();
  },
  true,
);

document.addEventListener(
  "drop",
  (ev) => {
    if (!dataTransferIsFileDrag(ev.dataTransfer)) return;
    ev.preventDefault();
  },
  true,
);

/** allow dropping files anywhere on the page (not only the labeled control) */
window.addEventListener("dragover", (ev) => {
  if (!dataTransferIsFileDrag(ev.dataTransfer)) return;
  ev.preventDefault();
  syncFileDragVisualFromPoint(ev);
});

window.addEventListener("drop", (ev) => {
  ev.preventDefault();
  clearAllFileDragChrome();
  const f = ev.dataTransfer?.files?.[0];
  if (f && isProbablyAudioFile(f)) void onAudioFileChosen(f);
});

fileInput.addEventListener("change", () => {
  const f = fileInput.files?.[0];
  if (f) void onAudioFileChosen(f);
  fileInput.value = "";
});

rangeStartSec.addEventListener("input", () => {
  enforcePreviewRangeSliders();
});
rangeEndSec.addEventListener("input", () => {
  enforcePreviewRangeSliders();
});

sentencesOnNewLinesEl.addEventListener("change", () => {
  syncTimestampSentenceToggleVisibility();
});

previewRangeToggle.addEventListener("click", () => {
  setPreviewRangeOptionsOpen(!previewRangeOptionsIsOpen());
});

whisperChunkToggle.addEventListener("click", (e) => {
  e.preventDefault();
  whisperChunkDdToggle();
});

whisperChunkToggle.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    if (!whisperChunkOptionsIsOpen()) setWhisperChunkOptionsOpen(true);
  }
});

whisperChunkListbox.addEventListener("keydown", (e) => {
  if (!whisperChunkOptionsIsOpen()) return;
  const items = whisperChunkDdGetItems();
  if (items.length === 0) return;
  switch (e.key) {
    case "Escape":
      e.preventDefault();
      setWhisperChunkOptionsOpen(false);
      return;
    case "ArrowDown":
      e.preventDefault();
      whisperChunkDdKbdIdx = (whisperChunkDdKbdIdx + 1) % items.length;
      whisperChunkDdSetKbdHighlight();
      items[whisperChunkDdKbdIdx]!.scrollIntoView({ block: "nearest" });
      return;
    case "ArrowUp":
      e.preventDefault();
      whisperChunkDdKbdIdx = (whisperChunkDdKbdIdx - 1 + items.length) % items.length;
      whisperChunkDdSetKbdHighlight();
      items[whisperChunkDdKbdIdx]!.scrollIntoView({ block: "nearest" });
      return;
    case "Enter":
    case " ": {
      e.preventDefault();
      const pick = WHISPER_CHUNK_UI_ROWS[whisperChunkDdKbdIdx]!.sec;
      whisperChunkSelect(pick);
      return;
    }
    case "Tab":
      setWhisperChunkOptionsOpen(false);
      return;
    default:
      break;
  }
});

attachRangeTimestampWidgetHandlers(rangeStartTs);
attachRangeTimestampWidgetHandlers(rangeEndTs);

startBtn.addEventListener("click", () => {
  if (!pendingFile || busy) return;
  void startTranscription(pendingFile);
});

changeFileBtn.addEventListener("click", () => {
  fileInput.click();
});

syncCopyButtonFromOutput();

copyBtn.addEventListener("click", async () => {
  const t = getOutputTranscriptText();
  if (!t || t === "\u2014") return;
  try {
    await navigator.clipboard.writeText(t);
    setStatus("Copied to clipboard.");
  } catch (err) {
    const detail = err instanceof Error ? formatErrorDetail(err) : "";
    setStatusError("Copy failed.", detail || undefined);
  }
});

downloadTxtBtn.addEventListener("click", () => {
  const t = getOutputTranscriptText();
  if (!t || t === "\u2014") return;
  const base = (pendingFile?.name ?? "transcript").replace(/\.[^.]+$/, "");
  const safeBase = base.trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, "_") || "transcript";
  const blob = new Blob([t + "\n"], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safeBase}.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  setStatus("Downloaded .txt transcript.");
});

rawBtn.addEventListener("click", () => {
  const t = getOutputTranscriptText();
  if (!t || t === "\u2014") return;
  const blob = new Blob([t + "\n"], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  document.body.appendChild(a);
  try {
    a.click();
    setStatus("Opened RAW transcript in a new tab.");
  } catch {
    // Last-resort fallback if opening a new tab is blocked.
    window.location.href = url;
  } finally {
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
});

/** Warn before tab close/reload while decode/transcription is in progress. */
window.addEventListener("beforeunload", (ev) => {
  if (!busy) return;
  ev.preventDefault();
  // Chrome/Edge ignore custom text but require returnValue to trigger confirmation.
  ev.returnValue = "";
});
