# Scientific Illustrator

Upload a reference figure to Codex; the plugin redraws it in **Microsoft PowerPoint, WPS Presentation, or draw.io** with editable objects where possible, then checks and corrects the result.

**Author: A geology PhD**

GitHub: [@icebird1998](https://github.com/icebird1998)

Current release: [v1.5.4](https://github.com/icebird1998/scientific-illustrator/releases/tag/v1.5.4)

This project supersedes [drawio-scientific-illustrator](https://github.com/icebird1998/drawio-scientific-illustrator). New work lands here only.

Chinese original: [README.zh-CN.md](README.zh-CN.md)

## First-time setup: 3 steps

### Step 1: Install the plugin

Send this block to Codex as-is:

~~~text
Please install https://github.com/icebird1998/scientific-illustrator.
Register the repo root as a Codex Marketplace, then install
scientific-illustrator@scientific-illustrator-tools. When done, remind me to restart Codex.
~~~

### Step 2: Restart Codex

After install:

1. Fully quit and reopen Codex;
2. Start a new task;
3. Open PowerPoint, WPS Presentation, or draw.io Desktop (whichever you will use).

### Step 3: Upload the image and paste a prompt

Attach the reference figure in Codex, pick the prompt below that matches your app, and **paste the whole block**.

## Supported platforms and apps

| App | Windows | macOS | How it works |
|---|---|---|---|
| Microsoft PowerPoint | Supported | Supported | Editable PPTX; live drawing on Windows; Mac can use normal mode or the live add-in |
| WPS Presentation | Supported | Supported | Editable PPTX working copy; checkpoint background refresh by default (does not keep stealing focus) |
| draw.io Desktop | Supported | Supported | Direct canvas control; saves editable `.drawio` and exports a preview image |

By default PowerPoint and WPS draw in the background so you can keep using the machine. WPS uses an editable PPTX working copy and will not claim it is attached to an arbitrary unsaved window; macOS verifies that WPS actually opened the file, and Windows reports `unknown` when that cannot be verified. Unknown draw.io shape names fail loudly instead of silently becoming rectangles. Content that cannot be rebuilt as shapes (micrographs, complex textures, etc.) is inserted as the smallest necessary image crop; text, arrows, and borders stay editable.

Every release runs code, MCP, Python, PowerShell, path-discovery, and OOXML regression tests on Ubuntu, macOS, and Windows. This release was also validated on a real Mac for PowerPoint open/refresh/close, WPS open-by-path, and live draw.io canvas control. Public GitHub runners do not ship commercial PowerPoint/WPS, so Windows in-app checks must be confirmed with the post-install status tools — simulated CI is not a live connection success.

## Copy-paste prompts

### Microsoft PowerPoint

Open PowerPoint, upload the reference figure, then paste:

~~~text
[@scientific-illustrator](plugin://scientific-illustrator@scientific-illustrator-tools)
Use Scientific Illustrator to recreate my uploaded reference figure in the current Microsoft PowerPoint.
Connect to PowerPoint first; inspect status, capabilities, backend, and the current slide; create a presentation if none exists.
Only COM or officejs-context-sync may claim attachment to the current window; if using OOXML, say clearly that you are editing a working copy.
Draw in the background by default; do not keep stealing focus. Prefer editable text, shapes, connectors, tables, and charts.
Only crop and insert images for the smallest regions that cannot be drawn reliably (e.g. micrographs or complex textures).
Draw region by region; after each region, check structure and the preview image, fix issues before continuing.
When finished, run a full-figure comparison, save the PPTX, and export the final preview image.
~~~

### WPS Presentation

Open WPS Presentation, upload the reference figure, then paste:

~~~text
[@scientific-illustrator](plugin://scientific-illustrator@scientific-illustrator-tools)
Use Scientific Illustrator to recreate my uploaded reference figure in WPS Presentation.
Set host_application explicitly to wps; do not connect to Microsoft PowerPoint. Inspect status and capabilities first;
confirm target_application=wps and microsoft_powerpoint_used=false. If no PPTX path is given,
create a WPS editable working copy; do not claim attachment to an arbitrary unsaved window. Draw with checkpoint background refresh by default.
Prefer editable text, shapes, connectors, tables, and charts. Only crop and insert images for the smallest regions that cannot be drawn reliably
(e.g. micrographs or complex textures). Draw region by region; after each region call refresh and verify
open_dispatched, document_open_verified, and refresh_verified; fix issues before continuing.
When finished, run a full-figure comparison, save the PPTX, and export the final preview image.
~~~

### draw.io

Install and open [draw.io Desktop](https://www.drawio.com/), upload the reference figure, then paste:

~~~text
[@scientific-illustrator](plugin://scientific-illustrator@scientific-illustrator-tools)
Use Scientific Illustrator to attach to the live draw.io canvas and recreate my uploaded reference figure.
Prefer editable text, shapes, connectors, tables, charts, and groups.
Only crop and insert images for the smallest regions that cannot be drawn reliably (e.g. micrographs or complex textures).
Draw region by region; after each region check structure and a canvas screenshot, fix issues before continuing.
When finished, run a full-figure comparison, save an editable .drawio, and export a 2000 px-wide PNG preview.
~~~

If the first plugin line is not recognized, pick **Scientific Illustrator** from the Codex plugin menu, then send the rest of the prompt.

To watch PowerPoint or WPS draw in the foreground, append:

~~~text
During drawing, set focus_policy to foreground so the presentation stays in front.
~~~

## Other install methods

Most users can let Codex install as above. You can also run the install scripts directly.

### Windows

~~~powershell
$p="$env:TEMP\scientific-illustrator-install.ps1"; Invoke-WebRequest https://raw.githubusercontent.com/icebird1998/scientific-illustrator/main/install.ps1 -OutFile $p; powershell -ExecutionPolicy Bypass -File $p
~~~

### macOS / Linux

~~~bash
curl -fsSL https://raw.githubusercontent.com/icebird1998/scientific-illustrator/main/install.sh | bash
~~~

### Manual install

~~~bash
git clone https://github.com/icebird1998/scientific-illustrator.git
cd scientific-illustrator
codex plugin marketplace add "$(pwd)"
codex plugin add scientific-illustrator@scientific-illustrator-tools
~~~

After any install or update, restart Codex and start a new task.

<details>
<summary><strong>Mac PowerPoint: enable per-object live drawing (optional)</strong></summary>

A normal install already produces editable PPTX. Complete this section only if you want to watch per-object live drawing inside Mac PowerPoint.

From the repo root:

~~~bash
node plugins/scientific-illustrator/scripts/officejs-setup.mjs prepare
openssl x509 -in "$HOME/.codex/scientific-illustrator/officejs/localhost.crt" -text -noout
node plugins/scientific-illustrator/scripts/officejs-setup.mjs sideload
~~~

Then:

1. In macOS Keychain Access, review and manually trust the localhost certificate;
2. Restart PowerPoint;
3. Open **Scientific Illustrator Live** from Insert → My Add-ins;
4. Keep the task pane open and confirm `powerpoint_officejs_status` shows `connected=true`.

The plugin never changes system certificate trust automatically.

</details>

## Release notes (summary)

| Version | Highlights |
|---|---|
| [v1.5.4](https://github.com/icebird1998/scientific-illustrator/releases/tag/v1.5.4) | Unified author attribution to “A geology PhD” |
| [v1.5.3](https://github.com/icebird1998/scientific-illustrator/releases/tag/v1.5.3) | Dual-OS / three-app compatibility, connection status, table/chart/arrow updates; three-platform CI, real open verification, draw.io fake-shape rejection |
| [v1.5.2](https://github.com/icebird1998/scientific-illustrator/releases/tag/v1.5.2) | Fix Mac PowerPoint live add-in icon format so the add-in is not silently ignored |
| [v1.5.1](https://github.com/icebird1998/scientific-illustrator/releases/tag/v1.5.1) | Stop PowerPoint/WPS from repeatedly stealing focus; background drawing by default |
| [v1.5.0](https://github.com/icebird1998/scientific-illustrator/releases/tag/v1.5.0) | PowerPoint, WPS, and draw.io on Windows/macOS; Mac PowerPoint live mode |
| [v1.3.0](https://github.com/icebird1998/scientific-illustrator/releases/tag/v1.3.0) | First public release: Windows PowerPoint and draw.io |

Older tags are kept. To roll back:

~~~bash
git fetch --tags
git checkout v1.5.0
~~~

Then re-register the Marketplace from that checkout and reinstall the plugin. To update to latest, rerun the install script.

## License and privacy

[MIT License](LICENSE) · [Privacy](PRIVACY.md)

Thanks for using **Scientific Illustrator**. Author: **A geology PhD**.
