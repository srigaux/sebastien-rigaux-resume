import React from "react"

/**
 * Implement Gatsby's SSR (Server Side Rendering) APIs in this file.
 *
 * See: https://www.gatsbyjs.org/docs/ssr-apis/
 */

// You can delete this file if you're not using it
export const onRenderBody = (
    { setHeadComponents, setPostBodyComponents },
    pluginOptions
  ) => {
    if (process.env.NODE_ENV !== `production`) {
      return null
    }
  
    // Lighthouse recommends pre-connecting to google analytics
    setHeadComponents([
      <link
        rel="dns-prefetch"
        key="dns-prefetch-google-analytics"
        href="https://www.google-analytics.com"
      />,
      <link
        rel="preconnect"
        key="preconnect-google-analytics"
        href="https://www.google-analytics.com"
      />,
    ])
};