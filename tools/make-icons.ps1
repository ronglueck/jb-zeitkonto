Add-Type -AssemblyName System.Drawing

$iconsDir = "C:\Users\Ron\jb-zeitkonto\icons"

function Draw-AnyIcon {
    param([int]$size, [string]$outPath)

    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit

    # Fill background transparent first
    $g.Clear([System.Drawing.Color]::Transparent)

    # Rounded rectangle parameters
    $radius = [int]($size * 0.22)
    $rect = New-Object System.Drawing.Rectangle(0, 0, $size, $size)

    # Create rounded rectangle path
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $radius * 2
    $path.AddArc($rect.X, $rect.Y, $d, $d, 180, 90)
    $path.AddArc($rect.Right - $d, $rect.Y, $d, $d, 270, 90)
    $path.AddArc($rect.Right - $d, $rect.Bottom - $d, $d, $d, 0, 90)
    $path.AddArc($rect.X, $rect.Bottom - $d, $d, $d, 90, 90)
    $path.CloseFigure()

    # Linear gradient from top-left to bottom-right
    $colorTop = [System.Drawing.ColorTranslator]::FromHtml("#16323a")
    $colorBot = [System.Drawing.ColorTranslator]::FromHtml("#0c161d")
    $gradBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        (New-Object System.Drawing.Point(0, 0)),
        (New-Object System.Drawing.Point($size, $size)),
        $colorTop,
        $colorBot
    )

    $g.FillPath($gradBrush, $path)
    $gradBrush.Dispose()

    # Border: ~10/512 inset, color #caa64a alpha 115
    $borderInset = [int]($size * 10.0 / 512.0)
    $borderWidth = [int]($size * 6.0 / 512.0)
    if ($borderWidth -lt 1) { $borderWidth = 1 }
    $borderAlpha = 115
    $borderColor = [System.Drawing.Color]::FromArgb($borderAlpha, 0xca, 0xa6, 0x4a)
    $borderPen = New-Object System.Drawing.Pen($borderColor, $borderWidth)

    $br = $radius - $borderInset
    if ($br -lt 1) { $br = 1 }
    $innerRect = New-Object System.Drawing.Rectangle($borderInset, $borderInset, ($size - 2 * $borderInset), ($size - 2 * $borderInset))
    $borderPath = New-Object System.Drawing.Drawing2D.GraphicsPath
    $bd = $br * 2
    $borderPath.AddArc($innerRect.X, $innerRect.Y, $bd, $bd, 180, 90)
    $borderPath.AddArc($innerRect.Right - $bd, $innerRect.Y, $bd, $bd, 270, 90)
    $borderPath.AddArc($innerRect.Right - $bd, $innerRect.Bottom - $bd, $bd, $bd, 0, 90)
    $borderPath.AddArc($innerRect.X, $innerRect.Bottom - $bd, $bd, $bd, 90, 90)
    $borderPath.CloseFigure()
    $g.DrawPath($borderPen, $borderPath)
    $borderPen.Dispose()
    $borderPath.Dispose()

    # Text "JB"
    $fontSize = [float]($size * 0.42)
    $font = New-Object System.Drawing.Font("Segoe UI", $fontSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $textColor = [System.Drawing.ColorTranslator]::FromHtml("#caa64a")
    $textBrush = New-Object System.Drawing.SolidBrush($textColor)
    $sf = New-Object System.Drawing.StringFormat
    $sf.Alignment = [System.Drawing.StringAlignment]::Center
    $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
    $drawRect = New-Object System.Drawing.RectangleF(0, 0, $size, $size)
    $g.DrawString("JB", $font, $textBrush, $drawRect, $sf)

    $font.Dispose()
    $textBrush.Dispose()
    $sf.Dispose()
    $path.Dispose()
    $g.Dispose()

    $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Host "Created: $outPath"
}

function Draw-MaskableIcon {
    param([int]$size, [string]$outPath)

    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit

    # Full-bleed gradient — no rounded corners, no transparency, no border
    $colorTop = [System.Drawing.ColorTranslator]::FromHtml("#16323a")
    $colorBot = [System.Drawing.ColorTranslator]::FromHtml("#0c161d")
    $gradBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        (New-Object System.Drawing.Point(0, 0)),
        (New-Object System.Drawing.Point($size, $size)),
        $colorTop,
        $colorBot
    )
    $fullRect = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
    $g.FillRectangle($gradBrush, $fullRect)
    $gradBrush.Dispose()

    # Text "JB" centered, ~0.33 * 512 font size (stays in safe zone)
    $fontSize = [float]($size * 0.33)
    $font = New-Object System.Drawing.Font("Segoe UI", $fontSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $textColor = [System.Drawing.ColorTranslator]::FromHtml("#caa64a")
    $textBrush = New-Object System.Drawing.SolidBrush($textColor)
    $sf = New-Object System.Drawing.StringFormat
    $sf.Alignment = [System.Drawing.StringAlignment]::Center
    $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
    $drawRect = New-Object System.Drawing.RectangleF(0, 0, $size, $size)
    $g.DrawString("JB", $font, $textBrush, $drawRect, $sf)

    $font.Dispose()
    $textBrush.Dispose()
    $sf.Dispose()
    $g.Dispose()

    $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Host "Created: $outPath"
}

# Generate the icons
Draw-AnyIcon -size 192 -outPath "$iconsDir\icon-192.png"
Draw-AnyIcon -size 512 -outPath "$iconsDir\icon-512.png"
Draw-MaskableIcon -size 512 -outPath "$iconsDir\icon-maskable-512.png"

# Browser-Tab-Favicons (gleiches "JB"-Motiv, kleinere Groessen)
Draw-AnyIcon -size 32 -outPath "$iconsDir\favicon-32.png"
Draw-AnyIcon -size 48 -outPath "$iconsDir\favicon-48.png"

Write-Host ""
Write-Host "=== Verification ==="
Add-Type -AssemblyName System.Drawing

$files = @(
    "$iconsDir\icon-192.png",
    "$iconsDir\icon-512.png",
    "$iconsDir\icon-maskable-512.png",
    "$iconsDir\favicon-32.png",
    "$iconsDir\favicon-48.png"
)

foreach ($f in $files) {
    $fi = Get-Item $f
    $img = [System.Drawing.Image]::FromFile($f)
    $w = $img.Width
    $h = $img.Height
    $img.Dispose()
    Write-Host ("  {0}: {1}x{2}, {3} bytes" -f $fi.Name, $w, $h, $fi.Length)
}
