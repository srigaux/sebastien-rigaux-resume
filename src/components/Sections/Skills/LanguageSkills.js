import React from 'react';
import PropTypes from 'prop-types';
import { CircularProgressbarWithChildren } from 'react-circular-progressbar';
import { Fade } from 'react-reveal';
import { useStaticQuery, graphql } from 'gatsby';
import { injectIntl } from 'react-intl';

const LanguageSkills = props => {
  const { languages, intl } = props;

  const { html } = useStaticQuery(graphql`
    query {
      markdownRemark(
        fields: { sourceName: { eq: "content" } }
        fileAbsolutePath: { regex: "//language-skills\\\\.md$/" }
      ) {
        html
      }
    }
  `);

  return (
    <>
      <h3 className="mb-4">
        {intl.formatMessage({ id: 'sections_skills_languageLevel' })}
      </h3>
      <div className="mb-5" dangerouslySetInnerHTML={{ __html: html }} />
      <div className="propgressbars row">
        {languages.map((lang, idx) => (
          <Fade key={lang.id} bottom delay={100 + idx * 100}>
            <div title={lang.title} className="col text-center">
              <div style={{ maxWidth: '8rem', margin: 'auto' }}>
                <CircularProgressbarWithChildren
                  value={lang.knowledgePercentage}
                  strokeWidth={2}
                >
                  <div className="CircularProgressbar-content">
                    {lang.shortTitle} <br />
                    {lang.knowledgePercentage} %
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

LanguageSkills.propTypes = {
  description: PropTypes.string,
  languages: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string.isRequired,
      title: PropTypes.string.isRequired,
      shortTitle: PropTypes.string.isRequired,
      knowledgePercentage: PropTypes.number.isRequired,
    })
  ),
};

export default injectIntl(LanguageSkills);
