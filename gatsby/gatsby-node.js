/**
 * Implement Gatsby's Node APIs in this file.
 *
 * See: https://www.gatsbyjs.org/docs/node-apis/
 */

const replace = require('replace-in-file');

function fixAmpErrors() {
  const options = {
    files: 'public/amp/**/*.html',
    from: /(<link[^>]*rel="amphtml"[^>]*>)|(<meta[^>]*http-equiv="Content-Security-Policy"[^>]*>)/g,
    to: '',
  };

  console.log(replace.sync(options));
}

exports.onPostBuild = _ => {
  const defaultOptions = {
    files: ['**/*.html'],
    publicPath: 'public',
    gaConfigPath: null,
    dist: null,
    serviceWorker: null,
  };

  fixAmpErrors();

  return Promise.all([]);
};
