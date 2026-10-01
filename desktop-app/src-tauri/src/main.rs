// Envoltorio nativo (Tauri v2) del dashboard The Lab Solutions.
// Google OAuth NO se ejecuta dentro de WKWebView: Google bloquea agentes embebidos.
// Calendar usa un flujo nativo de app de escritorio (browser del sistema + loopback
// 127.0.0.1 + PKCE) y devuelve únicamente el access token temporal al dashboard.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::{distributions::Alphanumeric, Rng};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    io::{ErrorKind, Read, Write},
    net::TcpListener,
    process::Command,
    sync::atomic::{AtomicUsize, Ordering},
    thread,
    time::{Duration, Instant},
};
use tauri::webview::{NewWindowResponse, WebviewWindowBuilder};
use url::Url;

static NEXT_WINDOW_ID: AtomicUsize = AtomicUsize::new(1);

#[derive(Debug, Serialize)]
struct GoogleOAuthResult {
    access_token: String,
    expires_in: u64,
}

#[derive(Debug, Deserialize)]
struct GoogleTokenResponse {
    access_token: Option<String>,
    expires_in: Option<u64>,
    error: Option<String>,
    error_description: Option<String>,
}

fn valid_google_client_id(value: &str) -> bool {
    let v = value.trim();
    v.len() >= 30
        && v.len() <= 220
        && v.ends_with(".apps.googleusercontent.com")
        && v.chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

fn browser_open(url: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(url)
            .spawn()
            .map_err(|e| format!("No se pudo abrir el navegador: {e}"))?;
        return Ok(());
    }
    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .args(["/C", "start", "", url])
            .spawn()
            .map_err(|e| format!("No se pudo abrir el navegador: {e}"))?;
        return Ok(());
    }
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    {
        Command::new("xdg-open")
            .arg(url)
            .spawn()
            .map_err(|e| format!("No se pudo abrir el navegador: {e}"))?;
        Ok(())
    }
}

