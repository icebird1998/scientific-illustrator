# Changelog

## Unreleased (fork thezavtrak-a11y)

- Added `drawio_live_reload_from_disk`: after rewriting the already-open `.drawio` on disk, wait for Desktop's red file-changed banner and trigger synchronize via the in-page `a.geStatus` click listener (synthetic mouse fallback). No OS mouse, no app restart. Prefer over `close_session`/`launch` for ordinary disk→viewport refresh.

## 1.5.4 — 2026-08-08

- Updated the author, developer, Office add-in provider, task-pane, license, README, and successful-delivery attribution to `一个地质博士`.
- Removed every remaining legacy author label from the plugin package.
- Synchronized the plugin, MCP server, Office.js manifest, documentation, and validation metadata at version 1.5.4.

## 1.5.3 — 2026-08-01

- Fixed macOS WPS discovery for the localized application path, environment overrides, Bundle ID lookup, and exact main-process matching.
- Replaced false-positive status with separate installed, running, managed-file, open-dispatch, document-open, and refresh-verification states. Unknown WPS states remain `null` instead of becoming success.
- Locked both backend and target application after the first presentation mutation, so an explicit WPS request can never reuse a PowerPoint COM/Office.js session; sequence-level host selection is propagated to every operation.
- Isolated the OOXML working-copy state per MCP process by default, preventing concurrent Codex tasks from overwriting or redirecting one another's PowerPoint/WPS session.
- Serialized stateful MCP requests within each server, preventing parallel tool calls from racing on PPTX state or draw.io canvas mutations and losing objects.
- Refused editable OOXML copies of `.pptm` and `.ppsx` instead of risking macro loss or content-type changes; those formats remain available to Windows COM or read-only OOXML inspection.
- Enforced output extensions for PPTX, PDF, PNG, and JPEG across file-backed and Office.js saves/exports instead of writing valid bytes under misleading filenames.
- Added checked `open -b com.kingsoft.wpsoffice.mac` dispatch, macOS `lsof` verification, safe activation/quit behavior, and an explicit `powerpoint_refresh` tool.
- Made Mac PowerPoint file-backed refresh/close target the exact application-reported directory plus filename instead of a potentially ambiguous duplicate name; replaced unreliable `lsof`-only window detection and unstable AppleScript object references with bounded indexed checks.
- Blocked automatic Mac PowerPoint reload when the managed window contains unsaved user edits, preventing checkpoint refresh from discarding manual changes.
- Changed OOXML sequences to checkpoint refresh by default while still saving each native object; `fast` refreshes once and explicit `per_object` remains available.
- Added Windows WPS environment/PATH/registry/versioned-path discovery, exact `wpp.exe`/`wpsoffice.exe` process parsing, `py -3` runtime support, and PowerShell syntax plus non-mutating COM status checks.
- Extended Windows WPS discovery to configured product roots and both 32-bit/64-bit App Paths registry views.
- Added Windows/macOS draw.io path regression tests and a GitHub Actions matrix for Ubuntu, macOS, and Windows. Public runners do not contain commercial PowerPoint/WPS applications, so simulated checks are never reported as real application integration.
- Rejected unknown or unloaded draw.io shape/stencil names instead of allowing the renderer to silently substitute a rectangle; capabilities now expose the live stencil registry.
- Separated free-line and attached-connector routing: coordinate lines now follow exact endpoints/waypoints without automatic orthogonal doglegs, while attached connectors keep square-corner orthogonal routing unless curvature is explicit.
- Fixed group-shape updates, table-layout length validation, and previously ignored arrowhead updates; file-backed status no longer equates a running process with an in-memory application connection.
- Tightened editable table/chart behavior across OOXML, Office.js, and COM: unsupported mutations now fail explicitly, transparency and banding are preserved, scatter x-values remain numeric, and editable axis titles are emitted where supported.
- Rejected oversized table data and out-of-range cell overrides instead of truncating them, and made banded-row parity consistent for any header-row count.
- Made Office.js, OOXML, and COM shape lookup reject ambiguous duplicate names and added duplicate-name hard findings so correction calls cannot silently edit the wrong object.
- Added WPS reliability tests, real Mac PowerPoint/WPS/draw.io integration checks, concise usage guidance, and synchronized plugin, MCP, and Office.js version metadata.

## 1.5.2 — 2026-08-01

- Replaced unsupported SVG manifest icons with validated 32 px and 64 px PNG assets so Mac PowerPoint no longer silently ignores the Office.js add-in.
- Added the correct `image/png` response type and regression checks for manifest icon paths, dimensions, MIME types, and synchronized release versions.

## 1.5.0 — 2026-07-30

- Added a sideloadable Microsoft PowerPoint Office.js task pane for macOS with direct `PowerPoint.run()` and per-object `context.sync()` updates in the current deck.
- Added a loopback-only HTTPS command bridge with a random session token, authenticated long polling, acknowledgements, heartbeat detection, size limits, and protocol timeout tests.
- Added automatic backend selection and session locking: Windows PowerPoint COM first, connected Mac PowerPoint Office.js next, then the existing WPS/Mac OOXML fallback.
- Added explicit `per_object`, `checkpoint`, and `fast` pacing modes without calling file refresh "live".
- Added editable geometry-backed arrow/connector and regular-chart composites for Office.js API gaps, with capability and result declarations instead of overstating native support.
- Added Office.js slide rendering and editable PPTX export, pre-cropped atomic-image enforcement, local certificate generation, and Mac manifest sideload helpers. Certificate trust remains a manual user decision.
- Fixed Office.js whole-slide audit classification so inspected lines and images use the normalized `shape_type` inventory field, and added a regression guard plus Office.js type validation.
- Added bilingual Windows/macOS × draw.io/PowerPoint/WPS compatibility, versioned-release, and rollback documentation. The first public `v1.3.0` release remains available alongside `v1.5.0`.

## 1.4.0 — 2026-07-29

- Added native editable PPTX support for Microsoft PowerPoint on macOS through a safe file-backed OOXML bridge.
- Added WPS Presentation compatibility on Windows and macOS using the same standard PPTX object model.
- Added automatic application discovery and explicit `auto`, `powerpoint`, and `wps` host selection.
- Preserved the Windows Microsoft PowerPoint COM backend as the fastest live-editing path.
- Added local Mac/WPS capability reporting, deterministic structure audit, isolated working copies, and LibreOffice/Poppler preview rendering.

## 1.3.0 — 2026-07-24

- Published as the new `scientific-illustrator` project.
- Integrated and upgraded the earlier `drawio-scientific-illustrator` research project.
- Added live Microsoft PowerPoint control through the native Windows COM object model.
- Preserved and expanded live draw.io graph-API drawing, file validation, and export.
- Added equivalent capability discovery and object operations for PowerPoint and draw.io.
- Added a backend-neutral Designer–Drawer–Reviewer–Corrector workflow.
- Added panel-by-panel local quality gates and repeated whole-figure review.
- Added deep editability review and atomic-raster enforcement so editable content is not needlessly flattened.
- Added deterministic alignment, distribution, z-order, grouping, table, chart, and connector-clearance operations.
- Added bilingual installation, usage, migration, privacy, and troubleshooting documentation.
