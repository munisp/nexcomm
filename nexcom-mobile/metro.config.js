// NEXCOM Mobile — Metro bundler config.
//
// Expo SDK 52 note: `inlineRequires` is ALREADY enabled by default in
// expo/metro-config for SDK 52 (it ships in the default transformer). We set
// it explicitly so the choice survives SDK upgrades and is visible to audit.
// inlineRequires defers module evaluation until first use — one of the
// biggest cold-start (TTI) wins on low-end Android.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.transformer = {
  ...config.transformer,
  inlineRequires: true,
};

module.exports = config;
