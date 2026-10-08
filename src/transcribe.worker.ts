import type { AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";
import { pipeline, env } from "@huggingface/transformers";
import {
  getWhisperModelOption,
  WHISPER_LANGUAGE,
  resolveWhisperModelId,
  type WhisperModelId,
} from "./whisper-models";

env.allowLocalModels = false;
env.useBrowserCache = true;

export type InferenceDevice = "wasm" | "webgpu";

export type MainToWorker = {
  cmd: "transcribe";
  samples: Float32Array;
  chunk_length_s: number;
  stride_length_s: number;
  model_id: WhisperModelId;
  inference_device: InferenceDevice;
  return_timestamps: boolean;
};

type WhisperChunk = {
  stride: number[];
  input_features: unknown;
  is_last: boolean;
  tokens?: unknown;
};

type DecodeAsrOpts = {
  time_precision: number;
  return_timestamps: boolean;
  force_full_sequences: boolean;
};

type WhisperTokenizerWithAsr = {
  _decode_asr(chunks: WhisperChunk[], opts: DecodeAsrOpts): [string, Record<string, unknown>?];
};

export type WorkerToMain =
  | { type: "model_progress"; phase: "progress" | "progress_total"; progress: number }
  | { type: "model_progress"; phase: "download"; file: string }
  | { type: "model_ready" }
  | {
      type: "partial";
      text: string;
      chunk: number;
      total: number;
      chunks?: Array<{ text?: string; timestamp?: [number | null, number | null] }>;
    }
  | { type: "transcribe_done"; result: { text: string } }
  | { type: "transcribe_error"; message: string; stack: string };

/** `modelId|device` aligned with {@link pipelinePromise}; cleared if load rejects. */
let pipelineCacheKey: string | null = null;
let pipelinePromise: Promise<AutomaticSpeechRecognitionPipeline> | null = null;

function getPipeline(
  modelId: WhisperModelId,
  device: InferenceDevice,
): Promise<AutomaticSpeechRecognitionPipeline> {
  const nextKey = `${modelId}|${device}`;
  if (pipelineCacheKey !== nextKey) {
    pipelinePromise = null;
    pipelineCacheKey = nextKey;
  }
  if (!pipelinePromise) {
    const option = getWhisperModelOption(modelId);
    const load = pipeline("automatic-speech-recognition", option.repo, {
      dtype: option.dtype,
      device,
      progress_callback: (ev) => {
        if (ev.status === "progress" && typeof ev.progress === "number") {
          postMessage({ type: "model_progress", phase: "progress", progress: ev.progress });
        } else if (ev.status === "progress_total" && typeof ev.progress === "number") {
          postMessage({ type: "model_progress", phase: "progress_total", progress: ev.progress });
        } else if (ev.status === "download" && ev.file) {
          postMessage({ type: "model_progress", phase: "download", file: ev.file });
        }
      },
    }) as Promise<AutomaticSpeechRecognitionPipeline>;
    pipelinePromise = (async () => {
      try {
        return await load;
      } catch (err) {
        pipelinePromise = null;
        pipelineCacheKey = null;
        throw err;
      }
    })();
  }
  return pipelinePromise;
}

function asWhisperTokenizer(tokenizer: AutomaticSpeechRecognitionPipeline["tokenizer"]): WhisperTokenizerWithAsr {
  return tokenizer as unknown as WhisperTokenizerWithAsr;
}

/** Whisper `generate()` may return a Tensor or `{ sequences: Tensor }` depending on config. */
function tokensFromWhisperGenerate(data: unknown): unknown {
  if (data == null) {
    throw new Error("Whisper generate() returned no output.");
  }
  const d = data as Record<string, unknown> & {
    0?: { tolist?: () => unknown };
    tolist?: () => unknown;
  };
  if ("sequences" in d && d.sequences != null) {
    const seq = d.sequences as { 0?: { tolist?: () => unknown }; tolist?: () => unknown };
    if (seq[0]?.tolist) return seq[0].tolist();
    if (typeof seq.tolist === "function") {
      const raw = seq.tolist();
      if (Array.isArray(raw) && raw.length > 0 && Array.isArray((raw as unknown[])[0])) {
        return (raw as unknown[][])[0];
      }
      return raw;
    }
    throw new Error("Whisper generate() sequences value has no tolist().");
  }
  if (d[0]?.tolist) return d[0].tolist();
  if (typeof d.tolist === "function") return d.tolist();
  throw new Error("Unrecognized Whisper generate() output shape.");
}

/**
 * Mirrors AutomaticSpeechRecognitionPipeline._call_whisper chunking + generate,
 * but calls _decode_asr after each chunk so the main thread can show cumulative text.
 */
async function transcribeWhisperStreaming(
  pipe: AutomaticSpeechRecognitionPipeline,
  aud: Float32Array,
  chunk_length_s: number,
  stride_length_s: number,
  return_timestamps: boolean,
): Promise<{ text: string }> {
  const force_full_sequences = false;
  let stride = stride_length_s;

  const fe = pipe.processor.feature_extractor;
  if (!fe) throw new Error("Missing feature extractor on processor.");
  const feature_extractor_config = fe.config;
  const modelCfg = pipe.model.config as unknown as { max_source_positions: number };
  const time_precision = feature_extractor_config.chunk_length / modelCfg.max_source_positions;
  const hop_length = feature_extractor_config.hop_length;
  const sampling_rate = feature_extractor_config.sampling_rate;

  const chunks: WhisperChunk[] = [];

  if (chunk_length_s > 0) {
    if (stride === null || stride === undefined || !Number.isFinite(stride)) {
      stride = chunk_length_s / 6;
    } else if (chunk_length_s <= stride) {
      throw new Error("`chunk_length_s` must be larger than `stride_length_s`.");
    }
    const windowSamples = sampling_rate * chunk_length_s;
    const strideSamples = sampling_rate * stride;
    const jump = windowSamples - 2 * strideSamples;
    let offset = 0;
    while (true) {
      const offsetEnd = offset + windowSamples;
      const subarr = aud.subarray(offset, offsetEnd);
      const feature = await pipe.processor(subarr);
      const input_features = (feature as { input_features?: unknown }).input_features;
      if (input_features == null) {
        throw new Error("Processor returned no input_features for audio chunk.");
      }
      const is_first = offset === 0;
      const is_last = offsetEnd >= aud.length;
      chunks.push({
        stride: [subarr.length, is_first ? 0 : strideSamples, is_last ? 0 : strideSamples],
        input_features,
        is_last,
      });
      if (is_last) break;
      offset += jump;
    }
  } else {
    const feature = await pipe.processor(aud);
    const input_features = (feature as { input_features?: unknown }).input_features;
    if (input_features == null) {
      throw new Error("Processor returned no input_features.");
    }
    chunks.push({
      stride: [aud.length, 0, 0],
      input_features,
      is_last: true,
    });
  }

  const decodeOpts: DecodeAsrOpts = {
    time_precision,
    return_timestamps,
    force_full_sequences,
  };

  const tokenizer = asWhisperTokenizer(pipe.tokenizer);
  const total = chunks.length;

  for (let i = 0; i < chunks.length; i++) {
    const chunk2 = chunks[i]!;
    const num_frames = Math.floor(chunk2.stride[0] / hop_length);
    const data = await pipe.model.generate({
      inputs: chunk2.input_features,
      num_frames,
      return_timestamps,
      force_full_sequences,
      language: WHISPER_LANGUAGE,
      task: "transcribe",
    } as never);
    chunk2.tokens = tokensFromWhisperGenerate(data) as WhisperChunk["tokens"];
    chunk2.stride = chunk2.stride.map((x) => x / sampling_rate);

    // Only pass chunks that already have `tokens`; _decode_asr reads every entry.
    const [partialText, partialMeta] = tokenizer._decode_asr(chunks.slice(0, i + 1), decodeOpts);
    const text = String(partialText ?? "").trim();
    const rawChunks = (partialMeta as { chunks?: unknown })?.chunks;
    const timedChunks = Array.isArray(rawChunks)
      ? rawChunks
          .map((c) => c as { text?: unknown; timestamp?: unknown })
          .map((c) => ({
            text: typeof c.text === "string" ? c.text : "",
            timestamp: Array.isArray(c.timestamp)
              ? [c.timestamp[0] as number | null, c.timestamp[1] as number | null]
              : ([null, null] as [null, null]),
          }))
      : undefined;
    postMessage({ type: "partial", text, chunk: i + 1, total, chunks: timedChunks });
  }

  const [full_text, optional] = tokenizer._decode_asr(chunks, decodeOpts);
  const text = String(full_text ?? "").trim();
  return { text, ...optional };
}

addEventListener("message", async (ev: MessageEvent<MainToWorker>) => {
  const msg = ev.data;
  if (msg.cmd !== "transcribe") return;
  try {
    const model_id = resolveWhisperModelId(msg.model_id);
    const pipe = await getPipeline(model_id, msg.inference_device);
    postMessage({ type: "model_ready" });
    const result = await transcribeWhisperStreaming(
      pipe,
      msg.samples,
      msg.chunk_length_s,
      msg.stride_length_s,
      msg.return_timestamps,
    );
    postMessage({ type: "transcribe_done", result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const stack =
      e instanceof Error ? (e.stack?.trim() || `${e.name}: ${e.message}`) : "";
    postMessage({ type: "transcribe_error", message, stack });
  }
});