fn http_reply(stream: &mut std::net::TcpStream, ok: bool, message: &str) {
    let title = if ok { "Google Calendar conectado" } else { "No se pudo conectar" };
    let accent = if ok { "#00d4cc" } else { "#ff5d5d" };
    let safe = message
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;");
    let body = format!(
        "<!doctype html><html lang='es'><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>{title}</title><body style='margin:0;background:#0a0a0a;color:#eee;font:15px -apple-system,BlinkMacSystemFont,system-ui;display:grid;place-items:center;min-height:100vh'><main style='width:min(520px,calc(100vw - 48px));padding:32px;border:1px solid #2c2c2c;border-radius:18px;background:#121212;box-shadow:0 24px 70px #0008'><div style='color:{accent};font-weight:800;letter-spacing:.04em;margin-bottom:10px'>{title}</div><p style='color:#aaa;line-height:1.55'>{safe}</p><p style='margin-top:22px;color:#777;font-size:13px'>Ya puedes cerrar esta pestaña y volver a The Lab CRM.</p></main></body></html>"
    );
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.as_bytes().len(),
        body
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

fn google_calendar_oauth_blocking(client_id: String) -> Result<GoogleOAuthResult, String> {
    let client_id = client_id.trim().to_string();
    if !valid_google_client_id(&client_id) {
        return Err("El Google OAuth Client ID de escritorio no es válido.".into());
    }

    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("No se pudo iniciar el retorno OAuth local: {e}"))?;
    listener
        .set_nonblocking(true)
        .map_err(|e| format!("No se pudo preparar OAuth local: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("No se pudo leer el puerto OAuth: {e}"))?
        .port();
    let redirect_uri = format!("http://127.0.0.1:{port}/oauth2/callback");

    let verifier: String = rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(80)
        .map(char::from)
        .collect();
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let state: String = rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(40)
        .map(char::from)
        .collect();

    let mut auth = Url::parse("https://accounts.google.com/o/oauth2/v2/auth")
        .map_err(|e| format!("URL OAuth inválida: {e}"))?;
    auth.query_pairs_mut()
        .append_pair("client_id", &client_id)
        .append_pair("redirect_uri", &redirect_uri)
        .append_pair("response_type", "code")
        .append_pair("scope", "https://www.googleapis.com/auth/calendar.events")
        .append_pair("code_challenge", &challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("state", &state)
        .append_pair("access_type", "online")
        .append_pair("prompt", "select_account");

    browser_open(auth.as_str())?;

    let deadline = Instant::now() + Duration::from_secs(180);
    let code = loop {
        if Instant::now() >= deadline {
            return Err("La autorización de Google venció. Vuelve a presionar Conectar Google Calendar.".into());
        }
        match listener.accept() {
            Ok((mut stream, _)) => {
                let mut buf = [0u8; 16384];
                let n = stream
                    .read(&mut buf)
                    .map_err(|e| format!("No se pudo leer el retorno OAuth: {e}"))?;
                let req = String::from_utf8_lossy(&buf[..n]);
                let path = req
                    .lines()
                    .next()
                    .and_then(|l| l.split_whitespace().nth(1))
                    .unwrap_or("/");
                let callback = Url::parse(&format!("http://127.0.0.1:{port}{path}"))
                    .map_err(|e| format!("Retorno OAuth inválido: {e}"))?;
                let params: std::collections::HashMap<String, String> =
                    callback.query_pairs().into_owned().collect();

                if params.get("state") != Some(&state) {
                    http_reply(&mut stream, false, "La respuesta de Google no coincide con esta solicitud.");
                    return Err("OAuth rechazado por validación de estado.".into());
                }
                if let Some(err) = params.get("error") {
                    let msg = format!("Google canceló o rechazó la autorización: {err}");
                    http_reply(&mut stream, false, &msg);
                    return Err(msg);
                }
                if let Some(c) = params.get("code") {
                    http_reply(&mut stream, true, "Autorización recibida correctamente.");
                    break c.clone();
                }
                http_reply(&mut stream, false, "Google no devolvió un código de autorización.");
                return Err("Google no devolvió un código de autorización.".into());
            }
            Err(e) if e.kind() == ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(100));
            }
            Err(e) => return Err(format!("Error esperando autorización de Google: {e}")),
        }
    };

    let http = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(25))
        .build()
        .map_err(|e| format!("No se pudo preparar el intercambio OAuth: {e}"))?;
    let response = http
        .post("https://oauth2.googleapis.com/token")
        .form(&[
            ("client_id", client_id.as_str()),
            ("code", code.as_str()),
            ("code_verifier", verifier.as_str()),
            ("grant_type", "authorization_code"),
            ("redirect_uri", redirect_uri.as_str()),
        ])
        .send()
        .map_err(|e| format!("No se pudo intercambiar el código OAuth: {e}"))?;
    let status = response.status();
    let token: GoogleTokenResponse = response
        .json()
        .map_err(|e| format!("Respuesta OAuth de Google inválida: {e}"))?;

    if !status.is_success() || token.access_token.is_none() {
        let detail = token
            .error_description
            .or(token.error)
            .unwrap_or_else(|| format!("HTTP {status}"));
        return Err(format!("Google OAuth: {detail}"));
    }

    Ok(GoogleOAuthResult {
        access_token: token.access_token.unwrap(),
        expires_in: token.expires_in.unwrap_or(3600),
    })
}

#[tauri::command]
async fn google_calendar_oauth(client_id: String) -> Result<GoogleOAuthResult, String> {
    tauri::async_runtime::spawn_blocking(move || google_calendar_oauth_blocking(client_id))
        .await
        .map_err(|e| format!("Falló el proceso OAuth: {e}"))?
}

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
        .invoke_handler(tauri::generate_handler![google_calendar_oauth])
        .run(tauri::generate_context!())
        .expect("error al iniciar The Lab CRM");
}
