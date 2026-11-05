use std::ffi::{c_char, c_int, c_void, CStr, CString};
use std::path::{Path, PathBuf};

use libloading::{Library, Symbol};

use crate::compute::ComputeMode;

type Status = i32;

#[repr(C)]
struct LoadParams {
    struct_size: u64,
    backend: i32,
    device: *mut c_void,
    no_mmap: bool,
}

#[repr(C)]
struct SessionParams {
    struct_size: u64,
    n_threads: i32,
    kv_type: i32,
    n_ctx: i32,
}

#[repr(C)]
struct RunParams {
    struct_size: u64,
    task: i32,
    timestamps: i32,
    pnc: i32,
    itn: i32,
    diarize: i32,
    language: *const c_char,
    target_language: *const c_char,
    keep_special_tags: bool,
    family: *const c_void,
    spec_k_drafts: i32,
    vocabulary: *const *const c_char,
    n_vocabulary: i32,
    prompt: *const c_char,
    prefix: *const c_char,
}

#[repr(C)]
struct DeviceInfo {
    struct_size: u64,
    name: *const c_char,
    description: *const c_char,
    kind: *const c_char,
    device_id: *const c_char,
    memory_total: u64,
    memory_free: u64,
    device_type: i32,
}

impl Default for LoadParams {
    fn default() -> Self {
        Self {
            struct_size: 0,
            backend: 0,
            device: std::ptr::null_mut(),
            no_mmap: false,
        }
    }
}

impl Default for SessionParams {
    fn default() -> Self {
        Self {
            struct_size: 0,
            n_threads: 0,
            kv_type: 0,
            n_ctx: 0,
        }
    }
}

impl Default for RunParams {
    fn default() -> Self {
        Self {
            struct_size: 0,
            task: 0,
            timestamps: 0,
            pnc: 0,
            itn: 0,
            diarize: 0,
            language: std::ptr::null(),
            target_language: std::ptr::null(),
            keep_special_tags: false,
            family: std::ptr::null(),
            spec_k_drafts: 0,
            vocabulary: std::ptr::null(),
            n_vocabulary: 0,
            prompt: std::ptr::null(),
            prefix: std::ptr::null(),
        }
    }
}

impl Default for DeviceInfo {
    fn default() -> Self {
        Self {
            struct_size: 0,
            name: std::ptr::null(),
            description: std::ptr::null(),
            kind: std::ptr::null(),
            device_id: std::ptr::null(),
            memory_total: 0,
            memory_free: 0,
            device_type: 0,
        }
    }
}

/// Dynamically loaded transcribe.cpp runtime.
///
/// The upstream Windows release ships `transcribe.dll` plus per-ISA `ggml-*.dll`
/// backend modules; the modules are only visible after `transcribe_init_backends`
/// and the sibling DLLs must be resolvable by the loader.
pub struct TranscribeDll {
    init_backends: unsafe extern "C" fn(*const c_char) -> Status,
    device_count: unsafe extern "C" fn() -> c_int,
    device_get: unsafe extern "C" fn(c_int) -> *mut c_void,
    device_info_init: unsafe extern "C" fn(*mut DeviceInfo),
    device_get_info: unsafe extern "C" fn(*mut c_void, *mut DeviceInfo) -> Status,
    load_params_init: unsafe extern "C" fn(*mut LoadParams),
    session_params_init: unsafe extern "C" fn(*mut SessionParams),
    run_params_init: unsafe extern "C" fn(*mut RunParams),
    model_load_file:
        unsafe extern "C" fn(*const c_char, *const LoadParams, *mut *mut c_void) -> Status,
    model_free: unsafe extern "C" fn(*mut c_void),
    model_device: unsafe extern "C" fn(*const c_void) -> *mut c_void,
    session_init:
        unsafe extern "C" fn(*mut c_void, *const SessionParams, *mut *mut c_void) -> Status,
    session_free: unsafe extern "C" fn(*mut c_void),
    run: unsafe extern "C" fn(*mut c_void, *const f32, c_int, *const RunParams) -> Status,
    full_text: unsafe extern "C" fn(*const c_void) -> *const c_char,
}

pub struct Model {
    raw: *mut c_void,
    free: unsafe extern "C" fn(*mut c_void),
}

pub struct Session {
    raw: *mut c_void,
    free: unsafe extern "C" fn(*mut c_void),
}

