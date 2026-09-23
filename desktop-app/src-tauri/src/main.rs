// Envoltorio nativo (Tauri v2) del dashboard The Lab Solutions.
// La app carga el dashboard en vivo, pero crea sus propias ventanas nativas para
// los window.open() internos. Así el menú contextual del dashboard funciona tanto
// en navegador como dentro de The Lab CRM para macOS.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::atomic::{AtomicUsize, Ordering};
use tauri::webview::{NewWindowResponse, WebviewWindowBuilder};

static NEXT_WINDOW_ID: AtomicUsize = AtomicUsize::new(1);

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let config = app
                .config()
                .app
                .windows
                .first()
                .expect("falta la configuración de la ventana principal");

            let app_handle = app.handle().clone();

            WebviewWindowBuilder::from_config(app.handle(), config)?
                .on_new_window(move |url, features| {
                    // Solo los deep-links del propio dashboard se convierten en
                    // nuevas ventanas nativas de The Lab CRM. Los enlaces externos
                    // conservan el comportamiento normal del WebView/sistema.
                    let internal = matches!(url.scheme(), "http" | "https")
                        && url.host_str() == Some("dashboard.thelab.solutions");

                    if !internal {
                        return NewWindowResponse::Allow;
                    }

                    let n = NEXT_WINDOW_ID.fetch_add(1, Ordering::Relaxed);
                    let label = format!("dashboard-{n}");

                    let builder = WebviewWindowBuilder::new(
                        &app_handle,
                        label,
                        tauri::WebviewUrl::External("about:blank".parse().unwrap()),
                    )
                    .window_features(features)
                    .title("The Lab CRM — Centro de Comando")
                    .on_document_title_changed(|window, title| {
                        let _ = window.set_title(&title);
                    });

                    match builder.build() {
                        Ok(window) => NewWindowResponse::Create { window },
                        Err(_) => NewWindowResponse::Deny,
                    }
                })
                .build()?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error al iniciar The Lab CRM");
}
