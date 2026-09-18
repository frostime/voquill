const TRAY_ICON_DEFAULT: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/icons/tray/menu-item-win-linux-36.png"
));

use crate::domain::EVT_REGISTER_CURRENT_APP;
use std::sync::OnceLock;
use tauri::menu::{MenuItem, Submenu};

pub const EVT_COPY_LAST_TRANSCRIPT: &str = "tray-copy-last-transcript";
pub const EVT_SET_DICTATION_LANGUAGE: &str = "tray-set-dictation-language";

const TRAY_LANGUAGE_ITEM_PREFIX: &str = "tray-lang:";

static LANGUAGE_SUBMENU: OnceLock<Submenu<tauri::Wry>> = OnceLock::new();

#[derive(Debug, Clone, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct TrayLanguageMenuItem {
    pub code: String,
    pub label: String,
    pub checked: bool,
}

#[cfg(desktop)]
pub fn setup_tray(app: &mut tauri::App) -> tauri::Result<()> {
    use tauri::image::Image;
    use tauri::menu::{MenuBuilder, SubmenuBuilder};
    use tauri::tray::TrayIconBuilder;
    use tauri::{Emitter, Manager};

    let open_item = MenuItem::with_id(app, "open-dashboard", "Open Dashboard", true, None::<&str>)?;
    let copy_last_transcript_item = MenuItem::with_id(
        app,
        "copy-last-transcript",
        "Copy Latest Transcript",
        true,
        None::<&str>,
    )?;
    let register_current_app_item = MenuItem::with_id(
        app,
        "register-current-app",
        "Register this app",
        true,
        None::<&str>,
    )?;
    let language_submenu = SubmenuBuilder::new(app, "Language").build()?;
    let _ = LANGUAGE_SUBMENU.set(language_submenu.clone());
    let quit_item = MenuItem::with_id(app, "quit-voquill", "Quit Voquill", true, None::<&str>)?;

    let menu = MenuBuilder::new(app)
        .item(&open_item)
        .item(&copy_last_transcript_item)
        .item(&register_current_app_item)
        .item(&language_submenu)
        .separator()
        .item(&quit_item)
        .build()?;

    let tray_icon_image = Image::from_bytes(TRAY_ICON_DEFAULT)?;

    #[allow(unused_mut)]
    let mut tray_builder = TrayIconBuilder::with_id("main")
        .menu(&menu)
        .tooltip("Voquill")
        .icon(tray_icon_image)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open-dashboard" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = crate::platform::window::surface_main_window(&window);
                }
            }
            "copy-last-transcript" => {
                if let Err(err) = app.emit(EVT_COPY_LAST_TRANSCRIPT, ()) {
                    log::error!("Failed to emit copy-last-transcript event: {err}");
                }
            }
            "register-current-app" => {
                if let Err(err) = app.emit(EVT_REGISTER_CURRENT_APP, ()) {
                    log::error!("Failed to emit register-current-app event: {err}");
                }
            }
            "quit-voquill" => app.exit(0),
            other if other.starts_with(TRAY_LANGUAGE_ITEM_PREFIX) => {
                let code = other[TRAY_LANGUAGE_ITEM_PREFIX.len()..].to_string();
                if let Err(err) = app.emit(EVT_SET_DICTATION_LANGUAGE, code) {
                    log::error!("Failed to emit set-dictation-language event: {err}");
                }
            }
            _ => {}
        });

    let _tray_icon = tray_builder.build(app)?;

    Ok(())
}

pub fn set_tray_language_menu(
    app: &tauri::AppHandle,
    items: Vec<TrayLanguageMenuItem>,
) -> Result<(), String> {
    use tauri::menu::CheckMenuItem;

    let submenu = LANGUAGE_SUBMENU
        .get()
        .ok_or("Language submenu not initialized")?;

    let existing_count = submenu.items().map_err(|err| err.to_string())?.len();
    for _ in 0..existing_count {
        submenu.remove_at(0).map_err(|err| err.to_string())?;
    }

    for item in &items {
        let id = format!("{TRAY_LANGUAGE_ITEM_PREFIX}{}", item.code);
        let check_item = CheckMenuItem::with_id(
            app,
            id.as_str(),
            item.label.as_str(),
            true,
            item.checked,
            None::<&str>,
        )
        .map_err(|err| err.to_string())?;
        submenu.append(&check_item).map_err(|err| err.to_string())?;
    }

    Ok(())
}
