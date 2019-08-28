module.exports = {
  siteTitle: 'Sébastien Rigaux', // <title>
  manifestName: 'Resume',
  manifestShortName: 'Landing', // max 12 characters
  manifestStartUrl: '/',
  manifestBackgroundColor: '#663399',
  manifestThemeColor: '#663399',
  manifestDisplay: 'standalone',
  manifestIcon: 'src/assets/img/logo.svg',
  pathPrefix: `/gatsby-starter-resume/`, // This path is subpath of your hosting https://domain/portfolio
  firstName: 'Sébastien',
  lastName: 'Rigaux',
  label: 'Full stack web/mobile developer',
  jobTitle: 'CTO',
  birthday: '1989-12-22',
  image: '/img/og-image.png',
  url: 'https://sebastien.rigaux.be',
  // social
  socialLinks: [
    {
      icon: 'fa-github',
      name: 'Github',
      identifier: '/srigaux',
      url: 'https://github.com/srigaux',
    },
    {
      icon: 'fa-facebook-f',
      name: 'Facebook',
      identifier: '/srigaux',
      url: 'https://facebook.com/srigaux',
    },
    {
      icon: 'fa-linkedin-in',
      name: 'Linkedin',
      identifier: '/sebastien-rigaux',
      url: 'https://linkedin.com/in/sebastien-rigaux',
    },
    // {
    //   icon: 'fa-link',
    //   name: 'Link',
    //   identifier: 'sebastien.rigaux.be',
    //   url: 'https://sebastien.rigaux.be',
    // },
    {
      icon: 'fa-twitter',
      name: 'Twitter',
      identifier: 'rigauxse',
      url: 'https://twitter.com/rigauxse',
    },
    {
      icon: 'fa-instagram',
      name: 'Instagram',
      identifier: '/rigauxse',
      url: 'https://www.instagram.com/rigauxse/',
    },
  ],
  email: 'sebastien@rigaux.be',
  phone: '+32 476 42 08 48',
  address: {
    zip: '4600',
    locality: 'Visé',
    country: 'Belgium',
    formatted: '4600 Visé – Belgium',
  },
  languageSkills: {
    description: `
    Né en Belgique francophone.
    Bonne compréhension de l'anglais.
    Bases de néerlandais apprises à l'école.`,
    languages: [
      {
        id: 'fr',
        title: 'Français',
        shortTitle: 'Français',
        knowledgePercentage: 100,
      },
      {
        id: 'en',
        title: 'Anglais',
        shortTitle: 'Anglais',
        knowledgePercentage: 60,
      },
      {
        id: 'nl',
        title: 'Néerlandais',
        shortTitle: 'Néérl.',
        knowledgePercentage: 30,
      },
    ],
  },
  competenceSkills: [
    {
      title: 'Web .net/php',
      knowledgePercentage: 95,
    },
    {
      title: 'Web frontend',
      knowledgePercentage: 90,
    },
    {
      title: 'Database',
      knowledgePercentage: 80,
    },
    {
      title: 'Mobile',
      knowledgePercentage: 95,
    },
    {
      title: 'BI / IoT / IA',
      knowledgePercentage: 65,
    },
  ],
};
