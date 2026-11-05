use serde::{Deserialize, Serialize};

const HUGGINGFACE_HOST: &str = "https://huggingface.co";
const HUGGINGFACE_MIRROR_HOST: &str = "https://hf-mirror.com";
const QWEN_REVISION: &str = "e4e16599b900eb0cb36e524514756bb92eb092b7";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ModelFamily {
    Whisper,
    Qwen,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LocalModel {
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
    #[serde(
        rename = "qwen3-asr-0.6b",
        alias = "qwen3_asr06_b",
        alias = "qwen3-asr",
        alias = "qwen"
    )]
    Qwen3Asr06B,
}

impl LocalModel {
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
            "qwen3-asr-0.6b" | "qwen3_asr06_b" | "qwen3-asr" | "qwen" => Some(Self::Qwen3Asr06B),
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
            Self::Qwen3Asr06B => "qwen3-asr-0.6b",
        }
    }

    pub fn family(self) -> ModelFamily {
        match self {
            Self::Qwen3Asr06B => ModelFamily::Qwen,
            _ => ModelFamily::Whisper,
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
            Self::Qwen3Asr06B => "Qwen3-ASR-0.6B-Q8_0.gguf",
        }
    }

    fn repository_path(self) -> String {
        match self {
            Self::Tiny => "ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin".to_string(),
            Self::Base => "ggerganov/whisper.cpp/resolve/main/ggml-base.bin".to_string(),
            Self::Small => "ggerganov/whisper.cpp/resolve/main/ggml-small.bin".to_string(),
            Self::Medium => "ggerganov/whisper.cpp/resolve/main/ggml-medium.bin".to_string(),
            Self::Large => "ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin".to_string(),
            Self::Turbo => {
                "ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin".to_string()
            }
            Self::Hindi2Hinglish => {
                "voquill/whisper-hindi2hinglish-apex-ggml/resolve/main/ggml-hindi2hinglish-apex-q5_1.bin"
                    .to_string()
            }
            Self::Qwen3Asr06B => format!(
                "handy-computer/Qwen3-ASR-0.6B-gguf/resolve/{QWEN_REVISION}/Qwen3-ASR-0.6B-Q8_0.gguf"
            ),
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
            Self::Qwen3Asr06B => 850_423_456,
        }
    }

    pub fn url_override(self) -> Option<String> {
        let env_var = format!(
            "RUST_TRANSCRIPTION_MODEL_URL_{}",
            self.as_slug().to_ascii_uppercase().replace(['-', '.'], "_")
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

        let (preferred, fallback) = if prefer_mirror {
            (HUGGINGFACE_MIRROR_HOST, HUGGINGFACE_HOST)
        } else {
            (HUGGINGFACE_HOST, HUGGINGFACE_MIRROR_HOST)
        };

        let path = self.repository_path();
        vec![format!("{preferred}/{path}"), format!("{fallback}/{path}")]
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
            "qwen3-asr-0.6b",
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mirror_first_orders_sources() {
        let sources = LocalModel::Tiny.download_sources(true);
        assert_eq!(sources.len(), 2);
        assert!(sources[0].starts_with("https://hf-mirror.com/ggerganov/whisper.cpp/"));
        assert!(sources[1].starts_with("https://huggingface.co/ggerganov/whisper.cpp/"));
    }

    #[test]
    fn official_first_orders_sources() {
        let sources = LocalModel::Turbo.download_sources(false);
        assert_eq!(sources.len(), 2);
        assert!(sources[0].starts_with("https://huggingface.co/ggerganov/whisper.cpp/"));
        assert!(sources[1].starts_with("https://hf-mirror.com/ggerganov/whisper.cpp/"));
    }

    #[test]
    fn expected_bytes_match_published_artifacts() {
        assert_eq!(LocalModel::Tiny.expected_bytes(), 77_691_713);
        assert_eq!(LocalModel::Base.expected_bytes(), 147_951_465);
        assert_eq!(LocalModel::Small.expected_bytes(), 487_601_967);
        assert_eq!(LocalModel::Medium.expected_bytes(), 1_533_763_059);
        assert_eq!(LocalModel::Large.expected_bytes(), 3_095_033_483);
        assert_eq!(LocalModel::Turbo.expected_bytes(), 1_624_555_275);
        assert_eq!(LocalModel::Hindi2Hinglish.expected_bytes(), 624_065_675);
        assert_eq!(LocalModel::Qwen3Asr06B.expected_bytes(), 850_423_456);
    }

    #[test]
    fn model_families_and_slugs() {
        assert_eq!(LocalModel::Tiny.family(), ModelFamily::Whisper);
        assert_eq!(LocalModel::Qwen3Asr06B.family(), ModelFamily::Qwen);
        assert_eq!(
            LocalModel::from_slug("qwen3-asr-0.6b"),
            Some(LocalModel::Qwen3Asr06B)
        );
        assert_eq!(LocalModel::Qwen3Asr06B.as_slug(), "qwen3-asr-0.6b");
    }
}
