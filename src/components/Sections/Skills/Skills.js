import React from 'react';
import Section from '../Section';
import LanguageSkills from './LanguageSkills';
import CompetenceSkills from './CompetenceSkills';
import { injectIntl } from 'react-intl';

const Skills = props => (
  <Section
    id="skills"
    title={props.intl.formatMessage({ id: 'sections_skills_title' })}
  >
    <div className="row">
      <div className="col-lg-5 mb-5">
        <LanguageSkills {...props.languageSkills} />
      </div>
      <div className="col-lg-6 offset-lg-1">
        <CompetenceSkills competences={props.competenceSkills} />
      </div>
    </div>
  </Section>
);

export default injectIntl(Skills);
