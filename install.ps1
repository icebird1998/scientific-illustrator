param(
  [string]$InstallDir = "$HOME\.codex\marketplaces\scientific-illustrator"
)

$ErrorActionPreference = "Stop"
$Repository = "https://github.com/icebird1998/scientific-illustrator.git"
$Plugin = "scientific-illustrator@scientific-illustrator-tools"

function Assert-NativeSuccess {
  param([string]$Action)
  if ($LASTEXITCODE -ne 0) {
    throw "$Action failed with exit code $LASTEXITCODE."
  }
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  throw "Git is required. Install Git for Windows, then run this installer again."
}

if (-not (Get-Command codex -ErrorAction SilentlyContinue)) {
  throw "Codex CLI was not found. Install or update the Codex app/CLI, then run this installer again."
}

if (Test-Path (Join-Path $InstallDir ".git")) {
  git -C $InstallDir pull --ff-only
  Assert-NativeSuccess "Updating the Scientific Illustrator repository"
} elseif (Test-Path $InstallDir) {
  throw "Install directory exists but is not this Git repository: $InstallDir"
} else {
  New-Item -ItemType Directory -Force -Path (Split-Path $InstallDir -Parent) | Out-Null
  git clone $Repository $InstallDir
  Assert-NativeSuccess "Cloning the Scientific Illustrator repository"
}

$PythonLaunchers = @()
if ($env:SCIENTIFIC_ILLUSTRATOR_PYTHON) {
  $PythonLaunchers += [pscustomobject]@{ Command = $env:SCIENTIFIC_ILLUSTRATOR_PYTHON; Arguments = @() }
}
foreach ($BundledPython in @(
  (Join-Path $HOME ".cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"),
  (Join-Path $HOME ".cache\codex-runtimes\codex-primary-runtime\dependencies\python\bin\python.exe"),
  (Join-Path $HOME ".cache\codex-runtimes\codex-primary-runtime\dependencies\python\bin\python3.exe")
)) {
  if (Test-Path $BundledPython) {
    $PythonLaunchers += [pscustomobject]@{ Command = $BundledPython; Arguments = @() }
  }
}
foreach ($Name in @("python", "python3", "py")) {
  $Command = Get-Command $Name -ErrorAction SilentlyContinue
  if ($Command) {
    $Arguments = if ($Name -eq "py") { @("-3") } else { @() }
    $PythonLaunchers += [pscustomobject]@{ Command = $Command.Source; Arguments = $Arguments }
  }
}

$PythonReady = $null
foreach ($Launcher in $PythonLaunchers) {
  $InvocationArguments = @($Launcher.Arguments)
  & $Launcher.Command @InvocationArguments -c "import pptx" 2>$null
  if ($LASTEXITCODE -eq 0) {
    $PythonReady = $Launcher
    break
  }
}

if (-not $PythonReady -and $PythonLaunchers.Count -gt 0) {
  $Launcher = $PythonLaunchers[0]
  $InvocationArguments = @($Launcher.Arguments)
  $VenvDir = Join-Path $InstallDir "plugins\scientific-illustrator\scripts\.venv"
  & $Launcher.Command @InvocationArguments -m venv $VenvDir
  Assert-NativeSuccess "Creating the Scientific Illustrator Python environment"
  $VenvPython = Join-Path $VenvDir "Scripts\python.exe"
  & $VenvPython -m pip install --disable-pip-version-check "python-pptx>=1.0,<2"
  Assert-NativeSuccess "Installing python-pptx"
  $PythonReady = [pscustomobject]@{ Command = $VenvPython; Arguments = @() }
}

if ($PythonReady) {
  $PythonDisplay = @($PythonReady.Command) + @($PythonReady.Arguments)
  Write-Host "Presentation OOXML backend: $($PythonDisplay -join ' ')"
} else {
  Write-Warning "Python with python-pptx was not found. Windows Microsoft PowerPoint COM remains available, but Windows WPS support requires Python 3 and python-pptx."
}

codex plugin marketplace add $InstallDir
Assert-NativeSuccess "Registering the Scientific Illustrator marketplace"
codex plugin add $Plugin
Assert-NativeSuccess "Installing the Scientific Illustrator plugin"

# Install the sci-illu CLI shim so any agent or terminal can use it.
$BinDir = if ($env:SCI_ILLU_BIN_DIR) { $env:SCI_ILLU_BIN_DIR } else { Join-Path $HOME ".local\bin" }
New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
$CliShim = Join-Path $BinDir "sci-illu.cmd"
$CliPath = Join-Path $InstallDir "plugins\scientific-illustrator\scripts\cli.mjs"
if (Test-Path $CliShim) {
  Write-Host "sci-illu CLI: $CliShim already exists."
} else {
  Set-Content -Path $CliShim -Value "@echo off`r`nnode `"$CliPath`" %*`r`n" -Encoding ASCII
  Write-Host "sci-illu CLI: $CliShim"
  if ($env:PATH -notlike "*$BinDir*") {
    Write-Host "Add $BinDir to PATH if it is not already there."
  }
}

Write-Host "Installed $Plugin"
Write-Host "Restart Codex and start a new task before first use."
Write-Host "Windows PowerPoint uses COM; Windows WPS uses the editable PPTX OOXML backend."
