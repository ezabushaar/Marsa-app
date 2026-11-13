// The contracts in vendor/contracts are copied from Marsa ERP, which imports its TypeScript files by their
// compiled name ("./http.js"). Metro resolves those to the .ts source here.
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
const resolve = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const next = resolve ?? context.resolveRequest;
  if (moduleName.startsWith(".") && moduleName.endsWith(".js")) {
    try {
      return next(context, moduleName.replace(/\.js$/, ".ts"), platform);
    } catch {}
  }
  return next(context, moduleName, platform);
};

module.exports = config;
