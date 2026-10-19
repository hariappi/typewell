const targets = ['firefox', 'chromium'];

export function parseBuildTargets(args) {
  let target = 'firefox';
  if (args.length === 1 && args[0].startsWith('--target=')) target = args[0].slice('--target='.length);
  else if (args.length === 2 && args[0] === '--target') target = args[1];
  else if (args.length) throw new Error('Usage: node scripts/build.mjs [--target firefox|chromium|all]');
  if (target === 'all') return [...targets];
  if (!targets.includes(target)) throw new Error(`Unknown build target: ${target}. Expected firefox, chromium, or all.`);
  return [target];
}

export function createManifest(source, target) {
  if (!targets.includes(target)) throw new Error(`Unknown build target: ${target}`);
  const manifest = structuredClone(source);
  if (target === 'firefox') return manifest;

  delete manifest.browser_specific_settings;
  manifest.minimum_chrome_version = '114';
  manifest.background = { service_worker: 'background-worker.js' };
  manifest.icons = Object.fromEntries([16, 32, 48, 128].map(size => [size, `icons/typewell-${size}.png`]));
  manifest.action.default_icon = { ...manifest.icons };
  for (const script of manifest.content_scripts ?? []) {
    script.js = [...new Set(['shared/compat.js', ...(script.js ?? [])])];
  }
  return manifest;
}
