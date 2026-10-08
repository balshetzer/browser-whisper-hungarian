# Browser Whisper (Hungarian)

Browser-based Hungarian speech-to-text with OpenAI Whisper, running fully on-device.

Deployed at: https://www.balshetzer.com/browser-whisper-hungarian/

This is a fork of [JoyousJohn/browser-whisper](https://github.com/JoyousJohn/browser-whisper) (MIT) that swaps the English-only `.en` checkpoints for multilingual Whisper ONNX models and transcribes Hungarian.

## Features

- Hungarian transcription (`language: "hungarian"`) with multilingual Whisper models
- Model dropdown (`src/whisper-models.ts`):
  - Tiny, Base, Small (fp32)
  - Medium (q4 and fp32)
  - Large v3 Turbo (q4 and fp32)
- Inference modes: CPU (`WebAssembly`) and GPU (`WebGPU`, when available)
- Drag/drop or file picker for common audio formats
- Transcription range selection and streaming transcript updates

## Privacy

- Audio files are processed in-browser. No cloud speech-transcription API is used.
- Model artifacts are downloaded from Hugging Face and cached locally by your browser.

## Adding or changing models

All model options live in `src/whisper-models.ts`. Each entry maps a stable `id` to a Hugging Face repo and dtype (`fp32` or `q4`). Only ONNX-converted repos work with Transformers.js. Sizes in the table are approximate and should be re-checked against the repo file listing.

## Tech Stack

- [Vite](https://vitejs.dev/)
- [TypeScript](https://www.typescriptlang.org/)
- [Transformers.js](https://huggingface.co/docs/transformers.js/index)
- Whisper ONNX checkpoints from Hugging Face

## Run locally

```
npm install
npm run dev
```

## Deploy (GitHub Pages)

Pushes to `main` build and publish via `.github/workflows/pages.yml`. In the repo settings, set **Pages → Source** to **GitHub Actions**.

## Browser notes

- `WebGPU` is primarily supported in Chromium-based browsers.
- The first run for each model can be slow because of the download size.
- Larger models generally improve accuracy but increase download and runtime cost.

## License

MIT. See `LICENSE`.
