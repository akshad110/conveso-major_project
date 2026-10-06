/**
 * A build the VM can actually run.
 *
 * Vite cannot build here — this project's node_modules were installed on macOS,
 * and rollup and esbuild both ship a platform-native binary that will not load
 * on Linux. npm is blocked too, so there is no way to fetch the Linux ones.
 *
 * What a build would have caught is still worth catching, so this does the two
 * parts that need no native code: parse every source file, and resolve every
 * import against the disk. That is precisely the class of failure that was
 * sitting in App.jsx — a relative path one directory out, which type-checks
 * fine, reads fine, and fails the moment anything tries to bundle it.
 *
 * Run: node tools/check-frontend.mjs [srcDir]
 */
import { readdirSync, existsSync, statSync, readFileSync } from 'node:fs'
import { join, dirname, resolve, extname } from 'node:path'

import { parse } from '@babel/parser'

const SRC = resolve(process.argv[2] || 'src')
const CODE = new Set(['.js', '.jsx', '.mjs'])
const RESOLVE_AS = ['', '.js', '.jsx', '.mjs', '/index.js', '/index.jsx']
/** Imports that are not files: packages, and anything Vite serves from public/. */
const isBare = (spec) => !spec.startsWith('.') && !spec.startsWith('/')

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) out.push(...walk(path))
    else if (CODE.has(extname(entry))) out.push(path)
  }
  return out
}

const files = walk(SRC)
const parseErrors = []
const missing = []
let imports = 0

for (const file of files) {
  const source = readFileSync(file, 'utf8')
  let ast
  try {
    ast = parse(source, {
      sourceType: 'module',
      plugins: ['jsx', 'classProperties', 'classPrivateMethods', 'classPrivateProperties'],
    })
  } catch (error) {
    parseErrors.push(`${file.replace(SRC, 'src')}: ${error.message}`)
    continue
  }

  const specs = []
  for (const node of ast.program.body) {
    if (node.type === 'ImportDeclaration') specs.push(node.source.value)
    if ((node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') && node.source) {
      specs.push(node.source.value)
    }
  }

  for (const spec of specs) {
    imports += 1
    if (isBare(spec)) continue
    const base = resolve(dirname(file), spec)
    const found = RESOLVE_AS.some((ext) => {
      const candidate = base + ext
      return existsSync(candidate) && statSync(candidate).isFile()
    })
    if (!found) missing.push(`${file.replace(SRC, 'src')} -> ${spec}`)
  }
}

console.log(`parsed ${files.length} files, ${imports} imports`)

if (parseErrors.length) {
  console.log('\nSYNTAX:')
  for (const line of parseErrors) console.log(`  ${line}`)
}
if (missing.length) {
  console.log('\nUNRESOLVED IMPORTS:')
  for (const line of missing) console.log(`  ${line}`)
}

if (parseErrors.length || missing.length) {
  console.log(`\nFAIL — ${parseErrors.length} syntax, ${missing.length} unresolved`)
  process.exit(1)
}
console.log('OK — every file parses and every relative import resolves')
