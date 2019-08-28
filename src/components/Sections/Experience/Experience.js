import React from 'react';
import ExperienceItem from './ExperienceItem';
import Timeline from '../../Timeline';
import Section from '../Section';

const Experience = ({ experiences }) => {
  return (
    <Section id="experience" title="Experience Professionnelle">
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

export default Experience;
