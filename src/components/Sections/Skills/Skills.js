import React from 'react';
import Section from '../Section';
import LanguageSkills from './LanguageSkills';
import CompetenceSkills from './CompetenceSkills';

const Skills = props => {
  return (
    <Section id="skills" title="Skills">
      <div className="row">
        <div className="col-5">
          <LanguageSkills {...props.languageSkills} />
        </div>
        <div className="col-6 offset-1">
          <CompetenceSkills competences={props.competenceSkills} />
        </div>
      </div>
    </Section>
  );
};

export default Skills;
