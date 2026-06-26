halyana@halyana-dev-rig:/opt/dev-local/Backlogger$ docker compose logs -f backlogger
backlogger-1  | ◇ injected env (0) from ../.env // tip: ⌘ suppress logs { quiet: true }
backlogger-1  | [backlogger] templates loaded=6 skipped=0
backlogger-1  | node:internal/fs/watchers:247
backlogger-1  |     const error = new UVException({
backlogger-1  |                   ^
backlogger-1  | 
backlogger-1  | Error: ENOSPC: System limit for number of file watchers reached, watch '/app/data/projects/home-system/archived/phases/p3/blocks/10_phase3_testing_ci.md'
backlogger-1  |     at FSWatcher.<computed> (node:internal/fs/watchers:247:19)
backlogger-1  |     at watch (node:fs:2503:36)
backlogger-1  |     at createFsWatchInstance (file:///app/node_modules/chokidar/handler.js:126:16)
backlogger-1  |     at setFsWatchListener (file:///app/node_modules/chokidar/handler.js:171:19)
backlogger-1  |     at NodeFsHandler._watchWithNodeFs (file:///app/node_modules/chokidar/handler.js:327:22)
backlogger-1  |     at NodeFsHandler._handleFile (file:///app/node_modules/chokidar/handler.js:393:29)
backlogger-1  |     at NodeFsHandler._addToNodeFs (file:///app/node_modules/chokidar/handler.js:618:31)
backlogger-1  | Emitted 'error' event on FSWatcher instance at:
backlogger-1  |     at FSWatcher._handleError (file:///app/node_modules/chokidar/index.js:558:18)
backlogger-1  |     at NodeFsHandler._addToNodeFs (file:///app/node_modules/chokidar/handler.js:626:26) {
backlogger-1  |   errno: -28,
backlogger-1  |   syscall: 'watch',
backlogger-1  |   code: 'ENOSPC',
backlogger-1  |   path: '/app/data/projects/home-system/archived/phases/p3/blocks/10_phase3_testing_ci.md',
backlogger-1  |   filename: '/app/data/projects/home-system/archived/phases/p3/blocks/10_phase3_testing_ci.md'
backlogger-1  | }
backlogger-1  | 
backlogger-1  | Node.js v20.20.2
backlogger-1  | ◇ injected env (0) from ../.env // tip: ⌘ override existing { override: true }
backlogger-1  | [backlogger] templates loaded=6 skipped=0
backlogger-1  | node:internal/fs/watchers:247
backlogger-1  |     const error = new UVException({
backlogger-1  |                   ^
backlogger-1  | 
backlogger-1  | Error: ENOSPC: System limit for number of file watchers reached, watch '/app/data/projects/home-system/archived/phases/p3/blocks/10_phase3_testing_ci.md'
backlogger-1  |     at FSWatcher.<computed> (node:internal/fs/watchers:247:19)
backlogger-1  |     at watch (node:fs:2503:36)
backlogger-1  |     at createFsWatchInstance (file:///app/node_modules/chokidar/handler.js:126:16)
backlogger-1  |     at setFsWatchListener (file:///app/node_modules/chokidar/handler.js:171:19)
backlogger-1  |     at NodeFsHandler._watchWithNodeFs (file:///app/node_modules/chokidar/handler.js:327:22)
backlogger-1  |     at NodeFsHandler._handleFile (file:///app/node_modules/chokidar/handler.js:393:29)
backlogger-1  |     at NodeFsHandler._addToNodeFs (file:///app/node_modules/chokidar/handler.js:618:31)
backlogger-1  | Emitted 'error' event on FSWatcher instance at:
backlogger-1  |     at FSWatcher._handleError (file:///app/node_modules/chokidar/index.js:558:18)
backlogger-1  |     at NodeFsHandler._addToNodeFs (file:///app/node_modules/chokidar/handler.js:626:26) {
backlogger-1  |   errno: -28,
backlogger-1  |   syscall: 'watch',
backlogger-1  |   code: 'ENOSPC',
backlogger-1  |   path: '/app/data/projects/home-system/archived/phases/p3/blocks/10_phase3_testing_ci.md',
backlogger-1  |   filename: '/app/data/projects/home-system/archived/phases/p3/blocks/10_phase3_testing_ci.md'
backlogger-1  | }
backlogger-1  | 
backlogger-1  | Node.js v20.20.2
backlogger-1  | ◇ injected env (0) from ../.env // tip: ⌘ custom filepath { path: '/custom/path/.env' }
backlogger-1  | [backlogger] templates loaded=6 skipped=0
backlogger-1  | node:internal/fs/watchers:247
backlogger-1  |     const error = new UVException({
backlogger-1  |                   ^
backlogger-1  | 
backlogger-1  | Error: ENOSPC: System limit for number of file watchers reached, watch '/app/data/projects/home-system/archived/phases/p3/blocks/10_phase3_testing_ci.md'
backlogger-1  |     at FSWatcher.<computed> (node:internal/fs/watchers:247:19)
backlogger-1  |     at watch (node:fs:2503:36)
backlogger-1  |     at createFsWatchInstance (file:///app/node_modules/chokidar/handler.js:126:16)
backlogger-1  |     at setFsWatchListener (file:///app/node_modules/chokidar/handler.js:171:19)
backlogger-1  |     at NodeFsHandler._watchWithNodeFs (file:///app/node_modules/chokidar/handler.js:327:22)
backlogger-1  |     at NodeFsHandler._handleFile (file:///app/node_modules/chokidar/handler.js:393:29)
backlogger-1  |     at NodeFsHandler._addToNodeFs (file:///app/node_modules/chokidar/handler.js:618:31)
backlogger-1  | Emitted 'error' event on FSWatcher instance at:
backlogger-1  |     at FSWatcher._handleError (file:///app/node_modules/chokidar/index.js:558:18)
backlogger-1  |     at NodeFsHandler._addToNodeFs (file:///app/node_modules/chokidar/handler.js:626:26) {
backlogger-1  |   errno: -28,
backlogger-1  |   syscall: 'watch',
backlogger-1  |   code: 'ENOSPC',
backlogger-1  |   path: '/app/data/projects/home-system/archived/phases/p3/blocks/10_phase3_testing_ci.md',
backlogger-1  |   filename: '/app/data/projects/home-system/archived/phases/p3/blocks/10_phase3_testing_ci.md'
backlogger-1  | }
backlogger-1  | 
backlogger-1  | Node.js v20.20.2
backlogger-1  | ◇ injected env (0) from ../.env // tip: ◈ encrypted .env [www.dotenvx.com]
backlogger-1  | [backlogger] templates loaded=6 skipped=0
backlogger-1  | node:internal/fs/watchers:247
backlogger-1  |     const error = new UVException({
backlogger-1  |                   ^
backlogger-1  | 
backlogger-1  | Error: ENOSPC: System limit for number of file watchers reached, watch '/app/data/projects/home-system/archived/phases/p3/blocks/10_phase3_testing_ci.md'
backlogger-1  |     at FSWatcher.<computed> (node:internal/fs/watchers:247:19)
backlogger-1  |     at watch (node:fs:2503:36)
backlogger-1  |     at createFsWatchInstance (file:///app/node_modules/chokidar/handler.js:126:16)
backlogger-1  |     at setFsWatchListener (file:///app/node_modules/chokidar/handler.js:171:19)
backlogger-1  |     at NodeFsHandler._watchWithNodeFs (file:///app/node_modules/chokidar/handler.js:327:22)
backlogger-1  |     at NodeFsHandler._handleFile (file:///app/node_modules/chokidar/handler.js:393:29)
backlogger-1  |     at NodeFsHandler._addToNodeFs (file:///app/node_modules/chokidar/handler.js:618:31)
backlogger-1  | Emitted 'error' event on FSWatcher instance at:
backlogger-1  |     at FSWatcher._handleError (file:///app/node_modules/chokidar/index.js:558:18)
backlogger-1  |     at NodeFsHandler._addToNodeFs (file:///app/node_modules/chokidar/handler.js:626:26) {
backlogger-1  |   errno: -28,
backlogger-1  |   syscall: 'watch',
backlogger-1  |   code: 'ENOSPC',
backlogger-1  |   path: '/app/data/projects/home-system/archived/phases/p3/blocks/10_phase3_testing_ci.md',
backlogger-1  |   filename: '/app/data/projects/home-system/archived/phases/p3/blocks/10_phase3_testing_ci.md'
backlogger-1  | }
backlogger-1  | 
backlogger-1  | Node.js v20.20.2
backlogger-1  | ◇ injected env (0) from ../.env // tip: ⌘ suppress logs { quiet: true }
backlogger-1  | [backlogger] templates loaded=6 skipped=0
backlogger-1  | node:internal/fs/watchers:247
backlogger-1  |     const error = new UVException({
backlogger-1  |                   ^
backlogger-1  | 
backlogger-1  | Error: ENOSPC: System limit for number of file watchers reached, watch '/app/data/projects/home-system/archived/phases/p3/blocks/10_phase3_testing_ci.md'
backlogger-1  |     at FSWatcher.<computed> (node:internal/fs/watchers:247:19)
backlogger-1  |     at watch (node:fs:2503:36)
backlogger-1  |     at createFsWatchInstance (file:///app/node_modules/chokidar/handler.js:126:16)
backlogger-1  |     at setFsWatchListener (file:///app/node_modules/chokidar/handler.js:171:19)
backlogger-1  |     at NodeFsHandler._watchWithNodeFs (file:///app/node_modules/chokidar/handler.js:327:22)
backlogger-1  |     at NodeFsHandler._handleFile (file:///app/node_modules/chokidar/handler.js:393:29)
backlogger-1  |     at NodeFsHandler._addToNodeFs (file:///app/node_modules/chokidar/handler.js:618:31)
backlogger-1  | Emitted 'error' event on FSWatcher instance at:
backlogger-1  |     at FSWatcher._handleError (file:///app/node_modules/chokidar/index.js:558:18)
backlogger-1  |     at NodeFsHandler._addToNodeFs (file:///app/node_modules/chokidar/handler.js:626:26) {
backlogger-1  |   errno: -28,
backlogger-1  |   syscall: 'watch',
backlogger-1  |   code: 'ENOSPC',
backlogger-1  |   path: '/app/data/projects/home-system/archived/phases/p3/blocks/10_phase3_testing_ci.md',
backlogger-1  |   filename: '/app/data/projects/home-system/archived/phases/p3/blocks/10_phase3_testing_ci.md'
backlogger-1  | }
backlogger-1  | 
backlogger-1  | Node.js v20.20.2
backlogger-1  | ◇ injected env (0) from ../.env // tip: ◈ secrets for agents [www.dotenvx.com]
backlogger-1  | [backlogger] templates loaded=6 skipped=0
backlogger-1  | node:internal/fs/watchers:247
backlogger-1  |     const error = new UVException({
backlogger-1  |                   ^
backlogger-1  | 
backlogger-1  | Error: ENOSPC: System limit for number of file watchers reached, watch '/app/data/projects/home-system/archived/phases/p3/blocks/10_phase3_testing_ci.md'
backlogger-1  |     at FSWatcher.<computed> (node:internal/fs/watchers:247:19)
backlogger-1  |     at watch (node:fs:2503:36)
backlogger-1  |     at createFsWatchInstance (file:///app/node_modules/chokidar/handler.js:126:16)
backlogger-1  |     at setFsWatchListener (file:///app/node_modules/chokidar/handler.js:171:19)
backlogger-1  |     at NodeFsHandler._watchWithNodeFs (file:///app/node_modules/chokidar/handler.js:327:22)
backlogger-1  |     at NodeFsHandler._handleFile (file:///app/node_modules/chokidar/handler.js:393:29)
backlogger-1  |     at NodeFsHandler._addToNodeFs (file:///app/node_modules/chokidar/handler.js:618:31)
backlogger-1  | Emitted 'error' event on FSWatcher instance at:
backlogger-1  |     at FSWatcher._handleError (file:///app/node_modules/chokidar/index.js:558:18)
backlogger-1  |     at NodeFsHandler._addToNodeFs (file:///app/node_modules/chokidar/handler.js:626:26) {
backlogger-1  |   errno: -28,
backlogger-1  |   syscall: 'watch',
backlogger-1  |   code: 'ENOSPC',
backlogger-1  |   path: '/app/data/projects/home-system/archived/phases/p3/blocks/10_phase3_testing_ci.md',
backlogger-1  |   filename: '/app/data/projects/home-system/archived/phases/p3/blocks/10_phase3_testing_ci.md'
backlogger-1  | }
backlogger-1  | 
backlogger-1  | Node.js v20.20.2
backlogger-1  | ◇ injected env (0) from ../.env // tip: ⌘ custom filepath { path: '/custom/path/.env' }
backlogger-1  | [backlogger] templates loaded=6 skipped=0
backlogger-1  | node:internal/fs/watchers:247
backlogger-1  |     const error = new UVException({
backlogger-1  |                   ^
backlogger-1  | 
backlogger-1  | Error: ENOSPC: System limit for number of file watchers reached, watch '/app/data/projects/home-system/archived/phases/p3/blocks/10_phase3_testing_ci.md'
backlogger-1  |     at FSWatcher.<computed> (node:internal/fs/watchers:247:19)
backlogger-1  |     at watch (node:fs:2503:36)
backlogger-1  |     at createFsWatchInstance (file:///app/node_modules/chokidar/handler.js:126:16)
backlogger-1  |     at setFsWatchListener (file:///app/node_modules/chokidar/handler.js:171:19)
backlogger-1  |     at NodeFsHandler._watchWithNodeFs (file:///app/node_modules/chokidar/handler.js:327:22)
backlogger-1  |     at NodeFsHandler._handleFile (file:///app/node_modules/chokidar/handler.js:393:29)
backlogger-1  |     at NodeFsHandler._addToNodeFs (file:///app/node_modules/chokidar/handler.js:618:31)
backlogger-1  | Emitted 'error' event on FSWatcher instance at:
backlogger-1  |     at FSWatcher._handleError (file:///app/node_modules/chokidar/index.js:558:18)
backlogger-1  |     at NodeFsHandler._addToNodeFs (file:///app/node_modules/chokidar/handler.js:626:26) {
backlogger-1  |   errno: -28,
backlogger-1  |   syscall: 'watch',
backlogger-1  |   code: 'ENOSPC',
backlogger-1  |   path: '/app/data/projects/home-system/archived/phases/p3/blocks/10_phase3_testing_ci.md',
backlogger-1  |   filename: '/app/data/projects/home-system/archived/phases/p3/blocks/10_phase3_testing_ci.md'
backlogger-1  | }
backlogger-1  | 
backlogger-1  | Node.js v20.20.2
backlogger-1  | ◇ injected env (0) from ../.env // tip: ◈ encrypted .env [www.dotenvx.com]
backlogger-1  | [backlogger] templates loaded=6 skipped=0
backlogger-1  | node:internal/fs/watchers:247
backlogger-1  |     const error = new UVException({
backlogger-1  |                   ^
backlogger-1  | 
backlogger-1  | Error: ENOSPC: System limit for number of file watchers reached, watch '/app/data/projects/home-system/archived/phases/p3/blocks/10_phase3_testing_ci.md'
backlogger-1  |     at FSWatcher.<computed> (node:internal/fs/watchers:247:19)
backlogger-1  |     at watch (node:fs:2503:36)
backlogger-1  |     at createFsWatchInstance (file:///app/node_modules/chokidar/handler.js:126:16)
backlogger-1  |     at setFsWatchListener (file:///app/node_modules/chokidar/handler.js:171:19)
backlogger-1  |     at NodeFsHandler._watchWithNodeFs (file:///app/node_modules/chokidar/handler.js:327:22)
backlogger-1  |     at NodeFsHandler._handleFile (file:///app/node_modules/chokidar/handler.js:393:29)
backlogger-1  |     at NodeFsHandler._addToNodeFs (file:///app/node_modules/chokidar/handler.js:618:31)
backlogger-1  | Emitted 'error' event on FSWatcher instance at:
backlogger-1  |     at FSWatcher._handleError (file:///app/node_modules/chokidar/index.js:558:18)
backlogger-1  |     at NodeFsHandler._addToNodeFs (file:///app/node_modules/chokidar/handler.js:626:26) {
backlogger-1  |   errno: -28,
backlogger-1  |   syscall: 'watch',
backlogger-1  |   code: 'ENOSPC',
backlogger-1  |   path: '/app/data/projects/home-system/archived/phases/p3/blocks/10_phase3_testing_ci.md',
backlogger-1  |   filename: '/app/data/projects/home-system/archived/phases/p3/blocks/10_phase3_testing_ci.md'
backlogger-1  | }
backlogger-1  | 
backlogger-1  | Node.js v20.20.2
backlogger-1  | ◇ injected env (0) from ../.env // tip: ⌁ auth for agents [www.vestauth.com]
backlogger-1  | [backlogger] templates loaded=6 skipped=0
backlogger-1  | node:internal/fs/watchers:247
backlogger-1  |     const error = new UVException({
backlogger-1  |                   ^
backlogger-1  | 
backlogger-1  | Error: ENOSPC: System limit for number of file watchers reached, watch '/app/data/projects/home-system/archived/phases/p3/blocks/10_phase3_testing_ci.md'
backlogger-1  |     at FSWatcher.<computed> (node:internal/fs/watchers:247:19)
backlogger-1  |     at watch (node:fs:2503:36)
backlogger-1  |     at createFsWatchInstance (file:///app/node_modules/chokidar/handler.js:126:16)
backlogger-1  |     at setFsWatchListener (file:///app/node_modules/chokidar/handler.js:171:19)
backlogger-1  |     at NodeFsHandler._watchWithNodeFs (file:///app/node_modules/chokidar/handler.js:327:22)
backlogger-1  |     at NodeFsHandler._handleFile (file:///app/node_modules/chokidar/handler.js:393:29)
backlogger-1  |     at NodeFsHandler._addToNodeFs (file:///app/node_modules/chokidar/handler.js:618:31)
backlogger-1  | Emitted 'error' event on FSWatcher instance at:
backlogger-1  |     at FSWatcher._handleError (file:///app/node_modules/chokidar/index.js:558:18)
backlogger-1  |     at NodeFsHandler._addToNodeFs (file:///app/node_modules/chokidar/handler.js:626:26) {
backlogger-1  |   errno: -28,
backlogger-1  |   syscall: 'watch',
backlogger-1  |   code: 'ENOSPC',
backlogger-1  |   path: '/app/data/projects/home-system/archived/phases/p3/blocks/10_phase3_testing_ci.md',
backlogger-1  |   filename: '/app/data/projects/home-system/archived/phases/p3/blocks/10_phase3_testing_ci.md'
backlogger-1  | }
backlogger-1  | 
backlogger-1  | Node.js v20.20.2
