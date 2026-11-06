use std::path::PathBuf;
use std::time::Duration;

use crate::config::SidecarConfig;
use crate::downloads::DownloadRegistry;
use crate::models::LocalModel;
use crate::qwen::QwenEngine;
use crate::streaming_sessions::TranscriptionSessionRegistry;
use crate::transcription::TranscriptionEngine;

#[derive(Clone)]
pub struct AppState {
    pub config: SidecarConfig,
    pub downloads: DownloadRegistry,
    pub transcription_sessions: TranscriptionSessionRegistry,
    pub http_client: reqwest::Client,
    pub transcriber: TranscriptionEngine,
    pub qwen: QwenEngine,
}

impl AppState {
    pub fn new(config: SidecarConfig) -> Result<Self, String> {
        let http_client = reqwest::Client::builder()
            .user_agent("voquill-rust-transcription/0.1")
            .connect_timeout(Duration::from_secs(10))
            .read_timeout(Duration::from_secs(30))
            .build()
            .map_err(|err| format!("failed to initialize http client: {err}"))?;

        Ok(Self {
            transcriber: TranscriptionEngine::new(config.mode),
            qwen: QwenEngine::new(config.mode),
            config,
            downloads: DownloadRegistry::default(),
            transcription_sessions: TranscriptionSessionRegistry::default(),
            http_client,
        })
    }

    pub fn model_path(&self, model: LocalModel) -> PathBuf {
        self.config.models_dir.join(model.filename())
    }
}
