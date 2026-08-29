param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$sourcePath = Join-Path $ProjectRoot 'store-assets\AltGrid-Store-300x300.png'
$outputDirectory = Join-Path $ProjectRoot 'store-assets\appx'

if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
  throw "Fonte do ícone da Store não encontrada: $sourcePath"
}

[void](New-Item -ItemType Directory -Force -Path $outputDirectory)
$source = [System.Drawing.Image]::FromFile($sourcePath)

function Save-AltGridAsset {
  param(
    [Parameter(Mandatory)][string]$Name,
    [Parameter(Mandatory)][int]$Width,
    [Parameter(Mandatory)][int]$Height,
    [Parameter(Mandatory)][int]$LogoSize,
    [System.Drawing.Color]$Background = [System.Drawing.Color]::Transparent
  )

  $bitmap = New-Object System.Drawing.Bitmap(
    $Width,
    $Height,
    [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
  )
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.Clear($Background)
    $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceOver
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality

    $x = [int](($Width - $LogoSize) / 2)
    $y = [int](($Height - $LogoSize) / 2)
    $graphics.DrawImage($source, $x, $y, $LogoSize, $LogoSize)

    $destination = Join-Path $outputDirectory $Name
    $bitmap.Save($destination, [System.Drawing.Imaging.ImageFormat]::Png)
    Write-Host "Gerado: $Name ($Width x $Height)"
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}

try {
  Save-AltGridAsset -Name 'StoreLogo.png' -Width 50 -Height 50 -LogoSize 50
  Save-AltGridAsset -Name 'Square44x44Logo.png' -Width 44 -Height 44 -LogoSize 44
  Save-AltGridAsset -Name 'Square150x150Logo.png' -Width 150 -Height 150 -LogoSize 150
  Save-AltGridAsset -Name 'Wide310x150Logo.png' -Width 310 -Height 150 -LogoSize 138
  Save-AltGridAsset -Name 'SmallTile.png' -Width 71 -Height 71 -LogoSize 71
  Save-AltGridAsset -Name 'LargeTile.png' -Width 310 -Height 310 -LogoSize 290
  Save-AltGridAsset -Name 'SplashScreen.png' -Width 620 -Height 300 -LogoSize 220 `
    -Background ([System.Drawing.ColorTranslator]::FromHtml('#07130d'))
} finally {
  $source.Dispose()
}
