const ghpages = require('gh-pages');
var fs = require('fs');

fs.writeFile(
  'public/CNAME',
  'sebastien.rigaux.be\nwww.sebastien.rigaux.be\nsébastien.rigaux.be\nwww.sébastien.rigaux.be',
  function(err) {}
);

ghpages.publish(
  'public',
  {
    branch: 'master',
    repo: 'https://github.com/srigaux/srigaux.github.io.git',
  },
  () => {
    console.log('Deploy Complete!');
  }
);
