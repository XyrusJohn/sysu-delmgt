export const meta = {
  name: 'sysu-go-responsive-design-system',
  description: 'Reorganize sysu-go dimens into 3-tier system and audit hardcoded values in layouts',
  phases: ['Reorganize dimens folders delete sw380dp and sw600dp', 'Audit layout hardcoded values', 'Report findings'],
}

const fs_dimens = {
  sw360: 'app/src/main/res/values-sw360dp/dimens.xml',
  base: 'app/src/main/res/values/dimens.xml',
  sw480: 'app/src/main/res/values-sw480dp/dimens.xml',
}

phase('Reorganize dimens folders delete sw380dp and sw600dp')

log('Deleting sw380dp (overlaps sw360dp and sw480dp inconsistently)...')
await bash('Remove-Item -Recurse -Force "app/src/main/res/values-sw380dp"')

log('Deleting sw600dp (tablets out of scope for 3-tier phone spec)...')
await bash('Remove-Item -Recurse -Force "app/src/main/res/values-sw600dp"')

log('Updating comments in base dimens.xml to clarify Medium tier...')
const baseContent = await readFile(fs_dimens.base)
const baseUpdated = baseContent
  .replace('420dp ≤ screen < 480dp', '390–414px (3x DPR) - PRIMARY TARGET')
  .replace('Standard / flagship phones: Galaxy S, Pixel, OnePlus', 'Standard phones: Galaxy S24, Pixel 8, iPhone 14/15')
log('Base comment updated')

log('Updating comments in sw360dp dimens.xml to clarify Small tier...')
const sw360Content = await readFile(fs_dimens.sw360)
const sw360Updated = sw360Content
  .replace('Budget / compact phones: Redmi, Galaxy A, Nokia', 'Small / Compact: iPhone SE, Xiaomi Redmi, Galaxy A budget')
  .replace('1.5x–2x DPR', '2x DPR')
log('sw360dp comment updated')

log('Updating comments in sw480dp dimens.xml to clarify Large tier...')
const sw480Content = await readFile(fs_dimens.sw480)
const sw480Updated = sw480Content
  .replace('480dp ≤ screen < 600dp', 'Large Tier (430-480px, 3x DPR)')
  .replace('Pro Max / foldables: Galaxy Ultra, Pixel Pro XL', 'Pro Max / Ultra: iPhone 15 Pro Max, Galaxy S24 Ultra, Pixel 8 Pro XL')
log('sw480dp comment updated')

await write(sw360Updated, fs_dimens.sw360)
await write(baseUpdated, fs_dimens.base)
await write(sw480Updated, fs_dimens.sw480)

log('Folders reorganized: sw360dp=Small, base=Medium, sw480dp=Large. Deleted: sw380dp, sw600dp')

phase('Audit layout hardcoded values')
log('=== AUDIT: Scanning for hardcoded dp/sp values in layout XMLs ===')

const layoutDir = 'app/src/main/res/layout'
const layouts = await glob(layoutDir + '/*.xml')
const findings = []

for (const layout of layouts) {
  const content = await readFile(layout)
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // Skip lines that already use @dimen/
    if (line.includes('@dimen/')) continue
    // Find lines with numeric dp or sp values
    const numericMatches = line.match(/[a-zA-Z_]+="[^"]*\d+dp"/g) || []
    const spMatches = line.match(/[a-zA-Z_]+="[^"]*\d+sp"/g) || []
    const allMatches = [...numericMatches, ...spMatches]
    if (allMatches.length > 0) {
      const fn = layout.replace(/\\/g, '/').split('/').pop()
      findings.push({ file: fn, line: i + 1, match: allMatches.join(' | '), text: line.trim() })
    }
  }
}

log('Found ' + findings.length + ' hardcoded dp/sp values across ' + layouts.length + ' layout files:')
for (const f of findings) {
  log('  ' + f.file + ':' + f.line + ' => ' + f.match + '  (' + f.text.substring(0, 120) + ')')
}

return findings