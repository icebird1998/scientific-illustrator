param(
  [string]$InstallDir = "$HOME\.claude\marketplaces\scientific-illustrator"
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

if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
  throw "Claude Code CLI was not found. Install or update Claude Code, then run this installer again."
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

$VenvDir = Join-Path $InstallDir "plugins\scientific-illustrator\scripts\.venv"
$PythonLaunchers = @()
if ($env:SCIENTIFIC_ILLUSTRATOR_PYTHON -and (Get-Command $env:SCIENTIFIC_ILLUSTRATOR_PYTHON -ErrorAction SilentlyContinue)) {
  $PythonLaunchers += [pscustomobject]@{ Command = $env:SCIENTIFIC_ILLUSTRATOR_PYTHON; Arguments = @() }
}
if (Test-Path (Join-Path $VenvDir "Scripts\python.exe")) {
  $PythonLaunchers += [pscustomobject]@{ Command = (Join-Path $VenvDir "Scripts\python.exe"); Arguments = @() }
}
foreach ($Name in @("python", "python3", "py")) {
  $Command = Get-Command $Name -ErrorAction SilentlyContinue
  if ($Command) {
    $Arguments = if ($Name -eq "py") { @("-3") } else { @() }
    $PythonLaunchers += [pscustomobject]@{ Command = $Command.Source; Arguments = $Arguments }
  }
}

# Windows PowerShell 5.1 turns redirected native stderr into terminating
# errors under Stop, so relax the preference while probing Python runtimes.
$ErrorActionPreference = "Continue"
$PythonReady = $null
foreach ($Launcher in $PythonLaunchers) {
  $InvocationArguments = @($Launcher.Arguments)
  & $Launcher.Command @InvocationArguments -c "import pptx" 2>$null
  if ($LASTEXITCODE -eq 0) {
    $PythonReady = $Launcher
    break
  }
}

if (-not $PythonReady) {
  $Launcher = $PythonLaunchers | Where-Object {
    $InvocationArguments = @($_.Arguments)
    & $_.Command @InvocationArguments --version 2>$null | Out-Null
    $LASTEXITCODE -eq 0
  } | Select-Object -First 1
  if ($Launcher) {
    $InvocationArguments = @($Launcher.Arguments)
    # Claude Code installs a copy of the plugin into its cache and drops
    # symlinks that point outside the plugin, so the venv needs --copies.
    & $Launcher.Command @InvocationArguments -m venv --copies $VenvDir
    if ($LASTEXITCODE -eq 0) {
      $VenvPython = Join-Path $VenvDir "Scripts\python.exe"
      & $VenvPython -m pip install --disable-pip-version-check "python-pptx>=1.0,<2"
      if ($LASTEXITCODE -eq 0) {
        $PythonReady = [pscustomobject]@{ Command = $VenvPython; Arguments = @() }
      }
    }
  }
}
$ErrorActionPreference = "Stop"

if ($PythonReady) {
  $PythonDisplay = @($PythonReady.Command) + @($PythonReady.Arguments)
  Write-Host "Presentation OOXML backend: $($PythonDisplay -join ' ')"
} else {
  Write-Warning "Python with python-pptx was not found. Windows Microsoft PowerPoint COM remains available, but Windows WPS support requires Python 3 and python-pptx."
}

claude plugin marketplace add $InstallDir
Assert-NativeSuccess "Registering the Scientific Illustrator marketplace"
# Reinstall so Claude Code's cache copy picks up a freshly built venv even
# when the plugin version is unchanged (install/update skip the re-copy).
$ErrorActionPreference = "Continue"
claude plugin uninstall $Plugin 2>$null | Out-Null
$ErrorActionPreference = "Stop"
claude plugin install $Plugin
Assert-NativeSuccess "Installing the Scientific Illustrator plugin"

Write-Host "Installed $Plugin"
Write-Host "Restart Claude Code and start a new session before first use."
Write-Host "Windows PowerPoint uses COM; Windows WPS uses the editable PPTX OOXML backend."
