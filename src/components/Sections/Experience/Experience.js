import React from 'react';
import ExperienceItem from './ExperienceItem';
import Timeline from '../../Timeline';

const Experience = props => (
  <section
    className="resume-section p-3 p-lg-5 d-flex justify-content-center"
    id="experience"
  >
    <div className="w-100">
      <h2 className="mb-5">Experience Professionnelle</h2>
      <Timeline>
        {props.experience.map((experience, idx) => (
          <ExperienceItem key={idx} {...experience} />
        ))}
      </Timeline>
    </div>
  </section>
);

export default Experience;
