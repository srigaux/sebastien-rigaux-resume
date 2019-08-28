import React from 'react';
import ExperienceItem from './ExperienceItem';
import Timeline from '../../Timeline';
import Section from '../Section';
import { injectIntl } from 'react-intl';

const Experience = ({ experiences, intl }) => {
  return (
    <Section
      id="experience"
      title={intl.formatMessage({ id: 'sections_experience_title' })}
    >
      <Timeline>
        {experiences.nodes.map(
          ({ id, html, frontmatter: { title, date, company } }) => (
            <ExperienceItem
              key={id}
              company={company}
              date={date}
              title={title}
              description={html}
            />
          )
        )}
      </Timeline>
    </Section>
  );
};

export default injectIntl(Experience);
