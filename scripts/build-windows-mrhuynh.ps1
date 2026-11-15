<#
  Build bộ cài Windows của Voice Studio - Mr.Huỳnh ngay trên máy của bạn.

  Cách dùng (mở PowerShell tại thư mục mã nguồn, hoặc bấm đúp BUILD-WINDOWS.bat):
    .\scripts\build-windows-mrhuynh.ps1 -Version 1.0.1 -Notes "Sửa lỗi lồng tiếng; Gói mua dễ nhìn hơn"

  Kết quả nằm trong thư mục upload\ — tải CẢ 4 file lên active.mrhuynh.net/downloads/:
    VoiceStudio-MrHuynh-<phiên bản>-win-x64.exe
    VoiceStudio-MrHuynh-<phiên bản>-win-x64.exe.blockmap
    electron-stable-win32-x64.yml        (upload SAU CÙNG: app khách đọc file này để biết có bản mới)
    voice-studio-source.zip              (mã nguồn theo giấy phép AGPL-3.0)
#>
[CmdletBinding()]
param(
  # Phiên bản mới, dạng 1.0.1. Bỏ trống = giữ phiên bản hiện tại trong package.json.
  [string]$Version,
  # "Có gì mới": các ý cách nhau bằng dấu chấm phẩy. Hoặc dùng -NotesFile.
  [string]$Notes,
  [string]$NotesFile,
  # Bỏ qua bước kiểm tra công cụ (khi bạn chắc chắn đã cài đủ).
  [switch]$SkipChecks
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Step($text) { Write-Host "`n==> $text" -ForegroundColor Cyan }
function Fail($text) { Write-Host "`nLỖI: $text" -ForegroundColor Red; exit 1 }
function Run($exe, [string[]]$arguments) {
  & $exe @arguments
  if ($LASTEXITCODE -ne 0) { Fail "Lệnh thất bại: $exe $($arguments -join ' ')" }
}
function ReadText($path) { [System.IO.File]::ReadAllText((Join-Path $Root $path), $Utf8NoBom) }
function WriteText($path, $text) { [System.IO.File]::WriteAllText((Join-Path $Root $path), $text, $Utf8NoBom) }

if (-not (Test-Path 'package.json') -or -not (Test-Path 'electron\electron-builder.config.mjs')) {
  Fail 'Hãy chạy script từ thư mục mã nguồn Voice Studio - Mr.Huỳnh.'
}

# ── 1. Kiểm tra công cụ ───────────────────────────────────────────────────────
if (-not $SkipChecks) {
  Step 'Kiểm tra công cụ build'
  $missing = @()
  function Has($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }

  if (-not (Has 'node')) { $missing += 'Node.js 22:  winget install OpenJS.NodeJS.LTS  (hoặc tải bản 22 tại nodejs.org)' }
  else {
    $nodeMajor = [int]((node --version).TrimStart('v').Split('.')[0])
    if ($nodeMajor -lt 22) { $missing += "Node.js 22 trở lên (đang có $(node --version)):  winget install OpenJS.NodeJS.LTS" }
  }
  if (-not (Has 'bun')) { $missing += 'Bun 1.4.2:  powershell -c "irm bun.sh/install.ps1 | iex"  rồi mở lại PowerShell' }
  if (-not (Has 'uv')) { $missing += 'uv 0.12.13:  powershell -c "irm https://astral.sh/uv/0.12.13/install.ps1 | iex"' }
  elseif (-not ((uv --version) -match '0\.12\.13')) {
    $missing += "uv đúng bản 0.12.13 (đang có $(uv --version)):  uv self update 0.12.13"
  }
  if (-not (Has 'cargo')) { $missing += 'Rust:  winget install Rustlang.Rustup  rồi mở lại PowerShell' }
  elseif (-not ((rustup target list --installed) -match 'x86_64-pc-windows-msvc')) {
    $missing += 'Rust target MSVC:  rustup target add x86_64-pc-windows-msvc'
  }
  $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
  $vc = if (Test-Path $vswhere) {
    & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
  }
  if (-not $vc) {
    $missing += 'Visual Studio Build Tools (C++):  winget install Microsoft.VisualStudio.2022.BuildTools --override "--quiet --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"'
  }
  if ($missing.Count) {
    Write-Host "`nCòn thiếu công cụ. Chạy các lệnh sau (PowerShell), xong MỞ LẠI PowerShell rồi build lại:" -ForegroundColor Yellow
    $missing | ForEach-Object { Write-Host "  - $_" }
    exit 1
  }
  Write-Host 'Đủ công cụ.' -ForegroundColor Green
}

# ── 2. Phiên bản ──────────────────────────────────────────────────────────────
$package = ReadText 'package.json'
$current = [regex]::Match($package, '"version":\s*"([^"]+)"').Groups[1].Value
if ($Version) {
  if ($Version -notmatch '^\d+\.\d+\.\d+$') { Fail 'Phiên bản phải có dạng 1.0.1' }
  $cv = [version]$current; $nv = [version]$Version
  if ($nv -lt $cv) { Fail "Phiên bản mới ($Version) thấp hơn bản hiện tại ($current): app khách sẽ không nhận." }
  Step "Đổi phiên bản $current -> $Version"
  WriteText 'package.json' ([regex]::Replace($package, '("version":\s*")[^"]+(")', "`${1}$Version`${2}", 1))
  $py = ReadText 'pyproject.toml'
  WriteText 'pyproject.toml' ([regex]::Replace($py, '(?m)^(version\s*=\s*")[^"]+(")', "`${1}$Version`${2}", 1))
  $lock = ReadText 'uv.lock'
  WriteText 'uv.lock' ([regex]::Replace($lock, '(name = "omnivoice"\r?\nversion = ")[^"]+(")', "`${1}$Version`${2}", 1))
  $vpy = ReadText 'backend\core\version.py'
  WriteText 'backend\core\version.py' ([regex]::Replace($vpy, '(_FALLBACK_VERSION = ")[^"]+(")', "`${1}$Version`${2}", 1))
} else {
  $Version = $current
  Write-Host "Giữ phiên bản $Version (thêm -Version 1.0.1 để lên bản mới)." -ForegroundColor Yellow
}

# ── 3. Ghi chú phát hành ("Có gì mới") ────────────────────────────────────────
Remove-Item Env:VSMH_RELEASE_NOTES_FILE -ErrorAction SilentlyContinue
if ($Notes) {
  $NotesFile = Join-Path $env:TEMP "vsmh-release-notes-$Version.md"
  $lines = $Notes -split ';' | ForEach-Object { $_.Trim() } | Where-Object { $_ } | ForEach-Object { "- $_" }
  [System.IO.File]::WriteAllText($NotesFile, ($lines -join "`n"), $Utf8NoBom)
}
if ($NotesFile) {
  if (-not (Test-Path $NotesFile)) { Fail "Không thấy file ghi chú: $NotesFile" }
  $env:VSMH_RELEASE_NOTES_FILE = (Resolve-Path $NotesFile).Path
}

# ── 4. Build ──────────────────────────────────────────────────────────────────
$env:VOICESTUDIO_RUST_TARGET = 'x86_64-pc-windows-msvc'
$env:VOICESTUDIO_UPDATE_CHANNEL = 'electron-stable-win32-x64'
$env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'

Step 'Cài thư viện (bun install)'
Run 'bun' @('install', '--frozen-lockfile')

Step 'Đóng gói uv vào bộ cài'
Run 'node' @('electron/scripts/stage-bundled-uv.mjs')

Step 'Build giao diện'
Run 'bun' @('run', '--cwd', 'electron', 'build')
Run 'bun' @('run', '--cwd', 'electron', 'build:web')

Step 'Tạo bộ cài .exe (lần đầu mất 10-20 phút vì phải biên dịch Rust)'
Remove-Item 'electron\release' -Recurse -Force -ErrorAction SilentlyContinue
Push-Location electron
try { Run 'bun' @('x', 'electron-builder', '--config', 'electron-builder.config.mjs', '--win', '--x64', '--publish', 'never') }
finally { Pop-Location }

# ── 5. Gom file để upload ─────────────────────────────────────────────────────
Step 'Gom file vào thư mục upload\'
$upload = Join-Path $Root 'upload'
Remove-Item $upload -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory $upload | Out-Null
$exe = "VoiceStudio-MrHuynh-$Version-win-x64.exe"
foreach ($name in @($exe, "$exe.blockmap", 'electron-stable-win32-x64.yml')) {
  $src = Join-Path 'electron\release' $name
  if (-not (Test-Path $src)) { Fail "Build không tạo ra $name (xem thư mục electron\release)." }
  Copy-Item $src $upload
}
$yml = Get-Content (Join-Path $upload 'electron-stable-win32-x64.yml') -Raw
if ($yml -notmatch "version:\s*$([regex]::Escape($Version))") { Fail 'File .yml không khớp phiên bản vừa build.' }

Step 'Nén mã nguồn (AGPL-3.0)'
$zip = Join-Path $upload 'voice-studio-source.zip'
$excludes = @(
  'node_modules', '.git', 'upload', 'electron/release', 'electron/out', 'electron/build/uv',
  'electron/build/omnivoice-tts', 'frontend/dist', 'target', '.venv', '__pycache__',
  # Không bao giờ đưa bí mật vào file công khai.
  'server/active_private/voice_studio2/config.php', '*.sqlite', '*.pem', '*private*.key', 'keygen_config.json'
)
$tarArgs = @('-a', '-c', '-f', $zip) + ($excludes | ForEach-Object { "--exclude=$_" }) + @('.')
Run 'tar.exe' $tarArgs

$size = [math]::Round((Get-Item (Join-Path $upload $exe)).Length / 1MB)
Write-Host "`nXONG! Bản $Version ($size MB) nằm trong: $upload" -ForegroundColor Green
Write-Host @"

Tải lên active.mrhuynh.net/downloads/ theo đúng thứ tự (ghi đè file cũ cùng tên):
  1. $exe
  2. $exe.blockmap
  3. voice-studio-source.zip
  4. electron-stable-win32-x64.yml   <- cuối cùng
App của khách sẽ tự thấy bản $Version, tự tải và hỏi "Khởi động lại để cài".
Muốn ép mọi người phải cập nhật: vào trang quản trị -> Phát hành -> nhập $Version -> Lưu.
"@
if ($env:VSMH_NO_OPEN -ne '1') { Start-Process explorer.exe $upload }
