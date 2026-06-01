module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      ['module-resolver', {
        alias: {
          '@nagellacke/core': '../../packages/core/src',
          '@nagellacke/sync': '../../packages/sync/src',
        },
      }],
    ],
  };
};
