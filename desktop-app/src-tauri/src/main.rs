// Envoltorio nativo (Tauri v2) del dashboard The Lab Solutions.
// La ventana carga directamente https://dashboard.thelab.solutions, así que la
// app siempre muestra el último deploy sin re-empaquetar. No expone comandos
// nativos al contenido remoto (sin IPC), por lo que la página web corre como en
// un navegador normal, solo que en su propia ventana de escritorio.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error al iniciar The Lab CRM");
}
