module.exports = {
  siteTitle: 'Sébastien Rigaux Resume', // <title>
  manifestName: 'Resume',
  manifestShortName: 'Landing', // max 12 characters
  manifestStartUrl: '/',
  manifestBackgroundColor: '#663399',
  manifestThemeColor: '#663399',
  manifestDisplay: 'standalone',
  manifestIcon: 'src/assets/img/website-icon.png',
  pathPrefix: `/gatsby-starter-resume/`, // This path is subpath of your hosting https://domain/portfolio
  firstName: 'Sébastien',
  lastName: 'Rigaux',
  // social
  socialLinks: [
    {
      icon: 'fa-github',
      name: 'Github',
      url: 'https://github.com/srigaux',
    },
    {
      icon: 'fa-linkedin-in',
      name: 'Linkedin',
      url: 'https://linkedin.com/in/sebastien-rigaux',
    },
    // {
    //   icon: 'fa-twitter',
    //   name: 'Twitter',
    //   url: 'https://twitter.com/srigaux',
    // },
    {
      icon: 'fa-facebook-f',
      name: 'Facebook',
      url: 'https://facebook.com/srigaux',
    },
  ],
  email: 'sebastien@rigaux.be',
  phone: '+32 476 42 08 48',
  address: '7 Rue Dossin, 4600 Visé (Belgium)',
  about: `
    Jeune et dynamique, j’ai 29 ans et 7 ans d’expérience acquise au travers de différents postes 
    d’une société de développement web et mobile. A la tête de l’équipe d’une quinzaine de personnes, 
    je suis le garant des choix technologiques et de l’architecture de tous nos projets. 
    Autodidacte et passionné de nouvelles technologies, je me forme continuellement et reste informé des nouveautés. 
    J’aime voyager, sortir, jouer au tennis, faire du golf et de la voile.
    `,
  experience: [
    {
      title: 'Directeur de la technologie',
      company: 'djm digital S.A. (Liège - BELGIUM)',
      date: '2016 - Maintenant',
      description:
        'Gestion des équipes de développement, de l’infrastructure, des serveurs. Conception de nouveaux produits.',
    },
    {
      title: 'Directeur de la technologie - Mobile',
      company: 'djm digital S.A. (Liège - BELGIUM)',
      date: '2015 - 2016',
      description:
        'Gestion de l’équipe de développement mobile iOS et Android. Développement mobile et APIs.',
    },
    {
      title: 'Développeur iOS',
      company: 'djm digital S.A. (Liège - BELGIUM)',
      date: '2012 - 2015',
      description:
        'Développement d’applications iOS ainsi que leurs APIs et d’applications web pour de grandes entreprises belges.',
    },
    {
      title: 'Stage Développeur iOS',
      company: 'djm digital S.A. (Liège - BELGIUM)',
      date: '2012 - 2012',
      description:
        'Développement d’une application iPhone, d’APIs et d’applications web en ASP.NET MVC.',
    },
  ],
  education: [
    {
      institution: 'Université de Liège – ULiège & HEC (BELGIUM)',
      studyType: 'Master ',
      area: 'en sciences informatiques à finalité Gestion',
      date: 'sept. 2013 – juin 2015',
      //description: '',
      gpa: 'Grade: distinction',
    },
    {
      institution: 'Université de Liège – ULiège(BELGIUM)',
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
      institution: 'Université de Liège – ULiège(BELGIUM)',
      studyType: 'Bachelier ',
      area: 'en sciences informatiques',
      date: 'sept. 2007 - juin 2010',
      description:
        'Deux premières années de bachelier en sciences informatiques à l’Université de Liège (ULiège)',
      //gpa: 'Grade: distinction',
    },
  ],
};
