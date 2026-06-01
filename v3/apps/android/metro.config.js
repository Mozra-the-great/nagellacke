const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

// Monorepo root is two levels up from this file
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Let Metro watch the entire monorepo, not just the app folder
config.watchFolders = [workspaceRoot];

// Tell Metro where to resolve packages from — app first, then workspace root
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// Allow symlinked packages (npm workspaces uses symlinks)
config.resolver.unstable_enableSymlinks = true;

module.exports = config;
