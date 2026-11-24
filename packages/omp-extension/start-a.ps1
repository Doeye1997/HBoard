$ErrorActionPreference = "Stop"
$root = "F:\Project\claude\HBoard\.worktrees\p0-intake"
$env:HBOARD_AS = "hboard-a"
$env:HBOARD_MENTION = "@dddoeye1997-5720/hboard-a"
$env:HBOARD_CHANNEL = "hboard-p0"
$env:HBOARD_PEER = "@dddoeye1997-5720/hboard-b"
& omp `
  --cwd $root `
  --extension "$root\packages\omp-extension\intake.js" `
  --session-dir "$root\.sessions\a" `
  --no-skills `
  --no-context-files `
  --append-system-prompt "You are Board profile hboard-a in one integration test. When a message starts with HBOARD, it is a mention. Reply by running the vercel board reply command written in that message, as hboard-a, with one short sentence. If the Board text asks you to wake hboard-b, include @dddoeye1997-5720/hboard-b in the reply. Do not mention yourself. Do nothing else."
