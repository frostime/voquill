use serde::{Deserialize, Serialize};

const HUGGINGFACE_HOST: &str = "https://huggingface.co";
const HUGGINGFACE_MIRROR_HOST: &str = "https://hf-mirror.com";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WhisperModel {
    Tiny,
    Base,
    Small,
    Medium,
    Large,
    #[serde(
        alias = "large-turbo",
        alias = "large_v3_turbo",
        alias = "large-v3-turbo"
    )]
    Turbo,
    #[serde(
        rename = "hindi2hinglish",
        alias = "hindi-hinglish",
        alias = "hindi2hinglish-apex",
        alias = "whisper-hindi2hinglish-apex"
    )]
    Hindi2Hinglish,
}

impl WhisperModel {
    pub fn from_slug(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "tiny" => Some(Self::Tiny),
            "base" => Some(Self::Base),
            "small" => Some(Self::Small),
            "medium" => Some(Self::Medium),
            "large" => Some(Self::Large),
            "turbo" | "large-turbo" | "large_v3_turbo" | "large-v3-turbo" => Some(Self::Turbo),
            "hindi2hinglish"
            | "hindi-hinglish"
            | "hindi2hinglish-apex"
            | "whisper-hindi2hinglish-apex" => Some(Self::Hindi2Hinglish),
            _ => None,
        }
    }

    pub fn as_slug(self) -> &'static str {
        match self {
            Self::Tiny => "tiny",
            Self::Base => "base",
            Self::Small => "small",
            Self::Medium => "medium",
            Self::Large => "large",
            Self::Turbo => "turbo",
            Self::Hindi2Hinglish => "hindi2hinglish",
        }
    }

    pub fn filename(self) -> &'static str {
        match self {
            Self::Tiny => "ggml-tiny.bin",
            Self::Base => "ggml-base.bin",
            Self::Small => "ggml-small.bin",
            Self::Medium => "ggml-medium.bin",
            Self::Large => "ggml-large-v3.bin",
            Self::Turbo => "ggml-large-v3-turbo.bin",
            Self::Hindi2Hinglish => "ggml-hindi2hinglish-apex-q5_1.bin",
        }
    }

    fn repository_path(self) -> &'static str {
        match self {
            Self::Tiny => "ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin",
            Self::Base => "ggerganov/whisper.cpp/resolve/main/ggml-base.bin",
            Self::Small => "ggerganov/whisper.cpp/resolve/main/ggml-small.bin",
            Self::Medium => "ggerganov/whisper.cpp/resolve/main/ggml-medium.bin",
            Self::Large => "ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin",
            Self::Turbo => "ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin",
            Self::Hindi2Hinglish => {
                "voquill/whisper-hindi2hinglish-apex-ggml/resolve/main/ggml-hindi2hinglish-apex-q5_1.bin"
            }
        }
    }

    pub fn expected_bytes(self) -> u64 {
        match self {
            Self::Tiny => 77_691_713,
            Self::Base => 147_951_465,
            Self::Small => 487_601_967,
            Self::Medium => 1_533_763_059,
            Self::Large => 3_095_033_483,
            Self::Turbo => 1_624_555_275,
            Self::Hindi2Hinglish => 624_065_675,
        }
    }

    pub fn url_override(self) -> Option<String> {
        let env_var = format!(
            "RUST_TRANSCRIPTION_MODEL_URL_{}",
            self.as_slug().to_ascii_uppercase()
        );

        std::env::var(env_var)
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
    }

    pub fn download_sources(self, prefer_mirror: bool) -> Vec<String> {
        if let Some(url) = self.url_override() {
            return vec![url];
        }

        let preferred = if prefer_mirror {
            HUGGINGFACE_MIRROR_HOST
        } else {
            HUGGINGFACE_HOST
        };
        let fallback = if prefer_mirror {
            HUGGINGFACE_HOST
        } else {
            HUGGINGFACE_MIRROR_HOST
        };

        vec![
            format!("{preferred}/{}", self.repository_path()),
            format!("{fallback}/{}", self.repository_path()),
        ]
    }

    pub fn supported() -> &'static [&'static str] {
        &[
            "tiny",
            "base",
            "small",
            "medium",
            "large",
            "turbo",
            "hindi2hinglish",
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mirror_first_orders_sources() {
        let sources = WhisperModel::Tiny.download_sources(true);
        assert_eq!(sources.len(), 2);
        assert!(sources[0].starts_with("https://hf-mirror.com/ggerganov/whisper.cpp/"));
        assert!(sources[1].starts_with("https://huggingface.co/ggerganov/whisper.cpp/"));
    }

    #[test]
    fn official_first_orders_sources() {
        let sources = WhisperModel::Turbo.download_sources(false);
        assert_eq!(sources.len(), 2);
        assert!(sources[0].starts_with("https://huggingface.co/ggerganov/whisper.cpp/"));
        assert!(sources[1].starts_with("https://hf-mirror.com/ggerganov/whisper.cpp/"));
    }

    #[test]
    fn expected_bytes_match_published_artifacts() {
        assert_eq!(WhisperModel::Tiny.expected_bytes(), 77_691_713);
        assert_eq!(WhisperModel::Base.expected_bytes(), 147_951_465);
        assert_eq!(WhisperModel::Small.expected_bytes(), 487_601_967);
        assert_eq!(WhisperModel::Medium.expected_bytes(), 1_533_763_059);
        assert_eq!(WhisperModel::Large.expected_bytes(), 3_095_033_483);
        assert_eq!(WhisperModel::Turbo.expected_bytes(), 1_624_555_275);
        assert_eq!(WhisperModel::Hindi2Hinglish.expected_bytes(), 624_065_675);
    }
}
