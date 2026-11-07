// democast edit: the timeline editor, in a browser.

export async function edit({ flags, scenePath, outDir }) {
  const { serve } = await import('../editor/server.js');
  await serve({ scenePath, outDir, port: Number(flags.port), open: flags.open });
  // The server keeps the process running: no exit code.
  return undefined;
}
