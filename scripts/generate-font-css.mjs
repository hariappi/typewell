import { writeFile } from 'node:fs/promises';
import '../extension/shared/catalog.js';

// Reproduce the declarations created by fetch-fonts.mjs using the local catalog.
// This helper does not download, subset, or modify any font binaries.
const fonts = globalThis.Typewell.fonts.filter(font => font.bundled);
const styles = fonts.map(font => `@font-face { font-family: ${JSON.stringify(font.family)}; src: url("../${font.file}") format("woff2"); font-weight: 400; font-style: normal; font-display: swap; }`).join('\n');
await writeFile(new URL('../extension/ui/fonts.css', import.meta.url), styles + '\n');
console.log(`Reproduced ${fonts.length} local font declarations.`);
