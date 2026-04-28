/**
 * Batch-fix: wrap bare `const t = (key, params) => globalT(...)` in useCallback
 */
import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';

const files = execSync(
  'grep -rl "const t = (key" apps/admin-next/src --include="*.tsx" --include="*.ts"',
  { encoding: 'utf8' },
)
  .trim()
  .split('\n')
  .filter(Boolean);

console.log(`Found ${files.length} files with bare t wrapper:\n  ${files.join('\n  ')}`);

for (const filePath of files) {
  let content = readFileSync(filePath, 'utf8');
  const orig = content;

  // Replace bare t wrapper with useCallback version
  // Matches:
  //   const t = (key: string, params?: Record<string, string | number>) =>
  //     globalT(`namespace_${key}`, params);
  const regex =
    /const t = \(key(?:: string)?, params(?:\?: Record<string, string \| number>)?\) =>\s*\n\s+globalT\(`([^`]+)\$\{key\}`(?:, params)?\);/g;

  let match;
  regex.lastIndex = 0;

  while ((match = regex.exec(content)) !== null) {
    const ns = match[1];
    const replacement = `const t = useCallback(
    (key: string, params?: Record<string, string | number>) =>
      globalT(\`${ns}\${key}\`, params),
    [globalT],
  );`;

    content =
      content.slice(0, match.index) +
      replacement +
      content.slice(match.index + match[0].length);

    regex.lastIndex = match.index + replacement.length;
  }

  if (content === orig) {
    console.log(`  SKIP (no match): ${filePath}`);
    continue;
  }

  // Add useCallback to React imports if not present
  if (content.includes('useCallback')) {
    // already there
  } else {
    content = content.replace(
      /(import\s+\{[^}]*)\}\s+from\s+['"]react['"]/,
      (m, imports) => {
        if (!imports.includes('useCallback')) {
          return `${imports.trimEnd(), useCallback }} from 'react'`;
        }
        return m;
      },
    );
  }

  writeFileSync(filePath, content);
  console.log(`  FIXED: ${filePath}`);
}

console.log('\nDone!');
