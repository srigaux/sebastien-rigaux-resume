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
      identifier: '/ srigaux',
      url: 'https://github.com/srigaux',
    },
    {
      icon: 'fa-facebook-f',
      name: 'Facebook',
      identifier: '/ srigaux',
      url: 'https://facebook.com/srigaux',
    },
    {
      icon: 'fa-linkedin-in',
      name: 'Linkedin',
      identifier: '/ sebastien-rigaux',
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
      identifier: '/ rigauxse',
      url: 'https://twitter.com/rigauxse',
    },
    {
      icon: 'fa-instagram',
      name: 'Instagram',
      identifier: '/ rigauxse',
      url: 'https://www.instagram.com/rigauxse/',
    },
  ],
  email: 'sebastien@rigaux.be',
  // phone: '+32 476 42 08 48',
  phone: '+1 (236) 858-8811',
  // address: {
  //   zip: '4600',
  //   locality: 'Visé',
  //   country: 'Belgium',
  //   formatted: '4600 Visé – Canada',
  // },
  address: {
    zip: 'BC V6J 1A6',
    locality: 'Vancouver',
    country: 'Canada',
    formatted: 'Vancouver, BC V6J 1A6',
  },
  competenceSkills: [
    {
      title: 'Web – Backend',
      knowledgePercentage: 95,
    },
    {
      title: 'Web – Frontend',
      knowledgePercentage: 85,
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