pub struct RunRequest<'a> {
    pub samples: &'a [f32],
    pub language: Option<&'a str>,
    pub prompt: Option<&'a str>,
}

pub struct RunOutput {
    pub text: String,
    pub device: String,
}

// The library documents that a loaded model may back several single-threaded
// sessions; the wrappers only move ownership of a pointer.
unsafe impl Send for Model {}
unsafe impl Sync for Model {}

impl TranscribeDll {
    pub fn load(native_dir: &Path) -> Result<Self, String> {
        let library_path = native_dir.join("transcribe.dll");
        if !library_path.is_file() {
            return Err(format!("transcribe.dll not found in {}", native_dir.display()));
        }

        add_dll_search_path(native_dir);

        let library: &'static Library = Box::leak(Box::new(
            unsafe { Library::new(&library_path) }
                .map_err(|err| format!("failed to load {}: {err}", library_path.display()))?,
        ));

        macro_rules! symbol {
            ($name:literal, $ty:ty) => {{
                let symbol: Symbol<'static, $ty> = unsafe { library.get($name.as_bytes()) }
                    .map_err(|err| format!("missing symbol {}: {err}", $name))?;
                *symbol
            }};
        }

        let dll = Self {
            init_backends: symbol!("transcribe_init_backends\0", unsafe extern "C" fn(*const c_char) -> Status),
            device_count: symbol!("transcribe_device_count\0", unsafe extern "C" fn() -> c_int),
            device_get: symbol!("transcribe_device_get\0", unsafe extern "C" fn(c_int) -> *mut c_void),
            device_info_init: symbol!(
                "transcribe_device_info_init\0",
                unsafe extern "C" fn(*mut DeviceInfo)
            ),
            device_get_info: symbol!(
                "transcribe_device_get_info\0",
                unsafe extern "C" fn(*mut c_void, *mut DeviceInfo) -> Status
            ),
            load_params_init: symbol!(
                "transcribe_model_load_params_init\0",
                unsafe extern "C" fn(*mut LoadParams)
            ),
            session_params_init: symbol!(
                "transcribe_session_params_init\0",
                unsafe extern "C" fn(*mut SessionParams)
            ),
            run_params_init: symbol!(
                "transcribe_run_params_init\0",
                unsafe extern "C" fn(*mut RunParams)
            ),
            model_load_file: symbol!(
                "transcribe_model_load_file\0",
                unsafe extern "C" fn(*const c_char, *const LoadParams, *mut *mut c_void) -> Status
            ),
            model_free: symbol!("transcribe_model_free\0", unsafe extern "C" fn(*mut c_void)),
            model_device: symbol!(
                "transcribe_model_device\0",
                unsafe extern "C" fn(*const c_void) -> *mut c_void
            ),
            session_init: symbol!(
                "transcribe_session_init\0",
                unsafe extern "C" fn(*mut c_void, *const SessionParams, *mut *mut c_void) -> Status
            ),
            session_free: symbol!("transcribe_session_free\0", unsafe extern "C" fn(*mut c_void)),
            run: symbol!(
                "transcribe_run\0",
                unsafe extern "C" fn(*mut c_void, *const f32, c_int, *const RunParams) -> Status
            ),
            full_text: symbol!(
                "transcribe_full_text\0",
                unsafe extern "C" fn(*const c_void) -> *const c_char
            ),
        };

        let artifact_dir = CString::new(native_dir.to_string_lossy().into_owned())
            .map_err(|_| "native directory path contains a NUL byte".to_string())?;
        let status = unsafe { (dll.init_backends)(artifact_dir.as_ptr()) };
        if status != 0 {
            return Err(format!(
                "failed to initialize transcription backends from {} (status {status})",
                native_dir.display()
            ));
        }

        Ok(dll)
    }

    pub fn cpu_device(&self) -> Option<*mut c_void> {
        let count = unsafe { (self.device_count)() };
        for index in 0..count.max(0) {
            let device = unsafe { (self.device_get)(index) };
            if device.is_null() {
                continue;
            }
            if self.device_kind(device).as_deref() == Some("cpu") {
                return Some(device);
            }
        }
        None
    }

    fn device_kind(&self, device: *mut c_void) -> Option<String> {
        if device.is_null() {
            return None;
        }

        let mut info = DeviceInfo::default();
        unsafe { (self.device_info_init)(&mut info) };
        if unsafe { (self.device_get_info)(device, &mut info) } != 0 {
            return None;
        }

        Some(unsafe { c_string(info.kind) })
    }

    pub fn device_label(&self, device: *mut c_void) -> String {
        if device.is_null() {
            return "unknown".to_string();
        }

        let mut info = DeviceInfo::default();
        unsafe { (self.device_info_init)(&mut info) };
        let status = unsafe { (self.device_get_info)(device, &mut info) };
        if status != 0 {
            return "unknown".to_string();
        }

        let description = unsafe { c_string(info.description) };
        let kind = unsafe { c_string(info.kind) };
        if description.is_empty() || kind.is_empty() {
            return "unknown".to_string();
        }

        format!("{description} ({kind})")
    }

    pub fn load_model(&self, path: &Path, mode: ComputeMode) -> Result<Model, String> {
        let path = CString::new(path.to_string_lossy().into_owned())
            .map_err(|_| "model path contains a NUL byte".to_string())?;

        let mut params = LoadParams::default();
        unsafe { (self.load_params_init)(&mut params) };
        if mode == ComputeMode::Cpu {
            params.device = self
                .cpu_device()
                .ok_or_else(|| "no CPU compute device available".to_string())?;
        }

        let mut raw: *mut c_void = std::ptr::null_mut();
        let status = unsafe { (self.model_load_file)(path.as_ptr(), &params, &mut raw) };
        if status != 0 || raw.is_null() {
            return Err(format!("failed to load model (status {status})"));
        }

        Ok(Model {
            raw,
            free: self.model_free,
        })
    }

    pub fn model_device_label(&self, model: &Model) -> String {
        let device = unsafe { (self.model_device)(model.raw) };
        self.device_label(device)
    }

    pub fn run(&self, model: &Model, request: RunRequest<'_>) -> Result<RunOutput, String> {
        let mut session_params = SessionParams::default();
        unsafe { (self.session_params_init)(&mut session_params) };

        let mut session_raw: *mut c_void = std::ptr::null_mut();
        let status =
            unsafe { (self.session_init)(model.raw, &session_params, &mut session_raw) };
        if status != 0 || session_raw.is_null() {
            return Err(format!("failed to create session (status {status})"));
        }
        let session = Session {
            raw: session_raw,
            free: self.session_free,
        };

        let mut params = RunParams::default();
        unsafe { (self.run_params_init)(&mut params) };

        let language = request
            .language
            .map(str::trim)
            .filter(|value| !value.is_empty() && *value != "auto")
            .and_then(|value| CString::new(value).ok());
        let prompt = request
            .prompt
            .map(|value| value.replace('\0', ""))
            .filter(|value| !value.trim().is_empty())
            .and_then(|value| CString::new(value).ok());

        params.language = language
            .as_ref()
            .map(|value| value.as_ptr())
            .unwrap_or(std::ptr::null());
        params.prompt = prompt
            .as_ref()
            .map(|value| value.as_ptr())
            .unwrap_or(std::ptr::null());

        let status = unsafe {
            (self.run)(
                session.raw,
                request.samples.as_ptr(),
                request.samples.len() as c_int,
                &params,
            )
        };
        if status != 0 {
            return Err(format!("transcription failed (status {status})"));
        }

        let text = unsafe { c_string((self.full_text)(session.raw)) };
        let device = self.model_device_label(model);

        Ok(RunOutput { text, device })
    }
}

impl Drop for Model {
    fn drop(&mut self) {
        if !self.raw.is_null() {
            unsafe { (self.free)(self.raw) };
            self.raw = std::ptr::null_mut();
        }
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        if !self.raw.is_null() {
            unsafe { (self.free)(self.raw) };
            self.raw = std::ptr::null_mut();
        }
    }
}

unsafe fn c_string(ptr: *const c_char) -> String {
    if ptr.is_null() {
        return String::new();
    }
    unsafe { CStr::from_ptr(ptr) }.to_string_lossy().into_owned()
}

/// Makes the runtime's sibling DLLs (`ggml*.dll`) resolvable before loading.
fn add_dll_search_path(dir: &Path) {
    let Some(existing) = std::env::var_os("PATH") else {
        return;
    };

    let mut entries = vec![dir.to_path_buf()];
    entries.extend(std::env::split_paths(&existing));

    if let Ok(joined) = std::env::join_paths(entries) {
        std::env::set_var("PATH", joined);
    }
}

pub fn native_dir_from_env() -> Option<PathBuf> {
    std::env::var("RUST_TRANSCRIPTION_NATIVE_DIR")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}
