import('./dist/tools/dashboard.js').then(async (m) => {
  const targetPath =
    process.env.DEEPSIGHT_PROJECT_PATH ||
    process.env.SIGBIN_PROJECT_PATH ||
    '';
  if (!targetPath) {
    console.error('Set DEEPSIGHT_PROJECT_PATH (or SIGBIN_PROJECT_PATH) to the project under test.');
    process.exit(1);
  }
  const url = await m.startWebServer(targetPath);
  console.log('DEEPSIGHT_URL=' + url);
}).catch(e => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
