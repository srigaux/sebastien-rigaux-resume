const config = require('./config');

const icons = config.socialLinks.map(l => l.icon);

const siteUrl = 'https://sebastien.rigaux.be';

module.exports = {
  pathPrefix: config.pathPrefix,
  siteMetadata: {
    title: config.siteTitle,
    titleTemplate: `%s | ${config.siteTitle}`,
    description: 'config.about',
    url: siteUrl,
    siteUrl,
    image: config.image,
    twitterUsername: 'rigauxse',
  },
  plugins: [
    {
      resolve: `gatsby-plugin-intl`,
      options: {
        // language JSON resource path
        path: `${__dirname}/src/intl`,
        // supported language
        languages: ['fr', 'en'],
        // language file path
        defaultLanguage: 'fr',
        // option to redirect to `/ko` when connecting `/`
        redirect: true,
      },
    },
    {
      resolve: `gatsby-source-filesystem`,
      options: {
        name: `experiences`,
        path: `${__dirname}/src/content/experiences`,
      },
    },
    {
      resolve: `gatsby-source-filesystem`,
      options: {
        name: `educations`,
        path: `${__dirname}/src/content/educations`,
      },
    },
    {
      resolve: `gatsby-source-filesystem`,
      options: {
        name: `content`,
        path: `${__dirname}/src/content/`,
      },
    },
    'gatsby-transformer-remark',
    'gatsby-remark-source-name',
    'gatsby-remark-intl',
    'gatsby-plugin-sitemap',
    'gatsby-plugin-robots-txt',
    'gatsby-plugin-react-helmet',
    {
      resolve: `gatsby-plugin-react-helmet-canonical-urls`,
      options: {
        siteUrl,
      },
    },
    {
      resolve: `gatsby-plugin-manifest`,
      options: {
        name: config.manifestName,
        short_name: config.manifestShortName,
        start_url: config.pathPrefix || config.manifestStartUrl,
        background_color: config.manifestBackgroundColor,
        theme_color: config.manifestThemeColor,
        display: config.manifestDisplay,
        icon: config.manifestIcon, // This path is relative to the root of the site.
      },
    },
    'gatsby-plugin-sass',
    {
      resolve: 'gatsby-plugin-react-svg',
      options: {
        rule: {
          include: /\.inline\.svg$/,
        },
      },
    },
    {
      resolve: `gatsby-plugin-prefetch-google-fonts`,
      options: {
        fonts: [
          {
            family: `Montserrat`,
            subsets: [`latin`],
            variants: [`100`, `200`, `300`, `700`],
          },
        ],
        fontDisplay: 'swap',
      },
    },
    {
      resolve: `gatsby-plugin-purgecss`,
      options: {
        printRejected: true, // Print removed selectors and processed file names
        // develop: true, // Enable while using `gatsby develop`
        // tailwind: true, // Enable tailwindcss support
        whitelist: [
          'CircularProgressbar',
          'CircularProgressbar-path',
          'CircularProgressbar-trail',
          'CircularProgressbar-text',
          'CircularProgressbar-background',
          ...icons,
        ], // Don't remove this selector
        ignore: ['_circular-progressbars.scss'], // Ignore files/folders
        // purgeOnly : ['components/', '/main.css', 'bootstrap/'], // Purge only these files/folders
      },
    },
    {
      resolve: `gatsby-plugin-google-analytics`,
      options: {
        trackingId: 'UA-5770503-2',
        // Defines where to place the tracking script - `true` in the head and `false` in the body
        head: false,
        // Setting this parameter is optional
        anonymize: true,
        // Setting this parameter is also optional
        respectDNT: false,
        // Avoids sending pageview hits from custom paths
        //exclude: ['/preview/**', '/do-not-track/me/too/'],
        // Delays sending pageview hits on route update (in milliseconds)
        //pageTransitionDelay: 0,
        // Enables Google Optimize using your container Id
        //optimizeId: 'YOUR_GOOGLE_OPTIMIZE_TRACKING_ID',
        // Enables Google Optimize Experiment ID
        //experimentId: 'YOUR_GOOGLE_EXPERIMENT_ID',
        // Set Variation ID. 0 for original 1,2,3....
        //variationId: 'YOUR_GOOGLE_OPTIMIZE_VARIATION_ID',
        // Any additional create only fields (optional)
        //sampleRate: 5,
        //siteSpeedSampleRate: 10,
        //cookieDomain: 'example.com',
      },
    },
    {
      resolve: 'gatsby-plugin-html2amp',
      options: {
        files: ['**/*.html'],
        dist: 'public/amp',
        gaConfigPath: 'gaConfig.json',
      },
    },
    {
      resolve: `gatsby-plugin-csp`,
      options: {
        disableOnDev: true,
        reportOnly: false, // Changes header to Content-Security-Policy-Report-Only for csp testing purposes
        mergeScriptHashes: true, // you can disable scripts sha256 hashes
        mergeStyleHashes: false, // you can disable styles sha256 hashes
        mergeDefaultDirectives: true,
        directives: {
          'default-src': "'self' www.google-analytics.com",
          'script-src': "'self' www.google-analytics.com cdn.ampproject.org",
          'style-src': "'self' 'unsafe-inline'",
          'img-src': "'self' data: www.google-analytics.com",
          'prefetch-src': "'self' www.google-analytics.com",
        },
      },
    },
    'gatsby-plugin-offline',
  ],
};
