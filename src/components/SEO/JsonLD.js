const createJsonLD = config => {
  const data = {
    '@context': 'http://schema.org/',
    '@type': 'Person',
    address: {
      '@type': 'PostalAddress',
      addressCountry: config.address.country,
      addressLocality: config.address.locality,
      postalCode: config.address.zip,
    },
    birthDate: config.birthday,
    email: config.email,
    familyName: config.lastName,
    givenName: config.firstName,
    jobTitle: config.jobTitle,
    telephone: config.phone,
    name: `${config.firstName} ${config.lastName}`,
    sameAs: config.socialLinks.map(link => link.url),
  };

  const json = JSON.stringify(data);
  return json;
};

export default createJsonLD;
