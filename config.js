function calculateAge(birthday) {
  // birthday is a date
  var ageDifMs = Date.now() - birthday.getTime();
  var ageDate = new Date(ageDifMs); // miliseconds from epoch
  return Math.abs(ageDate.getUTCFullYear() - 1970);
}

const birthday = '1989-12-22';
const age = calculateAge(new Date(birthday));

const firstExperienceDate = new Date('2012-02-01');
const experienceYears = calculateAge(firstExperienceDate);

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
  birthday,
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
  about: {
    fr: `
      Jeune et dynamique, j'ai {{age}} ans et {{experienceYears}} ans d'expérience acquise au travers de différents postes 
      d'une société de développement web et mobile. A la tête de l'équipe d'une quinzaine de personnes, 
      je suis le garant des choix technologiques et de l'architecture de tous nos projets. 
      Autodidacte et passionné de nouvelles technologies, je me forme continuellement et reste informé des nouveautés. 
      J'aime voyager, sortir, jouer au tennis, faire du golf et de la voile.
      `
      .replace('{{age}}', age)
      .replace('{{experienceYears}}', experienceYears),
    en: `
    Young and dynamic, I am {{age}} years old and have {{experienceYears}} of experience acquired through various positions 
    of a web and mobile development company. At the head of the team of about fifteen people, 
    I am the guarantor of the technological choices and architecture of all our projects. 
    Self-taught and passionate about new technologies, I am constantly learning and kept informed of new developments. 
    I like traveling, going out, playing tennis, golf, sailing, sailing.
        `
      .replace('{{age}}', age)
      .replace('{{experienceYears}}', experienceYears),
  },
  experience: [
    {
      title: {
        fr: 'Directeur de la technologie',
        en: 'Chief Technical Officer',
      },
      company: 'djm digital S.A. (Liège - BELGIUM)',
      date: '2016 - Maintenant',
      description: {
        fr: `Gestion des équipes de développement, de l'infrastructure, des serveurs. Conception de nouveaux produits.`,
        en: `Management of development teams, infrastructure, servers. Design of new products.`,
      },
    },
    {
      title: {
        fr: 'Directeur de la technologie - Mobile',
        en: 'Chief Technical Officer - Mobile',
      },
      company: 'djm digital S.A. (Liège - BELGIUM)',
      date: '2015 - 2016',
      description: {
        fr: `Gestion de l'équipe de développement mobile iOS et Android. Développement mobile et APIs.`,
        en: `Management of the iOS and Android mobile development team. Mobile development and APIs.`,
      },
    },
    {
      title: {
        fr: 'Développeur iOS',
        en: 'iOS Developer',
      },
      company: 'djm digital S.A. (Liège - BELGIUM)',
      date: '2012 - 2015',
      description: {
        fr: `Développement d'applications iOS ainsi que leurs APIs et d'applications web pour de grandes entreprises belges.`,
        en: `Development of iOS applications as well as their APIs and web applications for large Belgian companies.`,
      },
    },
    {
      title: {
        fr: 'Stage Développeur iOS',
        en: 'iOS Developer Internship',
      },
      company: 'djm digital S.A. (Liège - BELGIUM)',
      date: '2012 - 2012',
      description: {
        fr: `Développement d'une application iPhone, d'APIs et d'applications web en ASP.NET MVC.`,
        en: `Development of an iPhone application, APIs and web applications in ASP.NET MVC.`,
      },
    },
  ],
  education: [
    {
      institution: 'Université de Liège – ULiège & HEC (BELGIUM)',
      studyType: 'Master ',
      area: 'en sciences informatiques à finalité Gestion',
      date: 'sept. 2013 – juin 2015',
      //description: '',
      gpa: 'Grade: distinction',
    },
    {
      institution: 'Université de Liège – ULiège (BELGIUM)',
      studyType: 'Bachelier ',
      area: 'en sciences informatiques',
      date: 'sept. 2012 – juin 2013',
      //description: '',
      gpa: 'Grade: distinction',
    },
    {
      institution: 'Haute Ecole de la province de Liège – INPRES (BELGIUM)',
      studyType: 'Bachelier ',
      area: 'en informatique de gestion',
      date: 'sept. 2010 – juin 2012',
      //description: '',
      gpa: 'Grade: distinction',
    },
    {
      institution: 'Université de Liège – ULiège (BELGIUM)',
      studyType: 'Bachelier ',
      area: 'en sciences informatiques',
      date: 'sept. 2007 - juin 2010',
      description: `Deux premières années de bachelier en sciences informatiques à l'Université de Liège (ULiège)`,
      //gpa: 'Grade: distinction',
    },
  ],
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
