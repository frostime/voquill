use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use futures_util::StreamExt;
use serde::Serialize;
use tokio::io::AsyncWriteExt;
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::models::WhisperModel;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DownloadJobStatus {
    Pending,
    Running,
    Completed,
    Failed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadJobSnapshot {
    pub job_id: Uuid,
    pub model: WhisperModel,
    pub status: DownloadJobStatus,
    pub bytes_downloaded: u64,
    pub total_bytes: Option<u64>,
    pub progress: Option<f64>,
    pub error: Option<String>,
}

#[derive(Debug, Clone)]
struct DownloadJobRecord {
    model: WhisperModel,
    status: DownloadJobStatus,
    bytes_downloaded: u64,
    total_bytes: Option<u64>,
    error: Option<String>,
}

#[derive(Default)]
struct DownloadStore {
    jobs: HashMap<Uuid, DownloadJobRecord>,
    active_by_model: HashMap<WhisperModel, Uuid>,
}

#[derive(Clone, Default)]
pub struct DownloadRegistry {
    inner: Arc<Mutex<DownloadStore>>,
}

enum DownloadAttemptError {
    Remote(String),
    Local(String),
}

impl DownloadRegistry {
    pub async fn start_or_get_active(
        &self,
        model: WhisperModel,
        sources: Vec<String>,
        expected_bytes: Option<u64>,
        destination: PathBuf,
        client: reqwest::Client,
    ) -> Result<DownloadJobSnapshot, String> {
        if let Some(existing_size) = existing_model_file_size(&destination).await {
            let matches_expected = match expected_bytes {
                Some(expected) => expected == existing_size,
                None => true,
            };

            if matches_expected {
                return self
                    .record_completed(model, existing_size)
                    .await
                    .ok_or_else(|| "failed to create completed job snapshot".to_string());
            }

            let _ = tokio::fs::remove_file(&destination).await;
        }

        let (job_id, snapshot) = {
            let mut store = self.inner.lock().await;

            if let Some(existing_id) = store.active_by_model.get(&model).copied() {
                let existing = store
                    .snapshot(existing_id)
                    .ok_or_else(|| "active download job is missing".to_string())?;
                return Ok(existing);
            }

            let job_id = Uuid::new_v4();
            store.jobs.insert(
                job_id,
                DownloadJobRecord {
                    model,
                    status: DownloadJobStatus::Pending,
                    bytes_downloaded: 0,
                    total_bytes: None,
                    error: None,
                },
            );
            store.active_by_model.insert(model, job_id);

            let snapshot = store
                .snapshot(job_id)
                .ok_or_else(|| "failed to create job snapshot".to_string())?;

            (job_id, snapshot)
        };

        let registry = self.clone();
        tokio::spawn(async move {
            if let Err(err) = registry
                .run_download_job(job_id, model, sources, expected_bytes, destination, client)
                .await
            {
                let _ = registry.mark_failed(job_id, model, err).await;
            }
        });

        Ok(snapshot)
    }

    pub async fn get_job(&self, model: WhisperModel, job_id: Uuid) -> Option<DownloadJobSnapshot> {
        let store = self.inner.lock().await;
        let snapshot = store.snapshot(job_id)?;
        if snapshot.model == model {
            Some(snapshot)
        } else {
            None
        }
    }

    pub async fn get_active_job(&self, model: WhisperModel) -> Option<DownloadJobSnapshot> {
        let store = self.inner.lock().await;
        let job_id = store.active_by_model.get(&model).copied()?;
        store.snapshot(job_id)
    }

    async fn record_completed(
        &self,
        model: WhisperModel,
        existing_size: u64,
    ) -> Option<DownloadJobSnapshot> {
        let job_id = Uuid::new_v4();
        let mut store = self.inner.lock().await;
        store.jobs.insert(
            job_id,
            DownloadJobRecord {
                model,
                status: DownloadJobStatus::Completed,
                bytes_downloaded: existing_size,
                total_bytes: Some(existing_size),
                error: None,
            },
        );
        store.snapshot(job_id)
    }

    async fn run_download_job(
        &self,
        job_id: Uuid,
        model: WhisperModel,
        sources: Vec<String>,
        expected_bytes: Option<u64>,
        destination: PathBuf,
        client: reqwest::Client,
    ) -> Result<(), String> {
        self.mark_running(job_id).await?;

        if let Some(parent) = destination.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|err| format!("failed to create model directory: {err}"))?;
        }

        let filename = destination
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| "invalid destination filename".to_string())?;

        let temp_path = destination.with_file_name(format!("{filename}.{job_id}.download"));

        if sources.is_empty() {
            return Err("no download sources configured".to_string());
        }

        let mut last_error = String::new();

        for source in &sources {
            let attempt = self
                .try_download(job_id, source, expected_bytes, &temp_path, &destination, &client)
                .await;

            match attempt {
                Ok((downloaded, total_bytes)) => {
                    return self
                        .mark_completed(job_id, model, downloaded, total_bytes)
                        .await;
                }
                Err(DownloadAttemptError::Remote(message)) => {
                    let _ = tokio::fs::remove_file(&temp_path).await;
                    last_error = format!("{source}: {message}");
                }
                Err(DownloadAttemptError::Local(message)) => {
                    let _ = tokio::fs::remove_file(&temp_path).await;
                    return Err(format!("{source}: {message}"));
                }
            }
        }

        Err(format!(
            "all download sources failed; last error: {last_error}"
        ))
    }

    async fn try_download(
        &self,
        job_id: Uuid,
        source: &str,
        expected_bytes: Option<u64>,
        temp_path: &Path,
        destination: &Path,
        client: &reqwest::Client,
    ) -> Result<(u64, Option<u64>), DownloadAttemptError> {
        let _ = tokio::fs::remove_file(temp_path).await;

        let response = client
            .get(source)
            .send()
            .await
            .map_err(|err| DownloadAttemptError::Remote(format!("request failed: {err}")))?;

        if !response.status().is_success() {
            return Err(DownloadAttemptError::Remote(format!(
                "request failed with status {}",
                response.status()
            )));
        }

        let total_bytes = response.content_length();
        self.set_progress(job_id, 0, total_bytes)
            .await
            .map_err(DownloadAttemptError::Local)?;

        let mut stream = response.bytes_stream();
        let mut file = tokio::fs::File::create(temp_path)
            .await
            .map_err(|err| DownloadAttemptError::Local(format!("create temp file: {err}")))?;

        let mut downloaded: u64 = 0;

        while let Some(item) = stream.next().await {
            let chunk =
                item.map_err(|err| DownloadAttemptError::Remote(format!("stream failed: {err}")))?;
            file.write_all(&chunk)
                .await
                .map_err(|err| DownloadAttemptError::Local(format!("write failed: {err}")))?;
            downloaded += chunk.len() as u64;
            self.set_progress(job_id, downloaded, total_bytes)
                .await
                .map_err(DownloadAttemptError::Local)?;
        }

        file.flush()
            .await
            .map_err(|err| DownloadAttemptError::Local(format!("flush failed: {err}")))?;
        file.sync_all()
            .await
            .map_err(|err| DownloadAttemptError::Local(format!("sync failed: {err}")))?;
        drop(file);

        if let Some(expected) = expected_bytes {
            if downloaded != expected {
                return Err(DownloadAttemptError::Remote(format!(
                    "downloaded {downloaded} bytes but expected {expected}"
                )));
            }
        }

        if destination.exists() {
            tokio::fs::remove_file(destination)
                .await
                .map_err(|err| DownloadAttemptError::Local(format!("replace failed: {err}")))?;
        }

        tokio::fs::rename(temp_path, destination)
            .await
            .map_err(|err| DownloadAttemptError::Local(format!("finalize failed: {err}")))?;

        Ok((downloaded, total_bytes))
    }

    async fn mark_running(&self, job_id: Uuid) -> Result<(), String> {
        let mut store = self.inner.lock().await;
        let job = store
            .jobs
            .get_mut(&job_id)
            .ok_or_else(|| "download job not found".to_string())?;

        job.status = DownloadJobStatus::Running;
        job.error = None;
        Ok(())
    }

    async fn set_progress(
        &self,
        job_id: Uuid,
        downloaded: u64,
        total_bytes: Option<u64>,
    ) -> Result<(), String> {
        let mut store = self.inner.lock().await;
        let job = store
            .jobs
            .get_mut(&job_id)
            .ok_or_else(|| "download job not found".to_string())?;

        job.bytes_downloaded = downloaded;
        job.total_bytes = total_bytes;
        Ok(())
    }

    async fn mark_completed(
        &self,
        job_id: Uuid,
        model: WhisperModel,
        downloaded: u64,
        total_bytes: Option<u64>,
    ) -> Result<(), String> {
        let mut store = self.inner.lock().await;
        let job = store
            .jobs
            .get_mut(&job_id)
            .ok_or_else(|| "download job not found".to_string())?;

        job.status = DownloadJobStatus::Completed;
        job.bytes_downloaded = downloaded;
        job.total_bytes = total_bytes.or(Some(downloaded));
        job.error = None;
        store.active_by_model.remove(&model);

        Ok(())
    }

    async fn mark_failed(
        &self,
        job_id: Uuid,
        model: WhisperModel,
        error_message: String,
    ) -> Result<(), String> {
        let mut store = self.inner.lock().await;
        if let Some(job) = store.jobs.get_mut(&job_id) {
            job.status = DownloadJobStatus::Failed;
            job.error = Some(error_message);
        }
        store.active_by_model.remove(&model);
        Ok(())
    }
}

impl DownloadStore {
    fn snapshot(&self, job_id: Uuid) -> Option<DownloadJobSnapshot> {
        let job = self.jobs.get(&job_id)?;
        let progress = match job.total_bytes {
            Some(total) if total > 0 => Some((job.bytes_downloaded as f64 / total as f64).min(1.0)),
            Some(_) => Some(1.0),
            None => None,
        };

        Some(DownloadJobSnapshot {
            job_id,
            model: job.model,
            status: job.status,
            bytes_downloaded: job.bytes_downloaded,
            total_bytes: job.total_bytes,
            progress,
            error: job.error.clone(),
        })
    }
}

async fn existing_model_file_size(path: &Path) -> Option<u64> {
    match tokio::fs::metadata(path).await {
        Ok(metadata) if metadata.is_file() && metadata.len() > 0 => Some(metadata.len()),
        _ => None,
    }
}
