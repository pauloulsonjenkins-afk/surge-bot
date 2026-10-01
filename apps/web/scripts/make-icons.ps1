<#
  Draws the app icons in public/icons: a lightning bolt in the accent colour on the app's dark background.
  Run again after changing the design:  powershell -ExecutionPolicy Bypass -File scripts/make-icons.ps1
  (Windows only: it uses .NET's System.Drawing. The PNGs it makes are committed, so the build never needs it.)
#>
Add-Type -AssemblyName System.Drawing

$out = Join-Path $PSScriptRoot "..\public\icons"
New-Item -ItemType Directory -Force -Path $out | Out-Null

$bg = [System.Drawing.ColorTranslator]::FromHtml("#0E1116")
$accent = [System.Drawing.ColorTranslator]::FromHtml("#E8A33D")

# The bolt on a 100 x 100 grid.
$bolt = @(@(58, 6), @(22, 56), @(46, 56), @(38, 94), @(78, 40), @(53, 40), @(62, 6))

function Draw-Icon([int]$size, [string]$file, [double]$scale, [bool]$rounded) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)

  $brush = New-Object System.Drawing.SolidBrush $bg
  if ($rounded) {
    # Rounded square for the plain icon; the platform masks the maskable one itself.
    $r = [int]($size * 0.22)
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddArc(0, 0, $r * 2, $r * 2, 180, 90)
    $path.AddArc($size - $r * 2, 0, $r * 2, $r * 2, 270, 90)
    $path.AddArc($size - $r * 2, $size - $r * 2, $r * 2, $r * 2, 0, 90)
    $path.AddArc(0, $size - $r * 2, $r * 2, $r * 2, 90, 90)
    $path.CloseFigure()
    $g.FillPath($brush, $path)
  } else {
    $g.FillRectangle($brush, 0, 0, $size, $size)
  }

  # Centre the bolt, scaled to $scale of the icon (maskable icons keep it inside the 80% safe zone).
  $span = $size * $scale
  $offset = ($size - $span) / 2
  $points = $bolt | ForEach-Object { New-Object System.Drawing.PointF ([float]($offset + $_[0] / 100 * $span)), ([float]($offset + $_[1] / 100 * $span)) }
  $g.FillPolygon((New-Object System.Drawing.SolidBrush $accent), [System.Drawing.PointF[]]$points)

  $bmp.Save((Join-Path $out $file), [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose()
  $bmp.Dispose()
}

Draw-Icon 192 "icon-192.png" 0.62 $true
Draw-Icon 512 "icon-512.png" 0.62 $true
Draw-Icon 512 "maskable-512.png" 0.5 $false
# iOS adds its own rounded corners and shows a transparent corner as black, so the touch icon is a full square.
Draw-Icon 180 "apple-touch-icon.png" 0.62 $false
Draw-Icon 32 "favicon-32.png" 0.7 $true
Write-Output "Icons written to $out"
