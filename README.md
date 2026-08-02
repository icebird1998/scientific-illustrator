# Scientific Illustrator

把参考图上传给 Codex，插件会在 **Microsoft PowerPoint、WPS 演示或 draw.io** 中尽量用可编辑对象重新绘制，并自动检查和修正。

**作者：科研 up 主「进击的土博」**

GitHub：[@icebird1998](https://github.com/icebird1998)

当前版本：[v1.5.3](https://github.com/icebird1998/scientific-illustrator/releases/tag/v1.5.3)

本项目是 [drawio-scientific-illustrator](https://github.com/icebird1998/drawio-scientific-illustrator) 的升级整合版，后续功能只在本项目更新。

## 第一次使用：只需 3 步

### 第 1 步：安装插件

把下面这段话完整发送给 Codex：

~~~text
请安装 https://github.com/icebird1998/scientific-illustrator。
把仓库根目录注册为 Codex Marketplace，然后安装
scientific-illustrator@scientific-illustrator-tools。完成后提醒我重启 Codex。
~~~

### 第 2 步：重启 Codex

安装完成后：

1. 完全退出并重新打开 Codex；
2. 新建一个任务；
3. 打开准备使用的 PowerPoint、WPS 演示或 draw.io Desktop。

### 第 3 步：上传图片并复制提示词

把参考图上传到 Codex，然后从下方选择与你的软件对应的提示词，**整段复制发送**即可。

## 支持哪些平台和软件

| 软件 | Windows | macOS | 使用方式与结果 |
|---|---|---|---|
| Microsoft PowerPoint | 支持 | 支持 | 绘制为可编辑 PPTX；Windows 可实时绘制，Mac 可选择普通模式或实时加载项模式 |
| WPS 演示 | 支持 | 支持 | 绘制为可编辑 PPTX 工作副本；默认按检查点后台刷新，不会持续抢占窗口 |
| draw.io Desktop | 支持 | 支持 | 直接控制 draw.io 画布，保存可编辑 .drawio 并导出预览图 |

默认情况下，PowerPoint 和 WPS 会在后台绘制，你可以继续使用电脑。WPS 使用可编辑 PPTX 工作副本，不会假装已经连接任意未保存的当前窗口；macOS 会验证文件是否真的由 WPS 打开，Windows 无法验证时会明确显示“未知”。draw.io 不认识的图形名会直接报错，不会悄悄退化成矩形。显微照片、复杂纹理等确实无法用形状还原的内容，只会把最小必要区域作为图片插入，其余文字、箭头和边框仍保持可编辑。

每次更新都会在 Ubuntu、macOS 和 Windows 上运行代码、MCP、Python、PowerShell、路径发现与 OOXML 回归测试。本版另在真实 Mac 上验证了 PowerPoint 精确打开/刷新/关闭、WPS 指定文件打开和 draw.io 实时画布；GitHub 公共测试机没有商业版 PowerPoint/WPS，因此 Windows 的应用内联调必须由安装后的状态工具确认，不能把模拟测试当成实机连接成功。

## 直接复制使用

### 使用 Microsoft PowerPoint

先打开 PowerPoint 并上传参考图，然后复制：

~~~text
[@scientific-illustrator](plugin://scientific-illustrator@scientific-illustrator-tools)
使用 Scientific Illustrator，在当前 Microsoft PowerPoint 中复刻我上传的参考图。
先连接 PowerPoint，检查状态、可用能力、backend 和当前幻灯片；如果没有演示文稿就新建。
只有 COM 或 officejs-context-sync 才能声称连接当前窗口；如果使用 OOXML，明确说明正在编辑工作副本。
默认在后台绘制，不要反复抢占窗口。优先使用可编辑的文字、形状、连接线、表格和图表。
只有无法可靠绘制的最小区域，例如显微照片或复杂纹理，才裁剪为图片插入。
按区域逐步绘制，每完成一个区域就检查结构和预览图，有问题先修正再继续。
完成后做全图对比检查，保存 PPTX 并导出最终预览图。
~~~

### 使用 WPS 演示

先打开 WPS 演示并上传参考图，然后复制：

~~~text
[@scientific-illustrator](plugin://scientific-illustrator@scientific-illustrator-tools)
使用 Scientific Illustrator，在 WPS 演示中复刻我上传的参考图。
请将 host_application 明确设为 wps，不要连接 Microsoft PowerPoint；先检查状态和可用能力，
确认 target_application=wps 且 microsoft_powerpoint_used=false。如果没有指定要编辑的 PPTX 路径，
就新建一个 WPS 可编辑工作副本，不要声称已连接任意未保存的当前窗口。默认在后台按检查点绘制。
优先使用可编辑的文字、形状、连接线、表格和图表。只有无法可靠绘制的最小区域，
例如显微照片或复杂纹理，才裁剪为图片插入。按区域逐步绘制；每个区域完成后调用刷新，
分别检查 open_dispatched、document_open_verified 和 refresh_verified，有问题先修正。
完成后做全图对比检查，保存 PPTX 并导出最终预览图。
~~~

### 使用 draw.io

先安装并打开 [draw.io Desktop](https://www.drawio.com/)，上传参考图，然后复制：

~~~text
[@scientific-illustrator](plugin://scientific-illustrator@scientific-illustrator-tools)
使用 Scientific Illustrator，连接实时 draw.io 画布并复刻我上传的参考图。
优先使用可编辑的文字、图形、连接线、表格、图表和分组对象。
只有无法可靠绘制的最小区域，例如显微照片或复杂纹理，才裁剪为图片插入。
按区域逐步绘制，每完成一个区域就检查结构和画布截图，有问题先修正再继续。
完成后做全图对比检查，保存可编辑 .drawio，并导出宽度为 2000 px 的 PNG 预览图。
~~~

如果第一行插件命令没有被识别，请在 Codex 输入框的插件菜单中选择 **Scientific Illustrator**，再发送后面的提示词。

如果想让 PowerPoint 或 WPS 一直显示在最前面观看绘制过程，在提示词最后加一句：

~~~text
绘制期间请将 focus_policy 设置为 foreground，让演示文稿保持在前台。
~~~

## 其他安装方式

大多数用户使用上面的“让 Codex 安装”即可。也可以直接运行安装脚本。

### Windows

~~~powershell
$p="$env:TEMP\scientific-illustrator-install.ps1"; Invoke-WebRequest https://raw.githubusercontent.com/icebird1998/scientific-illustrator/main/install.ps1 -OutFile $p; powershell -ExecutionPolicy Bypass -File $p
~~~

### macOS / Linux

~~~bash
curl -fsSL https://raw.githubusercontent.com/icebird1998/scientific-illustrator/main/install.sh | bash
~~~

### 手动安装

~~~bash
git clone https://github.com/icebird1998/scientific-illustrator.git
cd scientific-illustrator
codex plugin marketplace add "$(pwd)"
codex plugin add scientific-illustrator@scientific-illustrator-tools
~~~

安装或更新后，都要重启 Codex 并新建任务。

<details>
<summary><strong>Mac PowerPoint：启用逐对象实时绘制（可选）</strong></summary>

普通安装已经可以生成可编辑 PPTX。只有想在 Mac PowerPoint 中观看逐对象实时绘制时，才需要完成本节。

在仓库目录运行：

~~~bash
node plugins/scientific-illustrator/scripts/officejs-setup.mjs prepare
openssl x509 -in "$HOME/.codex/scientific-illustrator/officejs/localhost.crt" -text -noout
node plugins/scientific-illustrator/scripts/officejs-setup.mjs sideload
~~~

然后：

1. 在 macOS“钥匙串访问”中检查并手动信任 localhost 证书；
2. 重启 PowerPoint；
3. 在“插入 → 我的加载项”中打开 **Scientific Illustrator Live**；
4. 保持任务窗格开启，确认 powerpoint_officejs_status 显示 connected=true。

插件不会自动修改系统证书信任。

</details>

## 不使用 Codex：纯 CLI 使用（sci-illu）

Codex 用户通过 MCP 工具使用本插件。**不使用 Codex 的 agent（pi、Claude Code、Cursor、Windsurf）以及纯命令行用户**，可以使用同名的 `sci-illu` CLI——每个子命令与一个 MCP 工具一一对应，参数形态完全一致。

### 安装

`install.sh` / `install.ps1` 会自动把 `sci-illu` 加入 PATH（可用 `SCI_ILLU_BIN_DIR` 指定目录）。也可以手动软链：

~~~bash
ln -s "$PWD/plugins/scientific-illustrator/scripts/cli.mjs" ~/.local/bin/sci-illu
~~~

### 用法

~~~bash
sci-illu <group> <tool> [flags]
# group: file（draw.io 文件工具）| live（draw.io 实时画布）| ppt（PowerPoint / WPS）
# 工具名支持 kebab-case（add-shape）或原始 MCP 名（drawio_live_add_shape）
~~~

命令示例：

~~~bash
# draw.io 实时绘制（draw.io Desktop 需已安装）
sci-illu live launch
sci-illu live add-shape --json '{"label":"box","shape":"rectangle","x":40,"y":40,"width":120,"height":60}'
sci-illu live screenshot --output /tmp/figure.png
sci-illu live audit-figure
sci-illu live save-snapshot --json '{"output_path":"/tmp/figure.drawio"}'

# draw.io 文件工具：创建、校验、导出
sci-illu file create-diagram --json '{"output_path":"/tmp/f.drawio","workflow_context":"explicit-file-only-request"}'
sci-illu file validate --json '{"input_path":"/tmp/f.drawio"}'
sci-illu file export --json '{"input_path":"/tmp/f.drawio","format":"png"}'

# PowerPoint / WPS（Linux 也可用 OOXML 后端生成可编辑 PPTX，需 python-pptx）
sci-illu ppt status --backend ooxml
sci-illu ppt add-shape --backend ooxml --json '{"slide_index":1,"shape_type":"rectangle","left":72,"top":72,"width":144,"height":72,"fill_color":"#F08705","text":"label"}'
sci-illu ppt export-slide-image --backend ooxml --json '{"slide_index":1,"output_path":"/tmp/slide.png"}'
sci-illu ppt save --backend ooxml --json '{"output_path":"/tmp/final.pptx"}'
~~~

输出约定：stdout 始终是单个 JSON（`ok` / `tool` / `result` / `images`）；成功退出码 0，工具失败 1，用法错误 2；截图等图片会写入文件（`--output` 指定路径）并在结果中报告路径。Mac PowerPoint 实时绘制的 Office.js 后端需要常驻桥，`sci-illu` 会自动管理守护进程（`sci-illu ppt serve` / `ppt stop`）。

完整命令参考见 skill `sci-illu-cli`（仓库内 `plugins/scientific-illustrator/skills/sci-illu-cli/SKILL.md`），或在任意目录运行 `sci-illu help`。

## 版本更新

| 版本 | 主要变化 |
|---|---|
| [v1.6.0](#) | 新增 `sci-illu` 纯 CLI 前端（Codex MCP 能力对 pi/Claude Code/Cursor 等 agent 与命令行可用）；Linux 全平台支持 draw.io 文件与实时画布；技能补充 CLI 映射与参考；新增 CLI 冒烟测试 |
| [v1.5.3](https://github.com/icebird1998/scientific-illustrator/releases/tag/v1.5.3) | 修复双平台三软件兼容、连接状态和表格/图表/箭头更新；增加三平台 CI、真实打开验证及 draw.io 防伪形状检查 |
| [v1.5.2](https://github.com/icebird1998/scientific-illustrator/releases/tag/v1.5.2) | 修复 Mac PowerPoint 实时加载项的图标格式，避免加载项被静默忽略 |
| [v1.5.1](https://github.com/icebird1998/scientific-illustrator/releases/tag/v1.5.1) | 修复 PowerPoint/WPS 反复抢占窗口；默认可在后台绘制 |
| [v1.5.0](https://github.com/icebird1998/scientific-illustrator/releases/tag/v1.5.0) | 支持 Windows/macOS 下的 PowerPoint、WPS、draw.io，并加入 Mac PowerPoint 实时模式 |
| [v1.3.0](https://github.com/icebird1998/scientific-illustrator/releases/tag/v1.3.0) | 首个公开版本，支持 Windows PowerPoint 和 draw.io |

旧版本不会被覆盖。需要回退时：

~~~bash
git fetch --tags
git checkout v1.5.0
~~~

然后从该目录重新注册 Marketplace 并安装插件。更新到最新版时重新运行安装脚本即可。

## 许可证与隐私

[MIT License](LICENSE) · [隐私说明](PRIVACY.md)

感谢使用 **Scientific Illustrator**。制作者：**进击的土博**。
