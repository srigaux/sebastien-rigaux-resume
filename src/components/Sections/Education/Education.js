import React from 'react';
import EducationItem from './EducationItem';
import Timeline from '../../Timeline';
import Section from '../Section';

const Education = ({ educations }) => {
  return (
    <Section id="education" title="Education">
      <Timeline>
        {educations.nodes.map(
          ({
            id,
            html,
            frontmatter: { institution, studyType, area, gpa, date },
          }) => (
            <EducationItem
              key={id}
              institution={institution}
              studyType={studyType}
              area={area}
              description={html}
              gpa={gpa}
              date={date}
            />
          )
        )}
      </Timeline>
    </Section>
  );
};

export default Education;
