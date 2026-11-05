use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use crate::compute::ComputeMode;
use crate::transcribe_dll::{native_dir_from_env, Model, RunRequest, TranscribeDll};
use crate::transcription::{resample_to_16khz, TranscriptionOutput};

#[derive(Debug, Clone)]
pub struct QwenInput {
    pub model_path: PathBuf,
    pub samples: Vec<f32>,
    pub sample_rate: u32,
    pub language: Option<String>,
    pub initial_prompt: Option<String>,
}

/// Runs GGUF models through the prebuilt transcribe.cpp runtime.
#[derive(Clone)]
pub struct QwenEngine {
    mode: ComputeMode,
    native_dir: Option<PathBuf>,
    runtime: Arc<Mutex<Option<Arc<TranscribeDll>>>>,
    models: Arc<Mutex<HashMap<PathBuf, Arc<Model>>>>,
}

impl QwenEngine {
    pub fn new(mode: ComputeMode) -> Self {
        Self {
            mode,
            native_dir: native_dir_from_env(),
            runtime: Arc::new(Mutex::new(None)),
            models: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn transcribe(&self, input: QwenInput) -> Result<TranscriptionOutput, String> {
        let engine = self.clone();
        tokio::task::spawn_blocking(move || engine.transcribe_blocking(input))
            .await
            .map_err(|err| format!("qwen transcription task failed: {err}"))?
    }

    pub async fn validate_model(&self, model_path: PathBuf) -> Result<bool, String> {
        let engine = self.clone();
        tokio::task::spawn_blocking(move || engine.load_model_blocking(&model_path).map(|_| true))
            .await
            .map_err(|err| format!("qwen validation task failed: {err}"))?
    }

    fn transcribe_blocking(&self, input: QwenInput) -> Result<TranscriptionOutput, String> {
        if input.sample_rate == 0 {
            return Err("sampleRate must be greater than 0".to_string());
        }

        let filtered: Vec<f32> = input
            .samples
            .into_iter()
            .filter(|sample| sample.is_finite())
            .collect();

        if filtered.is_empty() {
            return Err("no finite samples provided".to_string());
        }

        let samples = resample_to_16khz(&filtered, input.sample_rate);
        if samples.is_empty() {
            return Err("unable to resample audio".to_string());
        }

        let runtime = self.runtime()?;
        let model = self.model(&input.model_path)?;
        let output = runtime.run(
            &model,
            RunRequest {
                samples: &samples,
                language: input.language.as_deref(),
                prompt: input.initial_prompt.as_deref(),
            },
        )?;

        Ok(TranscriptionOutput {
            text: output.text,
            inference_device: output.device,
        })
    }

    fn load_model_blocking(&self, model_path: &Path) -> Result<Arc<Model>, String> {
        self.runtime()?;
        self.model(model_path)
    }

    fn runtime(&self) -> Result<Arc<TranscribeDll>, String> {
        let mut guard = self
            .runtime
            .lock()
            .map_err(|_| "qwen runtime lock poisoned".to_string())?;

        if let Some(runtime) = guard.as_ref() {
            return Ok(runtime.clone());
        }

        let native_dir = self.native_dir.clone().ok_or_else(|| {
            "the Qwen runtime is unavailable: RUST_TRANSCRIPTION_NATIVE_DIR is not set".to_string()
        })?;
        let runtime = Arc::new(TranscribeDll::load(&native_dir)?);
        *guard = Some(runtime.clone());
        Ok(runtime)
    }

    fn model(&self, model_path: &Path) -> Result<Arc<Model>, String> {
        let mut models = self
            .models
            .lock()
            .map_err(|_| "qwen model cache lock poisoned".to_string())?;

        if let Some(model) = models.get(model_path) {
            return Ok(model.clone());
        }

        let runtime = self.runtime()?;
        let model = Arc::new(runtime.load_model(model_path, self.mode)?);
        models.insert(model_path.to_path_buf(), model.clone());
        Ok(model)
    }
}
