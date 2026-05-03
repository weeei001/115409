# run_refine_best_seeds.ps1
# Purpose:
#   Run seed-based local refinement for Core Mode preset named "最佳".
#   If a meaningful improvement is found, the Python script will save a new preset.
#   It will NOT set the new preset as active.
#
# Usage:
#   Put this file in:
#     C:\Users\imd\Desktop\Fork\115409\backend
#   Then run:
#     powershell -ExecutionPolicy Bypass -File .\run_refine_best_seeds.ps1
#
# Encoding:
#   Save this file as UTF-8 with BOM.

$ErrorActionPreference = "Stop"

# Move to backend directory based on this script location.
Set-Location -Path $PSScriptRoot

# Make imports work from backend root.
$env:PYTHONPATH = "."

# === Basic settings ===
$PresetName = "最佳_seed_20260503_192831"
$Symbol = "2330"
$StartDate = "2024-02-23"
$EndDate = "2026-05-03"

# === Search settings ===
$RefinementLevel = "medium"
$MaxCandidates = 300
$FormalBacktestTopK = 100

# Random seeds for this run.
# Change $SeedCount if you want more or fewer random seeds.
$SeedCount = 10
$Seeds = (1..$SeedCount | ForEach-Object {
  Get-Random -Minimum 1 -Maximum 1000000
}) -join ","

# Conservative default.
# 0.015 = only save when clearly better.
# 0.005 = easier to save small improvements.
$MinImprovement = "0.015"

# === Save behavior ===
# true  = save new preset if meaningful improvement is found
# false = only generate report
$SaveImprovedPreset = "true"

# false = save only the global best candidate across all seeds
# true  = save every seed's improved candidate that passes threshold
$SaveEachImproved = "false"

# false = run all seeds then save global best
# true  = stop immediately when first improvement is found
$StopOnFirstImprovement = "false"

# Name for the saved preset if improvement passes.
# If duplicate exists, the Python script should append seed/timestamp suffix.
$RunStamp = Get-Date -Format "yyyyMMdd_HHmmss"
$ImprovedPresetName = "最佳_seed_$RunStamp"

# === Run ===
Write-Host "Running Core Mode seed-based refinement..."
Write-Host "Preset: $PresetName"
Write-Host "Symbol: $Symbol"
Write-Host "Date range: $StartDate ~ $EndDate"
Write-Host "Seeds: $Seeds"
Write-Host "Min improvement: $MinImprovement"
Write-Host "Save improved preset: $SaveImprovedPreset"
Write-Host ""

python scripts/refine_core_mode_best_preset.py `
  --preset-name $PresetName `
  --symbol $Symbol `
  --start-date $StartDate `
  --end-date $EndDate `
  --refinement-level $RefinementLevel `
  --max-candidates $MaxCandidates `
  --formal-backtest-top-k $FormalBacktestTopK `
  --seeds $Seeds `
  --min-improvement $MinImprovement `
  --improved-preset-name $ImprovedPresetName `
  --save-improved-preset $SaveImprovedPreset `
  --save-each-improved $SaveEachImproved `
  --stop-on-first-improvement $StopOnFirstImprovement `
  --dry-run false

Write-Host ""
Write-Host "Done. Check report files under:"
Write-Host "backend/outputs/core_mode_refinement/"
Write-Host ""
Write-Host "Reminder: saved presets are NOT automatically activated."
