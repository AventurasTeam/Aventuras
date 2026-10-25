<#
  Adds or removes this checkout's Rust build output (src-tauri\target) as a Windows Defender
  real-time scanning exclusion, or lists every exclusion with "Aventuras" in its path. Defender
  scanning freshly written archives makes cargo fail with
  "failed to remove temporary directory ... (os error 32)".

  Only the build output is excluded: sources, node_modules and the cargo registry stay scanned.
  Run from an administrator PowerShell; the path follows this script, not the current folder.

    .\scripts\defender-build-exclusion.ps1 -Action Add
    .\scripts\defender-build-exclusion.ps1 -Action Remove
    .\scripts\defender-build-exclusion.ps1 -Action Scan
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)]
  [ValidateSet('Add', 'Remove', 'Scan')]
  [string]$Action
)

$ErrorActionPreference = 'Stop'

# Reading the exclusions needs an administrator too: otherwise Defender returns a notice in their place.
$principal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Error 'Defender exclusions can only be read or changed from an administrator PowerShell.'
}

# Defender stores the text as given and never resolves a relative path, so it must be absolute.
$target = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\src-tauri\target'))
$exclusions = @((Get-MpPreference).ExclusionPath) | Where-Object { $_ }
$excluded = $exclusions -contains $target

switch ($Action) {
  'Add' {
    if ($excluded) {
      "Already excluded: $target"
    } else {
      Add-MpPreference -ExclusionPath $target
      "Excluded: $target"
    }
  }
  'Remove' {
    if ($excluded) {
      Remove-MpPreference -ExclusionPath $target
      "No longer excluded: $target"
    } else {
      "Was not excluded: $target"
    }
  }
  'Scan' {
    $found = @($exclusions | Where-Object { $_ -like '*Aventuras*' })
    if ($found.Count -eq 0) {
      'No exclusion has "Aventuras" in its path.'
    } else {
      $worktrees = @(git -C $PSScriptRoot worktree list --porcelain |
          Where-Object { $_ -like 'worktree *' } |
          ForEach-Object { [IO.Path]::GetFullPath($_.Substring(9)).TrimEnd('\') })

      # A missing `target` alone only means a clean; a missing checkout is a rule left behind.
      $found | ForEach-Object {
        $root = if ($_ -like '*\src-tauri\target') { Split-Path (Split-Path $_) } else { $_ }
        $rootExists = Test-Path -LiteralPath $root
        $isWorktree = $worktrees -contains $root.TrimEnd('\')
        [pscustomobject]@{
          Path = $_
          Status = if ($isWorktree) { 'live' } elseif ($rootExists) { 'not a worktree' } else { 'left behind' }
          TargetExists = Test-Path -LiteralPath $_
          ThisCheckout = $_ -eq $target
        }
      } | Format-Table -AutoSize -Wrap
    }
  }
}
