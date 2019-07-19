import React from 'react';
import EducationItem from './EducationItem';
import Timeline from '../../Timeline';
import Section from '../Section';

const Education = props => (
  <Section id="education" title="Education">
    <Timeline>
      {props.education.map((education, idx) => (
        <EducationItem key={idx} {...education} />
      ))}
    </Timeline>
  </Section>
);

export default Education;
