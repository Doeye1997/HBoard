$ErrorActionPreference = "Stop"
$root = "F:\Project\claude\HBoard\.worktrees\p0-intake"
$env:HBOARD_AS = "hboard-b"
$env:HBOARD_MENTION = "@dddoeye1997-5720/hboard-b"
$env:HBOARD_CHANNEL = "hboard-p0"
$env:HBOARD_PEER = "@dddoeye1997-5720/hboard-a"
& omp `
  --cwd $root `
  --extension "$root\packages\omp-extension\intake.js" `
  --session-dir "$root\.sessions\b" `
  --no-skills `
  --no-context-files `
  --append-system-prompt "You are Board profile hboard-b in one integration test. When a message starts with HBOARD, it is a mention. Reply by running the vercel board reply command written in that message, as hboard-b, with one short sentence. Do not mention hboard-a. Do nothing else."
