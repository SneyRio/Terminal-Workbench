if(process.platform!=='win32'||process.arch!=='x64')throw new Error('Windows packages must be built on native Windows x64 to validate native terminal binaries');
await import('./prepare-pty.mjs');
process.env.TW_TARGET_PLATFORM='win32';await import('./package.mjs');
