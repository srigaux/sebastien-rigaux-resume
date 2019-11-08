import React from 'react';
import { CircularProgressbarWithChildren } from 'react-circular-progressbar';
import { Fade } from 'react-reveal';
import { injectIntl } from 'react-intl';

const LanguageSkills = ({ html, frontmatter: { languages }, intl }) => {
  return (
    <>
      <h3 className="mb-4">
        {intl.formatMessage({ id: 'sections_skills_languageLevel' })}
      </h3>
      <div className="mb-5" dangerouslySetInnerHTML={{ __html: html }} />
      <div className="propgressbars row">
        {languages.map((lang, idx) => (
          <Fade key={idx} bottom delay={100 + idx * 100}>
            <div title={lang.lang} className="col text-center">
              <div style={{ width: '7rem', margin: 'auto' }}>
                <CircularProgressbarWithChildren
                  value={lang.level.value}
                  strokeWidth={2}
                >
                  <div className="CircularProgressbar-content">
                    {lang.lang} <br />
                    {lang.level.title || lang.level.value + ' %'}
                  </div>
                </CircularProgressbarWithChildren>
              </div>
            </div>
          </Fade>
        ))}
      </div>
    </>
  );
};

export default injectIntl(LanguageSkills);
