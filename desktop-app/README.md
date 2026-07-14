# The Lab CRM — App de escritorio (Tauri)

Envoltorio nativo del dashboard usando [Tauri v2](https://tauri.app). La ventana
carga directamente **https://dashboard.thelab.solutions**, así que la app
siempre muestra el último deploy: **no hay que re-empaquetar cuando cambias el
dashboard** — basta con hacer el deploy normal a `main`.

El resultado es un `.app` (arrastrable a Aplicaciones) y un `.dmg` (instalador)
nativos de macOS, con su propio ícono en el Dock y Launchpad, ventana sin barra
de navegador, y ~3–6 MB de peso (vs. ~150 MB de Electron).

> **Importante:** el `.dmg`/`.app` de macOS **se compila en un Mac** (Apple no
> permite generar binarios de macOS desde Linux/Windows). Los pasos de abajo son
> para correr **en el Mac de The Lab**, una sola vez para instalar herramientas y
> luego un comando cada vez que quieras un instalador nuevo.

---

## 1. Requisitos (instalar una vez en el Mac)

```bash
# a) Herramientas de línea de comandos de Xcode (compilador C, linker)
xcode-select --install

# b) Rust (toolchain que compila el núcleo de Tauri)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"

# c) Node.js 18+ (para el CLI de Tauri). Si no lo tienes: https://nodejs.org
node --version
```

## 2. Preparar el proyecto

Desde la carpeta `desktop-app/` del repo:

```bash
cd desktop-app
npm install          # baja el CLI de Tauri (@tauri-apps/cli)
npm run icon         # genera todos los íconos (.icns/.ico/png) desde ../icons/icon-512.png
```

`npm run icon` crea la carpeta `src-tauri/icons/` con todos los tamaños que
macOS necesita. Solo hay que repetirlo si cambias el ícono base.

## 3. Probar en desarrollo (opcional)

```bash
npm run dev          # abre la ventana Tauri apuntando al sitio en vivo
```

## 4. Compilar el instalador

```bash
npm run build
```

Al terminar, los artefactos quedan en:

```
src-tauri/target/release/bundle/
├── macos/The Lab CRM.app     ← arrastra a Aplicaciones
└── dmg/The Lab CRM_1.0.0_aarch64.dmg   ← instalador para compartir
```

(En un Mac con Apple Silicon el sufijo es `aarch64`; en Intel, `x64`.)

---

## Notas

- **Auto-actualización del contenido:** como la ventana carga la URL en vivo, cada
  deploy a `main` se refleja al reabrir la app. No necesitas recompilar salvo que
  cambies algo de la *cáscara* (título, tamaño, ícono, versión).
- **Sin conexión:** el dashboard ya trae service worker, así que muestra el último
  snapshot cacheado aunque no haya internet (igual que la PWA).
- **"App de un desarrollador no identificado":** al abrirla por primera vez sin
  firma de Apple, macOS pedirá confirmar en *Ajustes → Privacidad y seguridad →
  Abrir de todas formas*. Para evitarlo por completo hay que firmarla/notarizarla
  con una cuenta de Apple Developer (US$99/año) — configurable en
  `tauri.conf.json → bundle.macOS`; no es necesario para uso interno.
- **Seguridad:** la app no expone comandos nativos al contenido remoto (sin IPC),
  así que la página corre como en un navegador normal, solo que en su ventana.
- **Versión:** sube `version` en `package.json` y `src-tauri/tauri.conf.json`
  cuando quieras numerar un instalador nuevo.
