# Windows launcher

If `/interpretation` returns `{"error":"Not found"}`, the responding server does
not have the lab route. An older checkout, another app directory, or a server
started before updating can cause this. The custom local server loads its bundle
at startup; pulling changes does not update a running process.

`scripts/Start-Toolkit-Lab.ps1` avoids those existing copies and servers. It:

- Requires Git and Node.js 22 or newer.
- Clones `codex/general-table-extraction` into a unique folder under Documents.
- Installs the locked dependencies and builds the Worker.
- Starts a new local Workers process on an available loopback port.
- Checks both the lab HTML and a scripted interpretation API response.
- Opens the verified address and prints the project path, logs, and stop command.

Download the script, inspect it, and run it in Windows PowerShell. If Windows
blocks the downloaded script, the following permits scripts for this new process
only (it does not change the saved execution policy):

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$HOME\Downloads\Start-Toolkit-Lab.ps1"
```

Use the actual saved path if your Downloads directory is elsewhere. It starts a
background local server; use the specific `Stop-Process -Id ...` command printed
by the launcher when finished. It does not configure automatic restart after a
reboot. Run it again to create another isolated copy, or use `npm.cmd run dev`
from the printed app folder to reuse that copy.

Nothing is deployed, no paid services are enabled, and FantasyBrief is not used.
The launcher does not alter an existing checkout or stop an existing server.
On failure it stops its own new server, retains logs, and exits with status 1.

The app and its browser workflow are verified in the Linux cloud Workers runtime.
The PowerShell launcher still requires a Windows run to establish Windows readiness.


## Feedback survives launcher updates

The launcher starts the local feedback companion. It detects a single Windows Google Drive `My Drive` mount or offers one-time folder selection in the app. Files go in **Web Table Toolkit/feedback**, independently of the freshly downloaded code folder. Configuration stays in `%LOCALAPPDATA%\WebTableToolkit\feedback-storage.json`. Use the same synced root on both computers. The app reports local writes only; confirm actual upload status in Google Drive before switching machines. See [Drive feedback setup and recovery](interpretation-lab.md#automatic-google-drive-feedback-saving).
