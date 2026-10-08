/**
 * Whisper ONNX checkpoints offered in the model dropdown.
 *
 * All entries are multilingual Whisper builds (no `.en`), so the transcription
 * language is set explicitly in the worker (see `WHISPER_LANGUAGE`).
 *
 * Sizes are approximate first-download totals (encoder + decoder ONNX files plus
 * tokenizer/config) from the Hugging Face file listings. Transformers.js caches
 * each model per browser after the first load.
 */
export type WhisperDtype = "fp32" | "q4";

export interface WhisperModelOption {
  /** Stable key stored in localStorage and passed to the worker. */
  readonly id: string;
  /** Hugging Face repo loaded by Transformers.js. */
  readonly repo: string;
  readonly dtype: WhisperDtype;
  readonly title: string;
  readonly params: string;
  readonly approxDownloadMb: number;
  readonly note: string;
}

export const WHISPER_MODEL_OPTIONS: readonly WhisperModelOption[] = [
  {
    id: "whisper-tiny-fp32",
    repo: "Xenova/whisper-tiny",
    dtype: "fp32",
    title: "Tiny",
    params: "~39M",
    approxDownloadMb: 155,
    note: "smallest footprint, fastest, least accurate",
  },
  {
    id: "whisper-base-fp32",
    repo: "Xenova/whisper-base",
    dtype: "fp32",
    title: "Base",
    params: "~74M",
    approxDownloadMb: 295,
    note: "balanced speed and accuracy",
  },
  {
    id: "whisper-small-fp32",
    repo: "Xenova/whisper-small",
    dtype: "fp32",
    title: "Small",
    params: "~244M",
    approxDownloadMb: 970,
    note: "better Hungarian accuracy, heavier run",
  },
  {
    id: "whisper-medium-q4",
    repo: "Xenova/whisper-medium",
    dtype: "q4",
    title: "Medium (q4)",
    params: "~769M",
    approxDownloadMb: 680,
    note: "medium accuracy at 4-bit quantization",
  },
  {
    id: "whisper-medium-fp32",
    repo: "Xenova/whisper-medium",
    dtype: "fp32",
    title: "Medium",
    params: "~769M",
    approxDownloadMb: 3060,
    note: "strong Hungarian accuracy, large download",
  },
  {
    id: "whisper-large-v3-turbo-q4",
    repo: "onnx-community/whisper-large-v3-turbo",
    dtype: "q4",
    title: "Large v3 Turbo (q4)",
    params: "~809M",
    approxDownloadMb: 760,
    note: "near-large accuracy, quantized for smaller download",
  },
  {
    id: "whisper-large-v3-turbo-fp32",
    repo: "onnx-community/whisper-large-v3-turbo",
    dtype: "fp32",
    title: "Large v3 Turbo",
    params: "~809M",
    approxDownloadMb: 3200,
    note: "highest accuracy offered, largest download",
  },
];

export type WhisperModelId = (typeof WHISPER_MODEL_OPTIONS)[number]["id"];

export const DEFAULT_WHISPER_MODEL_ID: WhisperModelId = "whisper-small-fp32";

/** Language passed to Whisper's generate(); transcription is Hungarian only. */
export const WHISPER_LANGUAGE = "hungarian";

export function getWhisperModelOption(id: string): WhisperModelOption {
  return (
    WHISPER_MODEL_OPTIONS.find((o) => o.id === id) ??
    WHISPER_MODEL_OPTIONS.find((o) => o.id === DEFAULT_WHISPER_MODEL_ID)!
  );
}

export function resolveWhisperModelId(raw: string): WhisperModelId {
  return getWhisperModelOption(typeof raw === "string" ? raw.trim() : "").id as WhisperModelId;
}

function formatDownloadMb(mb: number): string {
  return mb >= 1000 ? `~${(mb / 1000).toFixed(1)} GB` : `~${mb} MB`;
}

/** Compact line for the closed dropdown control. */
export function whisperOptionTrigger(o: WhisperModelOption): string {
  return `${o.title} · ${o.params} · ${formatDownloadMb(o.approxDownloadMb)} approx.`;
}

/** Second line in each dropdown row. */
export function whisperOptionDetail(o: WhisperModelOption): string {
  return `${o.params} params · ${formatDownloadMb(o.approxDownloadMb)} download (approx.) · ${o.note}`;
}
