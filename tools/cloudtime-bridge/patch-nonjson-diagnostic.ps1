# Applies the non-JSON diagnostic to C:\cloudtime-bridge\bridge.mjs.
# Backs up first, verifies the match, and refuses to write if it does not find
# exactly one occurrence -- a half-applied edit would be worse than the bug.
$p = 'C:\cloudtime-bridge\bridge.mjs'
if (-not (Test-Path $p)) { throw "Not found: $p" }

$s = Get-Content $p -Raw
if ($s -match 'returned \$\{ctype') { Write-Host "Already patched. Nothing to do."; exit 0 }

$old = @'
  if (!res.ok) {
    throw new Error(`CloudTime ${path} -> HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return res.json();
}
'@ -replace "`r`n", "`n"

$new = @'
  const ctype = res.headers.get("content-type") ?? "";
  const body = await res.text();

  if (!res.ok) {
    throw new Error(`CloudTime ${path} -> HTTP ${res.status}: ${body.slice(0, 300)}`);
  }

  // A 200 carrying HTML is the interesting failure: Vercel's deployment-
  // protection page, an error page served mid-deploy, or a cloudTimeBaseUrl
  // that resolves to the Next.js app shell rather than the API. Left to
  // res.json() all three read as "Unexpected token '<'", which names the
  // symptom and hides every one of the causes.
  if (!ctype.includes("json")) {
    const peek = body.slice(0, 200).replace(/\s+/g, " ").trim();
    throw new Error(
      `CloudTime ${path} -> HTTP ${res.status} returned ${ctype || "no content-type"}, ` +
        `not JSON. Check cloudTimeBaseUrl points at the API host and that the ` +
        `deployment is not behind an access wall. First bytes: ${peek}`,
    );
  }

  try {
    return JSON.parse(body);
  } catch (err) {
    throw new Error(
      `CloudTime ${path} -> HTTP ${res.status} claimed ${ctype} but the body did not ` +
        `parse: ${String(err?.message ?? err)}. First bytes: ${body.slice(0, 200)}`,
    );
  }
}
'@ -replace "`r`n", "`n"

$norm = $s -replace "`r`n", "`n"
$hits = ([regex]::Matches($norm, [regex]::Escape($old))).Count
if ($hits -ne 1) { throw "Expected exactly 1 match, found $hits. Not writing. Patch by hand." }

Copy-Item $p "$p.bak-$(Get-Date -Format yyyyMMdd-HHmmss)" -Force
Set-Content -Path $p -Value ($norm.Replace($old, $new)) -NoNewline -Encoding UTF8

& node --check $p
if ($LASTEXITCODE -ne 0) { throw "Syntax check FAILED - restore from the .bak beside it." }
Write-Host "Patched and syntax-checked. Now: Stop-ScheduledTask CloudTime-wms-bridge; Start-ScheduledTask CloudTime-wms-bridge"
