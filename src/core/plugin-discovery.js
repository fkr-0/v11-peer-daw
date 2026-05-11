export async function discoverPlugins({ index = [], loader }) {
  const plugins = [];

  for (const entry of index) {
    plugins.push(await loader.load(entry));
  }

  return plugins;
}
