module.exports = {
  packagerConfig: {
    asar: false,
    icon: 'assets/icon',
    executableName: 'FlightRadar',
    // Include only necessary files
    ignore: [
      /^\/\.git/,
      /^\/\.vscode/,
      /^\/node_modules\/cesium\/(?!Build)/,  // Keep only Build folder from Cesium
      /^\/dist/,
      /^\/scripts/,
      /^\/web/,
      /^\/snapcraft\.yaml/,
      /^\/\.github/,
      /\.md$/,
      /flight-radar.*\.tgz$/
    ]
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'FlightRadar',
        setupIcon: 'assets/icon.ico',
        setupExe: 'Flight Radar Setup.exe',
        // Squirrel doesn't support all NSIS options, but provides modern installer
        noMsi: true
      }
    },
    {
      name: '@electron-forge/maker-deb',
      config: {
        options: {
          maintainer: 'Jonathan Birge',
          homepage: 'https://github.com/username/flight-radar',
          icon: 'assets/icon.png',
          categories: ['Utility'],
          section: 'utils'
        }
      }
    }
  ],
  publishers: []
};
