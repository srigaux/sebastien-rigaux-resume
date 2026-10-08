import React from 'react';
import EducationItem from './EducationItem';
import Timeline from '../../Timeline';
import Section from '../Section';
import { injectIntl } from 'react-intl';

const Education = ({ educations, intl }) => {
  return (
    <Section
      id="education"
      title={intl.formatMessage({ id: 'sections_education_title' })}
    >
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

export default injectIntl(Education);
