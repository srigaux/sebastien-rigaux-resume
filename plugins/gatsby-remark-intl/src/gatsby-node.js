const localeRegex = /\.(\w{2})\.md$/i;

exports.onCreateNode = ({ node, actions }) => {
  const { createNodeField } = actions;

  // We only care about MarkdownRemark content.
  if (node.internal.type !== 'MarkdownRemark') {
    return;
  }

  const fileAbsolutePath = node.fileAbsolutePath;

  const localeMatch = fileAbsolutePath.match(localeRegex);

  if (localeMatch) {
    createNodeField({
      node,
      name: 'locale',
      value: localeMatch[1],
    });
  }
};

exports.onCreatePage = ({ page, actions: { createPage, deletePage } }) => {
  if (!page.context.intl || page.context.language) {
    return;
  }

  deletePage(page);
  createPage({
    ...page,
    context: {
      ...page.context,
      language: page.context.intl.language,
    },
  });
};
