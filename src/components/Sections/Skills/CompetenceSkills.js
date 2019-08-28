import React from 'react';
import PropTypes from 'prop-types';
import { Fade } from 'react-reveal';
import { injectIntl } from 'react-intl';

const ProgressBar = ({ percentage = 0, children }) => (
  <div className="progress">
    <div
      className="progress-bar"
      role="progressbar"
      aria-valuenow={percentage}
      aria-valuemin="0"
      aria-valuemax="100"
      style={{ width: percentage + '%' }}
    >
      {children}
    </div>
  </div>
);

ProgressBar.propTypes = {
  percentage: PropTypes.number,
};

const CompetenceSkills = ({ competences, intl }) => (
  <>
    <Fade delay={0}>
      <h3 className="mb-4">
        {intl.formatMessage({ id: 'sections_skills_competences' })}
      </h3>
    </Fade>
    {competences.map(({ title, knowledgePercentage }, idx) => (
      <Fade key={idx} bottom delay={100 + idx * 30}>
        <div className="row progressbar-container mb-2">
          <div className="col-5 progressbar-title">{title}</div>
          <div className="col-7 progressbar-progress">
            <ProgressBar percentage={knowledgePercentage} />
          </div>
        </div>
      </Fade>
    ))}
  </>
);

CompetenceSkills.propTypes = {
  competences: PropTypes.arrayOf(
    PropTypes.shape({
      title: PropTypes.string.isRequired,
      knowledgePercentage: PropTypes.number.isRequired,
    })
  ),
};

export default injectIntl(CompetenceSkills);
