import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'content', 'manifest.config.json');
const OUTPUT_PATH = path.join(ROOT, 'content', 'manifest.json');

function decodeHtmlEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#96;/g, '`');
}

function extractTextFromHtml(html, tagName) {
  const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i');
  const match = html.match(regex);
  if (!match) return '';
  const raw = match[1];
  return decodeHtmlEntities(
    raw
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

async function readConfig() {
  const raw = await fs.readFile(CONFIG_PATH, 'utf-8');
  return JSON.parse(raw);
}

async function ensureDirectoryExists(dir) {
  try {
    const stat = await fs.stat(dir);
    if (!stat.isDirectory()) {
      throw new Error(`${dir} is not a directory`);
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`Directory not found: ${dir}`);
    }
    throw error;
  }
}

async function listHtmlFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.html'))
    .map((entry) => entry.name);
}

async function buildFileEntry(dir, fileName, overrides = {}) {
  const filePath = path.join(dir, fileName);
  const raw = await fs.readFile(filePath, 'utf-8');
  const headingText = extractTextFromHtml(raw, 'h2') || extractTextFromHtml(raw, 'h1');
  const descriptionText = extractTextFromHtml(raw, 'p');
  const slug = path.basename(fileName, path.extname(fileName));
  const override = overrides[slug] ?? {};
  return {
    id: slug,
    label: override.label ?? headingText ?? slug,
    description: override.description ?? descriptionText,
    path: path.join(path.relative(ROOT, dir), fileName).replace(/\\/g, '/'),
  };
}

function orderFiles(files, fileOrder = []) {
  const existing = new Set(files);
  const ordered = [];

  for (const name of fileOrder) {
    if (existing.has(name)) {
      ordered.push(name);
      existing.delete(name);
    }
  }

  const remaining = [...existing].sort((a, b) => a.localeCompare(b));
  return [...ordered, ...remaining];
}

async function buildManifest() {
  const config = await readConfig();
  const manifest = {
    previewTitle: config.previewTitle,
    previewDescription: config.previewDescription,
    collections: [],
  };

  for (const collection of config.collections) {
    const nextCollection = {
      label: collection.label,
      children: [],
    };

    for (const child of collection.children) {
      const directory = path.join(ROOT, child.directory);
      await ensureDirectoryExists(directory);
      const htmlFiles = await listHtmlFiles(directory);
      const orderedFiles = orderFiles(htmlFiles, child.fileOrder);
      const files = [];
      const overrides = child.overrides ?? {};

      for (const fileName of orderedFiles) {
        files.push(await buildFileEntry(directory, fileName, overrides));
      }

      nextCollection.children.push({
        id: child.id,
        label: child.label,
        description: child.description,
        files,
      });
    }

    manifest.collections.push(nextCollection);
  }

  return manifest;
}

async function writeManifest(manifest) {
  const payload = `${JSON.stringify(manifest, null, 2)}\n`;
  await fs.writeFile(OUTPUT_PATH, payload, 'utf-8');
}

async function main() {
  const manifest = await buildManifest();
  await writeManifest(manifest);
  // eslint-disable-next-line no-console
  console.log('Generated manifest at', path.relative(ROOT, OUTPUT_PATH));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
