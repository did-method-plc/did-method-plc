const pkgJson = require('@npmcli/package-json')

// `exports` takes precedence over `main` in Node >= 12, so both have to move
// together -- swapping `main` alone would leave resolution pinned to whichever
// target `exports` names.
const targets = {
  '--update-main-to-dist': {
    main: 'dist/index.js',
    types: 'dist/index.d.ts',
    exports: {
      '.': { types: './dist/index.d.ts', default: './dist/index.js' },
    },
  },
  '--update-main-to-src': {
    main: 'src/index.ts',
    types: 'src/index.ts',
    exports: {
      '.': { types: './src/index.ts', default: './src/index.ts' },
    },
  },
}

const flag = process.argv.find((arg) => arg in targets)
if (flag) {
  return pkgJson
    .load(__dirname)
    .then((pkg) => pkg.update(targets[flag]))
    .then((pkg) => pkg.save())
}
