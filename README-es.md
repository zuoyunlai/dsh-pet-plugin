# dsh-pet

Una mascota que vive en la esquina inferior derecha de la **interfaz web de DSH**: aparece
de forma permanente o aleatoria, habla (con voz), camina, baila, se pone tímida o enfadada,
y trae una cajita de texto para charlar con ella. Cuatro personajes fotorrealistas, cada uno
con su propio temperamento.

> Alcance: la mascota solo vive dentro de la ventana de DSH (se monta en el slot de overlay
> del marco). **No puede flotar sobre otras aplicaciones**: eso exigiría un shell Electron
> aparte, no un plugin.

## At a glance

- **Puntos de montaje**: `shell.overlay` (la mascota, capa transparente a los clics) y
  `conversation.input.right` (el botón junto al compositor).
- **Chat privado**: lo que escribes en la cajita **nunca entra en tu sesión**. El host
  expone `POST /dsh-pet/chat` y responde con una única llamada a `ctx.llm.stream()`
  (sin sesión, sin registro de sesión). Por defecto: `deepseek-account` / `deepseek-flash`.
- **Icono**: `icon.svg` y el botón del compositor comparten el mismo trazado.
- **Panel de ajustes**: agrupado (aspecto / voz / visualización / acciones / efectos), con
  desplegables y conmutadores propios, fijado al viewport.
- **Cuatro personajes** fotorrealistas, 5 expresiones cada uno: 薇, 绯, 靛, 雪.

## Behavior

| Capacidad | Cómo |
|---|---|
| Siempre visible / aleatoria | Interruptor en el panel; el modo aleatorio usa una probabilidad por hora |
| Horario activo | Hora de inicio y fin, admite cruzar medianoche |
| Frases proactivas | Paquetes de frases por estado de ánimo, burbuja + voz |
| Voz | **Opcional**: si el host tiene un python con `edge-tts` se usa voz neuronal; si no, el `speechSynthesis` del sistema |
| Cajita de texto | Chat solo con la mascota; llamada puntual al modelo, no escribe en ninguna sesión |
| Estados | idle / walk / dance / shy / angry / sleep / talk / happy |
| Mirada | Las pupilas siguen el ratón (solo variables CSS) |
| Efectos | Tinta / confeti / nube / niebla / bomba |

## Install (local, no registry)

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

Cierra DSH antes de instalarlo. El script añade la dependencia `file:` al perfil, registra el
bundle, ejecuta `pnpm install` y verifica el resultado. `update.cmd` solo copia archivos y se
puede usar con DSH abierto.

```bash
pip install edge-tts    # opcional: voz neuronal, cualquier python del host
```

## Verify

```bash
node --check client.js
node tests/smoke.mjs
cd <profile>/node_modules/@local/dsh-pet && node --test tests/host.test.mjs
node <dsh-plugin-guide>/bin/dsh-plugin-dev.js check --cwd . --strict
node <dsh-plugin-guide>/bin/dsh-plugin-dev.js verify --cwd .
```

## Customize

- Personajes, frases y temperamentos están en `PERSONAS` dentro de `client.js`.
- Nuevos estados: añade keyframes al bloque `CSS` y mapea la clase en `Face`/`PetArt`.
- `provider`, `model`, `maxTokens` y `temperature` son configuración del plugin.

## Known limits

- La voz neuronal requiere un python del host con `edge_tts`.
- El navegador bloquea el autoplay hasta el primer gesto del usuario.
- Los ajustes viven en `localStorage`; el asa de depuración `__dshPet` está desactivada por
  defecto (`dsh-pet.debug=1` o `?petdebug=1`).
- No puede flotar sobre otras aplicaciones.
